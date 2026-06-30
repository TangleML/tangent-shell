# Building and testing containerized components

When building a container image with local code changes and testing it in a pipeline run.

For the general pipeline iteration workflow (export, modify, submit), see
[iterating-on-runs.md](iterating-on-runs.md).

## Understanding the component

Before building, inspect the published component to understand its definition and
find its source code:

```bash
tangle-deploy component inspect --name "Component Name" --full-spec
```

- Returns the component spec (inputs, outputs, image, command wiring) and publication metadata
- The `annotations` section includes source links: `component_yaml_path`, `git_relative_dir`,
  and `git_remote_url`
- If the component originated from the local repo, use `component_yaml_path` to find the YAML
  and its Dockerfile in the repo
- If the component is from another repo, use `git_remote_url` to identify the repo and
  `git_relative_dir` for the path
- Use `--follow-deprecated` if the component is deprecated to jump to its successor

## Building the component

```bash
tangle-deploy component generate from-docker <Dockerfile> --output <component.yaml> --quick
```

- `--quick` skips CLI introspection and only builds, pushes, and updates the image reference
  in existing YAML
- Without `--quick`, the tool also introspects the CLI entrypoint to regenerate inputs/outputs
- Uses podman by default (not docker). Pass `--engine docker` only if podman is unavailable
- Authenticates to the registry automatically before both build and push steps

## Inserting into a pipeline

After exporting and dehydrating a run (see iterating-on-runs.md), replace the component
reference with a local file reference:

- Change the task's `componentRef` from `digest: ...` to `url: file://<path-to-component.yaml>`
- For large pipelines, write a Python script to patch the YAML programmatically rather than
  editing manually
- On submit, use `--hydrate` so the local file reference is resolved

## Inspecting results

```bash
# Execution tree with statuses and artifact info
tangle-deploy pipeline-run details <run_id> --state

# Drill into a specific task to see the component as actually used
tangle-deploy pipeline-run details <run_id> --execution-id <exec_id> --include-implementations

# Download output artifacts
tangle-deploy artifacts download <run_id> -q '{"tasks": {"TaskName": ["output_name"]}}' -o ./artifacts
```

## Key gotchas

- **Podman auth**: `tangle-deploy component generate from-docker` authenticates automatically
  via `gcloud auth print-access-token`. If you get pull errors for private base images, check
  gcloud credentials.
- **Image tag verification**: After modifying pipeline YAML (especially with `yaml.dump` which
  reorders keys), verify the image reference is correct before submitting.
- **Run details vs inspect**: Use `pipeline-run details` with `--execution-id` and
  `--include-implementations` to see the component as it was actually used in a run.
  `component inspect` shows the latest published version, which may differ.
- **Artifact download**: Use `artifacts download` to download files locally. `artifacts get`
  only returns gs:// URIs.
