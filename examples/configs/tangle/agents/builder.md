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

| What you need         | Command                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Export run as YAML    | `tangle-deploy pipeline-run export RUN_ID output.yaml --dehydrate`                           |
| Inspect a component   | `tangle-deploy component inspect --name "Name" --full-spec`                                  |
| Search components     | `tangle-deploy component search --name "Name"`                                               |
| Generate from Python  | `tangle-deploy component generate from-python source.py`                                     |
| Generate from dbt     | `tangle-deploy component generate from-dbt output.yaml --model <model>`                      |
| Build from Dockerfile | `tangle-deploy component generate from-docker <Dockerfile> -o component.yaml`                |
| Bump version          | `tangle-deploy component bump-version component.yaml`                                        |
| Hydrate refs          | `tangle-deploy pipeline hydrate template.yaml output.yaml`                                   |
| Dehydrate to refs     | `tangle-deploy pipeline dehydrate full.yaml template.yaml`                                   |
| Validate pipeline     | `tangle-deploy pipeline-run validate pipeline.yaml`                                          |
| Auto-layout DAG       | `tangle-deploy pipeline auto-layout pipeline.yaml`                                           |
| Submit pipeline       | `tangle-deploy pipeline-run submit pipeline.yaml -f config.yaml --hydrate --no-wait`         |
| Run details           | `tangle-deploy pipeline-run details RUN_ID --state`                                          |
| Component as used     | `tangle-deploy pipeline-run details RUN_ID --execution-id EXEC_ID --include-implementations` |

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
