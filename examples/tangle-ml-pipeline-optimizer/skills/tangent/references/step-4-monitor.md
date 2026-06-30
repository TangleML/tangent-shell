# Step 4: Monitor

Do NOT exit until all runs are DONE or permanently failed. Keep slots filled.

## Loop

```
LOOP:
  1. Light-poll all runs (graph state API, ~120 tokens total)
  2. Inspect completed/failed runs (tangle-deploy pipeline-run details --state)
  3. Process completed runs → queue for Step 5
  4. Process failed runs → launch debugger agent
  5. Backfill open slots → go to Step 2 for new experiments
  6. Wait → dispatch or sleep, loop
```

## Checking Run Status (Light Polling)

**Use `get_execution_graph_state` for status checks — NOT `tangle-deploy pipeline-run await`
or `tangle-deploy pipeline-run details`.** The graph state API returns ~120 tokens (per-task
status counts). `tangle-deploy pipeline-run details --state` returns ~17,000+ tokens (full
execution tree). Only use the heavy call when you need to debug or extract execution_ids.

Light polling is only available via the Python API (no CLI equivalent exists):

```bash
shadowenv exec -- python3 -c "
from tangle_deploy import TangleApiClient
client = TangleApiClient()
client.set_verbose(False)
run = client.get_pipeline_run('RUN_ID')
state = client.get_execution_graph_state(run.root_execution_id)
print(state.status_totals)            # e.g. {'SUCCEEDED': 13}
print(state.failed_execution_ids)     # [] if none failed
"
```

For multiple runs:

```bash
shadowenv exec -- python3 -c "
from tangle_deploy import TangleApiClient
client = TangleApiClient()
client.set_verbose(False)
for rid in ['RUN_1', 'RUN_2', 'RUN_3']:
    run = client.get_pipeline_run(rid)
    state = client.get_execution_graph_state(run.root_execution_id)
    print(f'{rid}: {state.status_totals} failed={state.failed_execution_ids}')
"
```

Mark runs exceeding 2x `scenario.timing.total_seconds` as STUCK and replace.

## Post-Completion Inspection

When a run completes (SUCCEEDED or FAILED), immediately run:

```bash
tangle-deploy pipeline-run details RUN_ID --state
```

This returns the execution tree with per-component status. Check for:

1. Any component in FAILED or SYSTEM_ERROR state (the overall run may show SUCCEEDED
   if the failed component was optional or non-blocking)
2. Components with unexpectedly short execution times (may indicate silent failures)
3. The training/tuning component specifically — note its execution_id for log fetching
   in Step 5

If any component failed unexpectedly, launch the debugger subagent even if the
overall pipeline status is SUCCEEDED.

Record the execution_id of key components (training, evaluation) in the session log
alongside the run_id. Step 5 will need these for detailed analysis.

## Failed Runs

**Launch the debugger as a subagent using the Agent tool.** Read `agents/debugger.md`
and pass its full content as the agent prompt, with this task context appended:

```
---
Task context:
Run ID: <run_id>
Failure playbook: <scenario.failure_playbook as YAML>
Pipeline task mapping: <task → source file>
Write snapshot to: <SCENARIO_DIR>/logs/failures/<run_id>.md
Return one-line: "<FAILURE_TYPE>: <description> → <action>"
```

Act on the diagnosis:

| Failure Type   | Action                                | Budget Impact   |
| -------------- | ------------------------------------- | --------------- |
| **PERMISSION** | Fix per diagnosis, resubmit           | No cost         |
| **INFRA**      | Retry if transient, fix if persistent | No cost         |
| **CONFIG**     | Fix per diagnosis, resubmit           | No cost         |
| **TRAINING**   | Record as result (failure IS data)    | Already counted |
| **EVAL**       | Fix per diagnosis, resubmit           | No cost         |
| **UNKNOWN**    | Escalate to user                      | No cost         |

## Cancelling a Run

Only cancel when the user asks or a run is blocking resources.

```bash
shadowenv exec -- tangle-deploy pipeline-run cancel RUN_ID
```

## Waiting

Use `dispatch` for non-blocking wait (if available), or sleep between light polls:

```
dispatch({ command: "shadowenv exec -- tangle-deploy pipeline-run await <run_id> --max-wait <interval> --exit-on-first-failure" })
```

Interval: 180s (short pipelines), 600s (medium), 900s (long).
On wake, light-poll ALL active runs (graph state API), not just the awaited one.

## Gate — do NOT proceed to Step 5 until all pass:

- [ ] All runs resolved (SUCCEEDED, permanently FAILED, or STUCK-replaced)
- [ ] No RUNNING runs remain
- [ ] Each completed run inspected with `tangle-deploy pipeline-run details --state`
- [ ] Key component execution_ids recorded in session log
- [ ] Each failed run has a debugger snapshot in `logs/failures/`
- [ ] Each failed run has a `run_failed` event logged
- [ ] Backfill exhausted (no open slots with pending experiments and budget)
- [ ] **Reload + review**: re-read this step file and `agents/debugger.md`; agent confirms it remembers them
