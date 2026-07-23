#!/usr/bin/env node
// Gate 0 link/anchor checker for contributed workflow + reference content
// (see the pre-pr-review skill's reference.md). Catches the two most common breakages in
// ported markdown: dead relative links and stale in-page `#anchors`.
//
// Understands the wiqd compose convention: at install, an extension's references
// are namespaced under `references/<ext>/`, so a WORKFLOW that links
// `references/atk/authentication.md#entra-sso` is validated against the source
// file `packages/wiqd-ext-atk/references/authentication.md`. Reference->reference
// links are plain same-directory paths and are resolved normally.
//
// Checks, per markdown link `[text](target)` (and bare `#anchor`):
//   - relative target file exists (any extension)
//   - `#anchor` resolves to a heading slug (GitHub rules) in the target `.md`
//     file, or the current file for a same-page `#anchor`
// External links (http(s)://, mailto:, tel:, //, data:) are ignored.
//
// SCOPE: changed files under packages/wiqd-ext-*/{workflows,references} by
// default; `--all` for a full audit; explicit file paths to scan just those.
//
// Exit 0 -> clean | 1 -> violations | 2 -> invalid invocation / IO error

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const PKG_ROOT = join(ROOT, 'packages');
const SCAN_KINDS = ['workflows', 'references'];

// ── argument parsing ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let mode = 'diff';
let base = null;
const explicitFiles = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--all') mode = 'all';
  else if (a === '--base') base = argv[++i];
  else if (a === '-h' || a === '--help') {
    console.log('usage: check-md-links.mjs [--all | --base <ref> | <file.md> ...]');
    process.exit(0);
  } else if (a.startsWith('--')) {
    console.error(`check-md-links: unknown option ${a}`);
    process.exit(2);
  } else {
    explicitFiles.push(a);
    mode = 'files';
  }
}

// ── file discovery ───────────────────────────────────────────────────────────
function collectMd(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      collectMd(p, out);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(p);
    }
  }
}

function inScope(relPath) {
  const norm = relPath.split(sep).join('/');
  return SCAN_KINDS.some((k) => new RegExp(`^packages/wiqd-ext-[^/]+/${k}/.*\\.md$`).test(norm));
}

function resolveBase() {
  if (base) return base;
  for (const cand of ['origin/main', 'main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', cand], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return cand;
    } catch {
      /* try next */
    }
  }
  return null;
}

function changedFiles() {
  const ref = resolveBase();
  if (!ref) {
    console.error('check-md-links: no base ref (origin/main / main) found; use --base or --all.');
    process.exit(2);
  }
  const sets = [
    ['diff', '--name-only', '--diff-filter=ACMR', `${ref}...HEAD`],
    ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'],
    ['diff', '--name-only', '--diff-filter=ACMR', '--cached'],
  ];
  const files = new Set();
  for (const args of sets) {
    let out = '';
    try {
      out = execFileSync('git', args, { encoding: 'utf8' });
    } catch {
      continue;
    }
    for (const line of out.split(/\r?\n/)) {
      if (line && inScope(line)) files.add(join(ROOT, line));
    }
  }
  return [...files].filter((f) => existsSync(f));
}

let targets = [];
if (mode === 'files') {
  targets = explicitFiles.map((f) => (f.startsWith(ROOT) ? f : join(ROOT, f)));
} else if (mode === 'all') {
  try {
    for (const e of readdirSync(PKG_ROOT, { withFileTypes: true })) {
      if (!e.isDirectory() || !e.name.startsWith('wiqd-ext-')) continue;
      for (const kind of SCAN_KINDS) {
        const base2 = join(PKG_ROOT, e.name, kind);
        if (existsSync(base2)) collectMd(base2, targets);
      }
    }
  } catch {
    console.error('check-md-links: cannot read packages/ — run from the repo root.');
    process.exit(2);
  }
} else {
  targets = changedFiles();
}

if (targets.length === 0) {
  console.log('OK: check-md-links — no in-scope changed files to check.');
  process.exit(0);
}

// ── heading-slug extraction (GitHub rules) with memoization ──────────────────
const anchorCache = new Map(); // absPath -> Set<slug> | null (unreadable)

