# Copilot instructions for ericsche CodingSkills

This repository is **not application code**. It is a **plugin + marketplace of
agent skills** that works for **both GitHub Copilot CLI and Claude Code** (both
share the same `SKILL.md` format and the same plugin/marketplace system). Almost
all "work" here is authoring Markdown skills and keeping two small JSON manifests
valid — there is no compiler, server, or test framework.

## Architecture (the big picture)

Three layers reference each other; changing one usually means touching another:

1. **Marketplace** — `.claude-plugin/marketplace.json` (name: `ericsche-codingskills`).
   Its `plugins[].source` points at the plugin directory (`./plugins/codingskills`).
2. **Plugin** — `plugins/codingskills/.claude-plugin/plugin.json` (name:
   `codingskills`, `displayName` "ericsche CodingSkills"). The default `skills/`
   directory is auto-scanned; no `skills` field is needed unless adding custom paths.
3. **Skills** — `plugins/codingskills/skills/<skill-name>/SKILL.md` (+ optional
   `reference.md`, scripts, resources). Each skill is discovered by its `SKILL.md`.

Install/consumption path (identical in both tools):
`/plugin marketplace add ericsche/CodingSkills` → `/plugin install codingskills@ericsche-codingskills`.
Skills are namespaced as `codingskills:<skill-name>` and load automatically when a
prompt matches the skill's `description`.

## Skill authoring conventions (specific to this repo)

- **Frontmatter is dual-tool compatible.** Always include **both** `name` and
  `description` (Copilot requires `name`; Claude derives it from the dir name).
  `name` must be lowercase, hyphenated, ≤64 chars, and must **not** contain the
  reserved words `claude` or `anthropic`. `license: MIT` is included on each skill.
- **`description` is the trigger** — write it as *what it does* **and** *when to
  use it*, packed with the concrete symptoms/terms a user would type (e.g. exact
  error strings). This is the only text matched against a prompt before the skill
  loads.
- **Progressive disclosure.** Keep `SKILL.md` concise (roughly < 5k tokens):
  overview, when-to-use, key decisions, top pitfalls, workflow. Move long detail
  (full guides, big tables, code) into a sibling `reference.md` and link to it.
  `teams-sso-spa/` is the reference example of this SKILL.md + reference.md split.
- **Content is English and grounded in real experience.** Skills distill
  battle-tested Microsoft-ecosystem learnings (Azure, .NET, Microsoft 365,
  Microsoft Graph), not generic advice. When translating a source doc, translate
  fully — do not leave mixed languages.
- **Directory name == `name`** by convention (e.g. `skills/teams-sso-spa/` has
  `name: teams-sso-spa`).

## Validating changes (there is no test suite — run these instead)

Both manifests must stay valid JSON. From the repo root (PowerShell):

```powershell
# Validate the two manifests
Get-Content .claude-plugin\marketplace.json -Raw | ConvertFrom-Json | Out-Null
Get-Content plugins\codingskills\.claude-plugin\plugin.json -Raw | ConvertFrom-Json | Out-Null

# Validate a SINGLE skill's frontmatter (swap the directory name)
$lines = Get-Content plugins\codingskills\skills\teams-sso-spa\SKILL.md
$name  = ($lines | Where-Object { $_ -match '^name:\s*(.+)$' } | Select-Object -First 1) -replace '^name:\s*',''
$ok    = ($name -cmatch '^[a-z0-9-]{1,64}$') -and ($name -notmatch 'claude|anthropic') -and [bool]($lines | Where-Object { $_ -match '^description:\s*.+' })
"valid=$ok name=$name"
```

To verify a skill actually loads in a session, use `/skills list` and
`/skills info <skill-name>` (or `/skills reload` after adding one mid-session).

## Adding a skill (exact steps)

1. Create `plugins/codingskills/skills/<skill-name>/SKILL.md` with `name` +
   `description` frontmatter and a Markdown body of instructions.
2. If it grows long, split detail into `reference.md` in the same directory and
   link to it from `SKILL.md`.
3. Feature it in `README.md` (skills table) — the README is kept in sync with the
   skill set and the repo structure diagram.
4. Bump `version` in `plugin.json` on a meaningful release so installed users get
   the update (otherwise the git commit SHA is treated as the version).
