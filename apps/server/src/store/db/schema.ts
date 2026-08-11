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
    /** `active` | `killed`. */
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
     * Which host runs the agent: `local` (a `pi` child), `remote` (a
     * connected remote environment), or `external` (a tab driven by a bundle
     * tool). Defaults to `local`; only `local` sub-agents are revived after a
     * restart.
     */
    host: text("host").notNull().default("local"),
    /**
     * The agent's connector facets (`ConnectorDescriptor`), backfilled from
     * `host`. Null on rows written before they existed, which the store reads
     * back through `host`. `spawnAuthority` is not stored: it follows from the
     * kind, and persisting it would let the two disagree.
     */
    connectorKind: text("connector_kind"),
    connectorLifecycle: text("connector_lifecycle"),
    connectorEnvironmentId: text("connector_environment_id"),
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
