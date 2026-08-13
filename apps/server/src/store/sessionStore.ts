import {
  type AgentRole,
  type Capability,
  type ChatMessage,
  type ConnectorDescriptor,
  connectorFor,
  type ConnectorKind,
  type PinnedArtifact,
  type Session,
  type SessionConfigMeta,
  type SubagentHost,
  type SubagentStatus,
  type UpdateSessionRequest,
  type UserIdentity,
} from "@tangent/shared/contracts.ts";

/**
 * Persisted lifecycle status of a session agent — the same set as the wire
 * {@link SubagentStatus}, deliberately. Nothing is collapsed on the way to the
 * database any more: "finished its task" and "was terminated" are different
 * facts, and discarding one of them at every restart is what made a
 * participant's lifecycle unreadable as history.
 */
export type SessionAgentStatus = SubagentStatus;

/** The connector kind each legacy `host` label stood for. */
const CONNECTOR_KIND_BY_HOST: Record<SubagentHost, ConnectorKind> = {
  local: "pi-stdio",
  remote: "remote-env",
  external: "external-inbound",
};

/**
 * The connector a roster row's legacy `host` label describes. Used for rows
 * written before the connector columns existed, and as the default for a row
 * recorded without a descriptor.
 */
export function connectorFromHost(
  host: SubagentHost | undefined,
): ConnectorDescriptor {
  return connectorFor(host ? CONNECTOR_KIND_BY_HOST[host] : "pi-stdio");
}

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
  /**
   * The capabilities this participant holds, derived from `role`. Prime carries
   * `orchestrator`; a sub-agent carries none. Authority reads this rather than
   * comparing the id to a reserved constant.
   */
  capabilities: Capability[];
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
  /**
   * Which host runs the sub-agent: `local` (a `pi` child) or `remote` (a
   * connected remote environment). Defaults to `local` on legacy rows.
   *
   * @deprecated Read {@link SessionAgent.connector} instead.
   */
  host?: SubagentHost;
  /** The connector that runs the agent; derived from `host` on legacy rows. */
  connector: ConnectorDescriptor;
  /**
   * The Conversation this agent posts into as its home thread. A fresh id for an
   * agent created after 2.4 (so a Conversation id no longer names an agent); the
   * agent's own id for a legacy row, whose JSONL log is named that way and stays
   * valid because the `conversations` table maps it. Resolved from that table on
   * read, falling back to {@link SessionAgent.id}.
   */
  homeConversationId: string;
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
  /** Which host runs the sub-agent (`local` default, `remote`, or `external`). */
  host?: SubagentHost;
  /** The connector running the agent; omitted leaves the stored one in place. */
  connector?: ConnectorDescriptor;
  /**
   * The Conversation id to mint for this agent's home thread. Supplied by a
   * spawner that mints the id up front (so its roster update and the subscribe
   * that follows carry it); omitted for Prime and legacy revives, where the
   * store resolves-or-mints the mapping itself.
   */
  homeConversationId?: string;
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
  /**
   * One Conversation's messages, in `seq` order. The per-Conversation read the
   * room-per-Conversation transport uses to seed a single thread's history on
   * subscribe, rather than merging the whole session's transcript.
   */
  getConversationMessages(
    sessionId: string,
    conversationId: string,
  ): Promise<ChatMessage[]>;
  appendMessage(message: ChatMessage): Promise<void>;
  /**
   * Allocates the next `seq` in a Conversation. The single allocator: {@link
   * appendMessage} persists whatever it is handed, and `ChatMessage.seq` is
   * required, so no writer can skip this. Monotonic but not gap-free — a
   * streamed turn reserves its `seq` before its content exists, and a stream
   * that fails leaves the number spent.
   */
  nextSeq(sessionId: string, conversationId: string): Promise<number>;

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
  /**
   * Marks every `active` sub-agent row `detached`, returning how many changed.
   * Run once at boot: no process outlives the server, so such a row is a claim
   * about a participant that no longer exists. Terminal rows are history and
   * Prime rows belong to {@link
   * import("../pi/piAgentManager.ts").PiAgentManager.ensure}, so both are left
   * alone.
   */
  detachActiveSubagents(): Promise<number>;
  /**
   * Every sub-agent row hosted by one remote environment, across sessions, so a
   * reconnecting environment can have its roster replayed. Rows written before
   * the connector columns existed carry no environment id and never match.
   */
  listAgentsForEnvironment(environmentId: string): Promise<SessionAgent[]>;

  /** Records that `userKey` viewed `sessionId` at `at` (ISO-8601), upserting. */
  markViewed(sessionId: string, userKey: string, at: string): Promise<void>;
  /** Returns `sessionId -> lastViewedAt` for everything `userKey` has opened. */
  getLastViewedMap(userKey: string): Promise<Map<string, string>>;
}
