# ericsche CodingSkills

A plugin of **custom agent skills** for **GitHub Copilot** and **Claude Code**,
distilled from hands-on development in the **Microsoft ecosystem** — Azure,
.NET, Microsoft 365, and Microsoft Graph.

Both GitHub Copilot CLI and Claude Code share the same `SKILL.md` format and the
same plugin + marketplace system, so a single repository works as a plugin for
**both** tools.

## What's inside

This repository is a **plugin marketplace** (`ericsche-codingskills`) that ships
one plugin (`codingskills`, displayed as **ericsche CodingSkills**). The plugin
bundles reusable skills that Copilot / Claude load automatically when a task
matches the skill's description.

| Skill | What it helps with |
| :---- | :----------------- |
| `azure-easy-auth` | Entra ID auth for Azure App Service (Easy Auth) & Static Web Apps; 403 / client-principal debugging |
| `dotnet-isolated-functions` | Running & debugging .NET-isolated Azure Functions locally (cold-start double-load, `func start` vs `dotnet run`) |
| `graph-app-only-email` | Sending mail via Microsoft Graph with app-only `Mail.Send` and local `DefaultAzureCredential` testing |

## Repository structure

```
CodingSkills/
├── .claude-plugin/
│   └── marketplace.json          # Marketplace catalog: "ericsche-codingskills"
├── plugins/
│   └── codingskills/
│       ├── .claude-plugin/
│       │   └── plugin.json        # Plugin manifest: "codingskills"
│       └── skills/
│           ├── azure-easy-auth/SKILL.md
│           ├── dotnet-isolated-functions/SKILL.md
│           └── graph-app-only-email/SKILL.md
├── LICENSE                        # MIT
└── README.md
```

## Install

### GitHub Copilot CLI

```shell
/plugin marketplace add ericsche/CodingSkills
/plugin install codingskills@ericsche-codingskills
```

You can also drop a skill directory into `.github/skills`, `.claude/skills`, or
`~/.copilot/skills`. Run `/skills list` to verify it loaded.

### Claude Code

```shell
/plugin marketplace add ericsche/CodingSkills
/plugin install codingskills@ericsche-codingskills
```

## Using the skills

Copilot / Claude pick a skill automatically based on your prompt and the skill's
description. You can also invoke one explicitly by name:

```
Use the /azure-easy-auth skill to debug my App Service 403.
```

## Add a new skill

1. Create `plugins/codingskills/skills/<skill-name>/SKILL.md`
   (lowercase, hyphenated directory name).
2. Add YAML frontmatter with `name` and `description` (state **what** it does
   and **when** to use it), then the instructions in the Markdown body.
3. Bundle any helper scripts or reference files in the same directory.

```markdown
---
name: my-skill
description: What it does and when Copilot/Claude should use it.
license: MIT
---

# My Skill

Step-by-step instructions...
```

## Contributing

This is a personal knowledge base. Suggestions and improvements are welcome via
issues and pull requests.

## License

Released under the [MIT License](LICENSE).
