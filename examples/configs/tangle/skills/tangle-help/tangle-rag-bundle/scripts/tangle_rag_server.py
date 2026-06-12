#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Ensure repo root is importable when this script is run directly.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tangle_rag.rag import answer_question  # noqa: E402

HOST = "0.0.0.0"
PORT = 8101


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib method name
        parsed = urlparse(self.path)
        if parsed.path != "/ask":
            self._json(404, {"error": "not_found", "message": "Use GET /ask?q=your+question"})
            return

        q = parse_qs(parsed.query).get("q", [""])[0].strip()
        if not q:
            self._json(400, {"error": "missing_query", "message": "Missing required query parameter: q"})
            return

        try:
            answer = answer_question(question=q, qdrant_path=ROOT / "rag_data" / "qdrant", limit=5)
            self._json(200, {"question": q, "answer": answer})
        except Exception as exc:  # Keep tiny server from crashing on bad request/runtime error.
            self._json(500, {"error": "rag_error", "message": str(exc)})

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Tangle RAG server listening on http://{HOST}:{PORT}/ask?q=...", flush=True)
    server.serve_forever()
