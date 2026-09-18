# Backend-only image for Cloud Run.
#
# The server is bundled (via esbuild) into a single self-contained ESM file and
# run with plain `node`. It spawns the Pi coding agent (`pi`) as child
# processes; Pi shells out to ripgrep/fd/jq/git, so those CLIs are installed
# alongside the published `@earendil-works/pi-coding-agent` package.
#
# Layered as three stages so each cache layer is invalidated independently:
#   1. base    - Node + CLI tools + Pi (changes rarely)
#   2. builder - install deps and compile the server to dist/ (changes per source)
#   3. runtime - copy the compiled bundle + assets and run it (lean, no deps)

# ---------------------------------------------------------------------------
# Stage 1: base — Node runtime, the CLI tools Pi needs, and Pi itself.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS base

# CLI tools the Pi agent's built-in tools (bash/grep/find) rely on at runtime.
# Debian ships `fd` as `fdfind`, so expose it under the expected `fd` name.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  git \
  ripgrep \
  fd-find \
  jq \
  ca-certificates \
  && ln -s "$(command -v fdfind)" /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*

# Pin the Pi coding agent so the `pi` binary is on PATH.
RUN npm install -g @earendil-works/pi-coding-agent@0.78.1

WORKDIR /app

# ---------------------------------------------------------------------------
# Stage 2: builder — install dependencies and bundle the server to dist/.
# A full install (incl. devDependencies) is needed for the esbuild build step.
# strictDepBuilds=false: esbuild's optional platform binary is installed as a
# regular dependency, so its (blocked) build script isn't required.
# ---------------------------------------------------------------------------
FROM base AS builder

ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# Workspace manifests first so the dependency install layer caches independently
# of source changes. All package.json files are copied so the install matches
# the lockfile graph; the install itself is filtered to the server subtree.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/build/package.json packages/build/
COPY packages/ui-extensions-sdk/package.json packages/ui-extensions-sdk/
RUN pnpm install --frozen-lockfile --config.strictDepBuilds=false \
  --filter @tangent/server...

# Server source plus the workspace packages it bundles (incl. the .md
# prompt/agent files and the orchestrator .ts extension copied next to the
# bundle).
COPY apps/server ./apps/server
COPY packages/shared ./packages/shared
COPY packages/build ./packages/build
COPY packages/ui-extensions-sdk ./packages/ui-extensions-sdk

# Produces apps/server/dist/index.js plus its runtime assets (prompts, agents,
# extensions, migrations). Invoked via node directly to avoid pnpm's pre-run
# dependency status check.
RUN node apps/server/build.mjs

# Defense in depth: fail the image build if any extension the server loads at
# runtime is missing from the bundle (the build script also asserts this).
RUN for f in orchestrator proxyProvider memory triggers; do \
  test -f "apps/server/dist/extensions/$f.ts" || { echo "missing apps/server/dist/extensions/$f.ts" >&2; exit 1; }; \
  done


# ---------------------------------------------------------------------------
# Stage 3: runtime — assemble the final image from base (tools + Pi) plus the
# self-contained bundle. No node_modules / pnpm: the bundle inlines all deps.
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
# Cloud Run injects PORT; default to 8080 to match its convention.
ENV PORT=8080
# Writable locations on Cloud Run for session workspaces and Pi's lockfiles/config.
ENV SESSIONS_ROOT=/tmp/sessions
ENV HOME=/tmp
ENV PI_BIN=pi
# Base URL of the LLM proxy the bundled proxy-provider extension points Pi at.
# Because HOME=/tmp there is no auto-discovered ~/.pi/agent provider config, so
# the extension registers providers itself. Override to target a different proxy.
ENV PI_PROXY_URL=https://proxy.shopify.ai
# PI_PROXY_API_KEY must be supplied at deploy time (e.g. a Cloud Run secret) so
# Pi can authenticate to the proxy; it is intentionally not baked into the image.
# Optional overrides: PI_PROVIDER / PI_MODEL pin the model (default openai/gpt-5.5),
# PI_DEBUG=1 enables verbose Pi RPC logging.

COPY --from=builder /app/apps/server/dist ./dist

# esbuild and better-sqlite3 are kept external by apps/server/build.mjs (native
# binaries, used at runtime). Install just them so node can resolve the bare
# imports from /app/dist/index.js.
RUN npm install --no-save --no-package-lock esbuild@0.28.0 better-sqlite3@12.10.0

EXPOSE 8080

CMD ["node", "dist/index.js"]
