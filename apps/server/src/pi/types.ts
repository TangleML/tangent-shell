import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type {
  AgentActivity,
  AgentRole,
  ChatAuthor,
  RunId,
  RunIngress,
  SessionRunStatus,
  SubagentInfo,
  SubagentStatus,
  UserIdentity,
} from "@tangent/shared/contracts.ts";

import type { AgentConfig, ResolvedSessionConfig } from "./agentConfig.ts";

/** Fixed id of the session's Prime agent (one per session). */
export const PRIME_AGENT_ID = "prime";

/**
 * The streamed body of an {@link AgentEvent}, before run attribution.
 * `messageId` correlates the `start`/`delta`/`end` of a single assistant
 * message so the client can build it up incrementally.
 */
type AgentEventBody =
  | { type: "start"; messageId: string }
  | { type: "delta"; messageId: string; delta: string }
  | { type: "thinking"; messageId: string; delta: string }
  | {
      type: "end";
      messageId: string;
      content: string;
      thinking: string;
      /**
       * Set when the turn was cut short by a cancellation. Its content is
       * history, not a request, so it is persisted but provokes no reaction.
       */
      aborted?: boolean;
    }
  | { type: "error"; messageId?: string; message: string }
  | { type: "activity"; activity: AgentActivity | null }
  | { type: "queue"; steering: string[]; followUp: string[] };

/**
 * Event surfaced to the chat layer as an agent streams a reply, attributed to
 * the {@link Run} that produced it. Deltas and thinking stay Run events rather
 * than Messages — only finalized content is persisted as a Message.
 *
 * `runId` is optional because a connector can relay a stream the server never
 * opened a Run for (an event about a participant that no longer exists, or a
 * far end that predates run attribution).
 */
export type AgentEvent = AgentEventBody & { runId?: RunId };

/** Identifies which agent in a session produced an {@link AgentEvent}. */
export interface AgentDescriptor {
  agentId: string;
  role: AgentRole;
  name: string;
  /**
   * The Conversation the agent's messages land in — decoupled from
   * {@link AgentDescriptor.agentId} so a Conversation id no longer names an
   * agent. Where the event handler tags the message and picks its room.
   */
  homeConversationId: string;
}

export type AgentEventHandler = (
  sessionId: string,
  agent: AgentDescriptor,
  event: AgentEvent,
) => void;

export type SubagentUpdateHandler = (
  sessionId: string,
  subagent: SubagentInfo,
) => void;

/** A Message a transport asks the conversation layer to post. */
export interface PostedMessage {
  sessionId: string;
  /** The Conversation it lands in. */
  conversationId: string;
  /** Who it is attributed to. */
  author: ChatAuthor;
  content: string;
  /** Participants it addresses by id, which is how a wake is requested. */
  mentions?: string[];
  /** What created it, when a reaction did not. */
  ingress?: RunIngress;
}

/**
 * Posts a Message into a Conversation. A transport reaches for this to say what
 * happened — a report it received, a refusal it has to explain — never to route
 * work: who wakes on a Message is the fan-out engine's decision.
 */
export type AgentMessageHandler = (message: PostedMessage) => void;

/** Relays a session's live run status change to the shared sessions lobby. */
export type SessionStatusHandler = (
  sessionId: string,
  status: SessionRunStatus,
) => void;

/**
 * Where a participant's events go: whatever holds participants — the local Pi
 * manager, the remote-env gateway, an external tab — reports through this one
 * interface, so a conversation renders and persists the same regardless of which
 * transport produced it.
 */
export interface ConversationEventSink {
  /** Relays an agent's streaming events to the session's room. */
  onAgentEvent: AgentEventHandler;
  /** Relays a sub-agent's spawn or status change to the session's room. */
  onSubagentUpdate: SubagentUpdateHandler;
  /** Posts a Message into a Conversation. */
  onAgentMessage: AgentMessageHandler;
  /** Broadcasts a session's live run status change to the sessions lobby. */
  onSessionStatus: SessionStatusHandler;
}

