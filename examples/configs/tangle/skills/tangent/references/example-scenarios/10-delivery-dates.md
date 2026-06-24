# Delivery Dates

## What It Does

Trains the Delivery Hours Model (DHM) that predicts estimated delivery dates for Shopify orders. Unique in that the trained LightGBM model is **compiled to a native shared library (.so)** via LLVM for production serving performance.

## What It Optimizes

- **Primary**: Delivery hour prediction accuracy
- **Serving**: Inference latency via native compilation with PGO + BOLT optimization

## Pipeline Flow

```
Dhm Prepare and Train -> Dhm Compile (LLVM) -> Dhm Package (upload to GCS)
                     |
                     +-> Dhm Predict (generate eval metrics)
```

1. **Prepare and train**: Data prepared from BQ, two-pass LightGBM model trained
2. **Compile**: Model compiled via `lleaves` (LightGBM → LLVM IR → native `.so`) with Profile-Guided Optimization (PGO) and BOLT post-link optimization, targeting `linux-x86-64-emeraldrapids` architecture
3. **Package**: Model artifacts bundled as deployment `.tgz` and uploaded to `gs://predicted-delivery-dates/dhm/`
4. **Predict**: Separately, predictions generated on full/small dataset for evaluation

## ML Techniques

| Aspect           | Details                                                         |
| ---------------- | --------------------------------------------------------------- |
| **Model**        | Two-pass LightGBM (DHM = Delivery Hours Model)                  |
| **Compilation**  | lleaves: LightGBM → LLVM IR → native `.so` shared library       |
| **Optimization** | PGO (Profile-Guided Optimization) + BOLT post-link optimization |
| **Target arch**  | `linux-x86-64-emeraldrapids` (Intel Sapphire Rapids+)           |
| **Hardware**     | 120 CPU, 510Gi memory (train); 60 CPU, 510Gi (predict)          |
| **Data size**    | Configurable: `dataset_size=small` (testing) or full            |

## Key Components

| Component               | Digest     | Purpose                          |
| ----------------------- | ---------- | -------------------------------- |
| `Dhm prepare and train` | `e1b5d38a` | Data prep + LightGBM training    |
| `Dhm compile`           | `41fce585` | LLVM compilation with PGO + BOLT |
| `Dhm predict`           | `804d7117` | Generate prediction metrics      |
| `Dhm package`           | `655b7f3a` | Bundle artifacts for deployment  |

## Active Users

| User       | Focus                                       | Activity          |
| ---------- | ------------------------------------------- | ----------------- |
| peter.moon | Delivery date model training and evaluation | 10+ runs on Apr 2 |

## Key Links

- delivery_dates_training_eval: [019d4fde457336ae6917](https://oasis.shopify.io/runs/019d4fde457336ae6917)
- Source: `world/areas/ml/shipping-tangle`

## Key Observations

- **Unique compilation pipeline**: Only Tangle pipeline that compiles ML models to native code
- **BOLT optimization**: Post-link binary optimization is extremely unusual for ML pipelines -- indicates latency-sensitive production serving
- **Same owner as shipping fraud**: peter.moon works across both delivery estimation and shipping fraud
