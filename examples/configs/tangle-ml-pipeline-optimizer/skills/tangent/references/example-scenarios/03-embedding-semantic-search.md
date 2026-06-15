# Embedding & Semantic Search

## What It Does

Trains and evaluates search embedding models for semantic product retrieval across Shopify storefronts. Two workstreams: (1) inner loop model evaluation cycling through embed-index-retrieve-evaluate for a **Unified HSTU co-trained model**, and (2) hard negative mining using a **GTE multilingual fine-tuned model** to generate challenging training examples for contrastive learning.

## What It Optimizes

- **Primary**: Retrieval recall@K (how often the correct product appears in top-K results, K=100-300)
- **Supporting**: Embedding quality metrics, hard negative difficulty distribution
- **Serving**: Latency and throughput of embedding inference in production

## Pipeline Flow

### Embedding Inner Loop Evaluation (Nebius)

Evaluates a **Unified HSTU (Hierarchical Sequential Transduction Unit) co-trained** embedding model for recommendation use cases. The query entity is `user` (behavioral/sequential model using `hstu_features`, not text-based), and the document entity is `product` (text-based, formatted as markdown product documents with prompt prefix `search_document: `).

```
Config Manager -> Export table to parquet -> Generate query embeddings (Nebius, 8xH200)
                                                      |
Config Manager -> Generate product documents (BQ) -> Generate document embeddings (Nebius, 8xH200)
                                                      |
                                               Train index (Flat, L2)
                                                      |
                                               Build index (1 shard)
                                                      |
                          Generate query embeddings -> Query index (top-k=100, 100 query shards)
                                                      |
                                               Merge topk (final top-k=300)
```

- **Model**: `Shopify/unified-hstu-cotrain` (model type: `UnifiedModel`, use case: `hstu_v8`)
- **Embedding dim**: 768
- **Inference**: Nebius 8xH200 GPUs, bfloat16 precision, SDPA attention
- **Document generation**: Markdown-formatted product documents from BigQuery, grain=product_id, representative selection by `max_popularity`
- **Index**: Flat index, L2 metric, 1 shard (small-scale eval), 1M max training samples
- **Metric version**: `recommendation` (drives which query/corpus/judgment tables are loaded)

### Hard Negative Mining - Query Embeddings

Mines hard negative examples by finding products that are similar in embedding space but are NOT the correct match. Uses a production-scale compressed FAISS index.

```
[INPUT: product embeddings] -> Export embeddings to GCS -> Train index (IVF8192,PQ192)
                                                                  |
                                                           Build index (200 shards)
                                                                  |
[INPUT: query set] -> Export to parquet -> Generate query embeddings (Nebius)
                                                                  |
                                           Build index + Query embeddings -> Query index (top-k=300, 6 query tasks)
                                                                  |
                                                           Merge topk (final top-k=1000)
                                                                  |
                              [INPUT: query positive table] -> Compute positive thresholds
                                                                  |
                                                           Filter search results
```

- **Model**: `Shopify/upe-gte-multilingual-search-finetune` (UPE = Unified Product Embedding, based on GTE multilingual)
- **Embedding dim**: 768
- **Index type**: **IVF8192,PQ192** (Inverted File with 8192 centroids + Product Quantization to 192 bytes) -- highly compressed for scale
- **Index metric**: INNER_PRODUCT (cosine similarity)
- **Scale**: 200 index shards, 200 parallelism, search_nprobe=512
- **Filtering**: Exclude self-matches, similarity lower threshold=0.3, rank lower threshold=650, max 100 results per query. Selects products ranked 1-650 that are above 0.3 similarity but below the positive threshold.
- **Data sources**: `upi_index_source_2026_03_28_snapshot_shop_eligible_products_embeddings` (product embeddings), `upe_training_queryset` (queries), `query_positives` (positive pairs)

**Variant**: "latest - shop" indicates shop-specific embedding models (Shop App search vs Storefront search).

## ML Techniques

