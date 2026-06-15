# UPI Cross-Shop Matching

## What It Does

Determines whether two products from different Shopify stores are the same product (or allowed variants like size/color). Uses a multi-stage architecture: ANN retrieval -> L1 scoring -> L3 reranking (vision-language model) -> connected components clustering -> UPI assignment. The reranker is the core ML model being actively iterated on.

## What It Optimizes

- **Primary**: F1 score on product match classification (target: >0.99, current baseline: 0.8269)
- **Priority**: Precision first, then recall
- **Operational**: Precision/recall at 6 thresholds (0.755, 0.852, 0.905, 0.940, 0.963, 0.982)
- **Full pipeline**: ANN recall@K, L1/L3 precision/recall, edge coverage, cluster precision/recall, UPI assignment quality

## Pipeline Flow

The ecosystem has 4 distinct pipeline types that form a complete ML lifecycle:

### 1. Dataset Generation Pipeline

```
Materialize BQ Template -> Create BQ Dataset -> Render Template Column -> Filter Columns
                                                                     |-> Split Prompt/Completion -> Strip Trailing Assistant -> Publish TRL Dataset
                                                                     |-> Prepare VL Dataset -> Profile & Filter (pixel range 4096-173056) -> Publish B64 Dataset
Materialize Prompt Template -> Render Template Column
Create BQ Dataset -> HF to OpenAI Batch
```

**Input**: 8 BQ matching tables (consideration_100k, consideration_50k x4, search_100k, random_25k, ann_highsim_gmv_50k)
**Output**: HuggingFace datasets in TRL format (text) + B64 format (with images) + OpenAI batch format

### 2. SFT Training + Eval Pipeline

```
Download Model (Qwen3-VL-Reranker-2B) ----\
Download Train Dataset --------------------> SFT Train -> Inference (vLLM) -> Upload Predictions to BQ -> Unified Eval
Download Eval Dataset --------------------/
Materialize SFT Config -> SFT Train
Materialize Inference Config -> Inference
```

### 3. Full Multi-Stage Eval (Unified Eval)

```
[7 Parallel Evals]:
  ANN Eval (FAISS results) | L1 Eval | L3 Eval | GTIN Eval | CC Eval | UPI Eval | Prod UPI Eval

[3 LLM Judge Branches]:
  CC Eval -> CC Judge Config -> Trigger Airflow DAG -> CC Judge Metrics
  UPI Eval -> UPI Judge Config -> Trigger Airflow DAG -> UPI Judge Metrics
  Prod UPI Eval -> Prod Judge Config -> Trigger Airflow DAG -> Prod Judge Metrics
```

### 4. UPI Options Judge (Quality Audit)

```
Prompt Resolver -> UPI Data Loader -> Payload Formatter -> Row Cached LLM Judge -> Error Rate Checker -> Results Writer
```

## ML Techniques

| Aspect                  | Details                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| **Base model**          | Qwen3-VL-Reranker-2B (2B param vision-language model)                      |
| **Training**            | SFT with TRL, completion-only loss, frozen visual encoder (`model.visual`) |
| **Optimizer**           | AdamW (beta1=0.9, beta2=0.95, eps=1e-7), weight decay 1.3e-8               |
| **LR**                  | 2e-05, linear scheduler, 20 warmup steps                                   |
| **Grad clipping**       | max_grad_norm=0.02 (extremely conservative)                                |
| **Precision**           | bf16, flash_attention_2, gradient_checkpointing                            |
| **Distributed**         | FSDP2 on 8x NVIDIA H200 (Nebius)                                           |
| **Inference**           | vLLM with prefix caching + chunked prefill on 1x H200                      |
| **Scoring**             | Extract P(positive) from logprobs as matching score                        |
| **Evaluation**          | Multi-threshold precision/recall + LLM judge (GPT-5.2 via Airflow DAG)     |
| **Options audit**       | GPT-5.2 judge with row-level caching (table: `options_judge_cache`)        |
| **Experiment tracking** | Comet ML (`upi-cross-store-clustering-eval`)                               |

## Key Components

| Component                                 | Digest     | Purpose                        |
| ----------------------------------------- | ---------- | ------------------------------ |
| `Unified Distillation: Train`             | `8a0773d5` | SFT fine-tuning via TRL        |
| `Inference Only` (subgraph)               | `90c0a6a1` | vLLM batch inference           |
| `UPI Reranker: Create HF Dataset from BQ` | `1cfc5a03` | BQ SQL -> HuggingFace dataset  |
| `UPI Reranker: Render Template Column`    | `887b2fa4` | Apply Jinja prompt to each row |
| `UPI Reranker: Prepare VL Dataset`        | `650b7302` | Download images, encode base64 |
| `[UPI Clustering] Unified Eval`           | `f62253d1` | Precision/recall at thresholds |
| `Trigger Airflow DAG`                     | `6cce1855` | Trigger external LLM judge     |
| `Upi options llm judge`                   | (inline)   | GPT-5.2 quality audit          |

## Active Experiment Variants

| Pipeline Name                               | What's Different                        | Runs     |
| ------------------------------------------- | --------------------------------------- | -------- |
| `UPI Reranker SFT Metafields v2 Old Recipe` | Baseline training recipe                | Many     |
| `UPI Reranker SFT Metafields v2 UD Recipe`  | Updated Unified Distillation recipe     | Many     |
| `UPI Reranker SFT Dir6 Full + ANN 50k`      | Added Dir6 data + ANN high-sim pairs    | Many     |
| `UPI Reranker SFT Metafields + Collections` | Added collection metadata features      | Many     |
| `UPI Reranker MF+Dir6+ANN v6`               | Latest iteration combining all features | Latest   |
| `Unified Eval — All Stages`                 | Full 7-stage + 3-judge evaluation       | Periodic |

## Key Links

- Dataset Gen v6: [019d507ec70a87581e29](https://oasis.shopify.io/runs/019d507ec70a87581e29)
- SFT Training: [019d4f834c158a410089](https://oasis.shopify.io/runs/019d4f834c158a410089)
- Eval (Oleg v22-4): [019d4ec8f3cb88016701](https://oasis.shopify.io/runs/019d4ec8f3cb88016701)
- Unified Eval All Stages: [019d4c0efe4b43a79ae7](https://oasis.shopify.io/runs/019d4c0efe4b43a79ae7)
- UPI Options Judge: [019d4db2eced0cd30ddd](https://oasis.shopify.io/runs/019d4db2eced0cd30ddd)
- Source: `world/areas/ml/foundation-models/unified-distillation/tangle/pipelines/upi`

## Known Issues & Research Findings

- **17.3pp F1 gap** to target (0.8269 vs 0.99) -- largest active gap
- **214 confidently wrong FNs** (score <0.1) suggest model cannot adapt to product image variations
- **MLP merger frozen** -- prevents visual projection learning
- **Class imbalance**: 7.6% positive rate (13:1 ratio) in training data
- **Calibration issue**: Recall@99% precision is only 0.0469
- **Progressive feature enrichment**: metafields -> Dir6 data -> ANN candidates -> collections
