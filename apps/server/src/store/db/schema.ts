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
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("session_agents_session_id").on(table.sessionId, table.id),
    index("session_agents_session_idx").on(table.sessionId),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type SessionAssetRow = typeof sessionAssets.$inferSelect;
export type SessionAgentRow = typeof sessionAgents.$inferSelect;
