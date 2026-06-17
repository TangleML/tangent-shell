# Tangle Pipeline Usage Report — Jan-Apr 2026

> **Purpose**: Structured inventory of all ML experiment pipelines running on Tangle/Oasis at Shopify,
> derived from live run data (Jan 1 - Apr 2, 2026) and codebase analysis.
> Designed for consumption by autonomous agents evaluating which scenarios to target next.

**Period**: 2026-01-01 to 2026-04-02
**Data sources**: Tangle/Oasis API (`search_runs`, `get_run_details`), tangent codebase (`discovery/` subtree)

---

## Product Areas

| # | Area | File | What It Optimizes | Key Technique | Users | Runs/Month |
|---|------|------|-------------------|---------------|-------|------------|
| 1 | [Storefront Search Ranking](01-storefront-search-ranking.md) | `01-storefront-search-ranking.md` | NDCG@10 on storefront product search | Dual LGBM/CatBoost ensemble (relevance + engagement) | noah.frank, zhibiao.rao, madhav.thaker | Very High |
| 2 | [UPI Cross-Shop Matching](02-upi-cross-shop-matching.md) | `02-upi-cross-shop-matching.md` | F1 on cross-shop product identity | Qwen3-VL-2B SFT with logprob scoring + GPT-5.2 judge | ben.chen, matt.mitsui | Very High |
| 3 | [Embedding & Semantic Search](03-embedding-semantic-search.md) | `03-embedding-semantic-search.md` | Retrieval quality (recall@K) | Contrastive embedding training with hard negatives on Nebius | yang.liu, sourav.bhattacharjee | Very High |
| 4 | [Storefront Vantage](04-storefront-vantage.md) | `04-storefront-vantage.md` | Search quality composite score | Multi-variant A/B eval (DNN, thresholds, query rewriting) | xiaofeng.xu, regan.zhao | High |
| 5 | [Search Relevance SFT](05-search-relevance-sft.md) | `05-search-relevance-sft.md` | Relevance ranking quality | Knowledge distillation SFT, multi-node distributed training | daria.sorokina, shane.moran | High |
| 6 | [Query Rewriting](06-query-rewriting.md) | `06-query-rewriting.md` | Personalized search recall | Personalized query expansion with gRPC serving evaluation | younggue.bae | High |
| 7 | [Catalog Taxonomy](07-catalog-taxonomy.md) | `07-catalog-taxonomy.md` | Category/attribute classification accuracy | SFT via Unified Distillation on H100 (Nebius) | xinjing.wang | High |
| 8 | [Offline Reranker (Scheduled)](08-offline-reranker-scheduled.md) | `08-offline-reranker-scheduled.md` | Composite relevance score v4.0 | GPT-5.2 relevance judgments + position signals | relevance-cloud-runner SA | Continuous |
| 9 | [Fraud & Risk ML](09-fraud-risk-ml.md) | `09-fraud-risk-ml.md` | AUPRC on fraud detection | LightGBM with Optuna HPO, temporal CV, champion/challenger | anirudh.mahesh, eric.lybrand, peter.moon | Medium |
| 10 | [Delivery Dates](10-delivery-dates.md) | `10-delivery-dates.md` | Delivery hour prediction accuracy | LightGBM compiled to native .so via LLVM+BOLT PGO | peter.moon | Medium |
| 11 | [GraphQL Gist](11-graphql-gist.md) | `11-graphql-gist.md` | GraphQL code generation quality | Gist token distillation (prompt compression) + ACE eval | matthew.sherar | Medium |
| 12 | [Product Recommendations](12-product-recommendations.md) | `12-product-recommendations.md` | Category Match Rate@K, Duplicate Rate@K | LLM Precision Judge on similarity API results | mariya.mansurova | Medium |
| 13 | [AI Search Judges](13-ai-search-judges.md) | `13-ai-search-judges.md` | Judge accuracy across 5 criteria | GEPA prompt optimization + nightly flywheel judges | precious.kolawole, sidekick SA | Continuous |
| 14 | [Post-Checkout & Commercial](14-post-checkout-commercial.md) | `14-post-checkout-commercial.md` | Marketing ROI (MMM), post-checkout quality | Bayesian MCMC (Meridian) for MMM; dbt for eval | nate.george, tangle-runner SA | Low-Medium |
| 15 | [Tangent Agent Scenarios](15-tangent-agent-scenarios.md) | `15-tangent-agent-scenarios.md` | Autonomous ML experiment optimization | 8-step agent loop with SHAP analysis, ensemble tuning | tangent agent | Active Setup |

---

## Cross-Cutting Techniques

| Technique | Where Used |
|-----------|-----------|
| **LightGBM/CatBoost L2R** | Storefront ranking, fraud detection, delivery dates |
| **SFT via Unified Distillation** | UPI cross-shop matching, catalog taxonomy, search relevance |
| **Vision-Language Models (Qwen3-VL)** | UPI cross-shop matching |
| **LLM-as-Judge (GPT-5.2)** | UPI options, offline reranker, similar products, AI search, GEPA |
| **Gist Token Distillation** | GraphQL code generation |
| **Bayesian MCMC (Meridian)** | US Marketing Mix Model |
| **LLVM Model Compilation** | Delivery date prediction (lleaves + BOLT PGO) |
| **Contrastive Embedding Training** | Semantic search embeddings |
| **GEPA Prompt Optimization** | Help search judge criteria |
| **Champion/Challenger Registry** | Card fraud, shipping fraud (Comet ML) |
| **Comet ML Experiment Tracking** | Storefront ranking, UPI eval, fraud, taxonomy |

## Infrastructure Patterns

| Pattern | Details |
|---------|---------|
| **GPU clusters** | Nebius (H200 for SFT/embedding, H100 for taxonomy), GKE for tree models |
| **Scheduled runs** | 4-hourly Storefront/Vantage pulses, nightly judges, daily offline reranker |
| **External integrations** | Airflow DAGs (UPI judge, offline reranker), CentML deploy (GraphQL gist), Comet ML registry |
| **Data flow** | BigQuery -> GCS -> training -> HuggingFace / Comet registry -> eval -> BQ metrics |
