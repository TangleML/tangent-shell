import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  type AgentRole,
  type ChatMessage,
  type ConnectorDescriptor,
  connectorFor,
  type ConnectorKind,
  type ConnectorLifecycle,
  type PinnedArtifact,
  type Session,
  type SessionConfigMeta,
  type SubagentHost,
  type UpdateSessionRequest,
  type UserIdentity,
} from "@tangent/shared/contracts.ts";
import { and, asc, count, eq } from "drizzle-orm";

import { ARTIFACTS_DIRNAME, SESSIONS_ROOT } from "../config.ts";
import {
  appendMessage as appendChatMessage,
  highestSeq,
  readAllMessages,
} from "./chatLog.ts";
import type { Db } from "./db/client.ts";
import {
  conversations,
  type SessionAgentRow,
  sessionAgents,
  sessionAssets,
  type SessionRow,
  sessions,
  sessionViews,
} from "./db/schema.ts";
import {
  connectorFromHost,
  type CreateSessionParams,
  type RecordAgentInput,
  type SessionAgent,
  type SessionAgentStatus,
  type SessionStore,
} from "./sessionStore.ts";

/** Id of the orchestrating Prime agent (mirrors `pi/types.ts`). */
const PRIME_AGENT_ID = "prime";

/** Maps a sessions row onto the wire {@link Session}, parsing the config JSON. */
function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.rootPath,
    status: row.status as Session["status"],
    config: row.config
      ? (JSON.parse(row.config) as SessionConfigMeta)
      : undefined,
    user: row.userIdentity
      ? (JSON.parse(row.userIdentity) as UserIdentity)
      : undefined,
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Reads a row's connector facets, falling back to the legacy `host` label for
 * rows written before the connector columns existed.
 */
function toConnector(row: SessionAgentRow): ConnectorDescriptor {
  if (!row.connectorKind) return connectorFromHost(row.host as SubagentHost);
  return {
    ...connectorFor(row.connectorKind as ConnectorKind),
    ...(row.connectorLifecycle
      ? { lifecycle: row.connectorLifecycle as ConnectorLifecycle }
      : {}),
    ...(row.connectorEnvironmentId
      ? { environmentId: row.connectorEnvironmentId }
      : {}),
  };
}

/** The connector columns a record-agent input writes; omitted leaves them as is. */
function connectorColumns(connector: ConnectorDescriptor | undefined) {
  return {
    connectorKind: connector?.kind,
    connectorLifecycle: connector?.lifecycle,
    connectorEnvironmentId: connector?.environmentId,
  };
}

/** Maps a session_agents row onto the {@link SessionAgent} domain type. */
function toAgent(row: SessionAgentRow): SessionAgent {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as AgentRole,
    name: row.name,
    purpose: row.purpose ?? undefined,
    status: row.status as SessionAgentStatus,
    model: row.model ?? undefined,
    thinkingDepth: row.thinkingDepth ?? undefined,
    template: row.template ?? undefined,
    tools: parseTools(row.tools),
    systemPrompt: row.systemPrompt ?? undefined,
    autoRelayToPrime: row.autoRelayToPrime,
    host: row.host as SubagentHost,
    connector: toConnector(row),
    createdAt: row.createdAt,
  };
}

