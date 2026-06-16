import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  AgentRole,
  ChatMessage,
  CreateSessionRequest,
  PinnedArtifact,
  Session,
  SessionConfigMeta,
  UpdateSessionRequest,
} from "@tangent/shared/contracts.ts";
import { and, asc, count, eq } from "drizzle-orm";

import { ARTIFACTS_DIRNAME, SESSIONS_ROOT } from "../config.ts";
import {
  appendMessage as appendChatMessage,
  readAllMessages,
} from "./chatLog.ts";
import type { Db } from "./db/client.ts";
import {
  type SessionAgentRow,
  sessionAgents,
  sessionAssets,
  type SessionRow,
  sessions,
} from "./db/schema.ts";
import type {
  RecordAgentInput,
  SessionAgent,
  SessionAgentStatus,
  SessionStore,
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
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
    createdAt: row.createdAt,
  };
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

  async createSession(input: CreateSessionRequest): Promise<Session> {
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
