/**
 * Wire contracts shared between the dev server and the web UI.
 *
 * Both `server/` and `src/` import these via the `@shared/*` path alias so the
 * REST payloads and Socket.IO event shapes never drift between the two sides.
 */

/** Lifecycle status of a session. Phase 1 only ever produces "created". */
export type SessionStatus = "created";

/**
 * Metadata about the Configuration Bundle a session was created from, surfaced
 * so the UI can show which preset a session uses. Derived from the bundle's
 * `tangent.yaml` at install time.
 */
export interface SessionConfigMeta {
  /** The bundle's stable slug id. */
  id: string;
  /** The bundle's human-readable name. */
  name: string;
  /** The bundle author's semver for this preset. */
  version: string;
  /** Relative icon path within the bundle, if any. */
  icon?: string;
}

/**
 * A Pi coding agent session. Each session owns a scoped "root" folder on disk
 * that a Pi worker will eventually run inside (Pi spawn is Phase 2).
 */
export interface Session {
  id: string;
  name: string;
  /** Absolute path to the session's scoped root folder. */
  rootPath: string;
  status: SessionStatus;
  /** Configuration Bundle this session was created from, when applicable. */
  config?: SessionConfigMeta;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

/**
 * Distinguishes the session's orchestrating Prime agent from the sub-agents it
 * spawns. Only present on agent authors. Drives client rendering (e.g. sub-agent
 * replies never carry a thinking process).
 */
export type AgentRole = "prime" | "subagent";

/** Author of a chat message. Chats assume multiple humans and agents. */
export interface ChatAuthor {
  id: string;
  kind: "human" | "agent";
  name: string;
  /** Only set when `kind` is `"agent"`. */
  agentRole?: AgentRole;
}

/**
 * The session's Prime coding agent. It is the only agent a human talks to and
 * the only one allowed to direct sub-agents. Shared across every session.
 */
export const PI_AGENT: ChatAuthor = {
  id: "prime",
  kind: "agent",
  name: "Prime",
  agentRole: "prime",
};

/** Lifecycle status of a sub-agent, surfaced in the session's agent roster. */
export type SubagentStatus = "active" | "completed" | "killed" | "error";

/** A sub-agent in a session's roster, as tracked for the UI sidebar. */
export interface SubagentInfo {
  /** Stable id; also used as the sub-agent's `ChatAuthor.id`. */
  id: string;
  name: string;
  status: SubagentStatus;
  /** Template the sub-agent was spawned from, if any. */
  template?: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/** A single chat message. `content` is markdown. */
export interface ChatMessage {
  id: string;
  sessionId: string;
  /**
   * The agent process this message belongs to: `"prime"` for the shared
   * human/Prime thread, or a sub-agent's id for that sub-agent's thread. Drives
   * which transcript the client buckets the message into.
   */
  conversationId: string;
  author: ChatAuthor;
  content: string;
  /**
   * The agent's reasoning (markdown), streamed before/alongside `content`.
   * Only present on agent replies that surfaced a thinking process.
   */
  thinking?: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export interface CreateSessionRequest {
  name?: string;
  /** Marketplace config id to create the session from (Phase 4). */
  configId?: string;
}

export interface UpdateSessionRequest {
  name?: string;
}

/** Payload sent by the client when joining a session's chat room. */
export interface ChatJoinPayload {
  sessionId: string;
}

/** Payload sent by the client to post a new chat message. */
export interface ChatMessagePayload {
  sessionId: string;
  author: ChatAuthor;
  content: string;
}

/** Streamed terminal output from a Pi worker. Reserved/stub for Phase 2. */
export interface TerminalDataPayload {
  sessionId: string;
  chunk: string;
}

/**
 * Emitted when the Pi agent begins a reply. Carries an empty-content
 * `ChatMessage` that the client appends and then fills in via deltas.
 */
export interface AgentStartPayload {
  message: ChatMessage;
}

/** A streamed chunk of the agent's reply, keyed by the message it extends. */
export interface AgentDeltaPayload {
  sessionId: string;
  messageId: string;
  delta: string;
}

/** A streamed chunk of the agent's reasoning, keyed by the message it extends. */
export interface AgentThinkingPayload {
  sessionId: string;
  messageId: string;
  delta: string;
}

/** Emitted when the agent finishes; carries the final, complete message. */
export interface AgentEndPayload {
  message: ChatMessage;
}

/** Emitted when the agent fails to produce (or finish) a reply. */
export interface AgentErrorPayload {
  sessionId: string;
  messageId?: string;
  message: string;
}

/** The kind of work an agent is currently doing, for the ephemeral indicator. */
export type AgentActivityKind = "thinking" | "tool";

/**
 * A transient snapshot of what an agent is doing between (or before) messages.
 * Rendered as an ephemeral spinner bubble and never persisted: it is replaced
 * as soon as the next message streams in, and cleared when the run ends.
 */
export interface AgentActivity {
  kind: AgentActivityKind;
  /** Human-readable description, e.g. "Thinking...", "Running grep". */
  label: string;
  /** The tool being executed, when `kind` is `"tool"`. */
  toolName?: string;
}

/**
 * Emitted as an agent's run-level state changes (start of run, tool calls,
 * between turns). `activity` is `null` when the run is idle or a message is
 * actively streaming (the streaming bubble is the visual in that case).
 */
export interface AgentActivityPayload {
  sessionId: string;
  conversationId: string;
  activity: AgentActivity | null;
}

/** Full sub-agent roster for a session, emitted on join and on reset. */
export interface SubagentRosterPayload {
  sessionId: string;
  subagents: SubagentInfo[];
}

/** A single sub-agent's spawn or status change. Upserted by `id` on the client. */
export interface SubagentUpdatePayload {
  sessionId: string;
  subagent: SubagentInfo;
}

/** Socket.IO event names shared by client and server. */
export const SocketEvents = {
  ChatJoin: "chat:join",
  ChatHistory: "chat:history",
  ChatMessage: "chat:message",
  TerminalData: "terminal:data",
  AgentStart: "agent:start",
  AgentDelta: "agent:delta",
  AgentThinking: "agent:thinking",
  AgentEnd: "agent:end",
  AgentError: "agent:error",
  AgentActivity: "agent:activity",
  SubagentRoster: "subagent:roster",
  SubagentUpdate: "subagent:update",
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];
