---
name: tangle-cli
description: Drive the open-source Tangle CLI (`tangle-cli`) for local pipeline/component workflows, run submission and inspection, and use the bundle's API tool to save complete pipeline definitions. Use to validate, hydrate, save, submit, inspect, or debug Tangle pipelines and runs.
allowed-tools: [Bash, Read, tangle_pipeline_save]
---

# Tangle CLI

All command-line work against Tangle goes through the open-source
[`tangle-cli`](https://github.com/TangleML/tangle-cli). Invoke it as
`uv run tangle ...`. This skill is the canonical reference; the role agents
(`builder`, `debugger`, `reviewer`, `researcher`, `reporter`, `designer`) point
here instead of duplicating the command list.

The CLI is split into two families:

- `tangle api ...` — thin OpenAPI wrappers around backend endpoints.
- `tangle sdk ...` — hand-written local and API-backed workflows (validate,
  hydrate, submit, component generation, etc.).

## Install (once)

`tangle-cli` is not bundled — it must be installed first. Any of:

```bash
# Recommended: install as an isolated uv tool
uv tool install tangle-cli

# Or run ad-hoc without installing
uvx tangle-cli --help

# Or into the current environment (native extra enables static API commands)
pip install 'tangle-cli[native]'
```

Verify and discover commands:

```bash
uv run tangle --help
uv run tangle quickstart
uv run tangle sdk --help
uv run tangle api --help
```

Any command's exact options: `uv run tangle sdk pipelines validate --help`.

## Auth & environment

API-backed commands need a base URL and (usually) auth. Explicit flags win over
config-file values, which win over environment defaults.

- `--base-url` / `TANGLE_API_URL` — API origin (defaults to the local dev API).
- `--token` / `TANGLE_API_TOKEN` — bearer token shorthand.
- `--auth-header` / `TANGLE_API_AUTH_HEADER` — full `Authorization` value
  (`Bearer ...` / `Basic ...`).
- `-H` / `--header` — extra headers, repeatable.
- `--log-type` — `console`, `none`, or `file`. Progress logs go to stderr / a
  temp file so structured stdout stays parseable; use `none` for
  machine-readable output.

Local-only commands (validate, hydrate, layout, diagram, component generation)
need no base URL or auth.

## Saving a pipeline definition

Use the bundle's `tangle_pipeline_save` tool to create or update a saved
pipeline from a complete definition. It uses the existing server-side egress
authentication, so no browser editor or backend credential in the agent
workspace is needed. CLI run submission creates a run; saving a pipeline is a
separate operation.

- `root_pipeline_task`: the full backend TaskSpec. Embed the complete component
  spec at `componentRef.spec`, including its `name`, graph/tasks, and wiring.
  Preserve configured task arguments. Validate and hydrate references as
  needed before saving; this tool does not build a definition from a prompt.
  The backend TaskSpec does not accept `taskInfo` on the root or nested tasks;
  omit those fields from CLI-generated definitions while preserving the graph.
  CLI validation of a component spec alone does not validate the complete
  backend TaskSpec.
- Supply exactly one of `file_path` or `pipeline_id`. Use a unique path such as
  `pipelines/<unique-id>.yaml` for a new pipeline. Saving to an existing caller
  path updates that pipeline under the backend's upsert contract. Use
  `pipeline_id` to update a known saved pipeline; the backend checks write permissions.
- `pipeline_run_annotations` is an optional string map. Never copy project run
  membership annotations from `TANGLE_ROOT_CONFIG` into a saved pipeline.
- `project_id` attaches the saved pipeline through the existing project
  resource API. Use the id from this session's seeded project memory when
  present, including when Prime passes it in a delegated task.

The tool verifies the authenticated backend caller with `/api/users/me`, then
waits for the save response. User identity in conversation context and session
membership do not grant permission to update another user's pipeline. The
tool omits `versioning_mode` to preserve the backend's versioning policy.

On success it returns `saved: true`, `id`, `name`, `user_id`,
`authenticated_user_id`, `file_path`, version details, and
`target: "pipeline://remote/<id>"`, plus project attachment details when
requested. Report persistence or attachment failures accurately; do not claim
completion before the backend confirms the save. Reuse the same creation path
when retrying an uncertain save to avoid creating duplicate pipelines.

The browser-hosted `create_pipeline` tool only creates and opens an empty
draft, returning tab/environment information. Use `tangle_pipeline_save` for
complete saved creation even if browser naming guidance mentions that tool.
After saving, `open_workarea_target` can open the returned target when a
browser is connected. Opening it is optional and must not gate persistence.

## Command reference

Local pipeline commands:

```bash
uv run tangle sdk pipelines validate pipeline.yaml
uv run tangle sdk pipelines hydrate pipeline.yaml --output hydrated.yaml
uv run tangle sdk pipelines diagram pipeline.yaml
uv run tangle sdk pipelines layout pipeline.yaml --recursive
```

Pipeline-run commands (API-backed):

```bash
# Submit (hydrates refs by default). --dry-run prints the payload; --no-hydrate
# submits the local YAML as-is. Args and annotations are repeatable flags.
uv run tangle sdk pipeline-runs submit pipeline.yaml --config config.yaml
uv run tangle sdk pipeline-runs submit pipeline.yaml --arg key=value --annotation tangent=true
uv run tangle sdk pipeline-runs submit pipeline.yaml --dry-run --log-type none

uv run tangle sdk pipeline-runs status RUN_ID
uv run tangle sdk pipeline-runs wait RUN_ID --max-wait 600 --poll-interval 10
uv run tangle sdk pipeline-runs logs EXECUTION_ID
uv run tangle sdk pipeline-runs export RUN_ID --output pipeline.yaml
uv run tangle sdk pipeline-runs annotations set RUN_ID key value
```

Artifacts (API-backed):

```bash
uv run tangle sdk artifacts get --run-id RUN_ID --query '{"artifact_ids":["artifact-id"]}'
```

Components:

```bash
uv run tangle sdk components generate from-python component.py --image python:3.12
uv run tangle sdk components bump-version component.yaml
uv run tangle sdk published-components search "<keyword>"
uv run tangle sdk published-components inspect "<name-or-digest>"
uv run tangle sdk published-components publish components/my-component.yaml --dry-run
```

Direct API (positional path params, query params as options):

```bash
uv run tangle api pipeline-runs list --base-url https://api.example
uv run tangle api pipeline-runs get RUN_ID
uv run tangle api components get DIGEST
uv run tangle api published-components list
```

## Not available in the OSS CLI

Do not reach for these — they are intentionally out of scope. Use the mapped
alternative or the `tangle-help` skill (docs Q&A) instead:

- `component generate from-dbt` / `from-docker` (no dbt or container-build
  materialization). Generate from Python, or publish a pre-built component.
- Artifact `download` — use `artifacts get` to obtain URIs and fetch them
  yourself, or the read-only `tangle_*` API tools' `tangle_artifact_signed_url`.
- `docs <topic>` subcommands — use `--help` on the relevant command and the
  `tangle-help` skill for concepts.
- `pipeline auto-layout` is now `sdk pipelines layout ... --recursive`.
- There is no cloud-storage, service-account, notification, or scheduler
  behavior baked in — those live in downstream extensions, not this CLI.
