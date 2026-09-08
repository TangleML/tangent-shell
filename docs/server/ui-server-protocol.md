# UI <-> Server Protocol

[< Back to index](./index.md)

The web UI talks to the server over **two transports**:

- **REST (`/api/*`)** — request/response CRUD for sessions, agent bundles,
  triggers, file uploads, and serving artifact/upload files.
- **Socket.IO** — the live, bidirectional chat/stream protocol. The client joins
  a session and subscribes to the **Conversations** its participant may see. A
  Message is delivered to its Conversation room (`conv:<sessionId>:<conversationId>`),
  so who receives it is a server-side decision derived from Membership. Session-level
  events (roster, presence, memory cards, trigger roster, generic UI directives)
  use the session-wide room `session:<id>`.

The wire shapes for both are defined once in
[packages/shared/src/contracts.ts](../../packages/shared/src/contracts.ts) and
imported by both `apps/server` and `apps/web` from the `@tangent/shared`
workspace package, so the two sides never drift. The client side of the socket
protocol lives in
[apps/web/src/features/chat/hooks/useSessionChat.ts](../../apps/web/src/features/chat/hooks/useSessionChat.ts).

---

## REST surface

Routers are created in [server/src/index.ts](../../server/src/index.ts) and
implemented under [server/src/routes/](../../server/src/routes).

### Sessions — [routes/sessions/index.ts](../../apps/server/src/routes/sessions/index.ts)

