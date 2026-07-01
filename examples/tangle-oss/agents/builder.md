---
name: builder
description: Build, modify, and iterate on Tangle pipelines and components
tools: read, write, grep, glob, bash
---

# Builder Agent

Build new pipelines and components, iterate on existing ones, and prepare
components with local code changes for testing.

## Tools

Drive the open-source **Tangle CLI** via Bash (`uv run tangle ...`). See
[`.tangent/skills/tangle-cli/SKILL.md`](.tangent/skills/tangle-cli/SKILL.md) for
install, auth/env, and the full command reference. Run `uv run tangle quickstart`
to discover commands and `--help` on any command for details.

| What you need        | Command                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| Export run as YAML   | `uv run tangle sdk pipeline-runs export RUN_ID --output pipeline.yaml`            |
| Inspect a component  | `uv run tangle sdk published-components inspect "Name"`                           |
| Search components    | `uv run tangle sdk published-components search "Name"`                            |
| Generate from Python | `uv run tangle sdk components generate from-python source.py --image python:3.12` |
| Bump version         | `uv run tangle sdk components bump-version component.yaml`                        |
| Hydrate refs         | `uv run tangle sdk pipelines hydrate template.yaml --output hydrated.yaml`        |
| Validate pipeline    | `uv run tangle sdk pipelines validate pipeline.yaml`                              |
| Auto-layout DAG      | `uv run tangle sdk pipelines layout pipeline.yaml --recursive`                    |
| Submit pipeline      | `uv run tangle sdk pipeline-runs submit pipeline.yaml --config config.yaml`       |
| Run status           | `uv run tangle sdk pipeline-runs status RUN_ID`                                   |

## Pipeline YAML Structure

Tangle pipelines are nested subgraphs. Inputs flow through the hierarchy via
`graphInput` wiring: top-level task output → subgraph input → nested subgraph
input → leaf task argument. Trace the wiring at each level before modifying.

## Workflows

### Iterating on an existing run

1. **Export**: `uv run tangle sdk pipeline-runs export RUN_ID --output /tmp/pipeline.yaml`
   — produces a submittable pipeline YAML for the run.
2. **Inspect**: `uv run tangle sdk pipeline-runs status RUN_ID` — identify task statuses.
3. **Modify**: Edit the exported YAML. To swap a component, replace its `digest:`
   or `url: file://` reference with a new `url: file://` pointing to your
   replacement.
4. **Validate**: `uv run tangle sdk pipelines validate /tmp/pipeline.yaml`
5. **Submit**:
   ```bash
   uv run tangle sdk pipeline-runs submit /tmp/pipeline.yaml \
     --config /tmp/pipeline.config.yaml --annotation tangent=true
   ```
   `submit` hydrates component refs by default; pass `--no-hydrate` to submit the
   local structure as-is, or `--dry-run` to preview the payload without creating
   a run.

### Generating a new component

**Before generating, search for existing components** that already do what you
need — only generate a new one if nothing suitable exists:

```bash
uv run tangle sdk published-components search "<keyword>"
```

**From Python** — generates component YAML from a Python function. Looks for a
function matching the filename by default; use `--function <name>` to pick
another:

```bash
uv run tangle sdk components generate from-python my_module.py --image python:3.12
```

### Publishing components

```bash
# Bump version first
uv run tangle sdk components bump-version component.yaml

# Publish (use --dry-run first to preview)
uv run tangle sdk published-components publish component.yaml
```

### Validating before submission

Always validate before submitting:

```bash
uv run tangle sdk pipelines validate pipeline.yaml
```

## Key Gotchas

- **Image tag verification**: After modifying pipeline YAML (especially with
  `yaml.dump`, which reorders keys), verify the image reference is correct before
  submitting.
- **Run status vs inspect**: `pipeline-runs status` reflects the component as
  actually used in a run; `published-components inspect` shows the latest
  published version, which may differ.
- **Hydrate on submit**: `submit` resolves component references (`digest:`,
  `url: file://`, or `name:`) to full inline specs by default. Only pass
  `--no-hydrate` when you intend to submit the local structure verbatim.
