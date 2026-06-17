# Reproduction Design Doc

Fill this in during PHASE 1 (Design subagent). Write the completed doc to
`artifacts/` and pin it. The final `DESIGN_READY` reply must reference its path.

## Paper

- **Title / authors / venue / year**:
- **Link**: arXiv / DOI / URL
- **PDF artifact path**: `artifacts/<paper>.pdf` (pinned: yes/no)

## Claim to reproduce

- **Headline result** (the specific number, table, or figure you will reproduce):
- **Metric(s)** and at what operating points:
- **Success criterion** (what "reproduced" means here, with tolerance):

## Datasets

| Dataset | Source / URI | Expected files | Checksums | Notes |
|---|---|---|---|---|
| | | | | |

## Methods

- **Method under test** (the paper's contribution):
- **Baseline(s)** to compare against:
- **Shared artifacts** reused by every method (quantizer, splits, tokenizer, ...):

## Pipeline DAG

Instantiate the seven-stage pattern for this paper. Every task must be a separate
node with explicit artifact wiring.

| # | Task | Inputs | Outputs | Purpose |
|---|---|---|---|---|
| 1 | `prepare_dataset` | | dataset dir, `dataset_manifest.json` | |
| 2 | `build_shared_artifacts` | | shared artifact, manifest | |
| 3 | `build_method_under_test` | | method artifact, manifest | |
| 4 | `build_baseline` | | baseline artifact, manifest | |
| 5 | `evaluate_sweep` | | `eval_results.json`, per-item metrics | |
| 6 | `plot_results` | | figure(s) (`.png`/`.svg`), `metrics.csv` | |
| 7 | `write_report` | | `summary.md`/`.html`, `repro_manifest.json` | |

Wiring summary (which output feeds which input):

```
dataset -> shared
dataset + shared -> method
dataset + shared -> baseline
dataset + shared + method + baseline -> evaluation
evaluation -> plots
manifests + metrics + plots -> report
```

**Design image artifact path**: `artifacts/<paper>-design.png` (pinned: yes/no)

## Configuration

- **Hyperparameters** (method): 
- **Hyperparameters** (baseline):
- **Sweep grid**:
- **Seeds**:

## Reproducibility settings

- **Threading**: single-threaded? which env vars / library calls?
- **Memory model**: in-memory eval? raw inputs retained for rerank/ground truth?
- **Timing**: per-item (no batched timing) for throughput metrics?
- **Metadata to record**: library versions, CPU/thread settings, config, seeds.

## Risks & caveats

- Known approximations (e.g. no exact author implementation available):
- Compute/runtime concerns:
- Anything that could prevent matching the paper's number:
