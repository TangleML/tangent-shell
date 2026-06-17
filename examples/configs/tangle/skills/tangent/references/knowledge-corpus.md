# Knowledge Corpus (GCS Learnings)

Persistent record of what tangent has tried and learned, so future sessions and
other scenarios can reuse prior context.

## Bucket layout

```
gs://shopify-discovery-relevance/tangent/learnings/
└── <scenario_name>/
    ├── research-<run_id>.md        # research brief from Step 1 (one per round that runs research)
    └── learning-<run_id>.json      # final learning from Step 7 (one per completed round)
```

`<run_id>` is the Tangle pipeline-run ID returned by `tangle-deploy pipeline-run submit`.

**Keying rules:**
- `research-<run_id>.md` — keyed by the **active run_id**:
  - Round 1: `active_run_id = baseline_run_id` (research happens before first submit)
  - Round 2+ re-research: `active_run_id = prior round's best_run_id` (the parent run
    that motivated the new research)
- `learning-<run_id>.json` — keyed by the round's **best_run_id** (the
  best-performing run of the round; in single-run rounds this is the only run).

## When to upload

- **Research brief** — Step 1 (Analyze), immediately after the researcher writes
  `$SCENARIO_DIR/research-brief.md`. Upload once per round that runs research.
- **Final learning** — Step 7 (Decide), after the round's outcome is known. Always
  upload, even on a regression — negative results are signal too.

## Upload commands

```bash
# Step 1 — research brief
gcloud storage cp \
  "$SCENARIO_DIR/research-brief.md" \
  "gs://shopify-discovery-relevance/tangent/learnings/<scenario>/research-<run_id>.md"

# Step 7 — final learning
gcloud storage cp \
  "$SCENARIO_DIR/logs/learning-<run_id>.json" \
  "gs://shopify-discovery-relevance/tangent/learnings/<scenario>/learning-<run_id>.json"
```

If the upload fails (auth, network), log a `learning_upload_failed` event and
keep going — the local copy under `$SCENARIO_DIR/logs/` is the source of truth.
A future session can retry the upload.

## learning.json shape

```json
{
  "scenario": "<scenario_name>",
  "run_id": "<run_id>",
  "session": "YYYY-MM-DD-<scenario_name>",
  "round": <N>,
  "baseline_run_id": "<baseline_run_id>",
  "hypothesis": "<one sentence, from Step 2>",
  "experiment_type": "<feature_selection|param_tuning|data_action|...>",
  "config_diff": { ... },               // diff vs baseline config
  "primary_metric": { "name": "...", "baseline": ..., "result": ..., "delta": ... },
  "all_metrics": { ... },               // full metric dict
  "outcome": "<SUCCESS|MARGINAL|NO_IMPROVEMENT|REGRESSION|FAILED>",
  "lesson": "<one-line takeaway, from Step 6 / MEMORY.md>",
  "next_direction": "<from Step 7 — what to try next>"
}
```

## Reading prior learnings

Step 0 may pull recent learnings for the same scenario into context:

```bash
gcloud storage ls "gs://shopify-discovery-relevance/tangent/learnings/<scenario>/" \
  | tail -20
```

Use `gcloud storage cp` to pull individual files. Don't bulk-download the whole
prefix — for a long-running scenario it grows without bound.
