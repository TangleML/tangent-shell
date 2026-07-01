import type {
  AgentRole,
  ChatMessage,
  PinnedArtifact,
  Session,
  SessionConfigMeta,
  UpdateSessionRequest,
  UserIdentity,
} from "@tangent/shared/contracts.ts";

/**
 * Persisted lifecycle status of a session agent. `error` is distinct so the
 * sessions list can flag "needs attention"; completions and kills both collapse
 * to `killed`, and only `active` agents are revived on restart.
 */
export type SessionAgentStatus = "active" | "killed" | "error";

/**
 * Input accepted by {@link SessionStore.createSession}: the public wire request
 * plus the server-resolved {@link UserIdentity} (from the creator's Oktasso JWT),
 * which is never part of the client-supplied body.
 */
export interface CreateSessionParams {
  name?: string;
  user?: UserIdentity;
}

/**
 * A persisted agent in a session's roster (the orchestrating Prime plus every
 * sub-agent it spawned), durable across restarts. Distinct from the wire
 * {@link import("@tangent/shared/contracts.ts").SubagentInfo} so it can also carry
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
  /** Tool allowlist the sub-agent was spawned with (for a faithful revive). */
  tools?: string[];
  /** The sub-agent's resolved appended system prompt (for a faithful revive). */
  systemPrompt?: string;
  /** Whether the sub-agent's replies auto-relay back to Prime. Defaults true. */
  autoRelayToPrime?: boolean;
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
  /** Tool allowlist the sub-agent was spawned with (for a faithful revive). */
  tools?: string[];
  /** The sub-agent's resolved appended system prompt (for a faithful revive). */
  systemPrompt?: string;
  /** Whether the sub-agent's replies auto-relay back to Prime. Defaults true. */
  autoRelayToPrime?: boolean;
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
  createSession(input: CreateSessionParams): Promise<Session>;
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

  /** Records that `userKey` viewed `sessionId` at `at` (ISO-8601), upserting. */
  markViewed(sessionId: string, userKey: string, at: string): Promise<void>;
  /** Returns `sessionId -> lastViewedAt` for everything `userKey` has opened. */
  getLastViewedMap(userKey: string): Promise<Map<string, string>>;
}
