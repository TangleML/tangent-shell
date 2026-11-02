# Tangent Configuration Bundle format

A **Tangent Configuration Bundle** is a portable `*.zip` that fully provisions a
session: its Prime and sub-agent prompts, tool allowlists, skills, workflows,
sub-agent templates, rules, and seed memory. A session created from a bundle
runs Pi with the bundle's prompts, tools, and extensions applied per-session
instead of the global server defaults.

This document is the human-readable spec. The machine-readable counterpart is
[`packages/shared/src/configBundle.ts`](../packages/shared/src/configBundle.ts)
(types + constants) and the validator in
[`apps/server/src/pi/config/manifest.ts`](../apps/server/src/pi/config/manifest.ts).

A bundle can also ship its own sandboxed UI components (input panels and custom
message components). That extension — its `ui:` manifest block, element
vocabulary, host bridge, and authoring rules — is specified separately under
[`bundle-ui/`](bundle-ui/README.md).

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
├── tools/
│   └── *.ts                # optional custom tool extensions (Pi --extension)
├── ui/
│   └── *.tsx               # optional sandboxed UI components (declared in ui:)
└── triggers/
    └── *.ts                # optional trigger transforms (signal -> prompt)
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
- `welcomeMessage` (optional) — relative path to a markdown file pre-seeded as
  Prime's first message at session creation, so the agent "speaks first" with no
  LLM call.
- `model` (optional) — `provider/model` id Prime runs; falls back to the server
  default.
- `thinking` (optional) — thinking depth (`off`, `minimal`, `low`, `medium`,
  `high`, `xhigh`); falls back to the server default.

### `subagents` (optional)

- `defaultSystemPrompt` (optional) — relative path to the default sub-agent
  prompt (typically `prompts/subagent.md`).
- `defaultTools` (optional) — default tool allowlist for sub-agents without an
  explicit list.
- `defaultModel` (optional) — default `provider/model` id for sub-agents lacking
  an explicit one.
- `defaultThinking` (optional) — default thinking depth for sub-agents lacking an
  explicit one.

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
[`apps/server/src/pi/agents/worker.md`](../apps/server/src/pi/agents/worker.md).

### `memoryBinding` (optional)

The default memory binding for sessions created from this bundle — how the
agent's pluggable memory store is wired. A `CreateSessionRequest.memory`
overrides it. This is distinct from the `memory` list above, which only names
seed markdown files copied into the workspace.

- `kind: simple-md` — a single agent-writable `MEMORY.md`. `root` (optional) is a
  session-root-relative store directory.
- `kind: pi-memory` — the `pi-memory` store. `root` (optional) plus a `config`
  map (`exitSummary`, `snapshot`, `qmdUpdate`, `search`, `exitSummaryModel`).
- `kind: composite` — a `children` array combining multiple bindings.

### `globalExtensions` (optional)

Opt-in policy for the server's **global extensions** (packages installed via the
`/api/extensions` registry and the Settings → Extensions UI). This is the bundle
layer of a two-layer opt-in; a session's own selection overlays it. It takes one
of three forms:

- `all` — include every installed global extension; a session may override it.
- a list of extension ids — include these; a session may extend the list or drop
  to none, but cannot remove individual bundle ids.
- `{ only: [<id>, ...] }` — include exactly these ids, locked; a session may not
  override (a defined session selection is rejected). `{ only: [] }` locks the
  session to no extensions.

Each id is a slug matching `^[a-z0-9][a-z0-9-]*$`. When omitted, sessions default
to inheriting "no global extensions" unless their own selection opts in. This is
distinct from the `extensions` list above, which ships the bundle's own
`tools/*.ts` sources.

**`all` — include every installed global extension.** A session can still opt out
with `none` or narrow to a specific list; if the session says nothing, it inherits
`all`, so newly installed extensions are picked up on the next spawn.

```yaml
globalExtensions: all
```

**A list of ids — a default set the session can extend.** These ids are always
included. A session may add more ids (the result is the union) or drop to `none`,
but it cannot remove an individual bundle id.

```yaml
globalExtensions:
  - web-search
  - pdf-tools
```

**`only` — a locked set the session cannot override.** Exactly these ids are
applied; a session that supplies its own `extensions` selection is rejected with
`409`. Use the empty form to lock a session to no global extensions.

```yaml
globalExtensions:
  only:
    - web-search
```

```yaml
globalExtensions:
  only: []
```

How each bundle form resolves once a session's own selection overlays it:

| Bundle form       | Session omits | Session list           | Session `none` | Session `all` |
| ----------------- | ------------- | ---------------------- | -------------- | ------------- |
| (field absent)    | none          | that list              | none           | all           |
| `all`             | all           | that list (exactly)    | none           | all           |
| `[a, b]`          | `[a, b]`      | `[a, b]` + session ids | none           | all           |
| `{ only: [...] }` | those ids     | 409 rejected           | 409 rejected   | 409 rejected  |

### `ui` (optional)

