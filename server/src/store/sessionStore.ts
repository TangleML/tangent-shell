import type {
  AgentRole,
  ChatMessage,
  CreateSessionRequest,
  PinnedArtifact,
  Session,
  SessionConfigMeta,
  UpdateSessionRequest,
} from "@shared/contracts.ts";

/** Persisted lifecycle status of a session agent. */
export type SessionAgentStatus = "active" | "killed";

/**
 * A persisted agent in a session's roster (the orchestrating Prime plus every
 * sub-agent it spawned), durable across restarts. Distinct from the wire
 * {@link import("@shared/contracts.ts").SubagentInfo} so it can also carry
 * Prime and server-side fields (purpose, model, thinking depth).
 */
export interface SessionAgent {
  id: string;
  sessionId: string;
  role: AgentRole;
  name: string;
  /** The agent's task/description, when known. */
  purpose?: string;
  status: SessionAgentStatus;
  model?: string;
  thinkingDepth?: string;
  /** Template the agent was spawned from, if any. */
  template?: string;
  createdAt: string;
}

/** Fields accepted when recording (upserting) a session agent. */
export interface RecordAgentInput {
  id: string;
  role: AgentRole;
  name: string;
  purpose?: string;
  /** Defaults to `"active"`. */
  status?: SessionAgentStatus;
  model?: string;
  thinkingDepth?: string;
  template?: string;
}

/**
 * Storage abstraction for sessions and their chat history.
 *
 * Metadata (sessions, pinned assets, the agent roster) lives in SQLite; chat
 * history lives as per-conversation JSONL files on disk. Everything depends on
 * this interface so the implementation can be swapped without touching the
 * routes or socket handlers.
 */
export interface SessionStore {
  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | undefined>;
  createSession(input: CreateSessionRequest): Promise<Session>;
  updateSession(
    id: string,
    input: UpdateSessionRequest,
  ): Promise<Session | undefined>;
  /** Records the Configuration Bundle a session was created from. */
  attachConfig(
    id: string,
    config: SessionConfigMeta,
  ): Promise<Session | undefined>;
  deleteSession(id: string): Promise<boolean>;

  getMessages(sessionId: string): Promise<ChatMessage[]>;
  appendMessage(message: ChatMessage): Promise<void>;

  /** Returns the session's pinned artifacts, oldest first. */
  getArtifacts(sessionId: string): Promise<PinnedArtifact[]>;
  /**
   * Pins an artifact (deduped by `path`) and returns the updated list. Re-pinning
   * an existing `path` refreshes its title without creating a duplicate.
   */
  pinArtifact(
    sessionId: string,
    artifact: { path: string; title: string },
  ): Promise<PinnedArtifact[]>;
  /** Unpins an artifact by `path` and returns the updated list. */
  unpinArtifact(sessionId: string, path: string): Promise<PinnedArtifact[]>;

  /**
   * Records (upserts) an agent in a session's roster, keyed by `(sessionId,
   * id)`. Re-recording a known agent refreshes its mutable fields.
   */
  recordAgent(
    sessionId: string,
    agent: RecordAgentInput,
  ): Promise<SessionAgent>;
  /** Flips an agent's status (e.g. `active` -> `killed`). No-op if unknown. */
  setAgentStatus(
    sessionId: string,
    agentId: string,
    status: SessionAgentStatus,
  ): Promise<void>;
  /** Lists a session's agents (Prime first), oldest first. */
  listAgents(sessionId: string): Promise<SessionAgent[]>;
}
