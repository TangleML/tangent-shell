export const USAGE = `Usage: tangent-local-agent --url <shell url> [options]

Hosts Tangent sub-agents as local pi processes and serves read-only file tools
from a local folder. Runs until interrupted.

Options:
  --url <url>            Shell URL. A session URL also scopes to that session. (TANGENT_SHELL_URL)
  --session <id|url>     Session whose remote spawns and file tools this host serves. (TANGENT_SESSION_ID)
  --selector <tag>       Attach to every session whose tags include this, e.g. projectId:<id>. (TANGENT_SELECTOR)
  --project <id>         Shortcut for --selector projectId:<id>. (TANGENT_PROJECT_ID)
  --email <address>      Identity to mint the token with. Default: the SSO cookie's. (TANGENT_EMAIL)
  --cwd <dir>            Folder sub-agents and file tools work in. Default: current directory.
  --host-id <id>         Stable host id. Default: cli-<hostname>-<random>. (TANGENT_HOST_ID)
  --pi-bin <path>        pi executable. Default: pi. (TANGENT_PI_BIN)
  --model <provider/id>  Model for local sub-agents instead of Prime's choice. (TANGENT_PI_MODEL)
  --pi-proxy-url <url>   LLM proxy for local pi; key from PI_PROXY_API_KEY. (TANGENT_PI_PROXY_URL)
  --description <text>   How this host describes itself to Prime. (TANGENT_HOST_DESCRIPTION)
  -h, --help             Show this help.

No token needed: the client self-mints a short-lived, auto-refreshed token,
running the Okta SSO login once and caching the cookie. The deployment's
OKTASSO_* and AUTH_JWT_TOKEN_COOKIE_NAME config must be present in the
environment (or a bundled .env/sso.config next to the client).`;
