# Query Rewriting

## What It Does

Evaluates a **350M-parameter LFM2 query expansion/synonyms model** (`Shopify/query_expansion_synonyms_model-lfm2_350m_preview`) for personalized search query rewriting (PQR). The pipeline runs model inference to generate expanded queries, scrapes search results with and without the expansion via Shopify's UPI index, then computes pairwise comparison metrics. Tests both standard Vantage broker and gRPC serving paths.

## What It Optimizes

- **Primary**: Pairwise win rate, AUC, harm rate (treatment vs baseline search results)
- **Recall**: recall@K improvement from rewritten queries
- **Segmented**: Quality broken down by query frequency x user activity buckets
- **Serving parity**: Consistency between Vantage broker (standard) and gRPC evaluation paths

## Pipeline Flow

### gRPC Evaluation
```
Prepare Personalized Sessions Prompt (BQ: pqr_session_sets, user profiles, product catalog)
Materialize Inference Config                                                                  \
Download Model (LFM2-350M) -----> Personalized Predict (vLLM, tp=4) -> gRPC Scrape Treatment -> Eval Treatment -\
                                                                                                                  +-> Compare (pairwise)
                                                     gRPC Scrape Baseline (latest-L1-f0) -----> Eval Baseline ---/
```

### Standard Evaluation (Vantage Broker)
```
Prepare Personalized Sessions Prompt
Materialize Inference Config                                                                         \
Download Model (LFM2-350M) -> Personalized Predict (vLLM) -> Personalized Scrape Arm (subgraph) -> Eval Treatment -\
                                                              [builds broker requests, executes]                     +-> Compare
                                              Scrape Baseline (vantage_broker_shop_real_upi) -----> Eval Baseline --/
```

The Scrape Arm subgraph produces both filtered results (for AUC/pairwise) and unfiltered top-N (for recall@K).

## ML Techniques

| Aspect | Details |
|--------|---------|
| **Model** | `Shopify/query_expansion_synonyms_model-lfm2_350m_preview` (LFM2 350M) |
| **Revision** | `626ae607ce6dda3221f07c090abd0d61e2992542` |
| **Inference** | vLLM, tensor_parallel_size=4, no constrained decoding |
| **Task** | Personalized Query Rewriting -- rewrites/expands queries using user session history, profiles, and product catalog |
| **Prompt prep** | Loads sessions from BQ (`pqr_session_sets`), user profiles, product catalog (`pqr_products_catalog`), renders per-session analysis prompts |
| **Baseline** | Standard search (`latest-L1-f0`) via Shopify UPI index (`shopify_upi/latest`), filtered by USD/US market, page_size=10, recall_page_size=500 |
| **Treatment** | Rich query with model expansion (`latest-rich-query-L1-f0`) using `treatment_query_sql` |
| **Scrape config** | Shopify UPI index, USD/US market |
| **Session set** | `ss-20260306-3fc982e3`, split: `mini-test` |
| **Metrics** | Pairwise win rate, AUC, harm rate, recall@K; segmented by query frequency x user activity |

## Key Components

| Component | Digest | Purpose |
|-----------|--------|---------|
| `Query Rewriting: Prepare Personalized Sessions Prompt` | `95845cdd` | Load sessions + user profiles from BQ, render prompts |
| `Unified Distillation: Materialize Config` | `f43555f6` | Materialize inference config |
| `Unified Distillation: Download HF` | `a4f578c8` | Download LFM2 model from HuggingFace |
| `Personalized Predict` | `bde25b91` (gRPC), `d1c5d308` (standard) | vLLM inference for query expansion |
| `Query Rewriting: gRPC Scrape` | `9621824d` | Scrape via gRPC endpoint |
| `Personalized Scrape Arm` (subgraph) | `85da7961` | Scrape via Vantage broker with filtered + unfiltered results |
| `Query Rewriting: Personalized Eval` | `65594d14` | Compute pairwise metrics |
| `Query Rewriting: Personalized Compare` | `087f8437` | A/B comparison of treatment vs baseline |

## Active Users

| User | Focus | Activity |
|------|-------|----------|
| younggue.bae | Model evaluation and serving validation | 10+ runs per day, both paths |

## Key Links

- Personalized Evaluation (gRPC): [019d507f8b26b3e6702e](https://oasis.shopify.io/runs/019d507f8b26b3e6702e)
- Personalized Evaluation (standard): [019d507b0f62130f8451](https://oasis.shopify.io/runs/019d507b0f62130f8451)
- Source: `areas/ml/foundation-models/unified-distillation/tangle/pipelines/query_rewriting`

## Key Observations

- **Eval-only pipeline**: No training -- purely evaluates an existing LFM2-350M model via A/B scrape comparison
- **Dual-path validation**: Every experiment runs both Vantage broker and gRPC paths in parallel -- serving infrastructure parity is critical
- **Personalization is the differentiator**: Not just spelling correction but user-context-aware query expansion using session history and user profiles
- **Vantage Scrape Arm is richer**: Standard path produces both filtered (for AUC) and unfiltered (for recall@K) results, while gRPC path is simpler
