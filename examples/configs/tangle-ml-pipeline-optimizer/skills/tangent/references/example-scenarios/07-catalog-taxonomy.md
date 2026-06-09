# Catalog Taxonomy

## What It Does

Trains and evaluates LLM/VLM models for two Shopify catalog classification tasks: (1) product category prediction and (2) variant attribute extraction (e.g., size, color, material from product listings). Both use the Unified Distillation SFT framework.

## What It Optimizes

- **Category**: Classification accuracy across Shopify's product taxonomy hierarchy
- **Variant Attribute**: Extraction accuracy for structured product attributes

## Pipeline Flow

Both pipelines share identical structure:
```
Materialize Taxonomy Config -> Preprocess Training Data -> SFT Train -> Prepare Model Dir -> Upload to GCS
Materialize Training Config ---^                               ^                  |
Download Model (HuggingFace) ---------------------------------+                  +-> Taxonomy Evaluation
```

1. **Config materialization**: YAML config strings written to files for the training and taxonomy configuration
2. **Data preprocessing**: HuggingFace dataset converted to TRL chat format (messages + images columns)
3. **Model download**: Base model fetched from HuggingFace
4. **SFT training**: Fine-tuning with TRL trainers using Accelerate FSDP2
5. **Model assembly**: Trained weights + taxonomy config + data bundled into model directory
6. **Upload + Eval**: Uploaded to GCS, evaluated via Taxonomy Evaluation subgraph

## ML Techniques

| Aspect | Details |
|--------|---------|
| **Framework** | Unified Distillation (same as UPI reranker, search relevance) |
| **Training** | SFT with TRL trainers, FSDP2 distributed |
| **Hardware** | 4x NVIDIA H100 GPUs (Nebius cluster), 120 CPU, 900Gi memory |
| **Model input** | Multi-modal: product text + product images (VLM) |
| **Data format** | TRL chat format with messages + images columns |
| **Experiment tracking** | Comet ML (`taxonomy-category`, `taxonomy-variant-attribute`) |

## Active Users

| User | Pipelines | Activity |
|------|-----------|----------|
| xinjing.wang | Category Train+Eval, Variant Attribute Train+Eval | 5+ runs/day, both in parallel |

## Key Links

- Category Train+Eval: [019d506d696cec2d5c89](https://oasis.shopify.io/runs/019d506d696cec2d5c89)
- Variant Attribute Train+Eval: [019d502b3e31d19c2ff5](https://oasis.shopify.io/runs/019d502b3e31d19c2ff5)
- Source: `world/areas/ml/foundation-models/unified-distillation`

## Key Observations

- **Shared infrastructure**: Uses the exact same Unified Distillation pipeline as UPI reranker -- `Unified Distillation: Train` component (`8a0773d5`)
- **Simultaneous submission**: Both Category and Variant Attribute pipelines submitted within minutes of each other
- **H100 vs H200**: Taxonomy uses H100 (Nebius) while UPI reranker uses H200 -- likely due to smaller model size
