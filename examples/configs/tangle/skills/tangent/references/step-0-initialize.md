# Step 0: Initialize

Pure setup — load everything before the experiment loop. No analysis, no decisions.

## Install / Upgrade tangle-deploy

Before anything else, ensure `tangle-deploy` is up to date:

```bash
shadowenv exec -- uv sync --upgrade-package tangle-deploy
```

Then discover available commands:

```bash
shadowenv exec -- tangle-deploy quickstart
```

## Scenario Directory

All experiment state lives in the scenario directory. Set the absolute path:

```
SCENARIO_DIR=<path_to_scenario_directory>
```

All `tangle-deploy` commands run via `shadowenv exec --`. All file reads/writes use
absolute `SCENARIO_DIR` paths. These are different locations — don't confuse them.

## No Scenario Yet? Build One

If the user doesn't have a scenario directory, or `scenario.yaml` doesn't exist
at `SCENARIO_DIR`, **run the scenario builder interview yourself**.

Read `.agents/skills/tangent/agents/scenario-builder.md` and follow its instructions directly — do NOT
spawn it as a subagent. The scenario builder is a multi-turn interview that
requires user interaction at every phase. Subagents cannot interact with the
user, so spawning it would skip the interview entirely.

Set the target directory to `SCENARIO_DIR` and work through all 7 phases.
Once the interview completes and files are generated, continue with Load State
below.

## Load State

1. Read `scenario.yaml` — target metric, search space, experiment actions, failure playbook, timing. **Use scenario.yaml for all paths and parameters — never hardcode.**
2. Read `MEMORY.md` — best config, key lessons, session index. If it has prior findings, don't repeat experiments.
3. Read `case_studies/*.md` if they exist — past experiment reports on this scenario
4. Read today's `sessions/YYYY-MM-DD.md` if it exists (resume)
5. Read all skills in `<scenario_dir>/skills/` (experiment-playbook, metrics-guide, etc.)
6. Ensure `logs/` and `sessions/` directories exist

### Resume: Check Active Runs

If MEMORY.md "Active Runs" lists runs from a prior session, light-poll each
with the graph state API (see Step 4 for the snippet). Classify: all tasks
terminal → Step 5, any RUNNING → Step 4, any FAILED → Step 4 (debugger).
This replaces Step 1-3 when resuming.

## Bootstrap Pipeline

### If no `pipeline.yaml` exists in `SCENARIO_DIR`:

**Option A: User has pipeline source code (preferred)**
If the repo already has a dehydrated pipeline YAML (with `name:` or `digest:` component
refs, no inline `spec:` blocks), ask the user for its path and copy it:

```bash
cp <path-to-dehydrated-pipeline.yaml> $SCENARIO_DIR/pipeline.yaml
```

This is preferred because `--hydrate` on submit will always resolve the latest published
component versions.

**Option B: Export from baseline run**
If no source pipeline exists, export and dehydrate from the baseline:

```bash
tangle-deploy pipeline-run export BASELINE_RUN_ID $SCENARIO_DIR/pipeline.yaml --dehydrate
```

`--dehydrate` strips inline specs and keeps only `name:` + `digest:` refs. Without it,
the exported YAML has full inline specs and `--hydrate` on submit becomes a no-op.

### If `pipeline.yaml` already exists but has inline `spec:` blocks (hydrated):

Dehydrate it in place so `--hydrate` on submit resolves the latest component versions:

```bash
tangle-deploy pipeline dehydrate $SCENARIO_DIR/pipeline.yaml $SCENARIO_DIR/pipeline.yaml
```

### Then:

1. Parse pipeline.yaml to build task → source file mapping (see researcher agent for code discovery)
2. Download baseline config and metrics to `$SCENARIO_DIR`
3. Initialize `$SCENARIO_DIR/logs/events.jsonl` (create if it doesn't exist)

## Gate — do NOT proceed to Step 1 until all pass:

- [ ] `tangle-deploy` upgraded (`uv sync --upgrade-package tangle-deploy`)
- [ ] `tangle-deploy quickstart` ran successfully
- [ ] `SCENARIO_DIR` set to absolute path
- [ ] `scenario.yaml` read and understood
- [ ] `MEMORY.md` read
- [ ] Scenario skills loaded
- [ ] `references/tangle-tools.md` read (Submission Rules, light polling, CLI reference)
- [ ] `references/event-log.md` read (event types and schemas)
- [ ] `pipeline.yaml` exists in `SCENARIO_DIR` and is dehydrated — verify: `grep -q '  spec:' $SCENARIO_DIR/pipeline.yaml` exits with code 1 (no matches)
- [ ] `logs/` and `sessions/` directories exist
- [ ] `step_transition` event logged
- [ ] **Reload + review**: re-read `SKILL.md`, `references/tangle-tools.md`, and `references/event-log.md`; agent confirms it remembers them before starting Step 1
