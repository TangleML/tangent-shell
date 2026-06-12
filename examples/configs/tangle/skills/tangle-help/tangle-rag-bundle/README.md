# Tangle RAG CLI

A small command-line RAG app over the TangleML documentation. It is not a service: each command runs, does its work, exits, and releases memory.

## Stack

- Python CLI (`argparse`)
- Embedded/local Qdrant via `QdrantClient(path="rag_data/qdrant")` — no Qdrant server required
- Local embeddings via `fastembed` (`BAAI/bge-small-en-v1.5` by default); vector size is inferred from the embedding model
- Optional OpenAI generation for synthesized answers; default mode is extractive excerpts with citations

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

## Build the index once

This clones `https://github.com/TangleML/website` and indexes its `docs/` directory:

```bash
tangle-rag index
```

Equivalent Python module form:

```bash
python3 -m tangle_rag index
```

Useful options:

```bash
tangle-rag index \
  --repo-dir .cache/tangle-website \
  --qdrant-path rag_data/qdrant \
  --collection tangle_docs
```

If you already have Markdown docs locally:

```bash
tangle-rag index --docs-dir /path/to/website/docs
```

## Ask questions

Default answer mode returns retrieved documentation excerpts and source citations:

```bash
tangle-rag ask "What is Tangle?"
```

For generated answers with citations, set `OPENAI_API_KEY` and use:

```bash
tangle-rag ask "How do I get started with Tangle?" --llm openai
```

## Data locations

- Cloned docs: `.cache/tangle-website/docs`
- Local Qdrant index: `rag_data/qdrant`

Both are local files/directories. No Qdrant server or long-running process is started.
