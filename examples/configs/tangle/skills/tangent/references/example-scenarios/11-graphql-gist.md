# GraphQL Gist

## What It Does

Trains a model for GraphQL code generation (gist-style short code snippets) using a novel **gist token distillation** technique -- learning compressed token embeddings that replace a full system prompt with K learned tokens, dramatically reducing inference cost while preserving quality.

## What It Optimizes

- **Primary**: GraphQL code generation quality (ACE evaluation scores + GraphQL judge scores)
- **Efficiency**: Prompt compression ratio (K gist tokens vs full system prompt)
- **Serving**: CentML-deployed model with automated evaluation loop

## Pipeline Flow

```
Download Gist Dataset -> Preprocess (tokenize with gist tokens, filter by seq length) -> Gist Distillation Training -> Upload Model to HF
Download SFT Model for Gist ---^                                                                                          |
Generate Run Paths (timestamped GCS paths) --+                                                                            v
                                             |                                                                    Deploy to CentML
                                             |                                                                        |
                                             +---> Run ACE Evaluation -> Prepare Judge Test Set -> Run GraphQL Judges -> Summarize Scores
                                                                                                                             |
                                                                                                               Consolidate Evaluation Summary
                                                                                                                             |
                                                                                                               Delete CentML Deployment
```

1. **Dataset download**: Training data from HuggingFace
2. **Preprocessing**: Tokenize with gist tokens, filter by sequence length
3. **Gist distillation**: Freeze SFT model, learn K compressed token embeddings that reproduce full system prompt logits
4. **Model upload**: Push trained model to HuggingFace as PR
5. **Deploy**: Deploy to CentML for evaluation
6. **ACE evaluation**: End-to-end conversation evaluation
7. **Judge scoring**: GraphQL-specific judge evaluates per-criterion quality
8. **Cleanup**: Delete CentML deployment

## ML Techniques

| Aspect | Details |
|--------|---------|
| **Technique** | Gist token distillation (prompt compression via learned embeddings) |
| **Teacher** | Pre-cached teacher logits from full system prompt |
| **Student** | Same model architecture with K gist tokens replacing system prompt |
| **Loss** | KL divergence between gist-prompted logits and full-prompt logits |
| **Evaluation** | ACE (end-to-end conversation quality) + GraphQL judge (per-criterion) |
| **Judge ID** | `c3e3c858-aa8f-40e1-a2f6-ba3497fbaffe` |
| **Deployment** | CentML (temporary, deleted after eval) |
| **Variants tested** | "Simple", "Sequential Preprocess" pipeline architectures |

## Key Links

- GraphQL Gist Training: [019d50730cd796aed7ec](https://oasis.shopify.io/runs/019d50730cd796aed7ec)
- GraphQL SFT Eval: [019d5013dc9cb760a2a9](https://oasis.shopify.io/runs/019d5013dc9cb760a2a9)
- Source: `Shopify/sidekick`

## Key Observations

- **Novel technique**: Gist token distillation is a cutting-edge prompt compression method -- not standard fine-tuning
- **Full lifecycle in one pipeline**: Train -> deploy -> evaluate -> cleanup all automated
- **Non-search ML use case**: One of the few Tangle pipelines outside search/ranking -- serves the Sidekick AI assistant
