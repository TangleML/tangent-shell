import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  ChatMessage,
  CreateSessionRequest,
  PinnedArtifact,
  Session,
  SessionConfigMeta,
  UpdateSessionRequest,
} from "@tangent/shared/contracts.ts";

import { ARTIFACTS_DIRNAME, SESSIONS_ROOT } from "../config.ts";
import type {
  RecordAgentInput,
  SessionAgent,
  SessionAgentStatus,
  SessionStore,
} from "./sessionStore.ts";

/** Id of the orchestrating Prime agent (mirrors `pi/types.ts`). */
const PRIME_AGENT_ID = "prime";

/** Builds the next stored agent, preserving `createdAt`/`status` on re-record. */
function mergeAgent(
  sessionId: string,
  agent: RecordAgentInput,
  prior: SessionAgent | undefined,
): SessionAgent {
  const status = agent.status ?? prior?.status ?? "active";
  return {
    id: agent.id,
    sessionId,
    role: agent.role,
    name: agent.name,
    purpose: agent.purpose,
    status,
    model: agent.model,
    thinkingDepth: agent.thinkingDepth,
    template: agent.template,
    createdAt: prior?.createdAt ?? new Date().toISOString(),
  };
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly artifacts = new Map<string, PinnedArtifact[]>();
  private readonly agents = new Map<string, SessionAgent[]>();

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
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(id, session);
    this.messages.set(id, []);
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
    const existing = this.sessions.get(id);
    if (!existing) return undefined;

    const updated: Session = {
      ...existing,
      name: input.name?.trim() || existing.name,
      archived: input.archived ?? existing.archived,
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
    this.artifacts.delete(id);
    this.agents.delete(id);
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

  async getArtifacts(sessionId: string): Promise<PinnedArtifact[]> {
    return this.artifacts.get(sessionId) ?? [];
  }

  async pinArtifact(
    sessionId: string,
    artifact: { path: string; title: string },
  ): Promise<PinnedArtifact[]> {
    const existing = this.artifacts.get(sessionId) ?? [];
    // Re-pinning a known path refreshes its title in place (preserving order);
    // a new path appends to the end so the list reads oldest-first.
    const prior = existing.find((a) => a.path === artifact.path);
    const next: PinnedArtifact = {
      path: artifact.path,
      title: artifact.title,
      pinnedAt: prior?.pinnedAt ?? new Date().toISOString(),
    };
    const updated = prior
      ? existing.map((a) => (a.path === artifact.path ? next : a))
      : [...existing, next];
    this.artifacts.set(sessionId, updated);
    return updated;
  }

  async unpinArtifact(
    sessionId: string,
    path: string,
  ): Promise<PinnedArtifact[]> {
    const existing = this.artifacts.get(sessionId) ?? [];
    const updated = existing.filter((a) => a.path !== path);
    this.artifacts.set(sessionId, updated);
    return updated;
  }

  async recordAgent(
    sessionId: string,
    agent: RecordAgentInput,
  ): Promise<SessionAgent> {
    const existing = this.agents.get(sessionId) ?? [];
    const prior = existing.find((a) => a.id === agent.id);
    const next = mergeAgent(sessionId, agent, prior);
    const updated = prior
      ? existing.map((a) => (a.id === agent.id ? next : a))
      : [...existing, next];
    this.agents.set(sessionId, updated);
    return next;
  }

  async setAgentStatus(
    sessionId: string,
    agentId: string,
    status: SessionAgentStatus,
  ): Promise<void> {
    const existing = this.agents.get(sessionId);
    if (!existing) return;
    this.agents.set(
      sessionId,
      existing.map((a) => (a.id === agentId ? { ...a, status } : a)),
    );
  }

  async listAgents(sessionId: string): Promise<SessionAgent[]> {
    return this.agents.get(sessionId) ?? [];
  }
}
