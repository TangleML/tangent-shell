# Storefront Vantage

## What It Does

A comprehensive offline search evaluation system for Shopify storefront search. Follows a **Scrape → Hydrate → Judge Evaluate** pattern: live search results are scraped, enriched with product data and relevance judgments, then scored using a `storefront_v1.2` composite evaluator. Includes both scheduled daily monitoring and ad-hoc experimentation with different model architectures, feature sets, and query processing strategies.

## What It Optimizes

- **Primary**: Composite search quality score v1.2 (combining relevance, engagement, and user satisfaction signals)
- **Per-experiment**: Configuration-specific quality metrics compared against baseline
- **Monitoring**: Daily quality pulse tracking regression and improvement trends
- **Minimum bar**: min_success_rate=0.90 on scrape completeness

## Pipeline Flow

### Core Pattern: Scrape → Hydrate → Judge Evaluate

All Vantage pipelines share the `Shop Scrape Judge Evaluate` subgraph:

```
Scrape Config Manager (StorefrontVantage) -> Merge jsons (update template params)
                                                      |
                                               Scrape V2 (storefront_vantage env, live search API)
                                                      |
                                               Hydrate (add product data + relevance judgments)
                                                      |
                                               Judge Evaluate storefront_v1.2 (composite scoring)
```

### Storefront Vantage Daily Pulse (Automated)

Adds a **Schedule Manager** for time-based cache busting (24h interval) to ensure daily freshness:

```
[Pipeline Creation Time] -> Truncate if time (24h boundary, used as cache_bust_key)
                                   |
                            Shop Scrape Judge Evaluate (subgraph above)
```

Scheduled every 4 hours (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC) by `relevance-cloud-runner` service account.
Query set: `daily_pulse_storefront_v4`. Search model: `StorefrontVantage`.

### Storefront Vantage Experiments (Manual)

Xiaofeng.xu runs controlled experiments varying one dimension at a time:

| Experiment                             | What It Tests                                                |
| -------------------------------------- | ------------------------------------------------------------ |
| `Vantage Combined No QR`               | Combined model without query rewriting -- isolates QR impact |
| `Vantage Body Html`                    | Using HTML body text as ranking feature                      |
| `Vantage Embed Threshold 0.1/0.15/0.2` | Semantic embedding similarity cutoff sweep                   |
| `Vantage DNN`                          | Deep neural network ranker (vs tree-based LGBM)              |
| `Vantage Rel Only`                     | Relevance-only ranking (no engagement signals)               |
| `Vantage Baseline`                     | Standard production configuration                            |
| `Vantage Symspell QR`                  | SymSpell-based query rewriting (spelling correction)         |

### Storefront L1 Scrape with QU (regan.zhao)

L1 stage evaluation with query understanding features enabled. Tests how QU pipeline improvements affect initial candidate retrieval.

### Storefront Scrape Only (regan.zhao)

Lightweight scrape-only pipeline (no judging/evaluation). Uses `storefront_reranker_scrape_20260331` query set with `{"first": 30}` template params, 15 QPS rate, 20 concurrent queries, 500ms delay.

## ML Techniques

| Aspect                    | Details                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| **Evaluation pattern**    | Scrape → Hydrate → Judge Evaluate (`storefront_v1.2` composite)                        |
| **DNN variant**           | Neural ranker as alternative to LGBM-based production ranker                           |
| **Embedding threshold**   | Configurable cosine similarity cutoff for semantic retrieval                           |
| **Query rewriting**       | SymSpell and other QR strategies tested for spelling correction impact                 |
| **Body HTML features**    | Product description HTML as additional ranking signal                                  |
| **Composite scoring**     | `storefront_v1.2` evaluator combining multiple quality signals                         |
| **Scrape infrastructure** | Vantage broker (`vantage_broker_shop_real_upi` env for standard; gRPC for alternative) |

## Key Components

| Component                        | Digest                                                                  | Purpose                                             |
| -------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| `Scrape Config Manager`          | `ac194d61`                                                              | Load StorefrontVantage search configuration         |
| `Merge jsons`                    | `fced86cc`                                                              | Update template parameters for experiment variants  |
| `Scrape V2`                      | `f50efb26` (manual), `db6067c0` (daily pulse), `bd949381` (scrape-only) | Hit live search APIs                                |
| `Hydrate`                        | `fbdf3230`                                                              | Enrich scrape results with product data + judgments |
| `Judge Evaluate storefront_v1.2` | `92ec6ff4` (manual), `0c6f84ab` (daily pulse)                           | Composite quality scoring                           |
| `Truncate if time`               | `9ff70bbe`                                                              | Schedule manager for daily cache busting            |

## Active Users

| User                      | Focus                                                      | Activity                |
| ------------------------- | ---------------------------------------------------------- | ----------------------- |
| xiaofeng.xu               | Systematic variant experiments (threshold sweeps, DNN, QR) | 5-10 runs/day           |
| regan.zhao                | L1 scraping and QU integration testing                     | 3-5 runs/day            |
| relevance-cloud-runner SA | Daily Pulse + production pipeline monitoring               | 12 runs/day (automated) |

## Key Links

- Vantage Embed Threshold 0.15: [019d503cade7f3351185](https://oasis.shopify.io/runs/019d503cade7f3351185)
- Vantage Combined No QR: [019d500a319b9f812e9b](https://oasis.shopify.io/runs/019d500a319b9f812e9b)
- Vantage Daily Pulse: [019d4fc854dc2e677eb5](https://oasis.shopify.io/runs/019d4fc854dc2e677eb5)
- Storefront Scrape Only: [019d4ebf42d9cb4d1e64](https://oasis.shopify.io/runs/019d4ebf42d9cb4d1e64)
- [View all storefront runs](https://oasis.shopify.io/?filter=%7B%22pipeline_name%22%3A+%22storefront%22%2C+%22created_after%22%3A+%222026-01-01T00%3A00%3A00Z%22%2C+%22created_before%22%3A+%222026-04-03T00%3A00%3A00Z%22%7D)

## Key Observations

- **Scrape-Hydrate-Judge pattern**: All Vantage pipelines share this core evaluation pattern, with different scrape configs
- **Systematic A/B testing**: Xiaofeng varies exactly one parameter per experiment, enabling clean causal attribution
- **Embedding threshold is key tuning lever**: Three thresholds tested (0.1, 0.15, 0.2) -- small changes have outsized ranking impact
- **DNN exploration**: Active investigation of whether neural rankers can outperform tree-based LGBM on storefront
- **QR impact isolation**: Comparing "No QR" vs "Symspell QR" vs baseline directly measures query rewriting value
- **Cache busting**: Daily Pulse uses 24h time truncation as cache key to prevent stale results
