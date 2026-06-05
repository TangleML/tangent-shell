/**
 * Wire contracts shared between the dev server and the web UI.
 *
 * Both `server/` and `src/` import these via the `@shared/*` path alias so the
 * REST payloads and Socket.IO event shapes never drift between the two sides.
 */

/** Lifecycle status of a session. Phase 1 only ever produces "created". */
export type SessionStatus = "created";

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
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

/** Author of a chat message. Chats assume multiple humans and agents. */
export interface ChatAuthor {
  id: string;
  kind: "human" | "agent";
  name: string;
}

/** The Pi coding agent's identity, shared across every session's replies. */
export const PI_AGENT: ChatAuthor = {
  id: "pi",
  kind: "agent",
  name: "Pi",
};

/** A single chat message. `content` is markdown. */
export interface ChatMessage {
  id: string;
  sessionId: string;
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
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];
