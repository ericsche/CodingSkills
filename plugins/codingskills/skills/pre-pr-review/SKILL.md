---
name: pre-pr-review
description: Two-gate self-review to run before opening or readying a pull request — cheap deterministic Gate-0 lints (dead markdown links, broken #anchors, residual port artifacts, format / line-ending / description-length gates) then a read-only sub-agent panel (code-review, security-review, rubber-duck, and for ports an explore/research provenance pass), then triage / calibrate / fix so the PR opens already clean. Use before "gh pr create" or flipping a draft PR to ready, when porting skills/references between repos (e.g. work-iq → wiqd / M365 Agents Toolkit), or for changes touching auth, deployment, or process-spawning guidance. Bundles two ready-to-run Node lint scripts (check-ported-content.mjs, check-md-links.mjs). See reference.md for the scripts, the composed-path convention, and calibration lessons.
license: MIT
---

# Pre-PR self-review (two gates)

Catch review findings **before** colleagues or CI see them. This skill codifies a
repeatable pre-PR pass: run cheap deterministic lints first (**Gate 0**), then a
read-only sub-agent panel (**Gate 1**), then triage and fix — so the PR opens already
clean. It was distilled from a large docs/skill **port PR** where ~30 reviewer findings
(cross-reference misses, broken composed links, a formatter-gated file with committed
drift, verbatim upstream code-sample bugs) were **all catchable before opening the PR**.

It **complements** (does not replace) any repo-native prepare-PR flow, CI, and human
review — it is the lightweight panel you can run from any clone.

## When to use

- Before `gh pr create`, or before flipping a draft PR to **ready**.
- Any non-trivial change; **strongly** for skill/reference **ports** between repos and
  for changes touching **auth, deployment, or process-spawning** guidance.
- A one-line typo fix only needs Gate 0.

## Gate 0 — deterministic lints (fast; green before spending agent time)

Run these first and fix everything they report. They are cheap and catch the
highest-frequency mistakes. Do **not** launch Gate 1 agents until Gate 0 is clean.

Two lint scripts are bundled in [`scripts/`](scripts/) next to this file. Run them from
your **target repo root** (they scan `process.cwd()`); both default to **diff-vs-base**
scope, take `--all` for a full audit, and accept explicit file paths.

1. **Markdown link + anchor check** — `node <skill>/scripts/check-md-links.mjs`
   Broadly reusable: validates relative links and in-page `#anchors` (GitHub slug rules,
   including em-dash `--` double-hyphens), ignoring external URLs and inline code. It is
   **compose-aware** for the wiqd layout (a workflow link `references/<ext>/x.md#a` maps
   to `packages/wiqd-ext-<ext>/references/x.md`). Docs-only trees that a formatter ignores
   are its sweet spot — no other gate catches their links.
2. **Ported-content lint** — `node <skill>/scripts/check-ported-content.mjs`
   Flags residual **port artifacts** (un-remapped upstream skill names, `AskUserQuestion`,
   toolchain-specific tokens, non-canonical deep links, links that skip the composed
   reference prefix). Ships tuned for the **wiqd / M365 Agents Toolkit (ATK)** porting
   workflow — adapt its token lists and scan roots for other repos (see reference.md).
   Suppress an intentional hit with `<!-- gate0-ignore: reason -->` (same line) or
   `<!-- gate0-ignore-next: reason -->` (line above, for hits in a fenced code block).

Then the **manual** deterministic gates (no script needed):

3. **Format on the diff — never assume ignore-file coverage.** Run the repo's formatter
   check (`prettier --check`, `dotnet format --verify-no-changes`, etc.) on the changed
   files; a tree you *think* is ignored often is not.
4. **Description-length cap.** If you add/edit an agent-skill `description:`, measure its
   **joined/folded** length — over the loader's cap (often 1024 chars) the skill is
   silently dropped.
5. **Line endings.** New files must match the repo's `eol` policy (usually **LF**); CRLF
   can fail `git add` under `core.safecrlf` / a `.gitattributes` `eol=lf` rule.

## Gate 1 — read-only sub-agent panel (parallel; on the branch diff)

Launch against `git diff <base>...<branch>`. Give each agent complete context (for a port:
the source repo, the target layout, and what is newly-introduced vs verbatim-from-upstream
— point them at the source clone for provenance).

| Agent                  | Reviews                                                      | Run when                     |
| ---------------------- | ------------------------------------------------------------ | ---------------------------- |
| `code-review`          | logic, architecture, consistency, code-sample bugs           | always                       |
| `security-review`      | security-relevant guidance/code (auth, deploy, exec, secrets) | diff touches auth/infra/exec |
| `rubber-duck`          | high-signal design / contradiction feedback                  | non-trivial changes          |
| `explore` / `research` | verify cross-reference remaps + provenance vs the source repo | ports                        |

**Prompt each agent to** return a verdict per finding (CONFIRMED / PARTIALLY VALID /
REFUTED), evidence (`file:line`), a calibrated severity, whether it is
**introduced-here or verbatim-from-upstream**, and a concrete fix. Ask them to be skeptical.

## Triage (you)

1. Consolidate and de-dup findings across agents.
2. **Calibrate** — confirm or refute each against the code; AI reviewers over- and
   under-state. Refuting *with evidence* is a valid, valuable outcome.
3. Fix confirmed findings; group by theme into reviewable commits.
4. **Re-run** the relevant agent on the fix to confirm closure.
5. Provenance: if the source repo is deprecated, fix verbatim bugs **here**; otherwise fix
   upstream and re-sync.

Then open the PR (draft; a human flips it to ready) and post a short "pre-review done"
note listing what was found, refuted, and deferred.

## Anti-patterns

- Launching the agent panel before Gate 0 is green (wastes agent turns on lint-level issues).
- Trusting an AI reviewer verbatim — **always calibrate** against the code before acting.
- Assuming an ignore-file covers a tree — verify with the formatter on the diff.
- Making `--no-verify` a habit — it signals the local hooks are not set up; they would have
  caught format/lint issues locally.
- Fixing an upstream-verbatim bug in-repo without recording provenance (drift risk).

## Reference

- [reference.md](reference.md) — the two bundled scripts (what they catch, all run modes,
  the compose convention, GitHub anchor-slug rules), how to adapt the port-lint to another
  repo, the PR #1853 calibration story (findings that were **refuted**), and CI-wiring notes.
