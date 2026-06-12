# Tangent / Autoresearch Setup

Tangent uses Tangle (via the `tangle-deploy` Python package) to run ML pipelines
on Oasis. Skills are synced to GCS so any repo can use them.

## 1. Install / upgrade tangle-deploy

Always upgrade at the start of every session:

```bash
shadowenv exec -- uv sync --upgrade-package tangle-deploy
```

If your repo doesn't use `uv sync`, install directly:
```bash
shadowenv exec -- uv pip install --upgrade tangle-deploy \
  --extra-index-url https://pkgs.shopify.io/basic/data/python/simple
```

Then discover available commands:
```bash
shadowenv exec -- tangle-deploy quickstart
```

## 2. Verify Tangle access

```bash
shadowenv exec -- tangle-deploy component inspect \
  --digest 9ff70bbe7155e7e7a6c0fec53da1479cc1af9f4eeaf966f4fc7667dc567d8243
```

Expected output starts with:
```
TangleApiClient initialized with base URL: https://oasis.shopify.io
```

## Auth

**Auth works two ways** — you don't need both:
- **Local (Minerva SSO)**: Automatic for @shopify.com accounts. No env vars needed.
- **River containers**: Uses `RIVER_SESSION_JWT` via the credentials proxy.

If the verify command fails with an auth error, check `shadowenv exec -- env | grep TANGLE`.

## Pipeline source attribution

Every pipeline run gets a `source` annotation that identifies which tool submitted
it. **Set `TANGLE_DEPLOY_SOURCE` at the start of every session**, before any
`tangle-deploy pipeline-run submit`:

```bash
export TANGLE_DEPLOY_SOURCE=$([ -n "$RIVER_SESSION_JWT" ] && echo "river-tangent" || echo "tangent")
```

- `river-tangent` — when `RIVER_SESSION_JWT` is set (River-driven session).
- `tangent` — otherwise (human / Pi / direct CLI).

This is required when running the skill from a repo *other* than
`//areas/ml/tangent` (e.g. `Shopify/discovery`, ml-taxonomy, anywhere the skill
files were pulled from
`gs://shopify-discovery-relevance/tangent/skills/`). Inside the Tangent zone
itself, the zone shadowenv sets the same value automatically — the explicit
export above is safe to run either way and idempotent.

Verify: `printenv TANGLE_DEPLOY_SOURCE` (or `shadowenv exec -- printenv
TANGLE_DEPLOY_SOURCE` inside the zone).

Do **not** pass `--source` to `tangle-deploy pipeline-run submit` or override
the env var per-run unless you have a deliberate reason — the standard values
are what downstream search and dashboards expect.

## Running Commands

The unified CLI is `tangle-deploy` with subcommand groups. All commands run via `shadowenv exec --`:

```bash
shadowenv exec -- tangle-deploy quickstart
shadowenv exec -- tangle-deploy pipeline-run submit pipeline.yaml -f config.yaml --hydrate --no-wait
shadowenv exec -- tangle-deploy pipeline-run details RUN_ID --state
shadowenv exec -- tangle-deploy pipeline-run logs EXECUTION_ID
shadowenv exec -- tangle-deploy artifacts get RUN_ID -q '{"tasks": {"TaskName": ["output"]}}'
```

For checking run status, see `references/tangle-tools.md` — use the light graph
state API for polling (~120 tokens), not `tangle-deploy pipeline-run details --state` (~17K tokens).

**Do not memorize a static command list.** Run `tangle-deploy quickstart` to discover
commands, and `tangle-deploy <group> <command> --help-full` for detailed usage.

## GCS Access (Artifact Downloads and Uploads)

Use `tangle-deploy artifacts` for all artifact operations — it handles auth automatically:

```bash
shadowenv exec -- tangle-deploy artifacts get RUN_ID -q '{"tasks": {"TaskName": ["output"]}}'
shadowenv exec -- tangle-deploy artifacts download RUN_ID -q '{"tasks": {"TaskName": ["output"]}}' -o ./artifacts
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `credential.helper has multiple values` | Use `git config --global --replace-all credential.helper ...` |
| GCS downloads hang forever | Local: run `gcloud auth application-default login`. River: check `RIVER_SESSION_JWT` is set |
| `dev up --bare` fails at "Install Python dependencies" but `uv sync` succeeds | Fix: `shadowenv exec -- uv pip install tangle-deploy --extra-index-url https://pkgs.shopify.io/basic/data/python/simple` |
| Tangle commands fail with auth error | Local: re-run `minerva login`. River: check `RIVER_SESSION_JWT` is set |
