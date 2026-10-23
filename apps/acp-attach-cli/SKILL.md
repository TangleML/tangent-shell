---
name: tangent-acp-attach
description: Starts the ACP attach client so a fresh coding agent joins a running Tangent session as a sub-agent for Prime to delegate to. Use when the user pastes a `/tangent-acp-attach <url> <session> <agent>`, `$tangent-acp-attach <url> <session> <agent>`, or `/skill:tangent-acp-attach <url> <session> <agent>` command, says "Use the tangent-acp-attach skill", or pastes a `node <skill-dir>/scripts/tangent-acp-attach.mjs` command.
---

# Tangent ACP Attach

When the user pastes the attach command — in any host's syntax
(`/tangent-acp-attach …`, `$tangent-acp-attach …`, or
`/skill:tangent-acp-attach …`) or the older `node … tangent-acp-attach.mjs …`
command — run the bundled client. Do not explain the command back.

## Steps

1. Read the Shell URL, session, and agent from the pasted text:
   - Slash/mention form: `<trigger> <url> <session> <agent>` — the words after
     the command are `--url`, `--session`, and an optional third `--agent`. When
     the third word is absent, the agent defaults to `claude`.
   - Legacy form: read the `--url`, `--session`, and (if present) `--agent` /
     `--token` flags. Ask only for a value that is missing.
2. Start the bundled client in the background from the repo root. The client
   sits next to this file at `scripts/tangent-acp-attach.mjs`; in the commands
   below, `<skill-dir>` is the directory that contains this SKILL.md. No token is
   needed — the client authenticates itself:

   ```bash
   node <skill-dir>/scripts/tangent-acp-attach.mjs \
       --url <url> --session <session> --agent <agent>
   ```

   It long-polls and does not exit on its own, so run it in the background. If a
   client is already running for the same `--session`, skip starting a second one.
   Pass the `--agent` from the third word so the spawned sub-agent matches the
   host you are running in; omit it only when no agent was given (defaults to
   `claude`).

3. If the Shell is behind Okta SSO, the client opens a browser for login on its
   first request and caches the session cookie — let it; do not handle tokens.
4. Reply with one line: which agent is joining which `--session`, and that
   stopping that process detaches it. State that this chat is not the joined
   agent — the client spawns a fresh agent process in `--cwd`.

## Talking to the spawned agent

Once the attach is running in the background, this chat can message the spawned
agent directly — no token needed, just the `--session`:

```bash
node <skill-dir>/scripts/tangent-acp-attach.mjs \
    peer send --session <session> --text "<message>"
node <skill-dir>/scripts/tangent-acp-attach.mjs \
    peer wait --session <session>
```

- `peer send` queues a message for the spawned agent; it runs as a turn there.
  Prints `queued`, or `not attached` (exit 1) if no attach is running.
- `peer wait` blocks for the agent's reply and prints it, or `timeout` after
  five minutes — run it again to keep waiting.
- The spawned agent answers with its own `peer_send` / `peer_wait` tools, so the
  two of you can go back and forth. Both processes are local to this machine.

## Notes

- The client self-mints a short-lived, session-scoped token; it refreshes on its
  own while attached. Okta SSO cookies are cached (shared with `tangle_deploy`),
  so login is usually a one-time prompt.
- A `.env` packaged next to this file supplies the Oktasso config, so the skill
  authenticates out of the box. Real environment variables override it.
- ACP spawns a fresh agent; it does not inherit this chat's context. It shares the
  working folder (`--cwd`, default current), so point it at the relevant repo if
  the agent needs those files.
- The spawned agent also gets session-resource tools (`put_session_resource`,
  `list_session_resources`, `read_session_resource`), so it can contribute files
  to the Tangent session and read what Prime or agents on other environments
  shared — no setup needed.
- The Okta login opens a browser and listens on `localhost:3001`, so run the
  client on the same machine as the browser you log in with.
- CLI flag reference lives in [apps/acp-attach-cli/src/usage.ts](../../../apps/acp-attach-cli/src/usage.ts).
