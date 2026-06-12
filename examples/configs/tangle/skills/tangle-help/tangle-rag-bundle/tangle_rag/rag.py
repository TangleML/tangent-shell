from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Sequence

REPO_URL = "https://github.com/TangleML/website.git"
DEFAULT_REPO_DIR = Path(".cache/tangle-website")
DEFAULT_QDRANT_PATH = Path("rag_data/qdrant")
DEFAULT_COLLECTION = "tangle_docs"
DEFAULT_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
DEFAULT_VECTOR_SIZE = 384


@dataclass(frozen=True)
class Chunk:
    id: str
    text: str
    source: str
    heading: str
    chunk_index: int


def fetch_docs(repo_dir: Path = DEFAULT_REPO_DIR, force: bool = False) -> Path:
    """Clone the TangleML website repository and return its docs directory."""
    repo_dir = Path(repo_dir)
    if force and repo_dir.exists():
        shutil.rmtree(repo_dir)

    if not repo_dir.exists():
        repo_dir.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", REPO_URL, str(repo_dir)],
            check=True,
        )
    elif (repo_dir / ".git").exists():
        subprocess.run(["git", "-C", str(repo_dir), "pull", "--ff-only"], check=True)
    else:
        raise ValueError(f"{repo_dir} exists but is not a git repository")

    docs_dir = repo_dir / "docs"
    if not docs_dir.exists():
        raise FileNotFoundError(f"Expected docs directory at {docs_dir}")
    return docs_dir


def iter_markdown_files(docs_dir: Path) -> Iterator[Path]:
    for path in sorted(Path(docs_dir).rglob("*.md")):
        if path.is_file():
            yield path
    for path in sorted(Path(docs_dir).rglob("*.mdx")):
        if path.is_file():
            yield path


def _strip_front_matter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4 :].lstrip()
    return text


def _heading_for(text: str) -> str:
    for line in text.splitlines():
        match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if match:
            return match.group(2).strip()
    return ""


def _split_by_headings(text: str) -> list[str]:
    sections: list[list[str]] = []
    current: list[str] = []
    for line in text.splitlines():
        if re.match(r"^#{1,3}\s+", line) and current:
            sections.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        sections.append(current)
    return ["\n".join(s).strip() for s in sections if "\n".join(s).strip()]


def _window_text(text: str, max_chars: int, overlap: int) -> Iterator[str]:
    text = text.strip()
    if len(text) <= max_chars:
        yield text
        return

    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            split_at = max(text.rfind("\n\n", start, end), text.rfind(". ", start, end))
            if split_at > start + max_chars // 2:
                end = split_at + 1
        chunk = text[start:end].strip()
        if chunk:
            yield chunk
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)


def build_chunks(docs_dir: Path, max_chars: int = 1600, overlap: int = 200) -> list[Chunk]:
    docs_dir = Path(docs_dir)
    chunks: list[Chunk] = []
    for md_path in iter_markdown_files(docs_dir):
        rel_source = md_path.relative_to(docs_dir).as_posix()
        text = _strip_front_matter(md_path.read_text(encoding="utf-8", errors="ignore"))
        chunk_index = 0
        for section in _split_by_headings(text):
            heading = _heading_for(section)
            for piece in _window_text(section, max_chars=max_chars, overlap=overlap):
                stable_id = str(uuid.UUID(hashlib.sha256(f"{rel_source}:{chunk_index}:{piece}".encode()).hexdigest()[:32]))
                chunks.append(
                    Chunk(
                        id=stable_id,
                        text=piece,
                        source=rel_source,
                        heading=heading,
                        chunk_index=chunk_index,
                    )
                )
                chunk_index += 1
    return chunks


def _embedder(model_name: str):
    from fastembed import TextEmbedding

    return TextEmbedding(model_name=model_name)


def embed_texts(texts: Sequence[str], model_name: str) -> list[list[float]]:
    model = _embedder(model_name)
    return [vector.tolist() for vector in model.embed(list(texts))]


def batched(items: Sequence[Chunk], batch_size: int) -> Iterator[Sequence[Chunk]]:
    for i in range(0, len(items), batch_size):
        yield items[i : i + batch_size]


