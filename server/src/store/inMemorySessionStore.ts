import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  ChatMessage,
  CreateSessionRequest,
  Session,
  SessionConfigMeta,
  UpdateSessionRequest,
} from "@shared/contracts.ts";

import { ARTIFACTS_DIRNAME, SESSIONS_ROOT } from "../config.ts";
import type { SessionStore } from "./sessionStore.ts";

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly messages = new Map<string, ChatMessage[]>();

  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  async getSession(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async createSession(input: CreateSessionRequest): Promise<Session> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const rootPath = path.join(SESSIONS_ROOT, id);

    // Each session is connected to a freshly created scoped "root" folder,
    // with an `artifacts/` subfolder agents write user-facing outputs into and
    // the file API serves over HTTP.
    await mkdir(rootPath, { recursive: true });
    await mkdir(path.join(rootPath, ARTIFACTS_DIRNAME), { recursive: true });

    const session: Session = {
      id,
      name: input.name?.trim() || `Session ${this.sessions.size + 1}`,
      rootPath,
      status: "created",
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(id, session);
    this.messages.set(id, []);
    return session;
  }

  async updateSession(
    id: string,
    input: UpdateSessionRequest,
  ): Promise<Session | undefined> {
    const existing = this.sessions.get(id);
    if (!existing) return undefined;

    const updated: Session = {
      ...existing,
      name: input.name?.trim() || existing.name,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(id, updated);
    return updated;
  }

  async attachConfig(
    id: string,
    config: SessionConfigMeta,
  ): Promise<Session | undefined> {
    const existing = this.sessions.get(id);
    if (!existing) return undefined;

    const updated: Session = {
      ...existing,
      config,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(id, updated);
    return updated;
  }

  async deleteSession(id: string): Promise<boolean> {
    this.messages.delete(id);
    return this.sessions.delete(id);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.messages.get(sessionId) ?? [];
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    const existing = this.messages.get(message.sessionId);
    if (existing) {
      existing.push(message);
    } else {
      this.messages.set(message.sessionId, [message]);
    }
  }
}
