---
name: tangle-help
description: Answer Tangle product, docs, and how-to questions from a local RAG over the TangleML documentation. Use for conceptual / "what is" / "how do I" lookups, not live run or execution data.
allowed-tools: [Bash, Read]
---

# Tangle Help

A self-contained CLI RAG over the TangleML docs lives under
[`tangle-rag-bundle/`](tangle-rag-bundle/). Use it to answer documentation,
concept, and how-to questions about Tangle. For live run/execution data use the
`tangle_*` API tools instead — this skill only knows the docs.

[`tangle-rag-bundle/README.md`](tangle-rag-bundle/README.md) is the source of
truth for full details; the essentials are below.

## When to use

- "What is Tangle?", "How do I get started?", "How do I configure X?" — anything
  answerable from the TangleML documentation.
- Not for: a specific run's status, logs, artifacts, or metrics. Those stay on
  the read-only `tangle_*` API tools.

## Setup (once)

A prebuilt local Qdrant index ships under
`tangle-rag-bundle/rag_data/qdrant/`, so `ask` works offline — you normally do
**not** need to run `index`. Install the package once:

```bash
cd skills/tangle-help/tangle-rag-bundle
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

Rebuild the index only if the shipped one is missing or stale (clones
`TangleML/website` and indexes its `docs/`):

```bash
tangle-rag index
```

## Ask

Primary path — the `uv run --system-certs` wrapper (no manual venv needed):

```bash
cd skills/tangle-help/tangle-rag-bundle
scripts/tangle-ask "What is Tangle?"
```

Module fallback (inside the installed venv):

```bash
python -m tangle_rag ask "How do I get started with Tangle?"
```

Default mode returns extractive doc excerpts with source citations. Options:

- `--limit N` — number of retrieved chunks (default 5).
- `--llm openai` — synthesized answer with citations; requires `OPENAI_API_KEY`.

## Server (optional)

For repeated queries, run the tiny HTTP server and query it over HTTP:

```bash
cd skills/tangle-help/tangle-rag-bundle
python scripts/tangle_rag_server.py
# then: GET http://localhost:8101/ask?q=your+question
```
