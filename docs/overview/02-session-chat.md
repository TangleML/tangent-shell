# Session Chat

## The pitch

Session Chat is the conversation at the heart of every session — but it's a
conversation with a teammate who actually works while you watch. You type (and
can attach files); the agent's reply **streams back live**, word by word, with a
visible sense of what it's doing: thinking, running a tool, or writing a file.

## Why it's useful

- **Live and transparent.** Replies stream as they're generated, and you see
  real-time activity ("Thinking…", "Running a tool…") so the agent never feels
  like a black box.
- **More than text.** Attach files to a message, and the agent can hand back
  real [Artifacts](06-artifacts.md) and embedded [Pages](07-pages.md) instead of
  walls of text.
- **A shared room.** The transcript is the single source of truth for the whole
  session — you, Prime, and any [sub-agents](05-subagent-orchestration.md) it
  spawns all appear in it, with specialists in their own threads.
- **Always resumable.** Rejoin a session and the full history is restored
  instantly.

## Tradeoffs to be honest about

- It's a **live connection**: the experience is best with the session open.
  Background, unattended work is what [Triggers](08-triggers.md) are for.
- The agent does real things (writes files, calls tools), so the chat is a
  workspace, not just a Q&A box — worth setting expectations for new users.

## Sending a message and getting a streamed reply

The user's message is saved and shown immediately, then handed to the agent. As
the agent works, Tangent streams its activity and its answer back into the room
in real time.

```mermaid
sequenceDiagram
  autonumber
  actor User
  box rgb(232, 244, 255) Your browser
    participant UI as Chat UI
  end
  box rgb(235, 245, 235) Server
    participant Tangent as Tangent Server
    participant Agent as Prime agent
  end

  User->>UI: Type a message (+ optional files)
  activate UI
  UI->>Tangent: Send message
  activate Tangent
  Tangent->>UI: Echo message into the room
  Tangent->>Agent: Deliver the prompt
  deactivate Tangent
  activate Agent

  Note over Agent: Agent starts working

  Agent-->>Tangent: "Thinking…" / "Running a tool…"
  activate Tangent
  Tangent-->>UI: Live activity indicator
  deactivate Tangent

  loop Reply streams in
    Agent-->>Tangent: Next piece of the answer
    activate Tangent
    Tangent-->>UI: Append to the bubble
    deactivate Tangent
  end

  Agent-->>Tangent: Final answer
  deactivate Agent
  activate Tangent
  Tangent->>Tangent: Save to transcript
  Tangent-->>UI: Finalize message
  deactivate Tangent
  UI-->>User: Complete reply (text, artifacts, pages)
  deactivate UI
```

## Rejoining a session

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Chat UI
  participant Tangent as Tangent Server

  User->>UI: Open an existing session
  activate UI
  UI->>Tangent: Join the room
  activate Tangent
  Tangent-->>UI: Full chat history
  Tangent-->>UI: Sub-agent roster + active triggers
  deactivate Tangent
  UI-->>User: Conversation restored, ready to continue
  deactivate UI
```

## Where this shows up next

- See what the agent can build for you in [Artifacts](06-artifacts.md) and
  [Pages](07-pages.md).
- Watch the agent bring in helpers in
  [Sub-agent Orchestration](05-subagent-orchestration.md).
