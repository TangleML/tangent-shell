---
name: bundle-assembly
description: Assemble authored skills into a valid Tangent Configuration Bundle and package it as a zip. Use when laying out tangent.yaml, organizing bundle directories, or producing the final installable bundle archive.
---

# Bundle assembly

A Tangent Configuration Bundle is a `*.zip` that provisions a session. This
skill covers turning authored skills into a valid bundle and packaging it.

## 1. Lay out the source folder

Only `tangent.yaml` and `prompts/prime.md` are strictly required. Use the
conventional directories so entities are auto-discovered:

```
<bundle>/
├── tangent.yaml            # required manifest
├── icon.svg                # optional preview icon
├── prompts/prime.md        # required; appended to Prime's prompt
├── prompts/subagent.md     # optional default sub-agent prompt
├── skills/<name>/SKILL.md   # one directory per skill
├── workflows/<name>.md      # prompt templates
├── agents/<name>.md         # sub-agent templates (frontmatter + body)
├── rules/AGENTS.md          # copied to the workspace root
├── memory/*.md              # seed files copied into the workspace
└── tools/*.ts               # optional custom tool extensions
```

## 2. Write `tangent.yaml`

Required metadata: `schemaVersion: 1`, `id` (slug matching
`^[a-z0-9][a-z0-9-]*$`), `name`, `version` (your own semver). Optional:
`description`, `author`, `icon`, `tags`.

```yaml
schemaVersion: 1
id: my-bundle
name: My Bundle
version: 1.0.0
description: One-line summary.
icon: icon.svg

prime:
  systemPrompt: prompts/prime.md
  tools: [read, write, edit, bash]

subagents:
  defaultSystemPrompt: prompts/subagent.md
  defaultTools: [read, grep, find, ls]

skills:
  - skills/my-skill/SKILL.md
```

- Listing entity arrays (`skills`, `workflows`, `agents`, `memory`,
  `extensions`, `contextFiles`) makes the manifest authoritative and controls
  ordering. Omit them to rely on directory auto-discovery.
- Every listed path must be bundle-relative and safe: no `..`, no absolute
  paths.
- `software` (optional) is declarative metadata only, keyed by package manager
  (`npm`, `pip`, `brew`, `apk`, ...); it is not installed automatically.

## 3. Validate before packaging

- `schemaVersion` equals `1` and `id` is a non-empty slug.
- `prompts/prime.md` exists and every referenced path resolves.
- Each `skills/<name>/SKILL.md` has valid frontmatter (see the
  `skill-authoring` skill).

## 4. Package the zip

Preferred: call the `package_bundle` tool with the source folder. It re-checks
the manifest and writes `<id>.zip`.

Fallback (bash):

```bash
cd <parent-of-source> && zip -r <id>.zip <source-folder> -x '*.DS_Store' '*/.*'
```

Report the output path and the list of packaged files.
