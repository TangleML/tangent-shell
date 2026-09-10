import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema for the session metadata DB (`tangent.db`).
 *
 * This holds queryable, relational state only: sessions, the assets a user
 * pinned per session, and the roster of agents (prime + subagents) created in
 * a session. Chat history is deliberately NOT a table here; it lives as
 * append-only JSONL files inside each session's `.tangent/chats/` folder (see
 * `chatLog.ts`).
 *
 * Schema changes are applied exclusively through drizzle-kit migrations; never
 * create or alter tables ad-hoc in application code.
 */

/** One Pi coding agent session. Mirrors the `Session` wire contract. */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Absolute path to the session's scoped root folder on disk. */
  rootPath: text("root_path").notNull(),
  status: text("status").notNull().default("created"),
  /** Serialized `SessionConfigMeta` (the bundle this session was created from). */
  config: text("config"),
  /** Serialized `UserIdentity` (the human who created the session), if resolved. */
  userIdentity: text("user_identity"),
  /** Whether the session is archived (hidden from the default list). */
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * An asset (pinned artifact) a user or agent pinned for quick access, scoped to
 * a session. The autoincrement `id` preserves oldest-first ordering; re-pinning
 * a known `path` updates the title in place (keeping its id) via the
 * `(session_id, path)` uniqueness.
 */
export const sessionAssets = sqliteTable(
  "session_assets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Path relative to the session root, e.g. `artifacts/report.html`. */
    path: text("path").notNull(),
    title: text("title").notNull(),
    pinnedAt: text("pinned_at").notNull(),
  },
  (table) => [
    unique("session_assets_session_path").on(table.sessionId, table.path),
    index("session_assets_session_idx").on(table.sessionId),
  ],
);

/**
 * The roster of agents created in a session (prime + every spawned subagent),
 * persisted so it survives a server restart instead of living only in
 * `PiAgentManager`'s memory. Deliberately tracks no message counts/timestamps
 * (those stay decoupled from the chat hot path and can be derived from the
 * JSONL files when needed).
 */