Sandboxed UI components the bundle ships (input panels and custom message
components). The `ui:` block, its element vocabulary, host bridge, and authoring
rules are specified separately under [`bundle-ui/`](bundle-ui/README.md).

### `triggers` (optional)

Triggers are a per-session primitive that turn an **external signal** into a
prompt delivered to the session's Prime agent. A bundle can ship default
triggers; they are seeded into the session's mutable trigger store at install
time, and Prime can create, enable, disable, or delete triggers at runtime when
the user asks.

`triggers` is a list; each entry has:

- `name` (required) — stable slug (`^[a-z0-9][a-z0-9-]*$`), unique within the
  bundle.
- `kind` (required) — `schedule` (fires on a timer) or `callback` (exposes an
  inbound URL external systems POST to).
- `title` (optional) — display label; defaults to `name`.
- `prompt` (optional) — prompt template delivered to Prime when the trigger
  fires. Supports `{{path.to.value}}` interpolation against the signal payload.
  Required unless a `handler` is supplied.
- `handler` (optional) — bundle-relative path to a TS/JS transform
  (conventionally `triggers/<name>.ts`). The default export receives the raw
  signal and returns the prompt string (or `{ prompt }`). Transpiled on upload
  and executed server-side in a sandbox with a timeout. Runtime-created triggers
  cannot supply a handler — they are prompt-template only.
- `schedule` (required when `kind: schedule`) — a map with `every` (a duration
  string such as `"1h"`, `"30m"`, `"45s"`) or `cron` (a standard cron
  expression evaluated server-side). Supply one.
- `enabled` (optional) — whether the trigger is armed on install. Defaults to
  `true`.

A `callback` trigger is reachable at
`POST /api/sessions/<id>/triggers/<triggerId>/callback/<secret>`; the secret is
generated per trigger and returned once on creation. The JSON body is the signal
payload passed to the prompt template / handler.

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
  welcomeMessage: prompts/welcome.md
  model: anthropic/claude-sonnet-4
  thinking: medium
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
globalExtensions:
  - web-search
  - pdf-tools

triggers:
  - name: hourly-digest
    kind: schedule
    title: Hourly digest
    schedule:
      every: 1h
    prompt: Summarize what changed in the last hour and post a short digest.
  - name: incident-webhook
    kind: callback
    title: Incident webhook
    handler: triggers/incident.ts

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
entities are applied as Pi spawn flags:

- `prompts/prime.md` / `prompts/subagent.md` → `--append-system-prompt`
- `prime.tools` / `subagents.defaultTools` → `--tools`
- `prime.model` / `subagents.defaultModel` → `--provider` / `--model`
- `prime.thinking` / `subagents.defaultThinking` → `--thinking`
- `skills/<name>/SKILL.md` → `--skill <path>`
- `workflows/<name>.md` → `--prompt-template <path>`
- `tools/*.ts` → `--extension <path>`
- `globalExtensions` → resolved against the session's selection into the set of
  opted-in global extensions; each contributes its resources via `--extension` /
  `--skill` / `--prompt-template` and its tool names are unioned into `--tools`.
- `rules/AGENTS.md` and `memory/*.md` → copied to the workspace root, where Pi
  auto-discovers `AGENTS.md`/`CLAUDE.md` and memory files from `cwd`.
- `agents/<name>.md` → loaded as sub-agent templates Prime can spawn.
- `prime.welcomeMessage` → pre-seeded as Prime's first message at creation (no
  Pi flag, no LLM call).
- `memoryBinding` → resolves the session's memory store; no direct Pi flag.
- `ui.components` → transpiled on upload and rendered by the host; no Pi mapping.
- `triggers` → seeded into the session's mutable trigger store; `triggers/*.ts`
  handlers are transpiled on upload and executed server-side when a trigger
  fires (no Pi mapping; triggers deliver prompts via the same path as user
  chat).
- `software` → no Pi mapping; declarative metadata only (not installed
  automatically).

## Memory

Agents have two live, mutable memory stores in addition to any seed files:

- **Session memory** — `memory/MEMORY.md` is the canonical, agent-writable
  session store. Ship it to pre-seed the session; if you omit it, Prime creates
  it on its first write. Other `memory/*.md` files remain read-only seed
  context. The agent updates session memory directly when the user says to
  "remember"/"memorize" something or when it spots an obvious workflow
  improvement.
- **Global memory** — server-wide, shared by every session, read from the
  directory in the `GLOBAL_MEMORY_DIR` env var (default `<cwd>/.memory`, holding
  `GLOBAL_MEMORY.md`). A read-only snapshot is injected into each session.
  Global memory is only written on an explicit user request, or after the user
  confirms an agent's suggestion; the chat shows a highlighted card with the
  exact text stored.

## Versioning

- **`schemaVersion`** is an integer owned by Tangent. Increment it only on a
  backwards-incompatible change to the manifest shape or layout. The validator
  rejects any manifest whose `schemaVersion` does not match the version it
  understands.
- **`version`** is the bundle author's own semver for their preset and has no
  bearing on `schemaVersion`. The marketplace may use it to dedupe or order
  multiple revisions of the same `id`.
