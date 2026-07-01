# Step 6: Synthesize

## Update Memory

- **Session log** (`sessions/YYYY-MM-DD.md`): full metrics, run IDs, analysis
- **MEMORY.md**: update Best Known Config, add one-line lesson, verify Active Runs empty
- **Audit trail** (`logs/audit.yaml`): append round entry with rationale and outcome

## Report (MANDATORY — do NOT skip, do NOT defer)

**Launch the reporter as a subagent — do NOT skip, do NOT defer.** Spawn
`spawn_subagent template: reporter`, passing this task context as its task:

```
---
Task context:
Scenario: <scenario_name>
Read: <SCENARIO_DIR>/logs/audit.yaml, events.jsonl, MEMORY.md, sessions/<today>.md, scenario.yaml
Baseline run: <baseline_run_id>
Round's best run_id: <best_run_id>   # use the best-performing run of this round
Write to: <SCENARIO_DIR>/logs/report-<best_run_id>.md
```

`<best_run_id>` is the round's representative run_id. Single-run rounds: it's the
only run. Multi-run rounds: the run with the best target metric. The same
`<best_run_id>` is used by Step 7 to key the reviewer output and the
`learning-<run_id>.json` upload.

## Gate — do NOT proceed to Step 7 until all pass:

- [ ] Session log updated with full metrics and analysis
- [ ] MEMORY.md updated (best config, lessons, Active Runs empty)
- [ ] `audit.yaml` round entry appended
- [ ] **`report-<best_run_id>.md` exists at `$SCENARIO_DIR/logs/`** (verify with Read — if it doesn't exist, the reporter did not run; the per-run filename means earlier rounds are preserved)
- [ ] `round_end` event logged
- [ ] **Reload + review**: re-read this step file and `.tangent/agents/reporter.md`; agent confirms it remembers them

Print this checklist to the user with checkmarks.
