# Product Recommendations

## What It Does

Evaluates Shopify's product similarity API by querying recommendations for a sample of products and measuring quality via category matching and LLM-based duplicate detection.

## What It Optimizes

- **Primary**: Category Match Rate@K (percentage of recommendations sharing the anchor product's category)
- **Quality**: Duplicate Rate@K (percentage of near-duplicate recommendations, detected by LLM judge)
- **API health**: Overview stats (total anchors, returned results, response rates)

## Pipeline Flow

```
Build SQL Context -> Load Product Sample -> Call Catalog API (per product)
                                                  |
                                                  +-> Category Match (via BQ) ---------> Combine All Metrics -> Write to BQ
                                                  +-> API Overview Stats ----------------^
                                                  +-> Duplicate Evaluation (subgraph) ---^
                                                       |-> Inject Anchor
                                                       |-> Run Precision Judge (LLM)
                                                       |-> Compute Duplicate Rate@K
```

1. **Product sampling**: SQL-based product selection from unified sample
2. **API calls**: Catalog similarity API called per anchor product
3. **Three parallel evaluation branches**:
   - Category Match: BQ-based category comparison at K
   - API Overview: Response rate and result count stats
   - Duplicate Detection: LLM Precision Judge labels product pairs, computes Duplicate Rate@K
4. **Metrics aggregation**: All metrics combined into single row and appended to BQ

## ML Techniques

| Aspect              | Details                                                     |
| ------------------- | ----------------------------------------------------------- |
| **Evaluation type** | API quality monitoring (no model training)                  |
| **LLM Judge**       | Precision Judge for duplicate pair detection                |
| **Metrics**         | Category Match Rate@K, Duplicate Rate@K, API overview stats |
| **Output**          | BigQuery metrics table (append-only)                        |

## Active Users

| User             | Focus                                             | Activity         |
| ---------------- | ------------------------------------------------- | ---------------- |
| mariya.mansurova | Similar product recommendation quality evaluation | 8+ runs on Apr 2 |

## Key Links

- Similar Products Evals v0: [019d4fd934b26e0aa293](https://oasis.shopify.io/runs/019d4fd934b26e0aa293)

## Key Observations

- **v0 designation**: Early-stage evaluation pipeline, still iterating on metrics definition
- **Eval-only pipeline**: No model training -- purely API quality monitoring
- **LLM judge for duplicates**: Uses LLM to determine if recommended products are near-duplicates of each other
