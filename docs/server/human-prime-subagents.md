# Human <-> Prime <-> Sub-agent Protocols

[< Back to index](./index.md)

This document covers the choreography between the three actors in a session: the
**human**, the session's **Prime** agent, and the **sub-agents** Prime spawns.
It builds on the mechanics in [orchestrator.md](./orchestrator.md).

## The roles and the rules

From [server/src/pi/primePrompt.md](../../server/src/pi/primePrompt.md) and the
orchestrator extension's role gating:

- **The human only talks to Prime.** Human messages are always relayed to Prime
  (`pi.prompt` -> `sendToAgent("prime", ...)`); sub-agents never receive human
  input directly.
- **Only Prime directs sub-agents.** Prime alone has `spawn_subagent`,
  `message_subagent`, `kill_subagent`, and `list_subagents`.
- **Sub-agents are read-only observers of each other.** Every agent (Prime and
  sub-agents) has `read_room` to read the shared transcript, but a sub-agent
  cannot message or spawn other agents. It can only push a directed update *up*
  to Prime via `message_prime`. Prime relays information between sub-agents when
  they need to coordinate.
- **All work shares one workspace.** Every agent's `cwd` is the same session root
  folder, so sub-agents see each other's files.

## Transcript threading

Every message carries a `conversationId`:

- `"prime"` — the main human/Prime thread.
- a sub-agent's id — that sub-agent's drill-in thread.

The single Socket.IO room receives all of them; the client filters by the
selected thread. Directed tasks (Prime -> sub) and reports (sub -> Prime) are
surfaced into the relevant thread so each reads as a real conversation, while
also being delivered to the target's stdin so the agent reacts.

---

## Sequence: delegation (spawn + initial task)

```mermaid
sequenceDiagram
  autonumber
  actor Human
  participant Handlers as ChatHandlers
  participant PiManager
  participant Prime
  participant Internal as InternalAgentsAPI
  participant Sub as Sub-agent
  participant UI

  Human->>Handlers: chat:message "build X and Y in parallel"
  activate Handlers
  Handlers->>PiManager: prompt("prime", text)
  activate PiManager
  PiManager->>Prime: stdin prompt
  activate Prime
  deactivate PiManager
  Prime-->>Handlers: streams plan into prime thread
  Handlers-->>UI: agent:delta / agent:end (prime thread)
  Prime->>Internal: spawn_subagent({ name:"scout", template:"scout", task:"recon X" })
  activate Internal
  Internal->>PiManager: spawnSubagent(...)
  activate PiManager
  PiManager->>Sub: spawn pi rpc
  activate Sub
  PiManager->>Handlers: onSubagentUpdate(active)
  Handlers-->>UI: subagent:update
  PiManager->>Sub: stdin prompt(task)
  PiManager->>Handlers: onAgentMessage(sub thread, author=Prime, task)
  Handlers-->>UI: chat:message (sub thread)
  PiManager-->>Internal: SubagentInfo
  deactivate PiManager
  Internal-->>Prime: { subagent id }
  deactivate Internal
  deactivate Prime
  Note over Sub: works asynchronously in its own thread
  deactivate Sub
  deactivate Handlers
```

Prime can spawn multiple sub-agents back-to-back to run independent subtasks in
parallel; each is an independent process with its own context window.

---

## Sequence: the async relay loop

Sub-agents work asynchronously. Prime is event-driven — it only acts when
prompted. So every finalized sub-agent message is relayed back into Prime's
stdin as it lands (`relaySubagentReply` in `finalizeMessage`), which closes the
loop without Prime having to poll.

```mermaid
sequenceDiagram
  autonumber
  participant Sub as Sub-agent
  participant PiManager
  participant Handlers as ChatHandlers
  participant Prime
  participant UI

  Sub-->>PiManager: message_end (finalized reply)
  activate PiManager
  PiManager->>Handlers: onAgentEvent(end) (sub thread)
  Handlers-->>UI: agent:end (sub thread)
  alt not aborted and content non-empty
    PiManager->>PiManager: relaySubagentReply
    PiManager->>Prime: stdin prompt 'Sub-agent "scout" replied:\n\n<content>'
    activate Prime
    Prime-->>Handlers: reacts, streams into prime thread
    Handlers-->>UI: agent:delta / agent:end (prime thread)
    deactivate Prime
  else aborted run
    PiManager->>PiManager: skip relay (partial output not fed to Prime)
  end
  deactivate PiManager
```

If the relayed sub-agent reply arrives while Prime is mid-run, `sendToAgent`
attaches `streamingBehavior: "followUp"` so Pi queues it rather than dropping it.

---

## Sequence: `message_subagent` (Prime -> sub, directed task)

