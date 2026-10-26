# Tangent — Local Agents

"Local Agents" lets you connect your own machine to a Tangent session so Prime can spawn specialized agents that run **locally** — editing files and running the terminal in your repo. There are two ways to connect: a **VS Code / Cursor extension** (flavor A) or an **ACP attach skill / CLI** (flavor B).

## At a glance

- **Scope** — A connects to a whole Tangle **Project**, so any session in that project can use local agents. B attaches to a single **session**.
- **Agent type** — A spawns **Pi** sub-agents. B lets you attach an agent of your choice (Claude, Codex, Cursor, Pi).
- **Control** — A is integrated into the editor. B is driven from the Web UI, Prime, and the agent you originally launched from — there's no in-agent control once it's attached.

## Flavor A — VS Code / Cursor extension ("Tangent Local Agent")

Connects your local machine as a remote environment that's ready to spawn new sub-agents whenever Prime needs one.

**What it does.** The extension registers your editor as a remote environment on the Shell's `/remote-env` namespace, so `spawn_subagent` with `environment: "remote"` runs a local `pi --mode rpc` process in your open workspace folder and streams replies back. It also adds a **Tangle** activity bar with **Runs**, **Resources**, and **Sessions** views scoped to the current project. Because it binds to the Tangle Project, every session in that project can use local agents.

**How to get it.** Install from the tophat build — keep the `?tophat_location=…` query in the URL while downloading the extension. The URL below is an example; substitute your deployment and the current `tophat_location` for the branch you want:

```
https://<deployment>/settings/vscode-extension?tophat_location=<branch>/<commit>
```

The extension is distributed as a `.vsix` served from the deployment (`/extension/*`) and self-updates once installed.

**Headless CLI.** The same remote-env host also ships as the `tangent-local-agent` CLI/skill for use without an editor. No token needed — it self-mints a short-lived, auto-refreshed token, running the Okta SSO login once and caching the cookie (same flow as Flavor B). Like the extension, it can scope to a whole project with `--project <id>` (or the general `--selector projectId:<id>`) so every session in that project can spawn local agents, not just a single session.

**Walkthrough.** `[video]`

**Details / PR.** [TangleML/tangle-ui#2911](https://github.com/TangleML/tangle-ui/pull/2911)

**Pros**

- Integrated into VS Code.
- Room to grow — we can add more features to fully support Tangent Projects in Tangle for the best dev experience.

**Cons**

- Requires a VS Code-based IDE (including Cursor).
- All spawned agents are Pi, so Pi must be pre-installed.

## Flavor B — ACP attach skill / CLI (`tangent-acp-attach`)

Connect from any agent you're already running. Instead of the extension, you init a remote env on your machine over the ACP protocol.

**What it does.** From a running coding agent, paste a one-line command to join a session as a sub-agent. It spawns a **fresh** local agent in your working folder (`--cwd`), and that agent can be controlled from the Web UI, Prime, and the agent you launched from. The spawned agent also gets session-resource tools so it can share files into the Tangent session and read what others contributed.

**How to get it.** Use the skill — [skills.quick.shopify.io/#/skills/tangent-acp-attach](https://skills.quick.shopify.io/#/skills/tangent-acp-attach) — or the `tangent-acp-attach` CLI directly. Paste the attach line for whichever host you're in:

```
/tangent-acp-attach <url> <session> claude
$tangent-acp-attach <url> <session> codex
/tangent-acp-attach <url> <session> cursor
/skill:tangent-acp-attach <url> <session> pi
```

No token needed — the client self-mints a short-lived, session-scoped token and runs the Okta SSO login once, caching the cookie.

**Walkthrough.** `[video]`

**Pros**

- Attach an agent of your choice (Claude, Codex, Pi, etc.).

**Cons**

- No immediate control from inside the agent once attached — only through the Web UI.

## Which should I use?

- On VS Code / Cursor and want Prime to spin up local helpers across a whole project → **Flavor A**.
- Want to bring a specific agent (or any editor) into a single session → **Flavor B**.
