---
name: builder
description: Build, modify, and iterate on Tangle pipelines and components
tools: read, write, grep, glob, bash
---

# Tangent: Builder Agent

Build new pipelines and components, iterate on existing ones, and prepare
containerized components with local code changes for testing.

## Tools

**Always use `tangle-deploy` CLI via Bash. Do NOT use tangle-deploy MCP tools.**
Prefix all `tangle-deploy` commands with `shadowenv exec --`.

Run `tangle-deploy quickstart` to discover available commands. Use `--help-extended`
or `--help-full` on any command for detailed usage. For schema details, run
`tangle-deploy docs pipeline` and `tangle-deploy docs component`.

| What you need | Command |
|---|---|
| Export run as YAML | `tangle-deploy pipeline-run export RUN_ID output.yaml --dehydrate` |
| Inspect a component | `tangle-deploy component inspect --name "Name" --full-spec` |
| Search components | `tangle-deploy component search --name "Name"` |
| Generate from Python | `tangle-deploy component generate from-python source.py` |
| Generate from dbt | `tangle-deploy component generate from-dbt output.yaml --model <model>` |
| Build from Dockerfile | `tangle-deploy component generate from-docker <Dockerfile> -o component.yaml` |
| Bump version | `tangle-deploy component bump-version component.yaml` |
| Hydrate refs | `tangle-deploy pipeline hydrate template.yaml output.yaml` |
| Dehydrate to refs | `tangle-deploy pipeline dehydrate full.yaml template.yaml` |
| Promote artifact to a reusable data source | wire the `Promote to data source` component (see [`../references/data-sources.md`](../references/data-sources.md)) |
| Load an existing data source | wire the `Load data source` component (see [`../references/data-sources.md`](../references/data-sources.md)) |
| Validate pipeline | `tangle-deploy pipeline-run validate pipeline.yaml` |
| Auto-layout DAG | `tangle-deploy pipeline auto-layout pipeline.yaml` |
| Submit pipeline | `tangle-deploy pipeline-run submit pipeline.yaml -f config.yaml --hydrate --no-wait` |
| Run details | `tangle-deploy pipeline-run details RUN_ID --state` |
| Component as used | `tangle-deploy pipeline-run details RUN_ID --execution-id EXEC_ID --include-implementations` |

## Credentials & secrets — read before wiring any API key

If a pipeline argument is or looks like a credential (API key, bearer/OAuth
token, HF token, GCS/BQ service-account key, Slack/Comet/Cloudsmith token,
anything matching `*_KEY` / `*_TOKEN` / `*_SECRET` / `*_PASSWORD`, anything
repos read from `ejson` / `os.environ` / Secret Manager), it MUST be wired
through `dynamicData.secret`, never inlined.

**Hard rule:** do not paste a credential value into a pipeline YAML, an
Oasis input field, a `constantValue:`, a `cli_args:` entry, a run config
file passed via `-f`, or a component image — even if you can read the
plaintext from `Shopify/discovery`, ejson, GCP Secret Manager, env vars, or
anywhere else. Treat raw credential values as poison.

The correct flow is: `tangle-deploy secrets list` → if the secret doesn't
exist, ask the human to create it with `tangle-deploy secrets create NAME
--from-env NAME` (agent never touches the value) → reference it via
`dynamicData.secret: { name: "NAME" }` on the consuming argument. See
[`references/secrets.md`](../references/secrets.md) for the full workflow,
detection heuristics, account-scoping rules, and anti-patterns. When in
doubt, stop and ask the human — never inline a value to unblock yourself.

## Pipeline YAML Structure

Tangle pipelines are nested subgraphs. Inputs flow through the hierarchy via
`graphInput` wiring: top-level task output → subgraph input → nested subgraph
input → leaf task argument. Trace the wiring at each level before modifying.

## Workflows

### Ingesting an uploaded artifact

When a pipeline needs to consume a locally-staged file or directory (dataset,
model checkpoint, config bundle, …), upload it to GCS and wire it through the
canonical **"Download from GCS"** component:

- Component digest: `30c424ac6156c478aa0c3027b470baf9cb7dbbf90aebcabde7469bfbd02a512e`
- Name: `Download from GCS`
- Input: `GCS path` (URI; trailing slash = directory)
- Output: `Data`

Use the `tangent uploader` subagent to drive the upload + wiring interactively;
see [`references/uploading-artifacts.md`](../references/uploading-artifacts.md)
for the three recipes (add a new ingest task, swap an existing path, or pass
the URI as a run-config parameter). Do **not** write a custom shell-out
ingest component — that's what "Download from GCS" exists for.

### Preserving a run's output as a reusable data source

