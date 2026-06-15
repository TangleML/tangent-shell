# Tangent Agent Scenarios

## What It Does

Tangent is an **autonomous ML experiment agent** that iterates on Tangle pipeline improvement. It doesn't just tune hyperparameters -- it can select features, change data composition, modify ensemble weights, analyze SHAP importance, and decide when to stop based on convergence criteria. Two production scenarios are defined for the storefront ranker and UPI cross-shop matching problems.

## What It Optimizes

- **Combined Ranker**: oneNDCG v3 @10 on storefront search (current: 0.4237)
- **Cross-Shop L3**: F1 on product matching (current: 0.8269, target: >0.99)

## Tangent Agent Architecture

### 8-Step Autonomous Loop

```
Step 0: Initialize (read scenario, find baseline)
Step 1: Analyze (extract baseline metrics, SHAP, weak segments)
Step 2: Hypothesize (propose experiment: feature, hyperparameter, data change)
Step 3: Submit (launch pipeline run, record in MEMORY)
Step 4: Monitor (wait for completion, poll status)
Step 5: Evaluate (compare metrics, check guards, download artifacts)
Step 6: Synthesize (extract lessons, update MEMORY)
Step 7: Decide (converged? → Stop. Else → Loop to Step 1)
```

### 5 Subagents

| Agent                | Purpose                                                     |
| -------------------- | ----------------------------------------------------------- |
| **Researcher**       | Pre-experiment research (code, literature, Slack, BigQuery) |
| **Debugger**         | Diagnose pipeline failures                                  |
| **Reporter**         | Generate metrics reports                                    |
| **Reviewer**         | Code review for experiment changes                          |
| **Scenario-Builder** | Interactive scenario generation                             |

### Memory System

- `MEMORY.md`: Long-term memory (best config, baseline metrics, active runs, session index)
- `sessions/YYYY-MM-DD.md`: Detailed daily session logs (append-only)
- `research-brief.md`: Pre-experiment research findings
- `research-priors.txt`: One-line actionable priors
- `logs/events.jsonl`: Structured event log

## Scenario 1: Combined L2 Ranker

| Field             | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| **Config**        | `discovery/prototypes/tangent/scenarios/combined_ranker/scenario.yaml`     |
| **Baseline Run**  | [019d06d757bb0ca740d3](https://oasis.shopify.io/runs/019d06d757bb0ca740d3) |
| **Target Metric** | oneNDCG v3 @10 overall = 0.4237                                            |
| **Budget**        | 60 runs max, 4 parallel, 10 rounds                                         |
| **Status**        | Initialized + analyzed (Step 0-1 completed 2026-03-20), 0/60 runs used     |

### Search Space

| Action Type               | Actions Available                                                     |
| ------------------------- | --------------------------------------------------------------------- |
| **Feature selection**     | SHAP pruning, category pruning, feature_fraction reduction            |
| **Hyperparameter tuning** | LR, num_leaves, regularization, truncation, early stopping            |
| **Data actions**          | Label switching, label gain, position debiasing, clickstream ablation |
| **Ensemble actions**      | Weight sweep 0.0-0.18, score transform: zscore/sigmoid/minmax         |
| **Analysis**              | SHAP inspection, prediction analysis, run details                     |

### Research Findings (from research-brief.md)

- Ensemble hurts primary metric: combined 0.4237 < relevance-only 0.4525 (2.88pp gap)
- GTE embedding at 18.6% SHAP (3.2x gap to #2 feature); feature_fraction=0.9 too high
- 29 zero-SHAP features, 79 near-zero — pruning opportunity
- Truncation=60 vs NDCG@10 optimization (gradient waste on positions 11-60)
- Tail (0.2766) and generic (0.3077) queries are weakest segments

## Scenario 2: Cross-Shop L3 UPI Matching

| Field             | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| **Config**        | `discovery/prototypes/tangent/scenarios/cross_shop_l3/scenario.yaml`       |
| **Baseline Run**  | [019cadee6c9cb6802848](https://oasis.shopify.io/runs/019cadee6c9cb6802848) |
| **Target Metric** | F1 > 0.99 (current: 0.8269, gap +17.3 points)                              |
| **Budget**        | 30 runs max, 2 parallel, 8 rounds                                          |
| **Status**        | Scenario defined, no experiments run yet                                   |

### Search Space (Prioritized Tiers)

| Tier                    | Actions                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| **Tier 1 (HIGH)**       | unfreeze_mlp, add_search_data, hard_negative_mining, scale_to_8b                              |
| **Tier 2 (MEDIUM)**     | enable_eval_checkpointing, more_epochs_cosine_lr, dpo_after_sft, listwise_loss                |
| **Tier 3 (LOW-MEDIUM)** | add_sku_barcode_features, positive_upsampling, increase_image_resolution, relax_grad_clipping |

### Research Findings (from research-brief.md)

- MLP merger frozen -- prevents visual projection learning (Tier 1 fix)
- Only 2 epochs with linear decay to 0; LR=2e-5 is 3.3x higher than recommended 6e-6
- max_grad_norm=0.02 is extremely conservative (standard: 1.0)
- 7.6% positive rate (13:1 class imbalance); unused tables available (search_100k, random_25k)
- 214 confidently wrong FNs (score <0.1) suggest architectural limitation
- Related PRs: #27371 (distillation), #29172 (94% recall failures are candidate gen), #29353 (MDE analysis)

## Key Links

- Combined Ranker scenario: `discovery/prototypes/tangent/scenarios/combined_ranker/`
- Cross-Shop L3 scenario: `discovery/prototypes/tangent/scenarios/cross_shop_l3/`
- Tangent skills: `.agents/skills/tangent/SKILL.md`
- Smoke test: `discovery/prototypes/tangent/tests/test_scenarios/smoke_test/`

## Key Observations

- **Autonomous ML experimentation**: Tangent aims to replace manual experiment iteration with an agent loop
- **Budget-constrained**: Both scenarios have explicit run budgets (60 and 30) to prevent runaway costs
- **Connected to manual work**: The Combined Ranker and UPI Reranker manual pipelines (see files 01 and 02) are the exact same models that Tangent scenarios target
- **Rich research pre-work**: Detailed research briefs and prioritized experiment directions already prepared before agent starts
- **Early stage**: Both scenarios have full budgets remaining -- agent has not yet started autonomous experimentation
