from __future__ import annotations

import argparse
from pathlib import Path

from .rag import (
    DEFAULT_COLLECTION,
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_QDRANT_PATH,
    DEFAULT_REPO_DIR,
    answer_question,
    fetch_docs,
    index_docs,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tangle-rag",
        description="CLI RAG over TangleML Markdown docs using embedded/local Qdrant.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch = subparsers.add_parser("fetch-docs", help="Clone/update TangleML website and use its docs directory")
    fetch.add_argument("--repo-dir", type=Path, default=DEFAULT_REPO_DIR)
    fetch.add_argument("--force", action="store_true", help="Delete and re-clone the repo directory")

    index = subparsers.add_parser("index", help="Build the local Qdrant index from Markdown docs")
    index.add_argument("--repo-dir", type=Path, default=DEFAULT_REPO_DIR, help="Repo directory to clone/update if --docs-dir is omitted")
    index.add_argument("--docs-dir", type=Path, default=None, help="Existing Tangle docs directory; skips clone/pull")
    index.add_argument("--qdrant-path", type=Path, default=DEFAULT_QDRANT_PATH, help="Local embedded Qdrant storage path")
    index.add_argument("--collection", default=DEFAULT_COLLECTION)
    index.add_argument("--embedding-model", default=DEFAULT_EMBEDDING_MODEL)
    index.add_argument("--vector-size", type=int, default=None, help="Optional safety check; inferred from the embedding model by default")
    index.add_argument("--chunk-chars", type=int, default=1600)
    index.add_argument("--chunk-overlap", type=int, default=200)
    index.add_argument("--batch-size", type=int, default=64)
    index.add_argument("--force-fetch", action="store_true", help="Re-clone TangleML website before indexing")

    ask = subparsers.add_parser("ask", help="Answer a Tangle question from the local Qdrant index")
    ask.add_argument("question", nargs="+", help="Question to answer")
    ask.add_argument("--qdrant-path", type=Path, default=DEFAULT_QDRANT_PATH)
    ask.add_argument("--collection", default=DEFAULT_COLLECTION)
    ask.add_argument("--embedding-model", default=DEFAULT_EMBEDDING_MODEL)
    ask.add_argument("--limit", type=int, default=5, help="Number of retrieved chunks")
    ask.add_argument("--llm", choices=["extractive", "openai"], default="extractive", help="Use extractive excerpts or OpenAI generation")
    ask.add_argument("--openai-model", default="gpt-4o-mini")

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "fetch-docs":
        docs_dir = fetch_docs(repo_dir=args.repo_dir, force=args.force)
        print(f"Docs ready: {docs_dir}")
        return

    if args.command == "index":
        docs_dir = args.docs_dir or fetch_docs(repo_dir=args.repo_dir, force=args.force_fetch)
        count = index_docs(
            docs_dir=docs_dir,
            qdrant_path=args.qdrant_path,
            collection=args.collection,
            embedding_model=args.embedding_model,
            vector_size=args.vector_size,
            chunk_chars=args.chunk_chars,
            chunk_overlap=args.chunk_overlap,
            batch_size=args.batch_size,
        )
        print(f"Indexed {count} chunks from {docs_dir} into {args.qdrant_path} collection '{args.collection}'.")
        return

    if args.command == "ask":
        question = " ".join(args.question)
        print(
            answer_question(
                question=question,
                qdrant_path=args.qdrant_path,
                collection=args.collection,
                embedding_model=args.embedding_model,
                limit=args.limit,
                llm=args.llm,
                openai_model=args.openai_model,
            )
        )
        return


if __name__ == "__main__":
    main()
