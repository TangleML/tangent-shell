#!/usr/bin/env bash
# Combined image entrypoint. The Node server serves the built UI, the REST API,
# and the Socket.IO transport from one port ($PORT) — no reverse proxy. exec so
# node is PID 1 and receives the orchestrator's signals (SIGTERM/SIGINT) directly.
set -euo pipefail

# Cloud Run injects PORT; default to 8000. The server reads it via config.ts.
export PORT="${PORT:-8000}"

exec node /app/dist/index.js