| Aspect                      | Details                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Inner Loop Model**        | Unified HSTU co-trained model (`hstu_v8`) -- behavioral/sequential, not text-only                         |
| **Hard Neg Model**          | UPE GTE multilingual fine-tuned (`upe-gte-multilingual-search-finetune`)                                  |
| **Training method**         | Contrastive learning with ANN-mined hard negatives                                                        |
| **Hard negative strategy**  | IVF8192+PQ192 index at 200 shards; filter by similarity range [0.3, positive_threshold] and rank [1, 650] |
| **Query representation**    | HSTU: behavioral features (`hstu_features`); UPE: text with `search_query: ` prefix                       |
| **Document representation** | Markdown product docs with `search_document: ` prefix, 768-dim embeddings                                 |
| **Infrastructure**          | Nebius cluster with NVIDIA H200 GPUs, bfloat16                                                            |
| **Index types**             | Flat/L2 (inner loop eval), IVF8192+PQ192/IP (hard neg mining at scale)                                    |

## Key Components

| Component                             | Digest                                         | Purpose                                          |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `Config Manager`                      | `a859c220`                                     | Pipeline configuration                           |
| `Export table to parquet`             | `097fb3ea`                                     | BQ → GCS parquet export                          |
| `Generate product documents`          | `53befaa1`                                     | BQ product data → markdown documents             |
| `Generate embeddings (Nebius Native)` | `c51ae0ac` (inner loop), `49f9b720` (hard neg) | Model inference on Nebius H200                   |
| `Train Index`                         | `0bed381d` (inner loop), `5e56a112` (hard neg) | FAISS index training                             |
| `Build Index`                         | `a5001fd8` (inner loop), `ef0a2c89` (hard neg) | FAISS index building                             |
| `Query Index`                         | `bd36872e` (inner loop), `c5001948` (hard neg) | FAISS ANN search                                 |
| `Merge topk results`                  | `e0b5c203` (inner loop), `e25a1db2` (hard neg) | Merge sharded results                            |
| `Compute positive thresholds`         | `471ec104`                                     | Derive similarity thresholds from positive pairs |
| `Filter search results`               | `ffcf236b`                                     | Select hard negatives by similarity/rank range   |

## Active Users

| User                 | Focus                                        | Activity                           |
| -------------------- | -------------------------------------------- | ---------------------------------- |
| yang.liu             | Embedding model development, inner loop eval | 30+ runs/week, primary model owner |
| sourav.bhattacharjee | Hard negative mining, inner loop eval        | 15+ runs/week, data pipeline focus |
| shuying.sun          | Inner loop eval (final candidate runs)       | Periodic validation runs           |

## Key Links

- Embedding Inner Loop (yang.liu): [019d5059142737a708e0](https://oasis.shopify.io/runs/019d5059142737a708e0)
- Embedding Inner Loop (sourav): [019d4977e6ff4bbb4783](https://oasis.shopify.io/runs/019d4977e6ff4bbb4783)
- Hard Negative Mining: [019d4fad6e7fcc197eaf](https://oasis.shopify.io/runs/019d4fad6e7fcc197eaf)
- Source: `areas/ml/foundation-models/discovery-embeddings/src/tangle/components`
- [View all embedding runs in Tangle UI](https://oasis.shopify.io/?filter=%7B%22pipeline_name%22%3A+%22embedding%22%2C+%22created_after%22%3A+%222026-01-01T00%3A00%3A00Z%22%2C+%22created_before%22%3A+%222026-04-03T00%3A00%3A00Z%22%7D)

## Key Observations

- **Highest iteration velocity** of any Tangle pipeline family -- the "inner loop" label is accurate
- **Nebius-exclusive**: Only pipeline area that runs entirely on Nebius cluster, not GKE
- **Two distinct models**: HSTU co-trained (behavioral, recommendation) vs UPE GTE (text, search) serve different retrieval use cases
- **Production-scale mining**: Hard negative pipeline uses IVF8192+PQ192 at 200 shards -- this is production-grade FAISS infrastructure
- **"final" suffix** on runs indicates production candidate models vs experimental iterations
- **Multi-person concurrent work**: Three engineers running overlapping experiments simultaneously
- **Hard negatives feed training**: Sourav's hard negative mining output directly feeds yang.liu's training loop
