#!/usr/bin/env node
// Gate 0 lint for ported contributed content (see the pre-pr-review skill's reference.md).
//
// Scans changed markdown under packages/wiqd-ext-*/{workflows,references} for
// residual "port" artifacts left over from a work-iq -> wiqd adaptation:
//   - upstream work-iq skill names that should have been remapped to a wiqd
//     workflow/reference (e.g. `ui-widget-developer` -> the `ui-widget` workflow)
//   - the AskUserQuestion tool name (a work-iq/Claude concept, not wiqd)
//   - the ATK_CLI_SKILL telemetry tag and the raw
//     `npx ... m365agentstoolkit-cli atk` invocation (use `wiqd agent …`)
//   - the non-canonical `chat/?titleId` deep-link (wiqd uses `chat?titleId`)
//   - workflow -> reference links that skip the composed `references/<ext>/` prefix
//
// SCOPE: by default only files changed vs a base ref are scanned, so the gate
// flags what THIS change introduces and stays quiet on legacy content. Provide
// `--all` for a full audit, or explicit file paths to scan just those.
//
// specs/** is intentionally out of scope: skill-name mentions there are provenance
// citations. Reference frontmatter is NOT checked (it is a valid, common pattern).
//
// Suppression (eslint-style, for intentional hits such as documentation/provenance):
//   `<!-- gate0-ignore: reason -->`       on the SAME line  -> suppress that line
//   `<!-- gate0-ignore-next: reason -->`  on the line ABOVE -> suppress the next line
// (use the -next form when the hit is inside a fenced code block, where an inline
// HTML comment would render literally).
//
// Usage:
//   node scripts/check-ported-content.mjs                 # changed vs origin/main (or main)
//   node scripts/check-ported-content.mjs --base <ref>    # changed vs <ref>
//   node scripts/check-ported-content.mjs --all           # full audit
//   node scripts/check-ported-content.mjs <file.md> ...   # explicit files
//
// Exit 0 -> clean | 1 -> violations | 2 -> invalid invocation / IO error

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const PKG_ROOT = join(ROOT, 'packages');
const SCAN_KINDS = ['workflows', 'references'];

// Upstream work-iq skill names that must be remapped in wiqd contributed content.
const UPSTREAM_SKILL_NAMES = [
  'ui-widget-developer',
  'declarative-agent-developer',
  'setup-sso-ui-widget',
  'm365-json-agent-developer',
  'mcp-apps-azure-functions',
  'teams-app-developer',
  'm365-agent-evaluator',
];

const TOKEN_RULES = [
  {
    re: /\bAskUserQuestion\b/,
    msg: 'residual AskUserQuestion tool reference — use a generic "ask the user"',
  },
  { re: /\bATK_CLI_SKILL\b/, msg: 'residual ATK_CLI_SKILL telemetry tag (work-iq only)' },
  {
    re: /npx\s+-y\s+--package\s+@microsoft\/m365agentstoolkit-cli\s+atk\b/,
    msg: 'raw ATK npx invocation — use `wiqd agent …` (an explicit `atk deploy` mention is fine)',
  },
  {
    re: /m365\.cloud\.microsoft\/chat\/\?/,
    msg: 'non-canonical deep link — use `chat?titleId` (no slash before `?`)',
  },
];
for (const name of UPSTREAM_SKILL_NAMES) {
  TOKEN_RULES.push({
    re: new RegExp(`(^|[^A-Za-z0-9/-])${name}(?![A-Za-z0-9-])`),
    msg: `un-remapped upstream skill name \`${name}\` — remap to the wiqd workflow/reference (or add gate0-ignore if intentional)`,
  });
}

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
    console.log('usage: check-ported-content.mjs [--all | --base <ref> | <file.md> ...]');
    process.exit(0);
  } else if (a.startsWith('--')) {
    console.error(`check-ported-content: unknown option ${a}`);
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
    console.error(
      'check-ported-content: no base ref (origin/main / main) found; use --base or --all.',
    );
    process.exit(2);
  }
  const sets = [
    ['diff', '--name-only', '--diff-filter=ACMR', `${ref}...HEAD`], // committed on this branch
    ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'], // unstaged
    ['diff', '--name-only', '--diff-filter=ACMR', '--cached'], // staged
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
    console.error('check-ported-content: cannot read packages/ — run from the repo root.');
    process.exit(2);
  }
} else {
  targets = changedFiles();
}

if (targets.length === 0) {
  console.log('OK: check-ported-content — no in-scope changed files to check.');
  process.exit(0);
}

// ── scan ─────────────────────────────────────────────────────────────────────
const violations = [];
function report(file, line, msg) {
  violations.push(`${relative(ROOT, file).split(sep).join('/')}:${line}: ${msg}`);
}

for (const file of targets) {
  const relPath = relative(ROOT, file).split(sep).join('/');
  const isWorkflow = /\/workflows\//.test(relPath);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    report(file, 0, 'unable to read file');
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const ln = i + 1;
    const suppressed =
      /gate0-ignore(?!-next)/.test(line) || (i > 0 && /gate0-ignore-next/.test(lines[i - 1]));
    if (!suppressed) {
      for (const { re, msg } of TOKEN_RULES) {
        if (re.test(line)) report(file, ln, msg);
      }
    }
    if (isWorkflow) {
      const linkRe = /\]\((references\/[^)]+?\.md)(#[^)]*)?\)/g;
      let m;
      while ((m = linkRe.exec(line)) !== null) {
        const target = m[1];
        const seg = target.split('/'); // references/<ext>/<file>
        if (seg.length < 3) {
          report(
            file,
            ln,
            `workflow link \`${target}\` must use the composed prefix \`references/<ext>/\``,
          );
        }
      }
    }
  });
}

if (violations.length === 0) {
  console.log(`OK: check-ported-content — ${targets.length} file(s) clean.`);
  process.exit(0);
}
console.error(`check-ported-content: ${violations.length} issue(s) found:\n`);
for (const v of violations) console.error('  ' + v);
console.error('\nSee the pre-pr-review skill reference.md (Gate 0). Suppress an intentional');
console.error('hit with an inline `<!-- gate0-ignore: reason -->` comment.');
process.exit(1);