/** Parses the JSON-encoded `tools` column into a string array, else undefined. */
function parseTools(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * SQLite-backed {@link SessionStore}. Session, asset, and agent-roster metadata
 * live in the Drizzle-managed DB; chat history lives as per-conversation JSONL
 * files inside each session's folder (see `chatLog.ts`), enumerated by readdir
 * so the chat hot path never touches the DB.
 */
export class SqliteSessionStore implements SessionStore {
  /** Caches sessionId -> rootPath so `appendMessage` avoids a DB read per line. */
  private readonly rootPaths = new Map<string, string>();
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async listSessions(): Promise<Session[]> {
    const rows = this.db
      .select()
      .from(sessions)
      .orderBy(asc(sessions.createdAt))
      .all();
    return rows.map(toSession);
  }

  async getSession(id: string): Promise<Session | undefined> {
    const row = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .get();
    if (!row) return undefined;
    this.rootPaths.set(row.id, row.rootPath);
    return toSession(row);
  }

  async createSession(input: CreateSessionParams): Promise<Session> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const rootPath = path.join(SESSIONS_ROOT, id);

    // Each session is connected to a freshly created scoped "root" folder, with
    // an `artifacts/` subfolder agents write user-facing outputs into and the
    // file API serves over HTTP.
    await mkdir(rootPath, { recursive: true });
    await mkdir(path.join(rootPath, ARTIFACTS_DIRNAME), { recursive: true });

    const [{ value: existing }] = this.db
      .select({ value: count() })
      .from(sessions)
      .all();

    const session: Session = {
      id,
      name: input.name?.trim() || `Session ${existing + 1}`,
      rootPath,
      status: "created",
      user: input.user,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .insert(sessions)
      .values({
        id: session.id,
        name: session.name,
        rootPath: session.rootPath,
        status: session.status,
        userIdentity: session.user ? JSON.stringify(session.user) : null,
        archived: session.archived,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      })
      .run();

    this.rootPaths.set(id, rootPath);
    await this.recordAgent(id, {
      id: PRIME_AGENT_ID,
      role: "prime",
      name: "Prime",
    });

    return session;
  }

  async updateSession(
    id: string,
    input: UpdateSessionRequest,
  ): Promise<Session | undefined> {
    const existing = await this.getSession(id);
    if (!existing) return undefined;

    const updated: Session = {
      ...existing,
      name: input.name?.trim() || existing.name,
      archived: input.archived ?? existing.archived,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .update(sessions)
      .set({
        name: updated.name,
        archived: updated.archived,
        updatedAt: updated.updatedAt,
      })
      .where(eq(sessions.id, id))
      .run();
    return updated;
  }

  async attachConfig(
    id: string,
    config: SessionConfigMeta,
  ): Promise<Session | undefined> {
    const existing = await this.getSession(id);
    if (!existing) return undefined;

    const updated: Session = {
      ...existing,
      config,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .update(sessions)
      .set({ config: JSON.stringify(config), updatedAt: updated.updatedAt })
      .where(eq(sessions.id, id))
      .run();
    return updated;
  }

  async deleteSession(id: string): Promise<boolean> {
    // Cascades delete session_assets + session_agents rows (FK ON DELETE
    // CASCADE). The on-disk folder (incl. chat JSONL) is left in place, matching
    // the prior in-memory behavior.
    const result = this.db.delete(sessions).where(eq(sessions.id, id)).run();
    this.rootPaths.delete(id);
    return result.changes > 0;
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const rootPath = await this.rootPathFor(sessionId);
    if (!rootPath) return [];
    return readAllMessages(rootPath);
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    const rootPath = await this.rootPathFor(message.sessionId);
    if (!rootPath) {
      console.error(
        `[store] appendMessage: unknown session ${message.sessionId}`,
      );
      return;
    }
    await appendChatMessage(rootPath, message);
  }

  async nextSeq(sessionId: string, conversationId: string): Promise<number> {
    await this.seedConversation(sessionId, conversationId);
    // better-sqlite3 is synchronous, so read-then-increment inside one
    // transaction is genuinely atomic: two concurrent writers get an order
    // rather than the same number.
    return this.db.transaction((tx) => {
      const row = tx
        .select({ nextSeq: conversations.nextSeq })
        .from(conversations)
        .where(
          and(
            eq(conversations.sessionId, sessionId),
            eq(conversations.id, conversationId),
          ),
        )
        .get();
      const allocated = row?.nextSeq ?? 1;
      tx.update(conversations)
        .set({ nextSeq: allocated + 1 })
        .where(
          and(
            eq(conversations.sessionId, sessionId),
            eq(conversations.id, conversationId),
          ),
        )
        .run();
      return allocated;
    });
  }

  /**
   * Creates a conversation's counter row on first use, starting above whatever
   * its existing JSONL log occupies. Messages written before `seq` existed are
   * numbered from their position on read, so seeding at 1 would hand out
   * numbers a legacy transcript already uses.
   */
  private async seedConversation(
    sessionId: string,
    conversationId: string,
  ): Promise<void> {
    const existing = this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.sessionId, sessionId),
          eq(conversations.id, conversationId),
        ),
      )
      .get();
    if (existing) return;

    const rootPath = await this.rootPathFor(sessionId);
    const occupied = rootPath ? await highestSeq(rootPath, conversationId) : 0;
    this.db
      .insert(conversations)
      .values({
        id: conversationId,
        sessionId,
        nextSeq: occupied + 1,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run();
  }

  async getArtifacts(sessionId: string): Promise<PinnedArtifact[]> {
    return this.readArtifacts(sessionId);
  }

  async pinArtifact(
    sessionId: string,
    artifact: { path: string; title: string },
  ): Promise<PinnedArtifact[]> {
    // Re-pinning a known path refreshes its title in place (keeping its row id,
    // hence its oldest-first position and original pinnedAt); a new path appends.
    this.db
      .insert(sessionAssets)
      .values({
        sessionId,
        path: artifact.path,
        title: artifact.title,
        pinnedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [sessionAssets.sessionId, sessionAssets.path],
        set: { title: artifact.title },
      })
      .run();
    return this.readArtifacts(sessionId);
  }

  async unpinArtifact(
    sessionId: string,
    artifactPath: string,
  ): Promise<PinnedArtifact[]> {
    this.db
      .delete(sessionAssets)
      .where(
        and(
          eq(sessionAssets.sessionId, sessionId),
          eq(sessionAssets.path, artifactPath),
        ),
      )
      .run();
    return this.readArtifacts(sessionId);
  }

  async recordAgent(
    sessionId: string,
    agent: RecordAgentInput,
  ): Promise<SessionAgent> {
    // Drizzle omits `undefined` fields, so re-recording without a field leaves
    // the stored value untouched (and `status` falls back to the column default
    // / existing value).
    const tools = agent.tools ? JSON.stringify(agent.tools) : undefined;
    this.db
      .insert(sessionAgents)
      .values({
        id: agent.id,
        sessionId,
        role: agent.role,
        name: agent.name,
        purpose: agent.purpose,
        status: agent.status,
        model: agent.model,
        thinkingDepth: agent.thinkingDepth,
        template: agent.template,
        tools,
        systemPrompt: agent.systemPrompt,
        autoRelayToPrime: agent.autoRelayToPrime,
        host: agent.host,
        ...connectorColumns(agent.connector),
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [sessionAgents.sessionId, sessionAgents.id],
        set: {
          role: agent.role,
          name: agent.name,
          purpose: agent.purpose,
          status: agent.status,
          model: agent.model,
          thinkingDepth: agent.thinkingDepth,
          template: agent.template,
          tools,
          systemPrompt: agent.systemPrompt,
          autoRelayToPrime: agent.autoRelayToPrime,
          host: agent.host,
          ...connectorColumns(agent.connector),
        },
      })
      .run();

    const row = this.db
      .select()
      .from(sessionAgents)
      .where(
        and(
          eq(sessionAgents.sessionId, sessionId),
          eq(sessionAgents.id, agent.id),
        ),
      )
      .get();
    // The row was just upserted, so it always exists here.
    return toAgent(row as SessionAgentRow);
  }

  async setAgentStatus(
    sessionId: string,
    agentId: string,
    status: SessionAgentStatus,
  ): Promise<void> {
    this.db
      .update(sessionAgents)
      .set({ status })
      .where(
        and(
          eq(sessionAgents.sessionId, sessionId),
          eq(sessionAgents.id, agentId),
        ),
      )
      .run();
  }

  async listAgents(sessionId: string): Promise<SessionAgent[]> {
    const rows = this.db
      .select()
      .from(sessionAgents)
      .where(eq(sessionAgents.sessionId, sessionId))
      .orderBy(asc(sessionAgents.createdAt))
      .all();
    return rows.map(toAgent);
  }

  async detachActiveSubagents(): Promise<number> {
    const rows = this.db
      .update(sessionAgents)
      .set({ status: "detached" })
      .where(
        and(
          eq(sessionAgents.role, "subagent"),
          eq(sessionAgents.status, "active"),
        ),
      )
      .returning({ id: sessionAgents.id })
      .all();
    return rows.length;
  }

  async listAgentsForEnvironment(
    environmentId: string,
  ): Promise<SessionAgent[]> {
    const rows = this.db
      .select()
      .from(sessionAgents)
      .where(
        and(
          eq(sessionAgents.role, "subagent"),
          eq(sessionAgents.connectorEnvironmentId, environmentId),
        ),
      )
      .orderBy(asc(sessionAgents.createdAt))
      .all();
    return rows.map(toAgent);
  }

  async markViewed(
    sessionId: string,
    userKey: string,
    at: string,
  ): Promise<void> {
    this.db
      .insert(sessionViews)
      .values({ sessionId, userKey, lastViewedAt: at })
      .onConflictDoUpdate({
        target: [sessionViews.sessionId, sessionViews.userKey],
        set: { lastViewedAt: at },
      })
      .run();
  }

  async getLastViewedMap(userKey: string): Promise<Map<string, string>> {
    const rows = this.db
      .select({
        sessionId: sessionViews.sessionId,
        lastViewedAt: sessionViews.lastViewedAt,
      })
      .from(sessionViews)
      .where(eq(sessionViews.userKey, userKey))
      .all();
    return new Map(rows.map((row) => [row.sessionId, row.lastViewedAt]));
  }

  /** Resolves a session's root folder, caching the lookup. */
  private async rootPathFor(sessionId: string): Promise<string | undefined> {
    const cached = this.rootPaths.get(sessionId);
    if (cached) return cached;
    const row = this.db
      .select({ rootPath: sessions.rootPath })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    if (!row) return undefined;
    this.rootPaths.set(sessionId, row.rootPath);
    return row.rootPath;
  }

  /** Reads a session's pinned assets as wire {@link PinnedArtifact}s, oldest first. */
  private readArtifacts(sessionId: string): PinnedArtifact[] {
    const rows = this.db
      .select()
      .from(sessionAssets)
      .where(eq(sessionAssets.sessionId, sessionId))
      .orderBy(asc(sessionAssets.id))
      .all();
    return rows.map((row) => ({
      path: row.path,
      title: row.title,
      pinnedAt: row.pinnedAt,
    }));
  }
}
