# Storefront Search Ranking

## What It Does

Trains and evaluates learning-to-rank models for Shopify storefront product search. The system uses a **dual-model ensemble**: a relevance ranker (trained on human relevance labels via LambdaRank) and an engagement ranker (trained on click fair-pairs). Both scores are z-score normalized and combined at a configurable ensemble weight.

## What It Optimizes

- **Primary**: oneNDCG v3 @10 (combined ensemble relevance metric)
- **Engagement**: Fair pairs win rate (click agreement between model ranking and user clicks)
- **Merchant presence**: M+ metrics (merchant visibility at various positions)
- **Per-segment**: Head/torso/tail/generic/brand/category query segments tracked independently

## Pipeline Flow

```
[Parallel Training]
  Relevance Ranker (8 tasks):
    Generate Base -> Generate Featureset -> Update LGBM Config -> Train LGBM -> {Eval Adhoc, SHAP, Score Stats}

  Engagement Ranker (8 tasks):
    Generate Click Base -> Generate Click Featureset -> Update Config -> Train LGBM -> {Eval Fair Pairs, SHAP, Score Stats}

[After both complete]
  Combined Eval (7 tasks):
    3 parallel eval tracks -> Log Metrics to Comet
    - Eval Adhoc (DCG on relevance featureset)
    - Eval Fair Pairs (click agreement on engagement featureset)
    - Eval Mplus (merchant presence)
```

**Total**: ~23 leaf tasks per full pipeline run.

## ML Techniques

| Aspect | Details |
|--------|---------|
| **Model type** | LightGBM (primary), CatBoost (experimental via zhibiao.rao) |
| **Relevance loss** | LambdaRank (pairwise learning-to-rank) |
| **Engagement loss** | Fair pairs (click agreement) |
| **Features** | ~900 features in base_v16 featureset; GTE embedding dominant at 18.6% SHAP |
| **Ensemble** | Z-score normalization per model, weighted combination (weight ~0.18 for engagement) |
| **Score transforms** | Configurable: zscore / sigmoid / minmax |
| **Explainability** | SHAP analysis on 5000 samples with summary + bar plots |
| **Experiment tracking** | Comet ML with `combined_eval` prefix |
| **Hardware** | 64 CPU / 512Gi RAM per training/eval task; 32 CPU / 256Gi for SHAP (no GPU -- tree models) |

## Key Components

| Component | Purpose |
|-----------|---------|
| `scripts.generate_base` | Generate base dataset from SQL template |
| `scripts.generate_featureset` | Enrich base with product attributes |
| `scripts.generate_click_base` | Generate click-based dataset with fair pairs + OFE features |
| `reranker.models.scripts.train` | Train LightGBM/CatBoost ranker |
| `scripts.eval_adhoc` | DCG evaluation |
| `scripts.eval_fair_pairs` | Click agreement evaluation |
| `tangle.components.sources.shap_analysis` | SHAP feature importance |
| `tangle.components.sources.compute_zscore_stats` | Score distribution stats for normalization |
| `tangle.components.sources.log_metrics_to_comet` | Log all metrics to Comet ML |

## Active Users & Runs

| User | Pipeline Variant | Branch | Notes |
|------|-----------------|--------|-------|
| noah.frank | Combined L2 Ranker (LGBM) | `nefrank/metrics-v4-retrain` | Standard production recipe |
| zhibiao.rao | Combined L2 Ranker (CatBoost) | `zhrao/catboost_pipeline` | CatBoost migration experiment; `.cbm` model files |
| madhav.thaker | Train Ranker V8 ANN Union | `03-23-multi-negative-training` | Round 31 of ANN union optimization; single-model (relevance only) |

## Key Links

- Combined Ranker (noah.frank): [019d507e72f098d7733a](https://oasis.shopify.io/runs/019d507e72f098d7733a)
- Combined Ranker (zhibiao.rao, CatBoost): [019d5023c8c5c7b6be6a](https://oasis.shopify.io/runs/019d5023c8c5c7b6be6a)
- Train Ranker V8 ANN Union: [019d4fdf9daad7a6b0a6](https://oasis.shopify.io/runs/019d4fdf9daad7a6b0a6)
- Engagement Eval Only: [019d5023b02ad6507e36](https://oasis.shopify.io/runs/019d5023b02ad6507e36)
- Combined Eval: [019d5023686f49beba6f](https://oasis.shopify.io/runs/019d5023686f49beba6f)
- Container image: `us-docker.pkg.dev/shopify-docker-images/containers/apps/production/search-reranker`

## Known Issues & Research Findings

- **Ensemble hurts primary metric**: Combined (0.4237) < relevance-only (0.4525) by 2.88pp -- engagement weight 0.18 too high
- **Feature dominance**: GTE embedding at 18.6% SHAP (3.2x gap to #2); `feature_fraction=0.9` too high
- **Dead features**: 29 zero-SHAP features, 79 near-zero (<0.001), mostly ExactMatch/FuzzyMatch
- **Truncation mismatch**: Truncation=60 but optimizing NDCG@10 (wastes gradient on positions 11-60)
- **Weak segments**: Tail queries (0.2766) and generic queries (0.3077) are 30% below average
