---
name: tangent
description: ML experiment toolkit and autonomous agent. Say "tangent" for help, "tangent <subagent>" for a specific tool, or "tangent auto" for the full autonomous experiment loop. Requires Tangle CLI access and GCS access.
allowed-tools: [Bash, Read, Write, Glob, Grep, Agent, dispatch]
---

# Tangent

Thin index. Every file linked here is the source of truth for its topic — read it
when you need it, don't paraphrase from this file.

## First, every session

Refresh the skill bundle, set the source attribution env var, then read
[`references/setup.md`](references/setup.md). The skill is published two
ways and the snippet below picks whichever applies. Locally it updates
the installed copy in place (no writes to your cwd). The fallback pulls
the bundle into a scratch dir under `$TMPDIR` and prints the path —
follow that printed path for any subsequent reads of skill files.

```bash
if [ -z "$RIVER_SESSION_JWT" ] && command -v devx >/dev/null 2>&1 && \
   devx skills update tangent -y; then
  # Local: updated the installed skill (~/.claude/skills/tangent/).
  # Idempotent; does not touch your working directory.
  :
else
  # River, no devx, or devx update failed: pull the bundle into a
  # scratch dir (NOT your cwd). Read subsequent skill files from there.
  TANGENT_SKILL_DIR="$(mktemp -d -t tangent-skill.XXXXXX)"
  gcloud storage cp --recursive \
    gs://shopify-discovery-relevance/tangent/skills/main/ "$TANGENT_SKILL_DIR/"
  export TANGENT_SKILL_DIR
  echo "Tangent skill bundle: $TANGENT_SKILL_DIR/main"
fi
export TANGLE_DEPLOY_SOURCE=$([ -n "$RIVER_SESSION_JWT" ] && echo "river-tangent" || echo "tangent")
```

Locally the source of truth is World `main` at
`areas/ml/tangent/.agents/skills/tangent/`; `devx skills update tangent`
pulls the latest from there. In River the same content is delivered via
the GCS bundle (synced from World `main` by
`areas-ml-tangent-tangent-sync-skills.yml` on merge). The `TANGLE_DEPLOY_SOURCE`
export tags every `tangle-deploy pipeline-run submit` with a `source`
annotation — `river-tangent` under River, `tangent` otherwise. See
[`references/setup.md`](references/setup.md) for details.

## Commands

- **`tangent`** — print the help block below.
- **`tangent <subagent>`** — read `agents/<subagent>.md` and follow it.
- **`tangent auto`** — run the autonomous loop. See [Auto Mode](#auto-mode).

```
Subagents:                         Agent file:
  tangent debugger                   agents/debugger.md
  tangent researcher                 agents/researcher.md
  tangent reporter                   agents/reporter.md
  tangent reviewer                   agents/reviewer.md
  tangent builder                    agents/builder.md
  tangent uploader                   agents/uploader.md
  tangent auth                       agents/auth-wizard.md
  tangent new-scenario               agents/scenario-builder.md

Automation:
  tangent auto       — Run full autonomous 8-step experiment loop
```

## References (read on demand)

| Topic | File |
|---|---|
| Setup / auth | [`references/setup.md`](references/setup.md) |
| Tangle CLI | [`references/tangle-tools.md`](references/tangle-tools.md) |
| Event log schema | [`references/event-log.md`](references/event-log.md) |
| Iterating on a run | [`references/iterating-on-runs.md`](references/iterating-on-runs.md) |
| Containerized components | [`references/containerized-component-iteration.md`](references/containerized-component-iteration.md) |
| Uploading artifacts → pipelines | [`references/uploading-artifacts.md`](references/uploading-artifacts.md) |
| Promoting / reusing data sources | [`references/data-sources.md`](references/data-sources.md) |
| Secrets & credentials (API keys, tokens) | [`references/secrets.md`](references/secrets.md) |
| Example scenarios | [`references/example-scenarios/INDEX.md`](references/example-scenarios/INDEX.md) |
| Knowledge corpus (GCS learnings) | [`references/knowledge-corpus.md`](references/knowledge-corpus.md) |

## Tools

Always use the `tangle-deploy` CLI via Bash. Do **not** use `tangle-deploy` MCP tools.
Run `shadowenv exec -- tangle-deploy quickstart` to discover commands. See
[`references/tangle-tools.md`](references/tangle-tools.md).

Cancel a run: `shadowenv exec -- tangle-deploy pipeline-run cancel RUN_ID`

Background execution: `dispatch`. Subagents: `agents/*.md`.

## Scenarios

A scenario is any repo with a Tangle pipeline. Contents: `scenario.yaml`, `MEMORY.md`,
`skills/`, `sessions/`, `logs/`, `pipeline.yaml`. No scenario? `tangent new-scenario`.
For inspiration: [`references/example-scenarios/INDEX.md`](references/example-scenarios/INDEX.md).

---

## Auto Mode

Autonomous MLE agent that iterates on an ML pipeline. Tunes parameters, selects
features, changes data, analyzes results, modifies pipelines.

### Memory & run_id

- **Long-term**: `MEMORY.md` — best config, lessons, session index. < 3000 tokens.
- **Short-term**: `sessions/YYYY-MM-DD.md` — daily log, append-only.
- **Active runs**: written to `MEMORY.md` on Step 3 submission, cleared on Step 5 completion.
- **`run_id`** is a first-class session concept. Every Tangle pipeline-run has one;
  the session log tracks them in order, and learnings uploaded to GCS are keyed by
  `<scenario>/<run_id>`. Always record the `run_id` returned by `tangle-deploy
  pipeline-run submit`.

### Procedure

Read each step file only when you reach that step — do not pre-read all step files.
Execute the step, verify the gate checklist, do not proceed until every gate passes.
**Each step gate ends with a "reload skills + context" checkbox — actually re-read
the step file and active agent files at that point, don't rely on stale memory.**

| Step | Reference |
|------|-----------|
| 0 Initialize | [`references/step-0-initialize.md`](references/step-0-initialize.md) |
| — Load builder skills | [`agents/builder.md`](agents/builder.md) (after init, before the loop) |
| 1 Analyze | [`references/step-1-analyze.md`](references/step-1-analyze.md) |
| 2 Hypothesize | [`references/step-2-hypothesize.md`](references/step-2-hypothesize.md) |
| 3 Submit | [`references/step-3-submit.md`](references/step-3-submit.md) |
| 4 Monitor | [`references/step-4-monitor.md`](references/step-4-monitor.md) |
| 5 Evaluate | [`references/step-5-evaluate.md`](references/step-5-evaluate.md) |
| 6 Synthesize | [`references/step-6-synthesize.md`](references/step-6-synthesize.md) |
| 7 Decide | [`references/step-7-decide.md`](references/step-7-decide.md) |

Loop: Step 7 → Step 1 if not converged. Read `references/tangle-tools.md` and
`references/event-log.md` at Step 0 only.

### Extracting metrics

```python
value = metrics
for key in path.split("."):
    value = value[int(key) if key.isdigit() else key]
```
