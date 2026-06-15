# AI Search Judges

## What It Does

Evaluates AI-powered search quality using LLM judges. Three pipeline types: (1) nightly automated quality monitoring of AI search, (2) nightly grounding evaluation (factual accuracy), and (3) GEPA-based prompt optimization for multi-criteria help search judges.

## What It Optimizes

- **Nightly Judge**: Per-criterion average scores on production AI search conversations
- **Grounding Judge**: Factual accuracy of AI-generated search answers
- **GEPA**: Judge prompt quality across 5 criteria: safety, language, response, grounding, goal_fulfillment

## Pipeline Flow

### Nightly Judge (ai_search / ai_search_grounding)

```
Extract Evaluable Objects (sample production conversations) -> Nightly Batch Score (flywheel judge) -> Summarize Scores (per-criterion averages)
```

Runs daily ~12:00-12:30 UTC as a parallel pair (ai_search + ai_search_grounding). Uses flywheel judge ID `c3e3c858-aa8f-40e1-a2f6-ba3497fbaffe`.

### GEPA Per-Criteria: Help Search Judge (5 criteria)

```
Flywheel Resolve Conversations (ground truth from BQ)
  |
  +-> Generate Config (safety) -------> Optimize (safety) ------+
  +-> Generate Config (language) -----> Optimize (language) ----+
  +-> Generate Config (response) -----> Optimize (response) ----+-> Consolidate Results -> Persist GEPA Scores (BQ)
  +-> Generate Config (grounding) ----> Optimize (grounding) ---+
  +-> Generate Config (goal_fulfillment) -> Optimize (goal_fulfillment) -+
```

GEPA (Generalized Evaluation via Prompt Alignment) / Playbook Builder: automated prompt optimization for LLM judges. Each of the 5 criteria is optimized **independently in parallel** via the Flywheel Optimize component, then consolidated.

## ML Techniques

| Aspect            | Details                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **Nightly Judge** | LLM-as-judge scoring on production traffic samples                                        |
| **GEPA**          | Automated prompt engineering -- optimizes judge prompts to align with ground truth labels |
| **5 Criteria**    | safety, language, response, grounding, goal_fulfillment                                   |
| **Judge model**   | Deployed flywheel judge (same judge ID shared with GraphQL gist)                          |
| **Data source**   | Production evaluable objects (conversations) extracted from BQ                            |
| **Output**        | Per-criterion scores to BQ, aggregated summaries to GCS                                   |

## Active Users

| User              | Pipeline                                        | Activity                       |
| ----------------- | ----------------------------------------------- | ------------------------------ |
| sidekick-run SA   | Nightly Judge (ai_search + ai_search_grounding) | Daily automated                |
| precious.kolawole | GEPA Help Search Judge                          | 10+ runs across Mar 30 - Apr 1 |

## Key Links

- Nightly Judge ai_search: [019d4e2c0b06c6132875](https://oasis.shopify.io/runs/019d4e2c0b06c6132875)
- GEPA Help Search Judge: [019d4a47d814a6b869b7](https://oasis.shopify.io/runs/019d4a47d814a6b869b7)

## Key Observations

- **GEPA is automated prompt engineering**: Not model training -- it's optimizing the judge prompts themselves
- **5 parallel optimization tracks**: Each criterion independently optimized, then consolidated
- **Shared judge**: Same flywheel judge used by Nightly Judge and GraphQL Gist evaluation
- **Sidekick team owned**: All pipelines serve the Sidekick AI assistant platform