```mermaid
sequenceDiagram
  autonumber
  participant Prime
  participant Internal as InternalAgentsAPI
  participant PiManager
  participant Sub as Sub-agent
  participant Handlers as ChatHandlers
  participant UI

  Prime->>Internal: message_subagent({ id, message })
  activate Internal
  Internal->>PiManager: sendToAgent(id, message, surfaceAuthor=Prime)
  activate PiManager
  PiManager->>Handlers: onAgentMessage(sub thread, author=Prime, message)
  Handlers-->>UI: chat:message (sub thread)
  PiManager->>Sub: stdin prompt(message)
  activate Sub
  deactivate PiManager
  Internal-->>Prime: { ok: true }
  deactivate Internal
  Sub-->>PiManager: streams reply -> relay loop (above)
  deactivate Sub
```

This is non-blocking from Prime's perspective: the tool returns immediately and
the sub-agent's reply later flows back through the relay loop.

---

## Sequence: `message_prime` (sub -> Prime, mid-run report)

A sub-agent uses `message_prime` to push a milestone directly to Prime without
waiting for its run to finish (e.g. "submitted run id 123"). This is the only
upward channel a sub-agent has.

```mermaid
sequenceDiagram
  autonumber
  participant Sub as Sub-agent
  participant Ext as Orchestrator Extension
  participant Internal as InternalAgentsAPI
  participant PiManager
  participant Handlers as ChatHandlers
  participant Prime
  participant UI

  Sub->>Ext: message_prime({ message })
  activate Ext
  Ext->>Internal: POST /internal/agents/report
  activate Internal
  Internal->>PiManager: reportToPrime(sessionId, subId, text)
  activate PiManager
  PiManager->>Handlers: onAgentMessage(sub thread, author=Sub, text)
  Handlers-->>UI: chat:message (sub thread)
  PiManager->>Prime: stdin prompt 'Sub-agent "..." reported:\n\n<text>'
  activate Prime
  deactivate PiManager
  Internal-->>Ext: { ok: true }
  deactivate Internal
  Ext-->>Sub: "Reported to Prime."
  deactivate Ext
  Prime-->>Handlers: reacts (prime thread)
  Handlers-->>UI: agent:delta / agent:end
  deactivate Prime
```

The difference from the automatic relay: `message_prime` is sub-agent-initiated
and attributed to the sub-agent; the automatic relay fires for *every* finalized
sub-agent message regardless, so milestones aren't dropped even if the sub-agent
never calls `message_prime`.

---

## Sequence: abort vs kill

Aborting stops the current run but keeps the agent; killing removes the agent
from the roster entirely.

```mermaid
sequenceDiagram
  autonumber
  actor Human
  participant Handlers as ChatHandlers
  participant PiManager
  participant Prime
  participant Internal as InternalAgentsAPI
  participant Sub as Sub-agent
  participant UI

  Note over Human,Sub: ABORT (cancel an in-progress run)
  Human->>Handlers: agent:abort { conversationId }
  activate Handlers
  Handlers->>PiManager: abort(sessionId, agentId)
  activate PiManager
  PiManager->>PiManager: aborted = true
  PiManager->>Sub: stdin abort
  activate Sub
  Sub-->>PiManager: agent_end
  deactivate Sub
  PiManager->>PiManager: finalize skips relay (aborted)
  PiManager-->>UI: agent:activity null
  deactivate PiManager
  deactivate Handlers

  Note over Prime,Sub: KILL (Prime retires a sub-agent)
  Prime->>Internal: kill_subagent({ id, completed })
  activate Internal
  Internal->>PiManager: killAgent(id, completed)
  activate PiManager
  PiManager->>PiManager: status = completed ? "completed" : "killed"; drop from roster
  PiManager->>Sub: child.kill()
  PiManager->>Handlers: onSubagentUpdate(terminal status)
  activate Handlers
  Handlers-->>UI: subagent:update
  deactivate Handlers
  PiManager-->>Internal: ok
  deactivate PiManager
  Internal-->>Prime: "Terminated sub-agent ..."
  deactivate Internal
```

A crash (process `error`/`exit`) is handled like an implicit kill: `removeAgent`
transitions a still-`active` sub-agent to `error` status and broadcasts the
roster update, while `failInFlight` emits an `agent:error` for any message that
was streaming.

---

## Sub-agent templates

`spawn_subagent` may name a `template` to seed tools + system prompt. The global
templates ship under
[server/src/pi/agents/](../../server/src/pi/agents) (`scout`, `planner`,
`reviewer`, `worker`); a bundle can override or add templates via its `agents/`
directory. Resolution precedence (`resolveSubagentConfig` in
[agentConfig.ts](../../server/src/pi/agentConfig.ts)): inline request > template
> bundle/session default > global base. `read_room` (and the other shared tools)
are always merged into the allowlist so the extension's tool is never filtered
out. See [extensions-and-prompts.md](./extensions-and-prompts.md) for the full
resolution rules.