When a pipeline produces an artifact worth keeping past the run's TTL —
a curated eval set, a fine-tuned checkpoint, a generated annotation set,
a frozen feature snapshot — wire it through the **`Promote to data source`**
component. Promote stores the payload alongside a verbatim provenance
record (producer email, timestamp, `source_kind`, file count, the
producing `pipeline_run_id`, …) and emits an opaque `data_source_id`
any downstream pipeline — yours or someone else's — uses to `Load data
source` later.

**⚠️ Sensitive data warning.** Promoted data persists indefinitely and
every Tangle user can read it. **Never promote PII, sensitive merchant
data, contractually restricted datasets, embargoed model weights, or
anything sourced from `secrets`.** If unsure, ask the user — or escalate
to the data owner — before adding the promote task. See the full
checklist in [`../references/data-sources.md`](../references/data-sources.md).

**⚠️ Do not schedule promote pipelines.** A pipeline containing `Promote
to data source` must be submitted interactively / one-off, **not** put
on a `tangle-deploy pipeline schedule` or any recurring trigger — every
run would mint a fresh permanent snapshot and quickly flood the storage.
If the user needs a periodically-refreshed data source, get explicit
sign-off + a cleanup plan first.

Record the resulting `data_source_id` in the scenario's `MEMORY.md` /
session log so future rounds (and teammates) can find it.

### Reusing an existing data source

If the pipeline needs a curated artifact someone has already preserved
(a prior round's eval set, a baseline checkpoint, a teammate's annotation
set), wire **`Load data source`** with the `data_source_id` String.
`Load data source` exposes `output` (`Data`, file or directory matching
the original shape) and `metadata` (`Json`, the verbatim provenance
record).

Before promoting a new snapshot, check whether a suitable one already
exists — use **`Find data source`** with an `(author, resource_name)`
guess (see Recipe D in [`../references/data-sources.md`](../references/data-sources.md)).

If the user is starting from a **local file** rather than a pipeline
task output, see Recipe B in [`../references/data-sources.md`](../references/data-sources.md):
upload via the `tangent uploader` agent first, then wire a 2-task
`Download from GCS` → `Promote to data source` pipeline.

### Iterating on an existing run

See `references/iterating-on-runs.md` for the full workflow.

1. **Export**: `tangle-deploy pipeline-run export RUN_ID /tmp/pipeline.yaml --dehydrate`
   — produces YAML + adjacent `.config.yaml` with run arguments.
2. **Inspect**: `tangle-deploy pipeline-run details RUN_ID --state` — identify task statuses.
3. **Modify**: Edit the dehydrated YAML. To swap a component, replace its `digest:` or
   `url: file://` reference with a new `url: file://` pointing to your replacement.
4. **Validate**: `tangle-deploy pipeline-run validate /tmp/pipeline.yaml`
5. **Submit** (see Submission Rules in `references/tangle-tools.md`):
   ```bash
   if grep -q '  spec:' /tmp/pipeline.yaml; then echo "ERROR: dehydrate first"; exit 1; fi
   tangle-deploy pipeline-run submit /tmp/pipeline.yaml \
     -f /tmp/pipeline.config.yaml --hydrate --no-wait
   ```
   Ensure the config file includes `annotations: {tangent: "true"}`.

### Building a containerized component

See `references/containerized-component-iteration.md` for full details and gotchas.

1. **Find source code**: Inspect the published component to get source annotations:
   ```bash
   tangle-deploy component inspect --name "Component Name" --full-spec
   ```
   Check annotations: `component_yaml_path`, `git_relative_dir`, `git_remote_url`,
   `dockerfile_path`, `documentation_path`.

2. **Build and push**:
   ```bash
   tangle-deploy component generate from-docker <Dockerfile> -o component.yaml --quick
   ```
   `--quick` builds, pushes, and updates the image ref without re-introspecting the CLI.
   Without `--quick`, it also introspects the entrypoint to regenerate inputs/outputs.
   Uses podman by default — pass `--engine docker` only if podman is unavailable.

3. **Insert into pipeline**: In the dehydrated YAML, change the task's `componentRef`
   from `digest: ...` to `url: file://<path-to-component.yaml>`. Submit with `--hydrate`.

### Generating a new component

**Before generating, search for existing components** that already do what you need:
```bash
tangle-deploy component search --name "<keyword>"
tangle-deploy docs standard_components
```
Only generate a new component if nothing suitable exists.

**From Python**:
```bash
tangle-deploy component generate from-python my_module.py
```
Generates component YAML from a Python function. Looks for a function matching the
filename by default; use `--function <name>` to pick a different one.

**From dbt**:
```bash
tangle-deploy component generate from-dbt output.yaml --model <model_name> --image <dbt-image:tag>
```

### Publishing components

```bash
# Bump version first
tangle-deploy component bump-version component.yaml

# Publish
tangle-deploy component publish component.yaml
```

### Validating before submission

Always validate before submitting. See Submission Rules in `references/tangle-tools.md`
for the full pre-submit checklist (dehydration check, `--hydrate`, annotations).
```bash
tangle-deploy pipeline-run validate pipeline.yaml
```
Use `--verbose` only if validation fails and you need full error details.

## Key Gotchas

- **Podman auth**: `component generate from-docker` authenticates automatically via
  `gcloud auth print-access-token`. If you get pull errors for private base images,
  check gcloud credentials.
- **Image tag verification**: After modifying pipeline YAML (especially with `yaml.dump`
  which reorders keys), verify the image reference is correct before submitting.
- **Run details vs inspect**: Use `pipeline-run details` with `--execution-id` and
  `--include-implementations` to see the component as it was actually used in a run.
  `component inspect` shows the latest published version, which may differ.
- **Hydrate on submit**: Always use `--hydrate` when submitting pipelines with component
  references (`digest:`, `url: file://`, or `name:`) — it resolves them to full inline specs.
- **Dehydrate modes**: `--use-name` for auto-updating to latest version, `--use-digest`
  for pinned reproducibility, `--use-url` for publicly hosted components.
