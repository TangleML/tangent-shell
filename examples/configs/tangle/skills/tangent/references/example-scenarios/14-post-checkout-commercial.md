# Post-Checkout & Commercial

## What It Does

Two distinct ML applications: (1) post-checkout model evaluation via dbt for buyer experience quality, and (2) US Marketing Mix Model (MMM) training using Bayesian MCMC for marketing channel effectiveness measurement.

## What It Optimizes

- **Post-checkout**: Model evaluation assertions (data quality + business logic) via dbt tests
- **MMM**: Marketing ROI attribution across channels, DMA-level geographic modeling

## Pipeline Flow

### Post-Checkout Model Evaluation
```
dbt run (post_checkout_model_evaluation) -> dbt test (assertions)
```
Simple 2-task pipeline using dbt to materialize an incremental model in BigQuery, then validate with dbt tests. This is a SQL-driven evaluation pipeline, not traditional ML training.

### US MMM Training Pipeline
```
Load Input Data (BQ: dma_mmm_metrics, 3yr rolling) -> Preprocess and Configure -> Train MMM Model -> Validate Model -> Save Model (GCS)
Load Prior Data (BQ: us_mmm_prior_data) ---------^
```

1. **Data loading**: 3-year rolling window from `mart_commercial_optimization.dma_mmm_metrics` + prior data
2. **Preprocessing**: DMA combining (50 target DMAs), knot configuration for media response curves
3. **Training**: Google Meridian Bayesian MCMC -- 8 chains, 4000 adaptation steps, 2000 burn-in, 2000 keep samples
4. **Validation**: Automated PASS/FAIL/REVIEW determination
5. **Routing**: PASS → production GCS path, FAIL/REVIEW → staging GCS path

## ML Techniques

| Aspect | Post-Checkout | US MMM |
|--------|--------------|--------|
| **Method** | dbt incremental model + tests | Bayesian MCMC (Google Meridian) |
| **Model type** | SQL-based evaluation | Marketing Mix Model |
| **Inference** | BQ SQL | 8 MCMC chains, 2000 samples each |
| **Hardware** | Standard BQ | 1x NVIDIA H200 (Nebius), 16 CPU, 64Gi |
| **Validation** | dbt test assertions | Automated PASS/FAIL/REVIEW |
| **Output** | BQ table `sdp-prd-payments` | `gs://sdp-prd-commercial/mmm_model_objects/us/` |
| **Source** | `shopify-playground/buyer-risk-project-docs` | `Shopify/meridian` |

## Active Users

| User | Pipeline | Activity |
|------|----------|----------|
| nate.george | Post-checkout model evaluation | 5 runs on Apr 2 |
| tangle-runner SA (sdp-prd-commercial) | US MMM Training Pipeline | Automated scheduled runs |

## Key Components

| Component | Digest | Purpose |
|-----------|--------|---------|
| `dbt run post_checkout_model_evaluation` | `eaafdfa6` | Materialize evaluation model |
| `dbt test post_checkout_model_evaluation` | `4d3e6266` | Validate assertions |
| `Run bigquery and save as dataset v02` | `aabc4353` | Load MMM input/prior data |
| `Preprocess and configure` | `2c154996` | DMA combining, knot config |
| `Train MMM Model` | `85b24ffb` | Meridian MCMC training |
| `Validate model` | `600f9794` | PASS/FAIL/REVIEW gate |
| `Save model` | `c4585cd4` | Route to production or staging GCS |

## Key Links

- Post-Checkout Eval: [019d4feb066c5ff589b0](https://oasis.shopify.io/runs/019d4feb066c5ff589b0)
- US MMM Training: [019d4facf7987264829d](https://oasis.shopify.io/runs/019d4facf7987264829d)

## Key Observations

- **Bayesian MCMC is rare on Tangle**: Only pipeline using MCMC sampling -- everything else is gradient-based or tree-based
- **Geographic modeling**: DMA-level granularity across 50 US Designated Market Areas
- **Validation routing**: Automated quality gate routes models to production vs staging -- human review for REVIEW status
- **dbt on Tangle**: Post-checkout shows Tangle used for SQL-based pipelines, not just ML training