export interface AgentProcess {
  agentId: string;
  role: AgentRole;
  name: string;
  template?: string;
  /**
   * The Conversation this agent posts into. Minted fresh when the agent is
   * spawned (Prime's resolved from the store, a sub-agent's from its spawner) so
   * it is distinct from {@link AgentProcess.agentId}; falls back to the agent id
   * for a legacy agent whose transcript is keyed that way.
   */
  homeConversationId: string;
  status: SubagentStatus;
  createdAt: string;
  /**
   * The resolved config this agent was spawned with (tools, prompt, model,
   * thinking depth). Retained so a model/thinking change can respawn the
   * process with the same tools and prompt but new model settings.
   */
  config: AgentConfig;
  child: ChildProcessWithoutNullStreams;
  busy: boolean;
  /**
   * Set when the current run was aborted by the user (via the `abort` RPC
   * command). Carried onto the finalized `end` event so a half-finished reply is
   * persisted without waking anyone, then reset for the next run.
   */
  aborted: boolean;
  /** The id of the assistant message currently streaming, if any. */
  currentMessageId: string | null;
  /**
   * Whether a `start` event was already emitted for {@link currentMessageId}.
   * Start is deferred until the first text/thinking delta so tool-only
   * assistant messages (no visible content) never open an empty bubble.
   */
  startEmitted: boolean;
  /** Accumulated text for the in-flight assistant message. */
  accum: string;
  /** Accumulated reasoning for the in-flight assistant message. */
  thinkingAccum: string;
  /** Text of the most recently finalized assistant message in this run. */
  lastFinalContent: string;
  /**
   * Whether Prime reacts to this agent's finalized replies. Retained so a spawn
   * can persist it and a revive can restore it; what it now describes is Prime's
   * Membership in this agent's Conversation, which is what actually decides.
   */
  autoRelayToPrime: boolean;
  /**
   * The agent's most recent run-level activity (a running tool or "thinking"),
   * or `null` when idle / a message is actively streaming. Retained so a client
   * joining mid-run can replay the current activity and not just see it go blank
   * after a page reload.
   */
  lastActivity: AgentActivity | null;
  /**
   * Set just before a deliberate `child.kill()` (model change, explicit
   * kill, dispose) so the supervisor's exit handler treats the exit as expected
   * and does NOT auto-respawn the process.
   */
  intentionalKill: boolean;
  /**
   * How many times the supervisor has auto-respawned this slot within the
   * current rolling window. Carried forward across respawns so a crash loop is
   * bounded; reset once the process survives past the window.
   */
  restartCount: number;
  /** Epoch ms of the last supervised respawn, or `null` if never respawned. */
  lastRestartAt: number | null;
}

export interface SessionAgents {
  rootPath: string;
  agents: Map<string, AgentProcess>;
  /**
   * Per-session config resolved from a Configuration Bundle, captured when the
   * session's Prime is first spawned. Absent for sessions created without a
   * bundle, which fall back to the server's global config.
   */
  config?: ResolvedSessionConfig;
  /**
   * The human who owns the session, resolved from their Oktasso JWT. Captured
   * so every agent's system prompt can be told who it's helping. Absent for
   * unauthenticated sessions.
   */
  user?: UserIdentity;
}

/** A single delta payload nested inside a `message_update` event. */
export interface AssistantDelta {
  type?: string;
  delta?: string;
}

/**
 * A parsed line from a Pi process's stdout (JSONL RPC stream). Kept as a flat
 * shape (rather than a discriminated union) because the `type` field comes
 * straight from JSON and may carry events we don't model; the dispatcher
 * switches on `type` and ignores unknown ones.
 */
export interface PiStdoutEvent {
  type?: string;
  assistantMessageEvent?: AssistantDelta;
  messages?: unknown;
  /** Present on `message_start` / `message_update` / `message_end` events. */
  message?: { role?: string; content?: unknown };
  /** Present on `tool_execution_*` events. */
  toolName?: string;
  /** Present on `tool_execution_start` / `tool_execution_update` events. */
  args?: unknown;
  /** Present on `tool_execution_end` events. */
  isError?: boolean;
  /** Present on `queue_update` events: pending steering messages. */
  steering?: unknown;
  /** Present on `queue_update` events: pending follow-up messages. */
  followUp?: unknown;
}