function githubSlug(text, seen) {
  let s = text
    .trim()
    .toLowerCase()
    .replace(/`([^`]*)`/g, '$1') // drop inline-code backticks, keep content
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // link/image -> its text
    .replace(/[*_~]/g, '') // strip emphasis markers
    .replace(/[^\w\s-]/gu, '') // strip remaining punctuation (keeps \w incl. _, spaces, -)
    .replace(/\s/g, '-'); // GitHub maps EACH space to a hyphen (does not collapse runs)
  const base3 = s;
  let n = seen.get(base3) ?? 0;
  if (n > 0) s = `${base3}-${n}`;
  seen.set(base3, n + 1);
  return s;
}

function anchorsFor(absPath) {
  if (anchorCache.has(absPath)) return anchorCache.get(absPath);
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    anchorCache.set(absPath, null);
    return null;
  }
  const slugs = new Set();
  const seen = new Map();
  let inFence = false;
  let fence = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const fenceMatch = line.match(/^(\s*)(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      if (!inFence) {
        inFence = true;
        fence = marker;
      } else if (marker === fence) {
        inFence = false;
        fence = '';
      }
      continue;
    }
    if (inFence) continue;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) slugs.add(githubSlug(h[1], seen));
    // explicit HTML anchors
    for (const m of line.matchAll(/<a\s+[^>]*(?:name|id)\s*=\s*["']([^"']+)["']/gi))
      slugs.add(m[1].toLowerCase());
    // {#custom-id} attribute syntax
    for (const m of line.matchAll(/\{#([A-Za-z0-9._-]+)\}/g)) slugs.add(m[1].toLowerCase());
  }
  anchorCache.set(absPath, slugs);
  return slugs;
}

// ── link resolution ──────────────────────────────────────────────────────────
function extShortOf(relPath) {
  const m = relPath
    .split(sep)
    .join('/')
    .match(/^packages\/wiqd-ext-([^/]+)\//);
  return m ? m[1] : null;
}

const EXTERNAL = /^(https?:|mailto:|tel:|data:|\/\/|#!)/i;
const violations = [];
function report(file, line, msg) {
  violations.push(`${relative(ROOT, file).split(sep).join('/')}:${line}: ${msg}`);
}

// [text](target) — target up to first whitespace (ignore optional "title")
const LINK_RE = /\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

for (const file of targets) {
  const relPath = relative(ROOT, file).split(sep).join('/');
  const ext = extShortOf(relPath);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    report(file, 0, 'unable to read file');
    continue;
  }
  const lines = text.split(/\r?\n/);
  // Precompute this file's own anchors for same-page links.
  const selfAnchors = anchorsFor(file) ?? new Set();

  let inFence = false;
  let fence = '';
  lines.forEach((raw, i) => {
    const ln = i + 1;
    const fenceMatch = raw.match(/^(\s*)(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      if (!inFence) {
        inFence = true;
        fence = marker;
      } else if (marker === fence) {
        inFence = false;
        fence = '';
      }
      return;
    }
    if (inFence) return;

    // Blank out inline-code spans so `[x](y)` written inside backticks is not
    // treated as a live markdown link (positions preserved with spaces).
    const scan = raw.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length));

    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(scan)) !== null) {
      const target = m[1];
      if (EXTERNAL.test(target)) continue;

      const hashIdx = target.indexOf('#');
      const path = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
      const anchor = hashIdx >= 0 ? target.slice(hashIdx + 1) : null;

      // same-page anchor
      if (path === '') {
        if (anchor && !selfAnchors.has(anchor.toLowerCase())) {
          report(file, ln, `dead same-page anchor \`#${anchor}\``);
        }
        continue;
      }

      // resolve the target file to a source path
      let absTarget;
      const composed = path.match(/^references\/([^/]+)\/(.+)$/);
      if (composed && ext && composed[1] === ext) {
        absTarget = join(PKG_ROOT, `wiqd-ext-${ext}`, 'references', composed[2]);
      } else {
        absTarget = resolve(dirname(file), path);
      }

      if (!existsSync(absTarget)) {
        report(file, ln, `broken link — target not found: \`${target}\``);
        continue;
      }
      if (anchor && absTarget.endsWith('.md') && statSync(absTarget).isFile()) {
        const set = anchorsFor(absTarget);
        if (set && !set.has(anchor.toLowerCase())) {
          report(file, ln, `dead anchor \`#${anchor}\` in \`${path}\``);
        }
      }
    }
  });
}

if (violations.length === 0) {
  console.log(`OK: check-md-links — ${targets.length} file(s) clean.`);
  process.exit(0);
}
console.error(`check-md-links: ${violations.length} issue(s) found:\n`);
for (const v of violations) console.error('  ' + v);
console.error('\nSee the pre-pr-review skill reference.md (Gate 0).');
process.exit(1);
