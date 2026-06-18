# Agent Communication

How agents communicate in `apps/server/src/pi`.

## The big picture: three transport layers

Agent communication in this system is deliberately **server-mediated**. Agents
never talk to each other directly. There are exactly three transports, each with
a distinct job:

| Layer | Direction | Who uses it |
|---|---|---|
| **Pi-RPC** (JSONL over stdin/stdout) | server ↔ a single Pi child process | `PiAgentManager` ↔ each `pi --mode rpc` subprocess |
| **Internal HTTP API** (`/internal/*` + bearer token) | Pi child → server | extension tools (orchestrator, memory, triggers, session) |
| **WebSockets** (Socket.IO rooms) | server → browser | the UI |

The `PiAgentManager` (`apps/server/src/pi/piAgentManager.ts`) is the single hub.
Every "A talks to B" path actually goes A → server → B.

Topology:

```
  Browser ──ws──┐                            ┌── stdin (Pi-RPC) ──> Prime  (pi child)
                │                            │
            Socket.IO                  PiAgentManager ──stdin──> Sub-agent (pi child)
                │                            ▲  ▲
  Browser <─ws──┘                            │  │ stdout (Pi-RPC events)
                                             │  │
                          /internal/agents ──┘  │
                          (HTTP + bearer) <──────┘
                          called by extensions inside the Pi children
```

## 1. Where the orchestrator extension activates

It activates **inside each Pi child process at spawn time** — not in the server.
The server only passes it as a path.

In `buildPiArgs`, every agent is spawned with `--extension ORCHESTRATOR_EXTENSION`
(alongside proxy-provider, memory, triggers, session):

```247:257:apps/server/src/pi/piAgentManager.ts
    "--extension",
    ORCHESTRATOR_EXTENSION,
    "--extension",
    PROXY_PROVIDER_EXTENSION,
    "--extension",
    MEMORY_EXTENSION,
    "--extension",
    TRIGGERS_EXTENSION,
    "--extension",
    SESSION_EXTENSION,
```

When `spawnAgent` launches the `pi` binary, it injects environment variables that
the extension reads to decide *what tools to register*:

```943:953:apps/server/src/pi/piAgentManager.ts
        env: {
          ...process.env,
          TANGENT_SESSION_ID: sessionId,
          TANGENT_AGENT_ID: descriptor.agentId,
          TANGENT_AGENT_ROLE: descriptor.role,
          TANGENT_INTERNAL_URL: INTERNAL_URL,
          TANGENT_INTERNAL_TOKEN: INTERNAL_TOKEN,
        },
```

Pi loads the extension with `jiti` and calls its default export. The extension
then branches on `TANGENT_AGENT_ROLE`:

- **Every agent** gets `read_room`.
- **Sub-agents** additionally get `message_prime` and then `return` early
  (see `orchestrator.ts:96-123`).
- **Prime only** gets `spawn_subagent`, `message_subagent`, `kill_subagent`,
  `list_subagents`.

So "activates" = the extension's `export default function (pi)` runs once per Pi
process during Pi's startup, registering a role-specific tool set. The extension
code itself is `@ts-nocheck` and is never imported by the server — it's authored
against Pi's runtime and only handed over as a file path.

## 2. Where the internal API plays (and how Prime "reads the room")

The extension tools are **thin HTTP clients**. They don't manipulate any state
directly — they `fetch` back into the server. From `orchestrator.ts`:

```35:47:apps/server/src/pi/extensions/orchestrator.ts
  const url = new URL(`${INTERNAL_URL}/internal/agents/${endpoint}`);
  ...
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${INTERNAL_TOKEN}`,
    },
```

Those `INTERNAL_URL`/`INTERNAL_TOKEN` are the same values the server injected as
env (`config.ts:119-128`). The bearer token (`requireInternalToken.ts`) ensures
only the spawned Pi processes — which were handed the token — can drive agents;
arbitrary local callers are rejected.

These requests land on `createInternalAgentsRouter` (`routes/internalAgents.ts`),
mounted at `/internal/agents` in `index.ts:105`. Each route just calls a
`PiAgentManager` method:

| Tool (in Pi) | HTTP endpoint | Manager method |
|---|---|---|
| `read_room` | `GET /internal/agents/room` | reads `store.getMessages()` (the persisted transcript) |
| `spawn_subagent` | `POST /spawn` | `pi.spawnSubagent` |
| `message_subagent` | `POST /message` | `pi.sendToAgent` |
| `message_prime` | `POST /report` | `pi.reportToPrime` |
| `kill_subagent` | `POST /kill` | `pi.killAgent` |
| `list_subagents` | `GET /list` | `pi.listSubagents` |

**How Prime reads a sub-agent's room:** "the room" is the shared session
transcript persisted in the `SessionStore`. When Prime (or any agent) calls
`read_room`, the tool hits `GET /internal/agents/room?sessionId=...`, and
`handleRoom` returns the tail of `store.getMessages(sessionId)`:

```138:151:apps/server/src/routes/internalAgents.ts
async function handleRoom(
  store: SessionStore,
  query: RoomQuery,
  res: Response,
): Promise<void> {
  ...
  const all = await store.getMessages(query.sessionId);
  res.json({ messages: all.slice(-limit) });
}
```

Crucially, every agent's output — Prime's, each sub-agent's, the human's, and
directed messages — is written into that one shared transcript (keyed by
`conversationId` = the producing agent's id). So `read_room` lets Prime see what
sub-agents said. But the *primary* way Prime learns of sub-agent work isn't
polling `read_room` — it's an automatic relay (next section).

## 3. Where Pi-RPC plays

Pi-RPC is the JSONL protocol between the server and each Pi child over
stdin/stdout. It's how the server actually *drives* an agent and *receives* its
streamed output.

**Server → agent (stdin):** `sendToAgent` writes a JSON command line to the
child's stdin:

```767:789:apps/server/src/pi/piAgentManager.ts
    const command: Record<string, unknown> = {
      id: randomUUID(),
      type: "prompt",
      message: text,
    };
    // `streamingBehavior` is only valid while the agent is streaming; when idle,
    // send a plain prompt.
    if (agent.busy) {
      command.streamingBehavior = busyStreamingBehavior(delivery);
    }
    ...
    agent.child.stdin.write(`${JSON.stringify(command)}\n`);
