# Search Relevance SFT

## What It Does

Trains search relevance judge models via supervised fine-tuning with knowledge distillation (KD). The model learns to predict relevance on a 0-3 scale by distilling from a teacher model's probability distribution. Active development on scaling from single-node to multi-node distributed training to handle the **32B model** variant.

## What It Optimizes

- **Primary**: Relevance judgment accuracy (0-3 scale alignment with ground truth via `gtx_fte_alignment` evaluator)
- **Training efficiency**: Multi-node FSDP2 training throughput and stability
- **Knowledge transfer**: KL divergence fidelity between student and teacher probability distributions

## Pipeline Flow

```
Download Model (Qwen3-VL-4B or 32B) ---------\
Download Train Dataset (relevance-judge-trl) ---\
Materialize SFT Training Config -----------------+-> SFT Train -> Upload Model to HF
                                                 |
Download Eval Dataset (relevance-judge-gtx) -----+-> Evaluation (Generic Eval with gtx_fte_alignment)
Materialize Inference Config --------------------/
Materialize Evaluation Config ------------------/
```

**Total**: 9 tasks, 4 unique component types.

## ML Techniques

| Aspect             | Production (daria.sorokina)                                                                  | Multinode Test (shane.moran)                                                     |
| ------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Base model**     | **Qwen3-VL-4B-Instruct**                                                                     | **Qwen3-VL-32B-Instruct**                                                        |
| **KD Loss**        | **KLDivergenceLossPlugin** (alpha=0.05, temperature=1.0, targets: [0,1,2,3])                 | Same                                                                             |
| **Teacher signal** | Probability distribution over 4 relevance classes via `probs` key                            | Same                                                                             |
| **Optimizer**      | AdamW (beta1=0.9, beta2=0.95, eps=1e-7), LR=2e-5, cosine schedule, warmup_ratio=0.2          | Same                                                                             |
| **Batch size**     | per_device=2, grad_accum=2                                                                   | per_device=1                                                                     |
| **Training**       | 1 epoch, 24 processes (3 nodes x 8 GPUs)                                                     | max_steps=15 (smoke test), 16 processes (2 nodes x 8 GPUs)                       |
| **FSDP**           | `MULTI_GPU`                                                                                  | `FSDP` v2 with auto-wrap TRANSFORMER_BASED_WRAP, CPU offload, sharded state dict |
| **Parallelism**    | Not specified                                                                                | dp_shard=8, dp_replicate=2, tp=1, cp=1                                           |
| **Vision**         | Freeze `model.visual`, unfreeze only `model.visual.merger`                                   | Same                                                                             |
| **Attention**      | flash_attention_2, bf16                                                                      | Same                                                                             |
| **Eval**           | 1000 samples, `gtx_fte_alignment`                                                            | 50 samples (smoke test)                                                          |
| **Inference**      | vLLM, tensor_parallel=4, max_model_len=32768, constrained JSON (relevance 0-3 + explanation) | Same                                                                             |
| **Upload**         | `relevance-judge-sft-kd`                                                                     | `relevance-judge-sft-kd-multinode-dev`                                           |

**Training data**: `Shopify/relevance-judge-trl-v3.1` (HF)
**Eval data**: `Shopify/relevance-judge-gtx-v3.1-dev` (HF)
**Tracking**: Comet ML (workspace: `model-distillation`, project: `relevance-judge`)

## Key Components

| Component                                  | Digest                                    | Purpose                                  |
| ------------------------------------------ | ----------------------------------------- | ---------------------------------------- |
| `Unified Distillation: Train`              | `8a0773d5`                                | SFT with KL divergence KD loss via TRL   |
| `Unified Distillation: Download HF`        | `a4f578c8`                                | Download model/dataset from HuggingFace  |
| `Unified Distillation: Upload HF`          | `d3f6c1b6`                                | Push trained model to HuggingFace        |
| `Unified Distillation: Materialize Config` | `f43555f6`                                | Materialize YAML config strings to files |
| `Generic Eval`                             | `1f1f8648` (prod), `aec40689` (multinode) | Evaluate via gtx_fte_alignment           |

## Active Users

| User           | Focus                                     | Activity                                  |
| -------------- | ----------------------------------------- | ----------------------------------------- |
| daria.sorokina | 4B model training and recipe iteration    | 15+ runs across Mar 30 - Apr 2            |
| shane.moran    | 32B multi-node FSDP2 distributed training | 15+ runs Mar 31 - Apr 1 (rapid debugging) |

## Key Links

- Search Relevance SFT KD (4B): [019d5061e8ba152140ea](https://oasis.shopify.io/runs/019d5061e8ba152140ea)
- SFT KD Multinode Test (32B): [019d49e9c1bdc4ffa56e](https://oasis.shopify.io/runs/019d49e9c1bdc4ffa56e)
- Source: `areas/ml/foundation-models/unified-distillation/tangle/pipelines/search_relevance`
- [View all search runs](https://oasis.shopify.io/?filter=%7B%22pipeline_name%22%3A+%22search%22%2C+%22created_after%22%3A+%222026-01-01T00%3A00%3A00Z%22%2C+%22created_before%22%3A+%222026-04-03T00%3A00%3A00Z%22%7D)

## Key Observations

- **Two model sizes**: 4B (production) and 32B (experimental multinode) -- significant scale difference
- **KL Divergence KD**: Teacher provides full probability distribution over [0,1,2,3] relevance classes, not just hard labels -- alpha=0.05 blends KD loss with standard cross-entropy
- **Vision-Language judge**: Model processes both product images and text, using Qwen3-VL architecture with frozen visual encoder (only merger unfrozen)
- **Constrained decoding**: Inference uses JSON schema to force structured output (integer relevance + explanation)
- **Two-person team split**: Daria owns the model/recipe, Shane owns the distributed infrastructure
- **Multinode debugging**: Shane's many rapid runs (max_steps=15) suggest active troubleshooting of FSDP2 configuration for the 32B model
- **Shared Unified Distillation framework**: Same `8a0773d5` Train component used by UPI reranker and catalog taxonomy
