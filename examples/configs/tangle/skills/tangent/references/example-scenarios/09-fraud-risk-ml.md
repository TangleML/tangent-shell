# Fraud & Risk ML

## What It Does

Trains ML models for fraud detection across two domains: (1) card fraud detection on payment transactions and (2) shipping fraud detection. Both use LightGBM with sophisticated evaluation and model registry patterns.

## What It Optimizes

- **Card fraud**: AUPRC (Area Under Precision-Recall Curve) as primary ranking metric, AUROC as secondary
- **Shipping fraud**: Normalized log loss < 0.5 as promotion gate

## Pipeline Flow

### Card Fraud V2 Model Training (Staging)
```
Create Comet Experiment -> Discover Dataset v2 -> Train with Splits -> Register Model -> Evaluate Cross Fold -> Compare Models
                     |                                  |
                     +-> Discover Featurized Auths      +-> Score Featurized Auths -> Upload to GCS
                     +-> Load Champion Model -----------------------------------------------^
Load Model Config (feeds Train + Score + Register)
```

1. **Comet experiment** created for tracking
2. **Latest dataset** discovered from GCS (temporal datasets)
3. **LightGBM trained** with temporal cross-validation folds, optional Optuna HPO
4. **Calibrator fitted** during training for probability calibration
5. **Model registered** to Comet model registry
6. **Cross-fold evaluation** against current champion model
7. **Champion/challenger comparison** by AUPRC
8. **Production scoring**: Featurized auth transactions scored and uploaded to GCS

### Shipping Fraud Train + Eval
```
Train (production mode) -> Promote (to Comet registry) -> Smoke Test
```

Simpler pipeline: train, check quality gate (`val_normalized_log_loss < 0.5`), promote to production stage in Comet, run smoke test.

## ML Techniques

| Aspect | Card Fraud | Shipping Fraud |
|--------|-----------|----------------|
| **Model** | LightGBM | LightGBM |
| **HPO** | Optuna (n_trials, timeout configurable) | N/A |
| **Validation** | Temporal cross-validation folds | Single holdout |
| **Calibration** | Fitted calibrator during training | N/A |
| **Quality gate** | min_auroc, min_auprc vs champion | val_normalized_log_loss < 0.5 |
| **Registry** | Comet ML model registry | Comet ML (`shipping-fraud` workspace) |
| **Pattern** | Champion/challenger comparison | Promote-or-block |

## Key Components

| Component | Digest | Purpose |
|-----------|--------|---------|
| `train_lgbm_with_splits` | `692bd7b0` | LightGBM training with temporal CV |
| `compare_models` | `b5bc76fe` | AUPRC comparison: challenger vs champion |
| `register_model` | `6885e399` | Push model + calibrator to Comet registry |
| `evaluate_model_cross_fold` | `a2b654a1` | Cross-fold evaluation metrics |
| `score_featurized_auths` | `13b21155` | Score production transactions |
| `Shipping Fraud Train` | `f9a6b29d` | End-to-end shipping fraud training |
| `st-promote` | `08efdbfc` | Conditional promotion to production |

## Active Users

| User | Pipeline | Activity |
|------|----------|----------|
| anirudh.mahesh | Card fraud v2 staging | 8+ runs/day (rapid iteration) |
| eric.lybrand | Card fraud v2 staging | Periodic runs |
| peter.moon | Shipping fraud train+eval | 1-2 runs/session |

## Key Links

- Card Fraud V2 Staging: [019d4fff546f1f651c23](https://oasis.shopify.io/runs/019d4fff546f1f651c23)
- Shipping Fraud: [019d4fef8092626ae6af](https://oasis.shopify.io/runs/019d4fef8092626ae6af)
- Source: `Shopify/financial-services-data` (card fraud), `world/areas/ml/shipping-tangle` (shipping)
