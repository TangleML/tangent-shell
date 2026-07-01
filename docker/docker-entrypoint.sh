#!/usr/bin/env bash
# Boots the combined image: render the nginx config for the externally exposed
# ${PORT}, start the Node server on a fixed loopback port, then run nginx in the
# foreground. If either process exits, tear the whole container down so an
# orchestrator (Cloud Run, etc.) restarts it instead of leaving a half-up image.
set -euo pipefail

default_bundle_placeholder="__TANGENT_RUNTIME_DEFAULT_SESSION_BUNDLE_ID__"
default_session_bundle_id="${VITE_DEFAULT_SESSION_BUNDLE_ID:-tangle-oss}"

if ! [[ "$default_session_bundle_id" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "VITE_DEFAULT_SESSION_BUNDLE_ID must be a bundle id slug (lowercase letters, numbers, and hyphens)" >&2
  exit 1
fi

find /app/ui-dist -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) \
  -exec sed -i "s/${default_bundle_placeholder}/${default_session_bundle_id}/g" {} +

# nginx owns the externally exposed port (Cloud Run injects PORT; default 8000).
export PORT="${PORT:-8000}"
envsubst '${PORT}' < /app/docker/nginx.conf.template > /etc/nginx/conf.d/default.conf

# Internal Node server on a fixed loopback port, kept distinct from nginx's PORT
# so config.ts's INTERNAL_URL (http://127.0.0.1:${PORT}) resolves to the server
# itself rather than to nginx.
PORT=8787 node /app/dist/index.js &
node_pid=$!

nginx -g 'daemon off;' &
nginx_pid=$!

# Whichever process exits first, stop the other and fail so the container exits.
wait -n
kill "$node_pid" "$nginx_pid" 2>/dev/null || true
exit 1
