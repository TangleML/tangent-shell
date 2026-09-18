# Sub-agent Orchestration

## The pitch

Hard problems aren't solved by one mind doing everything in sequence — they're
solved by a coordinator delegating to specialists. Tangent works the same way.
Your session's main agent, **Prime**, can spin up **sub-agents** — focused
helpers with their own instructions and tools — that work **in parallel** in the
same shared workspace. Prime delegates, the specialists report back, and Prime
synthesizes one clean answer for you.

## Why it's useful

- **Parallelism.** Several specialists can work at once while Prime keeps
  coordinating — faster than one agent doing everything step by step.
- **Specialization.** A bundle can define focused roles (researcher, builder,
  reviewer, optimizer…). Each sub-agent gets only the context and tools it needs.
- **Cleaner thinking.** Narrow context per task beats one giant, sprawling
  conversation — specialists stay sharp and on-topic.
- **One face by default, but not a wall.** Prime is the teammate you usually
  talk to, and delegation happens behind it. When you want to, you can address a
  specialist directly with an `@mention` and follow up in its own thread.

## Tradeoffs to be honest about

- **More moving parts.** Each sub-agent is real work running in parallel, so
  complex tasks cost more than a single thread.
- **Coordination is deliberate.** Prime is the usual coordinator, and the common
  shape is delegate-and-report. Agents don't chatter freely; who reacts to a
  given message is decided by each participant's rule (react to everything, only
  when mentioned, or never), not by a free-for-all.

## The shape of it

```mermaid
flowchart TB
  user["You"]
  prime["Prime<br/>(coordinator)"]
  s1["Researcher"]
  s2["Builder"]
  s3["Reviewer"]
  room["Shared room<br/>(everyone can read)"]

  user <-->|"chat"| prime
  prime -->|"spawns + delegates"| s1
  prime -->|"spawns + delegates"| s2
  prime -->|"spawns + delegates"| s3
  s1 -->|"reports back"| prime
  s2 -->|"reports back"| prime
  s3 -->|"reports back"| prime
  s1 -.->|"reads"| room
  s2 -.->|"reads"| room
  s3 -.->|"reads"| room
  prime -.->|"reads / writes"| room
```

## A delegated task, end to end

You ask Prime for something big. Prime breaks it down, spins up specialists with
their tasks, lets them run in parallel, gathers their results, and gives you a
single synthesized answer. Each specialist also appears in its own thread, so you
can drill in if you want.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Prime as Prime (coordinator)
  participant A as Sub-agent: Researcher
  participant B as Sub-agent: Builder

  User->>Prime: "Research X and build Y"
  activate Prime
  Note over Prime: Break the work into slices

  Prime->>A: Spawn + task: research X
  activate A
  Prime->>B: Spawn + task: build Y
  activate B
  Note over A,B: Specialists work in parallel,<br/>in the same workspace

  A-->>Prime: Findings on X
  deactivate A
  B-->>Prime: Built Y
  deactivate B

  Prime->>Prime: Synthesize results
  Prime-->>User: One clean answer
  deactivate Prime
```

## The shared transcript

Every agent can read the session's transcript, so a specialist can catch up on
what's already happened before acting. Delegate-and-report is the usual flow, but
it isn't the only one it can express:

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Prime as Prime
  participant Sub as Sub-agent
  participant Room as Conversation

  User->>Prime: Message (Prime reacts by default)
  activate Prime
  Prime->>Sub: Delegate a task
  deactivate Prime
  activate Sub
  Sub->>Room: Read recent context
  Room-->>Sub: What's happened so far
  Sub-->>Prime: Report milestone / result
  deactivate Sub
  activate Prime
  Prime-->>User: Surface progress and the final result
  deactivate Prime
```

## Beyond one coordinator

The same machinery covers shapes that aren't strictly Prime-in-the-middle:

- **Shared threads.** A [Conversation](11-conversations-and-participants.md) can
  hold several participants at once — more than one human, plus agents — instead
  of one agent per thread.
- **Reaction rules.** Each participant decides what wakes it: an observer that
  follows everything (`always`), a specialist that only acts when mentioned
  (`mentionsMe`), or a muted member that never runs (`never`).
- **Outside agents as ordinary members.** An independently deployed agent
  (reached over the A2A protocol) can join a shared thread as a normal member. By
  default it's **opaque** — it receives the message that addresses it rather than
  subscribing to the whole log — but it participates like any other peer.

## Where this shows up next

- See threads and roles in detail in
  [Conversations & Participants](11-conversations-and-participants.md).
- Specialists are defined by [Agent Bundles](03-agent-bundles.md) (the `agents/`
  templates).
- The tools each agent can use: [Tools & Extensions](10-tools-and-extensions.md).