export const sessionAgents = sqliteTable(
  "session_agents",
  {
    /** Agent id: `prime` for the prime agent, the subagent uuid otherwise. */
    id: text("id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** `prime` | `subagent`. */
    role: text("role").notNull(),
    name: text("name").notNull(),
    /** The agent's task/description, when known. */
    purpose: text("purpose"),
    /** `active` | `detached` | `completed` | `killed` | `error`. */
    status: text("status").notNull().default("active"),
    model: text("model"),
    thinkingDepth: text("thinking_depth"),
    /** Template the agent was spawned from, if any. */
    template: text("template"),
    /**
     * JSON-encoded tool allowlist the sub-agent was spawned with, persisted so a
     * revive can rebuild the exact `--tools` set (Prime's tools are derived from
     * its config, so this stays null for Prime).
     */
    tools: text("tools"),
    /**
     * The sub-agent's resolved appended system prompt, persisted so an inline
     * (template-less) sub-agent can be re-spawned faithfully after a restart.
     */
    systemPrompt: text("system_prompt"),
    /**
     * Whether the sub-agent's finalized replies auto-relay back to Prime.
     * Defaults to true; trigger-owned sub-agents persist false so a revive keeps
     * them reacting in isolation.
     */
    autoRelayToPrime: integer("auto_relay_to_prime", { mode: "boolean" })
      .notNull()
      .default(true),
    /**
     * Which host runs the agent: `local` (a `pi` child) or `remote` (a
     * connected remote environment). Defaults to `local`.
     */
    host: text("host").notNull().default("local"),
    /**
     * The agent's connector facets (`ConnectorDescriptor`), backfilled from
     * `host`. Null on rows written before they existed, which the store reads
     * back through `host`. `spawnAuthority` and `credentialScheme` are not
     * stored: both follow from the kind, and persisting them would let the two
     * disagree.
     */
    connectorKind: text("connector_kind"),
    connectorLifecycle: text("connector_lifecycle"),
    connectorEnvironmentId: text("connector_environment_id"),
    /**
     * Where a dialling connector reaches this participant — an A2A peer's Agent
     * Card base URL. Null for every participant that connects to Tangent rather
     * than the other way round.
     */
    connectorEndpointUrl: text("connector_endpoint_url"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("session_agents_session_id").on(table.sessionId, table.id),
    index("session_agents_session_idx").on(table.sessionId),
  ],
);

/**
 * One unit of work by one participant: what a stream of agent events is
 * attributable to, and what cancellation acts on. Runs are serial per
 * participant, so `(session_id, participant_id)` with `status = 'running'`
 * identifies at most one row.
 */
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** The participant doing the work (an agent id today). */
    participantId: text("participant_id").notNull(),
    /** The conversation this run's messages land in by default. */
    homeConversationId: text("home_conversation_id").notNull(),
    /** `running` | `completed` | `cancelled` | `failed`. */
    status: text("status").notNull().default("running"),
    /** `reaction` | `schedule` | `webhook` | `tool`. */
    ingress: text("ingress").notNull(),
    /** The far side's own id for this work (an Aquifer World session id). */
    externalId: text("external_id"),
    /** Connector-private resume cursor (the Aquifer drain's `lastSeq`). */
    cursor: text("cursor"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    /** Set when the run settled; null while it is `running`. */
    endedAt: text("ended_at"),
  },
  (table) => [
    index("runs_session_idx").on(table.sessionId),
    index("runs_session_participant_idx").on(
      table.sessionId,
      table.participantId,
    ),
  ],
);

/**
 * Per-conversation `seq` counter: the write authority that gives a Conversation
 * an order rather than a race. Rows are created on first allocation, seeded
 * above whatever the conversation's existing JSONL log already occupies, so
 * numbering never collides with messages persisted before `seq` existed.
 *
 * The embryo of a full Conversation entity — it holds only the counter today.
 */
export const conversations = sqliteTable(
  "conversations",
  {
    /**
     * Conversation id. A fresh uuid for a Conversation minted after 2.4; an
     * agent id (`prime` or a sub-agent uuid) for a legacy row, whose JSONL log
     * is named the same and stays valid because {@link conversations.agentId}
     * maps it. No longer names an agent for new Conversations.
     */
    id: text("id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /**
     * The participant that owns this Conversation as its home thread (an agent
     * id). The mapping that lets a Conversation id be distinct from the agent's
     * id: a message an agent produces lands in the Conversation whose `agentId`
     * is that agent, and a legacy row where `id == agentId` maps to itself.
     * Null only until the 0013 backfill sets `agent_id = id`.
     */
    agentId: text("agent_id"),
    /** The next `seq` to hand out; incremented as each is allocated. */
    nextSeq: integer("next_seq").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("conversations_session_id").on(table.sessionId, table.id),
    index("conversations_session_idx").on(table.sessionId),
    index("conversations_session_agent_idx").on(table.sessionId, table.agentId),
  ],
);

/**
 * A participant's standing in one Conversation: whether it reacts to what is
 * posted there, what work arriving through it counts as, and how much of the
 * transcript it sees. The successor to `session_agents.auto_relay_to_prime`,
 * which was a one-bit approximation of the reaction predicate.
 *
 * `session_id` is here because a participant or conversation id is only unique
 * within a session.
 */
export const memberships = sqliteTable(
  "memberships",
  {
    /** The participant that holds the membership (an agent id today). */
    participantId: text("participant_id").notNull(),
    /** The conversation it is a member of (an agent id today). */
    conversationId: text("conversation_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** A `ReactionSpec`: `+`-joined preset names, read as a disjunction. */
    reaction: text("reaction").notNull().default("never"),
    /** `reaction` | `schedule` | `webhook` | `tool`. */
    ingress: text("ingress").notNull().default("reaction"),
    /** `queue` | `coalesce` | `preempt` | `reject`: what a wake does mid-Run. */
    admission: text("admission").notNull().default("queue"),
    /** `shared` | `summarized` | `opaque`. */
    transcriptVisibility: text("transcript_visibility")
      .notNull()
      .default("shared"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("memberships_session_conversation_participant").on(
      table.sessionId,
      table.conversationId,
      table.participantId,
    ),
    index("memberships_session_conversation_idx").on(
      table.sessionId,
      table.conversationId,
    ),
  ],
);

/**
 * A session-scoped actor identity: the unification of today's `ChatAuthor` and
 * `SubagentInfo`. `kind` describes role only (`human` | `agent` | `automation`);
 * authority rides on `capabilities` (a JSON array — Prime holds `orchestrator`),
 * not on a reserved id. The connector facets that used to live on
 * `session_agents` move here; the agent-only columns (`role`, `model`,
 * `template`, `tools`, `system_prompt`, `auto_relay_to_prime`, `host`,
 * `purpose`, `status`) become a per-kind `agent_payload` blob rather than
 * participant-shaped columns.
 *
 * `session_agents` stays the write authority for this PR; these rows are
 * backfilled from it and kept in sync on record, and derived read-through for a
 * session the backfill never touched. A later cleanup drops `session_agents`.
 */
export const participants = sqliteTable(
  "participants",
  {
    /** Participant id: `prime`, or a sub-agent uuid. Same string as today. */
    id: text("id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** `human` | `agent` | `automation`. */
    kind: text("kind").notNull(),
    displayName: text("display_name").notNull(),
    /** JSON-encoded `Capability[]` (e.g. `["orchestrator"]`); `[]` for none. */
    capabilities: text("capabilities").notNull().default("[]"),
    /** `connected` | `away` | `detached`. A default until presence lifecycle. */
    presence: text("presence").notNull().default("connected"),
    connectorKind: text("connector_kind"),
    connectorLifecycle: text("connector_lifecycle"),
    connectorEnvironmentId: text("connector_environment_id"),
    connectorEndpointUrl: text("connector_endpoint_url"),
    /**
     * JSON-encoded kind-specific payload. For an agent: `role`, `model`,
     * `thinkingDepth`, `template`, `tools`, `systemPrompt`, `autoRelayToPrime`,
     * `host`, `purpose`, `status` — everything that was an agent-only column.
     */
    agentPayload: text("agent_payload"),
    /**
     * ISO-8601 timestamp set when a Participant is revoked from the session. A
     * revoked row is retained so a transcript keeps its attributions and a
     * person who left is not an unresolvable id; null means active.
     */
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("participants_session_id").on(table.sessionId, table.id),
    index("participants_session_idx").on(table.sessionId),
  ],
);

/**
 * A catalogued piece of content in a session, regardless of which connector or
 * mechanism produced it: a pinned `artifact`, a human `attachment`, a `memory`
 * document, or a workspace `file`. The unification of `session_assets`,
 * `Attachment` (embedded in JSONL), and the memory files, so "what content does
 * this session hold, and who authored it" has one answer.
 *
 * The bytes stay where they are (on disk under the session root, or in a memory
 * markdown file); this row is the catalog entry that points at them by `uri`.
 * Additive for this PR — the mechanisms above stay the write authority and
 * mirror into this table; a later cleanup can fold them onto it.
 */
export const resources = sqliteTable(
  "resources",
  {
    /** Resource id: a fresh uuid, or an opaque id for a backfilled row. */
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** `file` | `memory` | `attachment` | `artifact`. */
    kind: text("kind").notNull(),
    /** Display name / title. */
    name: text("name").notNull(),
    /**
     * Where the content lives: a path relative to the session root (e.g.
     * `artifacts/report.html`, `uploads/data.csv`) or a `memory://session` /
     * `memory://global` scheme for a memory document.
     */
    uri: text("uri").notNull(),
    /** The participant that produced it; null for a backfilled/legacy row. */
    authorParticipantId: text("author_participant_id"),
    /** Kind-specific JSON blob (e.g. `contentType`, `size`, `scope`). */
    meta: text("meta"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("resources_session_uri").on(table.sessionId, table.uri),
    index("resources_session_idx").on(table.sessionId),
  ],
);

/**
 * A {@link resources} entry surfaced in one Conversation: the answer to "should
 * this content appear in this thread, regardless of which connector produced
 * it". A reference governs surfacing and citation, not filesystem access —
 * agents read the workspace through tools against the session root and a
 * reference does not interpose on a read or write.
 *
 * `session_id` is here because a conversation id is only unique within a
 * session (as on `memberships`), and for the cascade delete.
 */
export const resourceReferences = sqliteTable(
  "resource_references",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("resource_references_conversation_resource").on(
      table.conversationId,
      table.resourceId,
    ),
    index("resource_references_conversation_idx").on(
      table.sessionId,
      table.conversationId,
    ),
  ],
);

/**
 * Which of a Conversation's {@link resourceReferences} one Participant may be
 * shown and may cite — the per-Membership grant of unified-model §4.4. Keyed by
 * `(conversation_id, participant_id, resource_id)` because a grant refines a
 * `(Participant, Conversation)` Membership's view of a single resource.
 *
 * Default-permissive: a Membership with no rows here surfaces the whole
 * reference set, so an empty table changes nothing. This is a surfacing and
 * citation decision, not a filesystem gate (§10), and delivery does not yet
 * consult it — enforcement lands with the multi-party transcript UI (2.6).
 */
export const resourceGrants = sqliteTable(
  "resource_grants",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull(),
    participantId: text("participant_id").notNull(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("resource_grants_conversation_participant_resource").on(
      table.conversationId,
      table.participantId,
      table.resourceId,
    ),
    index("resource_grants_conversation_participant_idx").on(
      table.sessionId,
      table.conversationId,
      table.participantId,
    ),
  ],
);

/**
 * The durable state of an installed Reactor (unified-model §9.3): a stateful
 * reaction that folds a running `state` over the Messages in its `scope` and
 * wakes its participant when `ready`. The engine owns this state rather than a
 * predicate's closure, which is precisely what makes it serializable, listable
 * and replayable — the workflow view reads it without executing anything.
 *
 * `scope` and `spec` are JSON blobs (a {@link ReactorScope} / {@link ReactorSpec});
 * `scope_key` is a deterministic digest of the scope so reinstalling the same
 * set upserts rather than stacking duplicate joins. Additive and empty for every
 * session written before Phase 3 — no backfill, because no such row has a Reactor.
 */
export const reactorState = sqliteTable(
  "reactor_state",
  {
    /** Reactor id: a fresh uuid. */
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** The participant this wakes — the installer, holder of every scope membership. */
    participantId: text("participant_id").notNull(),
    /** The Conversation the Run it opens belongs to. */
    homeConversationId: text("home_conversation_id").notNull(),
    /** A deterministic digest of `scope`, so the same scope upserts in place. */
    scopeKey: text("scope_key").notNull(),
    /** JSON-encoded {@link ReactorSpec}. */
    spec: text("spec").notNull(),
    /** JSON-encoded {@link ReactorScope}. */
    scope: text("scope").notNull(),
    /** JSON-encoded {@link ReactorState} — the running fold. */
    state: text("state").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("reactor_state_session_participant_scope").on(
      table.sessionId,
      table.participantId,
      table.scopeKey,
    ),
    index("reactor_state_session_idx").on(table.sessionId),
    index("reactor_state_session_participant_idx").on(
      table.sessionId,
      table.participantId,
    ),
  ],
);

/** When each user last opened a session. `user_key` is the email, or `local`. */
export const sessionViews = sqliteTable(
  "session_views",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userKey: text("user_key").notNull(),
    lastViewedAt: text("last_viewed_at").notNull(),
  },
  (table) => [
    unique("session_views_session_user").on(table.sessionId, table.userKey),
    index("session_views_session_idx").on(table.sessionId),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type SessionAssetRow = typeof sessionAssets.$inferSelect;
export type SessionAgentRow = typeof sessionAgents.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;
export type ResourceRow = typeof resources.$inferSelect;
export type ResourceReferenceRow = typeof resourceReferences.$inferSelect;
export type ResourceGrantRow = typeof resourceGrants.$inferSelect;
export type ReactorStateRow = typeof reactorState.$inferSelect;