| Method + path                                                                      | Purpose                                                                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /api/sessions`                                                                | List sessions (sorted by `createdAt`).                                                                         |
| `POST /api/sessions`                                                               | Create a session. Plain JSON, or a multipart `config` ZIP, or `{ bundleId }` referencing a marketplace bundle. |
| `GET /api/sessions/:id`                                                            | Fetch one session.                                                                                             |
| `PATCH /api/sessions/:id`                                                          | Rename a session.                                                                                              |
| `DELETE /api/sessions/:id`                                                         | Delete a session; disposes its `pi` processes and triggers.                                                    |
| `POST /api/sessions/:id/viewed`                                                    | Record that the current user opened the session.                                                               |
| `POST /api/sessions/:id/files`                                                     | Upload chat attachments into the session's `uploads/`.                                                         |
| `GET /api/sessions/:id/triggers`                                                   | List the session's triggers.                                                                                   |
| `POST /api/sessions/:id/triggers`                                                  | Create a runtime trigger.                                                                                      |
| `PATCH /api/sessions/:id/triggers/:triggerId`                                      | Update a mutable trigger field.                                                                                |
| `DELETE /api/sessions/:id/triggers/:triggerId`                                     | Delete a trigger.                                                                                              |
| `POST /api/sessions/:id/triggers/:triggerId/callback/:secret`                      | Public, secret-guarded inbound callback that fires a callback trigger.                                         |
| `GET /api/sessions/:id/participants`                                               | List every Participant with its Memberships (roster + presence).                                               |
| `POST /api/sessions/:id/participants`                                              | Invite a Participant (e.g. a human) into the session.                                                          |
| `DELETE /api/sessions/:id/participants/:participantId`                             | Revoke a Participant (the row is kept so past attributions still resolve).                                     |
| `POST /api/sessions/:id/participants/:participantId/memberships`                   | Join a Participant to a Conversation.                                                                          |
| `DELETE /api/sessions/:id/participants/:participantId/memberships/:conversationId` | Leave a Conversation.                                                                                          |
| `PATCH /api/sessions/:id/participants/:participantId/memberships/:conversationId`  | Mute/unmute a membership (mute = reaction `never`).                                                            |
| `GET /api/sessions/:id/resources`                                                  | List the resource catalog (optionally scoped to `?conversationId=&participantId=`).                            |
| `POST /api/sessions/:id/resources`                                                 | Catalog a host resource (a workspace file, etc.).                                                              |
| `DELETE /api/sessions/:id/resources`                                               | Remove a catalog entry.                                                                                        |
| `GET /api/sessions/:id/files/*splat`                                               | Serve a file from the session's `artifacts/` or `uploads/` subtree (path-traversal guarded).                   |

Other API mounts: `/api/agent-bundles`, `/api/global-memory`, `/api/mcp` (public
MCP relay), `/api/me` (current user), `/api/embed`, and the token-guarded
`/internal/*` routers the agent extensions call.

### Agent bundles — [routes/agentBundles.ts](../../server/src/routes/agentBundles.ts)

| Method + path                         | Purpose                                                      |
| ------------------------------------- | ------------------------------------------------------------ |
| `GET /api/agent-bundles`              | List saved bundle metadata.                                  |
| `POST /api/agent-bundles`             | Upload + validate + store a bundle ZIP (multipart `bundle`). |
| `GET /api/agent-bundles/:id`          | Fetch one bundle's metadata.                                 |
| `GET /api/agent-bundles/:id/icon`     | Serve the preview SVG.                                       |
| `GET /api/agent-bundles/:id/download` | Download the original ZIP.                                   |
| `GET /api/agent-bundles/:id/ui/:file` | Serve a compiled UI component JS asset.                      |
| `POST /api/agent-bundles/ui-egress`   | The bundle-UI `host.fetch` egress proxy.                     |
| `DELETE /api/agent-bundles/:id`       | Delete a saved bundle.                                       |

`GET /api/health` returns `{ ok: true }`.

---

## Socket.IO event catalog

Event names come from `SocketEvents` in
[shared/contracts.ts](../../shared/contracts.ts).

### Client -> Server

- `chat:join` `{ sessionId }` — join the session room.
- `conversation:subscribe` — subscribe to a Conversation the participant is
  authorized for; the server joins its `conv:<sessionId>:<conversationId>` room
  and can reply with that Conversation's history.
- `chat:message` `{ sessionId, author, content, conversationId?, delivery?, attachments? }` —
  post a human message. `conversationId` targets a Conversation (the primary
  thread by default, or another the participant may write to). Any `@mentions` in
  the text are resolved to participant ids server-side at write time. `delivery`
  (`"auto" | "steer" | "followUp"`, default `"auto"`) controls how a message is
  queued when the target agent is mid-run: `"steer"` nudges it before the next LLM
  call, `"followUp"` waits until the run stops; both are ignored when the agent is
  idle.
- `agent:abort` `{ sessionId, conversationId }` — abort an in-progress **Run**;
  the server resolves the participant's open run id and cancels it through
  whichever connector holds it.
- `memory:confirm` `{ sessionId, suggestionId }` — accept a memory suggestion.
- `memory:dismiss` `{ sessionId, suggestionId }` — decline a memory suggestion.
- `artifact:pin` `{ sessionId, path, title }` — pin an artifact.
- `artifact:unpin` `{ sessionId, path }` — unpin an artifact.
- `terminal:data` — reserved/no-op stub for a future phase.

### Server -> Client

- `chat:history` `ChatMessage[]` — a Conversation's transcript, sent on join /
  subscribe for each Conversation the participant may see.
- `conversation:history` — history for one subscribed Conversation.
- `chat:message` `ChatMessage` — a persisted message (human, directed sub-agent
  task, sub-agent report rendered as a relay, memory highlight, or trigger
  prompt). Carries `seq` so concurrent writers interleave deterministically.
- `agent:start` `{ message }` — an agent opened a new (empty) reply bubble.
- `agent:delta` `{ sessionId, messageId, delta }` — a streamed text chunk.
- `agent:thinking` `{ sessionId, messageId, delta }` — a streamed reasoning chunk.
- `agent:end` `{ message }` — the finalized message (persisted first).
- `agent:error` `{ sessionId, messageId?, message }` — a run failed.
- `agent:activity` `{ sessionId, conversationId, activity }` — run-level spinner
  state (`thinking` / `tool` / `null`). Not persisted to disk, but the latest
  value per live agent is retained in memory and replayed to a joining socket
  (see the join sequence below), so the indicator/label and activity bubble
  survive a reload.
- `agent:queue` `{ sessionId, conversationId, steering, followUp }` — the
  agent's pending steer/follow-up nudges changed; drives the composer's
  queued-nudge indicator. Empty arrays mean the queue drained.
- `subagent:roster` `{ sessionId, subagents }` — full roster on join.
- `subagent:update` `{ sessionId, subagent }` — one sub-agent's spawn/status
  change (upserted by id).
- `participant:presence` — a participant's presence changed (`connected` /
  `away` / `detached`); drives the roster's presence dots.
- `resources:updated` `{ sessionId }` — the resource catalog changed; open
  clients refetch (used where a mutation has no `ChatMessage` to piggyback on).
- `memory:suggestion` `{ sessionId, suggestionId, scope, text }` — a
  confirm/dismiss card.
- `trigger:roster` `{ sessionId, triggers }` — full trigger roster on join.
- `trigger:update` `{ sessionId, trigger }` — one trigger's create/update.
- `trigger:removed` `{ sessionId, triggerId }` — a trigger was deleted.
- `ui:command` `{ sessionId, command }` — the generic agent->UI directive
  channel (`session.update`, `artifacts.update`).

Each message carries a `conversationId` — a **Conversation id** — that tells the
client which transcript to bucket it into. It is no longer necessarily an agent
id: a Conversation can hold several participants, and legacy agent-id-named
transcripts stay valid because the `conversations` table maps them. Every message
is attributed to its author (a stable participant id, resolved from any
`@mention` at write time), and a `source.kind === "relay"` message renders as a
report rather than a peer turn.

---

## Sequence: connect + join + replay

When a session view mounts, `useSessionChat` opens a socket and emits
`chat:join`; the server replays everything the client needs to render the room.

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant Socket as SocketIO
  participant Handlers as ChatHandlers
  participant PiManager
  participant Store as SessionStore
  participant TE as TriggerEngine

  UI->>Socket: connect (path BASE_PREFIX + socket.io)
  activate Socket
  Socket-->>UI: connect ack
  UI->>Socket: chat:join { sessionId }
  Socket->>Handlers: handleChatJoin
  activate Handlers
  Handlers->>Store: getSession(id)
  activate Store
  Store-->>Handlers: session
  deactivate Store
  Handlers->>Socket: socket.join("session:<id>")
  Handlers->>PiManager: ensure(id, rootPath)
  activate PiManager
  PiManager-->>Handlers: (Prime spawned if needed)
  deactivate PiManager
  Handlers->>TE: sync(id, rootPath)
  activate TE
  TE-->>Handlers: (schedules re-armed)
  deactivate TE
  Handlers->>Store: getMessages(id) per authorized Conversation
  activate Store
  Store-->>Handlers: history
  deactivate Store
  Handlers-->>UI: chat:history (for each Conversation the participant may see)
  Handlers-->>UI: subagent:roster + participant roster / presence
  Handlers-->>UI: agent:activity (per live agent, replayed)
  Handlers-->>UI: trigger:roster
  Handlers-->>UI: ui:command { artifacts.update }
  deactivate Handlers
  deactivate Socket
```

History is fetched per Conversation and scoped to the Conversations the joining
participant is authorized for, rather than one flat dump of the whole session.

Note: the replayed current activity (from `pi.listActivities`) and the artifact
list are both sent to _only the joining socket_. Activity reuses the same
`agent:activity` event that later streams live; the artifact list reuses the same
`artifacts.update` directive that later broadcasts mutations to the whole room.

---

## Sequence: send a message + streamed reply

This is the central protocol. The human's message is persisted and broadcast,
then relayed into Prime's stdin; Prime's reply streams back as `agent:*` events.

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant Socket as SocketIO
  participant Handlers as ChatHandlers
  participant Store as SessionStore
  participant PiManager
  participant Prime

  UI->>Socket: chat:message { sessionId, author, content, attachments? }
  activate Handlers
  Socket->>Handlers: handleChatMessage
  Handlers->>Store: appendMessage(userMessage)
  activate Store
  Store-->>Handlers: ok
  deactivate Store
  Handlers-->>UI: chat:message (echo to room)
  Handlers->>PiManager: prompt(id, rootPath, contentWithAttachments)
  activate PiManager
  PiManager->>PiManager: ensure(id) then sendToAgent("prime", text)
  PiManager->>Prime: stdin { id, type:"prompt", message }
  activate Prime
  deactivate PiManager
  Prime-->>PiManager: stdout agent_start
  activate PiManager
  PiManager-->>Handlers: onAgentEvent(activity "Thinking...")
  Handlers-->>UI: agent:activity
  Prime-->>PiManager: stdout message_update (first delta)
  PiManager-->>Handlers: onAgentEvent(start) + onAgentEvent(delta)
  Handlers-->>UI: agent:start
  Handlers-->>UI: agent:delta (repeated)
  Prime-->>PiManager: stdout message_end
  PiManager-->>Handlers: onAgentEvent(end)
  Handlers->>Store: appendMessage(finalMessage)
  activate Store
  Store-->>Handlers: ok
  deactivate Store
  Handlers-->>UI: agent:end
  Prime-->>PiManager: stdout agent_end
  deactivate Prime
  PiManager-->>Handlers: onAgentEvent(activity null)
  Handlers-->>UI: agent:activity (cleared)
  deactivate PiManager
  deactivate Handlers
```

Key correctness details (see [orchestrator.md](./orchestrator.md) for the full
event lifecycle):

- The `agent:start` is deferred until the **first** text/thinking delta, so a
  tool-only assistant message never opens an empty bubble.
- `agent:end` is persisted **before** it is broadcast, so a client that
  reconnects mid-stream still sees the message in `chat:history`.
- `thinking` deltas stream for every agent; the final `agent:end` carries the
  authoritative content (from the `message_end` payload, not just the streamed
  accumulator).

---

## Sequence: abort a run

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant Socket as SocketIO
  participant Handlers as ChatHandlers
  participant PiManager
  participant Agent

  UI->>Socket: agent:abort { sessionId, conversationId }
  activate Handlers
  Socket->>Handlers: pi.abort(sessionId, conversationId)
  Handlers->>PiManager: abort(sessionId, agentId)
  activate PiManager
  PiManager->>PiManager: mark agent.aborted = true (if busy)
  PiManager->>Agent: stdin { type:"abort" }
  activate Agent
  Agent-->>PiManager: stdout agent_end
  deactivate Agent
  PiManager-->>Handlers: onAgentEvent(activity null)
  Handlers-->>UI: agent:activity (cleared)
  deactivate PiManager
  deactivate Handlers
```

The diagram shows the local Pi path; in general `agent:abort` resolves the
participant's open **Run** and cancels it through whichever connector holds it
(see [connectors.md](./connectors.md)). The process stays alive; the `aborted`
flag ensures a half-finished sub-agent reply is not relayed back as if it had
completed.

---

## Sequence: memory suggestion confirm / dismiss

When Prime proposes a memory it isn't allowed to write directly, the server
emits a card. The user's choice is sent back over the socket.

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant Socket as SocketIO
  participant Handlers as ChatHandlers
  participant Memory as MemoryManager
  participant Store as SessionStore
  participant PiManager
  participant Prime

  Note over Prime,Memory: Prime called suggest_memory earlier -> memory:suggestion card shown
  UI->>Socket: memory:confirm { sessionId, suggestionId }
  activate Handlers
  Socket->>Handlers: handleMemoryConfirm
  Handlers->>Memory: takeSuggestion(suggestionId)
  activate Memory
  Memory-->>Handlers: pending suggestion
  deactivate Memory
  Handlers->>Store: getSession(id)
  activate Store
  Store-->>Handlers: session
  deactivate Store
  Handlers->>Memory: write(rootPath, scope, text)
  activate Memory
  Memory-->>Handlers: { scope, added }
  deactivate Memory
  Handlers->>Store: appendMessage(memory highlight)
  Handlers-->>UI: chat:message (memory highlight)
  Handlers->>PiManager: sendToAgent("prime", "user confirmed...")
  activate PiManager
  PiManager->>Prime: stdin { type:"prompt" }
  deactivate PiManager
  deactivate Handlers
```

A `memory:dismiss` follows the same shape but writes nothing; it only tells
Prime the user declined so it can continue honestly. See
[memory.md](./memory.md).

---

## Sequence: the generic `ui:command` channel

`ui:command` is the single, extensible transport every agent->UI directive rides
on. Today it carries `session.update` (after `rename_session`) and
`artifacts.update` (pin/unpin). Clients dispatch by `command.kind` and ignore
kinds they don't recognize, so older clients stay forward-compatible.

```mermaid
sequenceDiagram
  autonumber
  participant Prime
  participant Ext as Session Extension
  participant Internal as InternalSessionAPI
  participant Store as SessionStore
  participant Emitter as UiCommandEmitter
  participant UI

  Prime->>Ext: rename_session({ name })
  activate Ext
  Ext->>Internal: POST /internal/session/rename
  activate Internal
  Internal->>Store: updateSession(id, { name })
  activate Store
  Store-->>Internal: updated session
  deactivate Store
  Internal->>Emitter: emit { kind:"session.update", session }
  activate Emitter
  Emitter-->>UI: ui:command (broadcast to room)
  deactivate Emitter
  Internal-->>Ext: { session }
  deactivate Internal
  Ext-->>Prime: "Renamed this session to ..."
  deactivate Ext
```

Artifact pinning works the same way: it can originate from the UI
(`artifact:pin` socket event) or from an agent (the `pin_artifact` tool via
`POST /internal/session/pin-artifact`), and both paths broadcast an
`artifacts.update` `ui:command` to the room.