def index_docs(
    docs_dir: Path,
    qdrant_path: Path = DEFAULT_QDRANT_PATH,
    collection: str = DEFAULT_COLLECTION,
    embedding_model: str = DEFAULT_EMBEDDING_MODEL,
    vector_size: int | None = None,
    chunk_chars: int = 1600,
    chunk_overlap: int = 200,
    batch_size: int = 64,
) -> int:
    chunks = build_chunks(docs_dir, max_chars=chunk_chars, overlap=chunk_overlap)
    if not chunks:
        raise ValueError(f"No Markdown chunks found in {docs_dir}")

    qdrant_path = Path(qdrant_path)
    qdrant_path.mkdir(parents=True, exist_ok=True)
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, PointStruct, VectorParams

    def make_points(batch: Sequence[Chunk], vectors: Sequence[Sequence[float]]) -> list[PointStruct]:
        return [
            PointStruct(
                id=chunk.id,
                vector=vector,
                payload={
                    "text": chunk.text,
                    "source": chunk.source,
                    "heading": chunk.heading,
                    "chunk_index": chunk.chunk_index,
                    "embedding_model": embedding_model,
                },
            )
            for chunk, vector in zip(batch, vectors)
        ]

    chunk_batches = batched(chunks, batch_size)
    first_batch = next(chunk_batches)
    first_vectors = embed_texts([chunk.text for chunk in first_batch], embedding_model)
    inferred_vector_size = len(first_vectors[0])
    if vector_size is not None and vector_size != inferred_vector_size:
        raise ValueError(
            f"--vector-size {vector_size} does not match embedding model '{embedding_model}' "
            f"output size {inferred_vector_size}"
        )

    client = QdrantClient(path=str(qdrant_path))
    try:
        client.recreate_collection(
            collection_name=collection,
            vectors_config=VectorParams(size=inferred_vector_size, distance=Distance.COSINE),
        )
        client.upsert(collection_name=collection, points=make_points(first_batch, first_vectors))

        for batch in chunk_batches:
            vectors = embed_texts([chunk.text for chunk in batch], embedding_model)
            client.upsert(collection_name=collection, points=make_points(batch, vectors))
    finally:
        client.close()
    return len(chunks)


def search(
    question: str,
    qdrant_path: Path = DEFAULT_QDRANT_PATH,
    collection: str = DEFAULT_COLLECTION,
    embedding_model: str = DEFAULT_EMBEDDING_MODEL,
    limit: int = 5,
):
    from qdrant_client import QdrantClient

    client = QdrantClient(path=str(qdrant_path))
    query_vector = embed_texts([question], embedding_model)[0]
    # qdrant-client supports query_points in newer versions and search in older versions.
    if hasattr(client, "query_points"):
        result = client.query_points(
            collection_name=collection,
            query=query_vector,
            limit=limit,
            with_payload=True,
        )
        points = result.points
    else:
        points = client.search(
            collection_name=collection,
            query_vector=query_vector,
            limit=limit,
            with_payload=True,
        )
    client.close()
    return points


def format_context(points) -> str:
    parts: list[str] = []
    for i, point in enumerate(points, start=1):
        payload = point.payload or {}
        source = payload.get("source", "unknown")
        heading = payload.get("heading") or ""
        text = payload.get("text", "")
        score = getattr(point, "score", None)
        label = f"[{i}] {source}"
        if heading:
            label += f" — {heading}"
        if score is not None:
            label += f" (score {score:.3f})"
        parts.append(f"{label}\n{text}")
    return "\n\n---\n\n".join(parts)


def extractive_answer(question: str, points) -> str:
    if not points:
        return "I could not find relevant Tangle documentation in the local index."
    lines = [
        f"Question: {question}",
        "",
        "Relevant Tangle documentation excerpts:",
        "",
        format_context(points),
        "",
        "Sources:",
    ]
    for i, point in enumerate(points, start=1):
        payload = point.payload or {}
        source = payload.get("source", "unknown")
        heading = payload.get("heading") or ""
        suffix = f" — {heading}" if heading else ""
        lines.append(f"[{i}] {source}{suffix}")
    return "\n".join(lines)


def openai_answer(question: str, points, model: str = "gpt-4o-mini") -> str:
    from openai import OpenAI

    context = format_context(points)
    client = OpenAI()
    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "Answer Tangle-related questions using only the supplied documentation context. "
                    "Cite sources with bracket numbers like [1]. If the context is insufficient, say so."
                ),
            },
            {
                "role": "user",
                "content": f"Question: {question}\n\nDocumentation context:\n{context}",
            },
        ],
        temperature=0.2,
    )
    return response.choices[0].message.content or ""


def answer_question(
    question: str,
    qdrant_path: Path = DEFAULT_QDRANT_PATH,
    collection: str = DEFAULT_COLLECTION,
    embedding_model: str = DEFAULT_EMBEDDING_MODEL,
    limit: int = 5,
    llm: str = "extractive",
    openai_model: str = "gpt-4o-mini",
) -> str:
    points = search(
        question=question,
        qdrant_path=qdrant_path,
        collection=collection,
        embedding_model=embedding_model,
        limit=limit,
    )
    if llm == "openai":
        if not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is required when --llm openai is used")
        return openai_answer(question, points, model=openai_model)
    return extractive_answer(question, points)
