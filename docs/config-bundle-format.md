# Tangent Configuration Bundle format

A **Tangent Configuration Bundle** is a portable `*.zip` that fully provisions a
session: its Prime and sub-agent prompts, tool allowlists, skills, workflows,
sub-agent templates, rules, and seed memory. A session created from a bundle
runs Pi with the bundle's prompts, tools, and extensions applied per-session
instead of the global server defaults.

This document is the human-readable spec. The machine-readable counterpart is
[`shared/configBundle.ts`](../shared/configBundle.ts) (types + constants) and
the validator in
[`server/src/pi/config/manifest.ts`](../server/src/pi/config/manifest.ts).

## Bundle layout

A bundle is a ZIP archive with this structure (only `tangent.yaml` and
`prompts/prime.md` are strictly required):

```
my-bundle.zip
├── tangent.yaml            # required manifest (see below)
├── icon.svg                # optional preview icon
├── prompts/
│   ├── prime.md            # appended to Prime's system prompt
│   └── subagent.md         # default appended prompt for sub-agents
├── skills/
│   └── <name>/SKILL.md     # a skill (passed to Pi via --skill)
├── workflows/
│   └── <name>.md           # a prompt template (Pi --prompt-template)
├── agents/
│   └── <name>.md           # a sub-agent template (frontmatter + body)
├── rules/
│   └── AGENTS.md           # copied to the workspace root; Pi auto-discovers it
├── memory/
│   └── *.md                # seed files copied into the workspace
└── tools/
    └── *.ts                # optional custom tool extensions (Pi --extension)
```

The conventional directories (`skills/`, `workflows/`, `agents/`, `memory/`,
`tools/`) are **auto-discovered** at install time when the matching manifest
list is omitted. Listing them explicitly in the manifest makes the manifest
authoritative and lets you control ordering or include files from non-standard
locations.

## `tangent.yaml`

The manifest is YAML with `schemaVersion: 1`.

### Metadata

- `schemaVersion` (required) — must equal `1`.
- `id` (required) — stable slug, matching `^[a-z0-9][a-z0-9-]*$`. Used as the
  marketplace identifier.
- `name` (required) — human-readable display name.
- `version` (required) — the author's semver for this preset (independent of
  `schemaVersion`).
- `description` (optional) — short summary for the marketplace.
- `author` (optional) — bundle author.
- `icon` (optional) — relative path to a preview icon; defaults to `icon.svg`.
- `tags` (optional) — array of strings for filtering and search.

### `prime` (required)

- `systemPrompt` (required) — relative path to the prompt appended to Prime's
  system prompt (typically `prompts/prime.md`).
- `tools` (optional) — Prime's tool allowlist. Orchestration tools
  (`spawn_subagent`, etc.) and `read_room` are added automatically at spawn, so
  they need not be listed.

### `subagents` (optional)

- `defaultSystemPrompt` (optional) — relative path to the default sub-agent
  prompt (typically `prompts/subagent.md`).
- `defaultTools` (optional) — default tool allowlist for sub-agents without an
  explicit list.

### Optional entity lists

When present these are authoritative; when omitted the conventional directory
is auto-discovered. Every entry must be a safe, bundle-relative path (no `..`,
no absolute paths).

- `skills` — `skills/<name>/SKILL.md` paths.
- `workflows` — `workflows/<name>.md` paths.
- `agents` — `agents/<name>.md` sub-agent template paths.
- `contextFiles` — files copied to the workspace root.
- `memory` — `memory/*.md` seed files.
- `extensions` — `tools/*.ts` custom tool extension paths.

Sub-agent templates under `agents/` use the existing frontmatter format
(`name`, `description`, `tools`, then a markdown body), identical to the
server's bundled templates such as
[`server/src/pi/agents/worker.md`](../server/src/pi/agents/worker.md).

### `software` (optional)

Declarative software requirements: the package managers, packages, and other
software a session needs installed to operate. The value is a map keyed by
package manager (e.g. `npm`, `pip`, `brew`, `apk`, `cargo`), each holding a
list of dependency specs:

- Each entry is a string of the form `"<package>"` or `"<package>:<version>"`.
- The `:<version>` suffix is an optional convention (e.g. `"typescript:^5"`,
  `"requests:2.31.0"`); it is recorded but not parsed or validated.
- Keys are arbitrary package-manager names, so any tool can be referenced
  without a schema change.

This block is **declarative metadata only**: Tangent records the requirements
but does not install them automatically.

## Example

```yaml
schemaVersion: 1
id: research-assistant
name: Research Assistant
version: 1.0.0
description: Web research workflow with a scout sub-agent and review template.
author: Tangent
icon: icon.svg
tags:
  - research
  - writing

prime:
  systemPrompt: prompts/prime.md
  tools:
    - read
    - write
    - edit
    - bash

subagents:
  defaultSystemPrompt: prompts/subagent.md
  defaultTools:
    - read
    - grep
    - find
    - ls

skills:
  - skills/web-research/SKILL.md
workflows:
  - workflows/literature-review.md
agents:
  - agents/scout.md
memory:
  - memory/project-notes.md
extensions:
  - tools/citations.ts

software:
  npm:
    - "typescript:^5"
  pip:
    - "requests:2.31.0"
  brew:
    - "ripgrep"
```

## How entities map onto Pi

At session creation the bundle is installed into the session workspace and its
entities are applied as Pi spawn flags (wired in Phase 3):

- `prompts/prime.md` / `prompts/subagent.md` → `--append-system-prompt`
- `prime.tools` / `subagents.defaultTools` → `--tools`
- `skills/<name>/SKILL.md` → `--skill <path>`
- `workflows/<name>.md` → `--prompt-template <path>`
- `tools/*.ts` → `--extension <path>`
- `rules/AGENTS.md` and `memory/*.md` → copied to the workspace root, where Pi
  auto-discovers `AGENTS.md`/`CLAUDE.md` and memory files from `cwd`.
- `agents/<name>.md` → loaded as sub-agent templates Prime can spawn.
- `software` → no Pi mapping; declarative metadata only (not installed
  automatically).

## Versioning

- **`schemaVersion`** is an integer owned by Tangent. Increment it only on a
  backwards-incompatible change to the manifest shape or layout. The validator
  rejects any manifest whose `schemaVersion` does not match the version it
  understands.
- **`version`** is the bundle author's own semver for their preset and has no
  bearing on `schemaVersion`. The marketplace may use it to dedupe or order
  multiple revisions of the same `id`.
