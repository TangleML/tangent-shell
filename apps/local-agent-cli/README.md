# tangent-local-agent

Headless Tangent local agent. Connects your machine to a Tangent Shell's
`/remote-env` namespace so Prime can spawn local `pi` sub-agents that read, edit,
and run commands in your workspace, and serves read-only file tools from a local
folder. It runs in the foreground until interrupted (Ctrl-C).

This is the headless counterpart to the VS Code / Cursor "Tangent Local Agent"
extension — same remote-env host, no editor required.

## Authentication — no token needed

The client self-mints a short-lived, auto-refreshed remote-env token. On its
first request it runs the Okta SSO login once (opening a browser and listening on
`localhost:3001`), caches the cookie, and derives your identity from it. Pass
`--email` only to mint as a specific identity instead.

The deployment's Okta config must be present at runtime via `OKTASSO_*` and
`AUTH_JWT_TOKEN_COOKIE_NAME` — either in your environment, a `.env` in the current
directory, or the `.env` / `sso.config` the build vendors next to the bundle. A
bundle-adjacent `.env` / `sso.config` takes precedence over a `.env` in the
current directory; real environment variables override all of them.

## Usage

```
tangent-local-agent --url <shell url> [options]
```

In the examples below `tangent-local-agent` stands in for however you run it —
the built bundle (`node .cursor/skills/tangent-local-agent/scripts/tangent-local-agent.cjs`)
or from source with `tsx` (see [Running from source](#running-from-source)). There
is no globally installed binary.

### Examples

Attach to a single session (a session URL scopes the host to it):

```bash
tangent-local-agent --url https://shell.example/tangent/sessions/abc123
```

Host a whole machine with a stable id, scoped by an explicit session:

```bash
tangent-local-agent \
    --url https://shell.example/tangent \
    --session abc123 \
    --host-id my-laptop
```

Attach to a whole project — serve every session tagged `projectId:<id>`:

```bash
tangent-local-agent --url https://shell.example/tangent --project abc123
# or the general form: --selector projectId:abc123
```

Point sub-agents and file tools at a specific repo:

```bash
tangent-local-agent --url https://shell.example/tangent --session abc123 \
    --cwd ~/code/my-repo
```

Mint as a specific identity instead of the SSO cookie's:

```bash
tangent-local-agent --url https://shell.example/tangent --session abc123 \
    --email me@shopify.com
```

Drive it from the environment (most flags have an env fallback):

```bash
export TANGENT_SHELL_URL=https://shell.example/tangent
export TANGENT_SESSION_ID=abc123
tangent-local-agent --cwd ~/code/my-repo
```

Local dev against an LLM proxy with a pinned model:

```bash
tangent-local-agent --url http://localhost:5173 \
    --pi-proxy-url https://proxy.internal --model anthropic/claude-sonnet-4
# PI_PROXY_API_KEY supplies the proxy key.
```

## Options

| Flag                    | Environment                | Description                                                                                                       |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--url <url>`           | `TANGENT_SHELL_URL`        | Shell URL. A session URL also scopes the host to that session. Required.                                          |
| `--session <id\|url>`   | `TANGENT_SESSION_ID`       | Session whose remote spawns and file tools this host serves. Accepts a raw id or a pasted session URL.            |
| `--selector <tag>`      | `TANGENT_SELECTOR`         | Attach to every session whose tags include this, e.g. `projectId:<id>`.                                           |
| `--project <id>`        | `TANGENT_PROJECT_ID`       | Shortcut for `--selector projectId:<id>`.                                                                         |
| `--email <address>`     | `TANGENT_EMAIL`            | Identity to mint the token with. Default: the SSO cookie's.                                                       |
| `--cwd <dir>`           | —                          | Folder sub-agents and file tools work in, resolved relative to the current directory. Default: current directory. |
| `--host-id <id>`        | `TANGENT_HOST_ID`          | Stable host id. Default: `cli-<hostname>-<random>`.                                                               |
| `--pi-bin <path>`       | `TANGENT_PI_BIN`           | `pi` executable. Default: `pi`.                                                                                   |
| `--model <provider/id>` | `TANGENT_PI_MODEL`         | Model for local sub-agents instead of Prime's choice.                                                             |
| `--pi-proxy-url <url>`  | `TANGENT_PI_PROXY_URL`     | LLM proxy for local `pi`; key from `PI_PROXY_API_KEY`.                                                            |
| `--description <text>`  | `TANGENT_HOST_DESCRIPTION` | How this host describes itself to Prime.                                                                          |
| `-h`, `--help`          | —                          | Show help.                                                                                                        |

Okta config (`OKTASSO_OAUTH_ENDPOINT_BASE`, `OKTASSO_TOKEN_EXCHANGE_URL`,
`OKTASSO_CLIENT_ID`, `OKTASSO_SCOPES`, `OKTASSO_REDIRECT_URI`,
`OKTASSO_CALLBACK_PORT`, `OKTASSO_REFRESH_AFTER_MS`, `AUTH_JWT_TOKEN_COOKIE_NAME`)
is read from the environment or a vendored `.env` — see above.

The authoritative flag reference lives in
[src/usage.ts](src/usage.ts).

## Running from source

During development, run the entry point directly with `tsx`:

```bash
pnpm --filter tangent-local-agent-cli exec tsx src/main.ts --url <shell url>
```

## Build

`pnpm --filter tangent-local-agent-cli build` bundles the CLI (and the `pi`
extensions it ships) into a single self-contained executable at
`.cursor/skills/tangent-local-agent/scripts/tangent-local-agent.cjs`, and vendors
the Okta config next to it. Run the built bundle directly with Node:

```bash
node .cursor/skills/tangent-local-agent/scripts/tangent-local-agent.cjs \
    --url https://shell.example/tangent/sessions/abc123
```

## Scripts

- `pnpm --filter tangent-local-agent-cli build` — bundle the skill executable.
- `pnpm --filter tangent-local-agent-cli test` — run the unit tests.
- `pnpm --filter tangent-local-agent-cli typecheck` — type-check.
- `pnpm --filter tangent-local-agent-cli lint` — lint.
- `pnpm --filter tangent-local-agent-cli format` — format with Prettier.
