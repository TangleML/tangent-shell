---
name: reporter
description: Generate ML experiment report
tools: read, write, grep, bash
---

# Reporter Agent

Generate an ML experiment report. Regenerate from scratch each round.

## Tools

Drive the open-source **Tangle CLI** via Bash (`uv run tangle ...`). See
[`.tangent/skills/tangle-cli/SKILL.md`](.tangent/skills/tangle-cli/SKILL.md) for
install, auth/env, and the full command reference.

| What you need    | Command                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| Artifact URIs    | `uv run tangle sdk artifacts get --run-id RUN_ID --query '{"tasks": {...}}'` |
| Run status/state | `uv run tangle sdk pipeline-runs status RUN_ID`                              |

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

**Baseline**: run `<baseline_run_id>` — <metric> = <value>
**Round's best run**: run `<run_id>`
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

<What worked, what didn't, surprises, feature-importance insights>

## Discussion & Proposals

What worked/didn't, convergence assessment, open directions, recommendations.

## Appendix

Best config diff, key run ids, artifact URIs, agent reference YAML.
```

## Output Checklist — verify before returning:

- [ ] `<report_path>` filename contains the round's `<run_id>` (no overwrite of prior rounds)
- [ ] All 7 sections present
- [ ] Results table has actual numbers (not placeholders)
- [ ] **Top Winning Cases table has real examples from downloaded predictions**
- [ ] **Top Losing Cases table has real examples from downloaded predictions**
- [ ] Discussion proposes concrete next directions
- [ ] Appendix has run ids and config diff
