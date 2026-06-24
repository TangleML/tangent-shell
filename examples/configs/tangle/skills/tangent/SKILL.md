---
name: tangent
description: ML experiment toolkit and autonomous agent. Say "tangent" for help, "tangent <subagent>" for a specific tool, or "tangent auto" for the full autonomous experiment loop. Requires Tangle CLI access and GCS access.
allowed-tools: [Bash, Read, Write, Glob, Grep, Agent, dispatch]
---

# Tangent

Thin index. Every file linked here is the source of truth for its topic — read it
when you need it, don't paraphrase from this file.

## First, every session

Re-sync skills from GCS, set the source attribution env var, then read
[`references/setup.md`](references/setup.md):

```bash
gcloud storage cp --recursive gs://shopify-discovery-relevance/tangent/skills/main/ .
export TANGLE_DEPLOY_SOURCE=$([ -n "$RIVER_SESSION_JWT" ] && echo "river-tangent" || echo "tangent")
```

The export tags every `tangle-deploy pipeline-run submit` with a `source`
annotation — `river-tangent` under River, `tangent` otherwise. See
[`references/setup.md`](references/setup.md) for details.

## Commands

- **`tangent`** — print the help block below.
- **`tangent <subagent>`** — delegate the role by spawning its bundle agent
  template: `spawn_subagent template: <name>`. Each template carries its own
  scoped tool set and system prompt — you do not need to read an agent file.
- **`tangent auto`** — run the autonomous loop. See [Auto Mode](#auto-mode).

```
Subagents:                         spawn_subagent template:
  tangent debugger                   debugger
  tangent researcher                 researcher
  tangent reporter                   reporter
  tangent reviewer                   reviewer
  tangent builder                    builder
  tangent uploader                   uploader
  tangent auth                       auth-wizard
  tangent new-scenario               scenario-builder

Automation:
  tangent auto       — Run full autonomous 8-step experiment loop
```

## References (read on demand)

| Topic                            | File                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Setup / auth                     | [`references/setup.md`](references/setup.md)                                                         |
| Tangle CLI                       | [`references/tangle-tools.md`](references/tangle-tools.md)                                           |
| Event log schema                 | [`references/event-log.md`](references/event-log.md)                                                 |
| Iterating on a run               | [`references/iterating-on-runs.md`](references/iterating-on-runs.md)                                 |
| Containerized components         | [`references/containerized-component-iteration.md`](references/containerized-component-iteration.md) |
| Uploading artifacts → pipelines  | [`references/uploading-artifacts.md`](references/uploading-artifacts.md)                             |
| Example scenarios                | [`references/example-scenarios/INDEX.md`](references/example-scenarios/INDEX.md)                     |
| Knowledge corpus (GCS learnings) | [`references/knowledge-corpus.md`](references/knowledge-corpus.md)                                   |

## Tools

Always use the `tangle-deploy` CLI via Bash. Do **not** use `tangle-deploy` MCP tools.
Run `shadowenv exec -- tangle-deploy quickstart` to discover commands. See
[`references/tangle-tools.md`](references/tangle-tools.md).

Cancel a run: `shadowenv exec -- tangle-deploy pipeline-run cancel RUN_ID`

Background execution: `dispatch`. Subagents: bundle agent templates spawned via
`spawn_subagent template: <name>` (`builder`, `debugger`, `reviewer`,
`researcher`, `reporter`, `uploader`, `auth-wizard`, `scenario-builder`).

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

| Step                  | Reference                                                              |
| --------------------- | ---------------------------------------------------------------------- |
| 0 Initialize          | [`references/step-0-initialize.md`](references/step-0-initialize.md)   |
| — Load builder skills | spawn `template: builder` (after init, before the loop)                |
| 1 Analyze             | [`references/step-1-analyze.md`](references/step-1-analyze.md)         |
| 2 Hypothesize         | [`references/step-2-hypothesize.md`](references/step-2-hypothesize.md) |
| 3 Submit              | [`references/step-3-submit.md`](references/step-3-submit.md)           |
| 4 Monitor             | [`references/step-4-monitor.md`](references/step-4-monitor.md)         |
| 5 Evaluate            | [`references/step-5-evaluate.md`](references/step-5-evaluate.md)       |
| 6 Synthesize          | [`references/step-6-synthesize.md`](references/step-6-synthesize.md)   |
| 7 Decide              | [`references/step-7-decide.md`](references/step-7-decide.md)           |

Loop: Step 7 → Step 1 if not converged. Read `references/tangle-tools.md` and
`references/event-log.md` at Step 0 only.

### Extracting metrics

```python
value = metrics
for key in path.split("."):
    value = value[int(key) if key.isdigit() else key]
```
