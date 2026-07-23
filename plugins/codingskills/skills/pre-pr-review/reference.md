# Pre-PR self-review — reference

Full detail for the [`pre-pr-review`](SKILL.md) skill: the two bundled Gate-0 lint
scripts, the compose-path convention they understand, the GitHub anchor-slug rules,
how to adapt the port-lint to another repo, a real calibration story (including findings
that were **refuted**), and CI-wiring notes.

## The two bundled scripts

Both live in [`scripts/`](scripts/), are plain Node ES modules (`node:fs`,
`node:child_process` — no dependencies), and share the same CLI:

```
node <path>/check-md-links.mjs            # default: files changed vs the base ref
node <path>/check-md-links.mjs --base <ref>
node <path>/check-md-links.mjs --all      # full audit of the in-scope trees
node <path>/check-md-links.mjs <file.md> ...   # explicit files
```

- **Run from the target repo root** — `ROOT = process.cwd()`.
- **Diff scope by default.** They union three git sets: `<base>...HEAD` (committed on the
  branch), unstaged (`HEAD`), and staged (`--cached`), then keep only in-scope files. This
  is the correct behaviour for a *pre-PR* gate: it flags what **your change** introduces
  and stays silent on legacy content. Base ref auto-detects `origin/main` then `main`;
  override with `--base`.
- **Exit codes:** `0` clean · `1` violations (printed `file:line: message`) · `2` bad
  invocation / IO error.

### check-md-links.mjs (broadly reusable)

Validates, for every markdown link `[text](target)` and bare `#anchor`:

- the relative target **file exists** (any extension), and
- a `#anchor` resolves to a heading **slug** in the target `.md` (or the current file for a
  same-page anchor).

It ignores external links (`http(s):`, `mailto:`, `tel:`, `data:`, `//`) and **blanks
inline-code spans** so a `[x](y)` written inside backticks is not treated as a live link.
Fenced code blocks are skipped entirely.

**Compose awareness (wiqd layout):** a link in a `workflows/` file written
`references/<ext>/x.md#a` is resolved against the *source* file
`packages/wiqd-ext-<ext>/references/x.md`. This exists because at install the tool
namespaces each extension's references under `references/<ext>/`, so the authored link and
the on-disk path differ. Reference→reference links are plain same-directory paths.

### check-ported-content.mjs (tuned for wiqd / ATK ports)

Line-scans in-scope files for residual **port artifacts** and reports them. Default rules:

- un-remapped **upstream skill names** (`ui-widget-developer`, `declarative-agent-developer`,
  `setup-sso-ui-widget`, `m365-json-agent-developer`, `mcp-apps-azure-functions`,
  `teams-app-developer`, `m365-agent-evaluator`),
- `AskUserQuestion` (a foreign tool name),
- `ATK_CLI_SKILL` and the raw `npx … m365agentstoolkit-cli atk` invocation,
- non-canonical `chat/?titleId` deep links (should be `chat?titleId`),
- `workflows/` → reference links that skip the composed `references/<ext>/` prefix.

**Suppression** (eslint-style, for intentional hits such as documentation/provenance):

```
... the ui-widget-developer skill <!-- gate0-ignore: docs -->      # this line
<!-- gate0-ignore-next: fenced example -->                          # the next line
```

Use `-next` when the hit is inside a fenced code block (an inline HTML comment would render
literally there).

## Adapting the port-lint to another repo

`check-ported-content.mjs` is deliberately small; edit the top of the file:

- **`UPSTREAM_SKILL_NAMES`** — the source names that must be remapped in your target.
- **`TOKEN_RULES`** — `{ re, msg }` pairs for foreign tool names / commands / URL shapes.
- **`SCAN_KINDS`** and **`inScope()`** — the directories that hold contributed content
  (defaults to `packages/wiqd-ext-*/{workflows,references}`).

`check-md-links.mjs` usually needs only `SCAN_KINDS` / `inScope()` and, if you do not use
the compose layout, you can drop the `references/<ext>/` mapping branch (plain relative
resolution then covers everything).

## GitHub anchor-slug rules (why the checker is picky)

The link checker reproduces GitHub's heading→slug algorithm. The subtle parts:

- lowercase; strip inline-code backticks (keep content); reduce `[text](url)` to `text`;
  strip emphasis markers; remove punctuation **except** word chars, spaces, and `-`.
- **Map each space to its own `-` — do not collapse runs.** This is the common surprise:
  `## Production Hosting — Azure App Service (Easy Auth)` becomes
  `production-hosting--azure-app-service-easy-auth` — a **double** hyphen, because the
  removed em-dash leaves two spaces (`Hosting`␠␠`Azure`) that each become a hyphen.
- duplicate headings get `-1`, `-2`, … suffixes.
- explicit `<a name>`/`<a id>` and `{#custom-id}` anchors are also honored.

## Calibration story (PR #1853) — and what was *refuted*

The skill's Gate 1 is only useful if you **calibrate** its output. On the port PR that
seeded this skill, two AI-generated colleague reviews produced ~30 findings; sub-agent
re-review then **refuted several**:

- *"routing-order value collides"* — REFUTED: order is **not** unique-enforced; the build
  conflict gate only fails on duplicate workflow **id / routing-label / trigger-phrase**,
  and two shipped workflows already shared an order. Routing is trigger-phrase driven.
- *"lifecycle-order / theme keys are wrong"* — REFUTED: those keys are consumed by **no**
  builder; the new workflows have no such block.
- *"work-iq frontmatter was retained in references"* — REFUTED: references legitimately
  carry frontmatter in this repo, so a blanket "references have no frontmatter" lint is a
  false-positive generator (it was removed from the port-lint for exactly this reason).
- *"routing loop between workflows"* — REFUTED on inspection.

Confirmed and fixed, by contrast: a **public unauthenticated App Service** example (P1),
CORS-is-not-auth and anonymous-tunnel **semantics** (kept `--allow-anonymous` for local
dev but documented the risk), authN≠authZ in an Easy Auth snippet, and several
verbatim-from-upstream code-sample bugs (fixed **in-repo** because the source was being
deprecated). The lesson encoded in Gate 1's prompt: demand a **verdict + evidence +
introduced-vs-upstream** for every finding, and treat *refuted with evidence* as success.

## Two failure modes this tooling itself hit (worth knowing)

- A pre-PR gate must scan the **diff**, not the whole repo — an early whole-repo version
  flagged legacy files that were not part of the change. Hence the diff-scoped default.
- A hand-rolled slugger that used `\s+` (collapsing) mis-flagged every em-dash heading;
  GitHub maps **each** space. Verify a slugger against real double-space cases.

## CI wiring (optional follow-up)

Model it on a repo's existing custom-lint step (e.g. a comment-ref scanner wired into a CI
job and the `pre-push` hook). Two caveats specific to these scripts:

- Run them **diff-scoped** in CI so the PR base ref must be fetched (avoid shallow clones
  without the base), **or**
- switch to `--all` only **after** clearing the pre-existing legacy hits an `--all` audit
  reports — otherwise the job fails on unrelated legacy content.