```

(`abort` uses the same channel: `apps/server/src/pi/piAgentManager.ts:849`.)

**Agent → server (stdout):** `wireChildStreams` attaches a JSONL reader to the
child's stdout; each line is parsed and dispatched through `eventHandlers` by Pi
event `type` (`agent_start`, `message_update`, `message_end`,
`tool_execution_start`, `agent_end`, etc.) — see `handleStdoutLine`
(`piAgentManager.ts:1133`) and the dispatch table (`piAgentManager.ts:1111`).

**This is the mechanism behind agent-to-agent messaging.** When Prime calls
`message_subagent`, the chain is: Pi-RPC carries Prime's tool call out on Prime's
stdout → orchestrator tool fires HTTP `POST /message` → `pi.sendToAgent` → Pi-RPC
writes a `prompt` to the *sub-agent's* stdin. The reverse (sub-agent → Prime)
happens two ways:

- **Automatic relay:** when a sub-agent finalizes a message (`message_end`),
  `finalizeMessage` calls `relaySubagentReply`, which does
  `sendToAgent(PRIME_AGENT_ID, "Sub-agent ... replied:\n\n...")` — i.e. it feeds
  the sub-agent's reply into Prime's stdin as a new prompt:

```1381:1395:apps/server/src/pi/piAgentManager.ts
  private relaySubagentReply(
    sessionId: string,
    agent: AgentProcess,
    content: string,
  ): void {
    if (agent.role !== "subagent" || !content.trim()) return;
    // Trigger-owned sub-agents react in isolation; they reach Prime only when
    // they explicitly call `message_prime`, never via this automatic relay.
    if (!agent.autoRelayToPrime) return;
    this.sendToAgent(
      sessionId,
      PRIME_AGENT_ID,
      `Sub-agent "${agent.name}" replied:\n\n${content}`,
    );
  }
```

- **Explicit `message_prime`:** mid-run, a sub-agent calls the tool →
  `POST /report` → `reportToPrime` (`piAgentManager.ts:815`), which surfaces it
  in the sub-agent's own thread *and* writes it to Prime's stdin.

So agent-to-agent communication = Pi-RPC out (tool call) → internal HTTP → Pi-RPC
in (prompt) to the other agent. The server is always in the middle.

## 4. Where WebSockets play

WebSockets are **server → browser only**; they are not involved in
agent-to-agent communication. They exist so the UI can watch what's happening.

The `PiAgentManager` is constructed with four handlers, wired in `index.ts:69-72`
to Socket.IO emitters in `sockets/chat.ts`:

- `onAgentEvent` → `createAgentEventHandler` — relays each Pi-RPC streaming event
  (`start`/`delta`/`thinking`/`end`/`activity`/`queue`/`error`) to the session's
  Socket.IO room (`session:<id>`), tagged with `conversationId` so the UI buckets
  it into the right thread.
- `onSubagentUpdate` → `createSubagentUpdateHandler` — broadcasts roster changes
  and persists status.
- `onAgentMessage` → `createAgentMessageHandler` — surfaces directed messages
  (e.g. a task Prime sends a sub-agent) into a thread.
- `onSessionStatus` → `createSessionStatusHandler` — fans idle/active/busy status
  to the `sessions:lobby` room.

The browser also sends *into* the system over WebSockets: `handleChatMessage`
(`chat.ts:762`) receives a `chat:message`, persists/broadcasts it, then calls
`pi.prompt(...)` (Prime) or `pi.sendToAgent(...)` (a specific sub-agent) — which
hands off to the Pi-RPC stdin path. So a human message is: WS in → manager →
Pi-RPC stdin; the reply is Pi-RPC stdout → manager handler → WS out.

## End-to-end example: Prime delegates to a sub-agent

1. **Human → server (WS):** browser emits `chat:message`; `handleChatMessage` →
   `pi.prompt` → Prime's stdin (**Pi-RPC**).
2. **Prime decides to delegate (Pi-RPC out):** Prime emits a `spawn_subagent` /
   `message_subagent` tool call on its stdout. The orchestrator tool runs
   *inside Prime's Pi process*.
3. **Tool → server (internal HTTP):** the tool does `POST /internal/agents/spawn`
   then `/message` with the bearer token.
4. **Server drives the sub-agent (Pi-RPC in):** `pi.spawnSubagent` launches a new
   Pi child; `pi.sendToAgent` writes the task to its stdin.
5. **Sub-agent works and replies (Pi-RPC out):** its `message_end` events stream
   back on its stdout.
6. **Relay back to Prime (Pi-RPC in):** `relaySubagentReply` writes the reply into
   Prime's stdin. (Optionally the sub-agent also called `message_prime` →
   `POST /report` mid-run.)
7. **Everything mirrored to UI (WS out):** at each streaming step,
   `onAgentEvent`/`onAgentMessage` emit to the `session:<id>` Socket.IO room so
   both Prime's thread and the sub-agent's thread render live. `read_room`
   (internal HTTP → `store.getMessages`) lets any agent re-read this shared
   transcript on demand.

> Trigger-fired sub-agents (see `pi/triggers/`) are spawned with
> `autoRelayToPrime: false`, so they react in isolation and only reach Prime when
> they explicitly call `message_prime`.
