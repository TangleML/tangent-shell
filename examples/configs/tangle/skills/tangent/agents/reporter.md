---
name: reporter
description: Generate ML experiment report
tools: read, write, grep, bash
---

# Tangent: Reporter Agent

Generate an ML experiment report. Regenerate from scratch each round.

## Tools

**Always use `tangle-deploy` CLI via Bash. Do NOT use tangle-deploy MCP tools.**
Prefix all `tangle-deploy` commands with `shadowenv exec --`.

Run `tangle-deploy quickstart` to discover available commands. Use `--help-extended`
or `--help-full` on any command for detailed usage.

| What you need      | Command                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| Artifact URIs      | `tangle-deploy artifacts get RUN_ID -q '{"tasks": {...}}'`                     |
| Download artifacts | `tangle-deploy artifacts download RUN_ID -q '{"tasks": {...}}' -o ./artifacts` |
| Run details        | `tangle-deploy pipeline-run details RUN_ID --state`                            |

## Inputs

- `scenario_dir` — scenario directory path
- `run_id` — **best run of the round** being reported (the round's representative run_id)
- `baseline_run_id` — for baseline artifacts
- `report_path` — where to write. Caller should pass a per-run path
  (e.g. `<scenario_dir>/logs/report-<run_id>.md`) so multi-round runs do not
  overwrite each other.
- Read: `logs/audit.yaml`, `logs/events.jsonl`, `MEMORY.md`, `sessions/<today>.md`,
  `scenario.yaml`, `research-brief.md` (if exists)

## Output

`<report_path>` — 7-section report following the template below. The filename
must include `<run_id>` so each round's report is preserved.

**CRITICAL: The Analysis section MUST include per-example winning/losing cases.**
Download predictions from baseline and best run, compare per-example, show the
top movers. If predictions are truly unavailable, state why — do not silently skip.

```markdown
# <scenario_name>

**Date**: YYYY-MM-DD
**Status**: IN_PROGRESS | SUCCESS | MARGINAL | NO_IMPROVEMENT | REGRESSION

## Abstract

<3-5 sentences: problem, approach, result as baseline delta, insight>

## Background & Related Work

**Baseline**: [<baseline_run_id>](https://oasis.shopify.io/runs/<baseline_run_id>) — <metric> = <value>
**Round's best run**: [<run_id>](https://oasis.shopify.io/runs/<run_id>)
**Goal**: <direction> by at least <min_improvement>

## Methodology

<Strategy, intervention types, search space>

## Results

| Metric | Baseline | Best | Delta % |
| ------ | -------- | ---- | ------- |

Per-round progression, segment breakdown, guard status.

## Analysis

### Top Winning Cases

Download predictions from best run and baseline. Join on key columns.
Show top 5-10 examples where the model improved most.

| Example | Baseline Score | Best Score | Delta | Why |
| ------- | -------------- | ---------- | ----- | --- |

### Top Losing Cases

Show top 5-10 examples where the model regressed most.

| Example | Baseline Score | Best Score | Delta | Why |
| ------- | -------------- | ---------- | ----- | --- |

### Key Findings

<What worked, what didn't, surprises, SHAP insights>

## Discussion & Proposals

What worked/didn't, convergence assessment, open directions, recommendations.

## Appendix

Best config diff, key run links, GCS artifacts, agent reference YAML.
```

## Output Checklist — verify before returning:

- [ ] `<report_path>` filename contains the round's `<run_id>` (no overwrite of prior rounds)
- [ ] All 7 sections present
- [ ] Results table has actual numbers (not placeholders)
- [ ] **Top Winning Cases table has real examples from downloaded predictions**
- [ ] **Top Losing Cases table has real examples from downloaded predictions**
- [ ] Discussion proposes concrete next directions
- [ ] Appendix has run links and config diff
