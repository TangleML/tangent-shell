# Offline Reranker (Scheduled)

## What It Does

Automated pipelines that continuously evaluate storefront search reranker quality using GPT-5.2 relevance judgments combined with position-based signals. Runs without human intervention on fixed schedules.

## What It Optimizes

- **Primary**: Composite relevance score v4.0 (combines LLM relevance judgments with position signals)
- **Monitoring**: Daily quality regression detection

## Pipeline Flow

### Offline Reranker Composite Score V4.0 Refresh

```
Create Query Set -> Create Scrape -> CompositeScores (triggers Airflow DAG)
Run BQ (search results as parquet) ---^           ^
Run BQ SQL - Search Results ---------------------+
Run BQ SQL - Relevance (GPT-5.2 judgments) ------+
```

1. **Query extraction**: Queries sampled from `offline_reranker_scores_fallback_latest`
2. **Scrape creation**: Live search results captured for the query set
3. **BQ data load**: Search results and GPT-5.2 relevance judgments loaded into temp tables
4. **Composite scoring**: Airflow DAG computes composite v4.0 scores combining position + relevance signals
5. **Output**: `sdp-prd-discovery-experience.search.offline_reranker_composite_score_refresh`

### Offline Reranker Evaluation Pipeline

Runs multiple times daily to evaluate reranker quality against latest search traffic.

## ML Techniques

| Aspect                | Details                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| **LLM Judge**         | GPT-5.2 (model family: `gpt-5.2-2025-12-11`) for relevance judgments      |
| **Composite scoring** | Position-based signals + LLM relevance judgments combined into v4.0 score |
| **Orchestration**     | Triggers external Airflow DAG for heavy computation                       |
| **Schedule**          | Composite Refresh: daily 13:00 UTC; Eval: 00:00, 11:00, 12:00 UTC         |

## Active Users

| User                          | Type            | Pipeline                             | Schedule        |
| ----------------------------- | --------------- | ------------------------------------ | --------------- |
| relevance-cloud-runner SA     | Service account | Composite Score Refresh + Evaluation | Daily automated |
| volv-grebennikov-scheduler SA | Service account | Evaluation Pipeline (backup)         | Daily automated |

## Key Components

| Component                     | Digest     | Purpose                                   |
| ----------------------------- | ---------- | ----------------------------------------- |
| `[Official] Create query set` | `3e08cc45` | Sample and format evaluation queries      |
| `[Official] Create scrape`    | `c271576a` | Capture live search results               |
| `CompositeScores`             | `4c2a50b7` | Compute composite v4.0 scores             |
| `Run bigquery sql`            | `450d5bdb` | Load relevance judgments + search results |

## Key Links

- Composite Score V4.0 Refresh: [019d4e47bee092307858](https://oasis.shopify.io/runs/019d4e47bee092307858)
- Evaluation Pipeline: [019d4e111c41bd934c92](https://oasis.shopify.io/runs/019d4e111c41bd934c92)
- Source: `Shopify/discovery`
