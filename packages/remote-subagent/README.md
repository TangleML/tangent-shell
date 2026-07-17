# @tangent/remote-subagent

Connector SDK for hosting Tangent **remote sub-agents**.

A Tangent session normally runs its sub-agents as local `pi` child processes.
This package lets an external **remote environment** host sub-agents instead: it
connects to the server over a dedicated Socket.IO namespace (`/remote-env`),
receives the same orchestration commands the local orchestrator uses
(`spawn` / `message` / `kill` / read transcript), and streams the same events
back.

This package is **only the connector**. It contains no agent runtime — you
plug your own agent implementation (built on whatever agent SDK you like) into
the handlers. Unimplemented handlers throw, so the integration gap is explicit.

## Install

```bash
pnpm add @tangent/remote-subagent
```

## Usage

```ts
import { connectRemoteEnvironment } from "@tangent/remote-subagent";

const client = connectRemoteEnvironment({
  url: "http://localhost:8787",
  token: process.env.REMOTE_ENV_TOKEN!,
  environmentId: "my-environment",
  handlers: {
    async onSpawn(command) {
      // Stand up a sub-agent for `command.agentId` using the resolved
      // tools / systemPrompt / model. Stream its output back:
      client.agentEvent(command.sessionId, command.agentId, {
        type: "start",
        messageId: "msg-1",
      });
      client.agentEvent(command.sessionId, command.agentId, {
        type: "delta",
        messageId: "msg-1",
        delta: "Hello from the remote environment",
      });
      client.agentEvent(command.sessionId, command.agentId, {
        type: "end",
        messageId: "msg-1",
        content: "Hello from the remote environment",
        thinking: "",
      });
    },
    async onMessage(command) {
      // Deliver `command.text` to the running sub-agent `command.agentId`.
    },
    async onKill(command) {
      // Tear down sub-agent `command.agentId`.
      client.subagentUpdate(
        command.sessionId,
        command.agentId,
        command.completed ? "completed" : "killed",
      );
    },
  },
});

// Read the shared session transcript on demand:
const messages = await client.readRoom(sessionId, 30);
```

## Outbound helpers

- `client.agentEvent(sessionId, agentId, event)` — stream a single agent event
  (`start` / `delta` / `thinking` / `end` / `error` / `activity` / `queue`).
- `client.subagentUpdate(sessionId, agentId, status)` — push a lifecycle change
  (`active` / `completed` / `killed` / `error`).
- `client.report(sessionId, agentId, text)` — send a directed report to Prime.
- `client.readRoom(sessionId, limit?)` — read the tail of the shared transcript.
- `client.disconnect()` — close the connection.

## Protocol

The wire shapes live in `@tangent/shared/remoteSubagent.ts` and are shared with
the server gateway, so the protocol cannot drift between the two sides.
