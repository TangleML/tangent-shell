# Step 3: Submit

**Never exceed budget.** Infra retries and analysis actions don't count against it.
Maximize concurrency — fill all `scenario.budget.max_parallel_runs` slots.

| Budget           | Runs/Round | Strategy                        |
| ---------------- | ---------- | ------------------------------- |
| Tight (< 10)     | 2-3        | Sequential refinement           |
| Moderate (10-20) | 3-5        | Sweep primary dimension, refine |
| Generous (20-50) | 5-8        | Parallel sweeps                 |

## Submission

Refer to `scenario.experiment_actions` and the scenario's `experiment-playbook.md`
skill for the specific config changes per experiment type.

Analysis actions don't consume budget — run locally, update session log.

## Pipeline Submission

**Follow the Submission Rules in `references/tangle-tools.md`** — dehydration check,
`--hydrate --no-wait`, and `tangent` annotation are all mandatory.

Build a config file with experiment args and auto-loop annotations:

```yaml
# $SCENARIO_DIR/run_config.yaml
args:
  # experiment-specific args here
annotations:
  tangent: "true"
  session: "YYYY-MM-DD-<scenario_name>"
  round: "<N>"
  type: "<experiment_type>"
  label: "<short-description>"
```

Submit:

```bash
if grep -q '  spec:' $SCENARIO_DIR/pipeline.yaml; then echo "ERROR: dehydrate first"; exit 1; fi
shadowenv exec -- tangle-deploy pipeline-run submit $SCENARIO_DIR/pipeline.yaml \
  -f $SCENARIO_DIR/run_config.yaml --hydrate --no-wait
```

### If you modified component source code:

1. Rebuild: `tangle-deploy component generate from-docker <Dockerfile> -o component.yaml --quick`
2. Update ref in pipeline YAML: swap `digest: ...` with `url: file://<path-to-component.yaml>`
3. Submit with the command above

See `agents/builder.md` for the full workflow.

## Post-Submission

`tangle-deploy pipeline-run submit` returns a **`run_id`** for each submitted
pipeline. Treat `run_id` as a first-class session concept:

1. Log to `sessions/YYYY-MM-DD.md` — record the `run_id` in a `## Run Log`
   section with timestamp, round, label, config diff. Order is chronological.
2. **Write to MEMORY.md "Active Runs" immediately** — `run_id`, Oasis link,
   label, config summary, timestamp. Survives session interruptions.
3. The `run_id` is what keys learnings uploads in Step 7
   (`learning-<run_id>.json` under `gs://.../tangent/learnings/<scenario>/`),
   so make sure it's recorded verbatim.

## Gate — do NOT proceed to Step 4 until all pass:

- [ ] Pipeline submitted with `--hydrate` flag
- [ ] If source code was modified: component rebuilt and pipeline ref updated
- [ ] All runs submitted successfully (run IDs received)
- [ ] Each run annotated with tangent, session, round, type, label
- [ ] MEMORY.md "Active Runs" updated with every `run_id`
- [ ] Session log `Run Log` section updated with every `run_id`
- [ ] Budget check: total runs submitted ≤ remaining budget
- [ ] `step_transition` and `run_submit` events logged
- [ ] **Reload + review**: re-read this step file and `references/tangle-tools.md`; agent confirms it remembers them
