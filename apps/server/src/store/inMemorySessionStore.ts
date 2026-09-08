import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  capabilitiesForRole,
  type ChatMessage,
  type ConnectorDescriptor,
  connectorFor,
  type PinnedArtifact,
  type Session,
  type SessionConfigMeta,
  type UpdateSessionRequest,
} from "@tangent/shared/contracts.ts";

import { ARTIFACTS_DIRNAME, SESSIONS_ROOT } from "../config.ts";
import {
  participantFromAgent,
  type ParticipantStore,
} from "./participantStore.ts";
import type { ResourceStore } from "./resourceStore.ts";
import {
  type CreateSessionParams,
  type RecordAgentInput,
  type SessionAgent,
  type SessionAgentStatus,
  type SessionStore,
} from "./sessionStore.ts";

/** Id of the orchestrating Prime agent (mirrors `pi/types.ts`). */
const PRIME_AGENT_ID = "prime";

/** Returns only the explicitly-set fields of a record-agent input. */
function definedAgentFields(
  agent: RecordAgentInput,
): Partial<RecordAgentInput> {
  const out: Partial<RecordAgentInput> = {};
  for (const [key, value] of Object.entries(agent)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** The connector to store: explicit, else the prior one, else the `pi-stdio` default. */
function mergeConnector(
  agent: RecordAgentInput,
  prior: SessionAgent | undefined,
): ConnectorDescriptor {
  return agent.connector ?? prior?.connector ?? connectorFor("pi-stdio");
}

/**
 * Builds the next stored agent. Mirrors the SQLite store's upsert semantics:
 * an omitted (undefined) field leaves the prior value untouched, so a partial
 * re-record (e.g. a model-only change) never wipes the persisted spawn config.
 */
function mergeAgent(
  sessionId: string,
  agent: RecordAgentInput,
  prior: SessionAgent | undefined,
): Omit<SessionAgent, "homeConversationId"> {
  return {
    ...prior,
    ...definedAgentFields(agent),
    id: agent.id,
    sessionId,
    role: agent.role,
    name: agent.name,
    capabilities: capabilitiesForRole(agent.role),
    status: agent.status ?? prior?.status ?? "active",
    connector: mergeConnector(agent, prior),
    createdAt: prior?.createdAt ?? new Date().toISOString(),
  };
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly artifacts = new Map<string, PinnedArtifact[]>();
  private readonly agents = new Map<string, SessionAgent[]>();
  private readonly views = new Map<string, Map<string, string>>();
  /** Per-conversation `seq` counters, keyed `sessionId/conversationId`. */
  private readonly seqs = new Map<string, number>();
  /** Agent → home Conversation id, keyed by session; mirrors `conversations`. */
  private readonly homeConversations = new Map<string, Map<string, string>>();
  /** Mirrors each recorded roster row, matching the SQLite store's dual-write. */
  private readonly participants?: ParticipantStore;
  /** Mirrors each pinned artifact into the resource catalog, when present. */
  private readonly resources?: ResourceStore;

  constructor(participants?: ParticipantStore, resources?: ResourceStore) {
    this.participants = participants;
    this.resources = resources;
  }

  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  async getSession(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async createSession(input: CreateSessionParams): Promise<Session> {
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
      user: input.user,
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
    for (const key of this.seqs.keys()) {
      if (key.startsWith(`${id}/`)) this.seqs.delete(key);
    }
    this.artifacts.delete(id);
    this.agents.delete(id);
    this.homeConversations.delete(id);
    return this.sessions.delete(id);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.messages.get(sessionId) ?? [];
  }

  async getConversationMessages(
    sessionId: string,
    conversationId: string,
  ): Promise<ChatMessage[]> {
    return (this.messages.get(sessionId) ?? [])
      .filter((message) => message.conversationId === conversationId)
      .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    const existing = this.messages.get(message.sessionId);
    if (existing) {
      existing.push(message);
    } else {
      this.messages.set(message.sessionId, [message]);
    }
  }

  async nextSeq(sessionId: string, conversationId: string): Promise<number> {
    const key = `${sessionId}/${conversationId}`;
    const allocated = this.seqs.get(key) ?? this.seedSeq(sessionId, key);
    this.seqs.set(key, allocated + 1);
    return allocated;
  }

  /** Seeds a counter above whatever the in-memory transcript already holds. */
  private seedSeq(sessionId: string, key: string): number {
    const conversationId = key.slice(sessionId.length + 1);
    const held = (this.messages.get(sessionId) ?? []).filter(
      (message) => message.conversationId === conversationId,
    );
    return Math.max(0, ...held.map((message) => message.seq)) + 1;
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
    await this.resources?.catalog({
      sessionId,
      kind: "artifact",
      name: artifact.title,
      uri: artifact.path,
    });
    return updated;
  }

  async unpinArtifact(
    sessionId: string,
    path: string,
  ): Promise<PinnedArtifact[]> {
    const existing = this.artifacts.get(sessionId) ?? [];
    const updated = existing.filter((a) => a.path !== path);
    this.artifacts.set(sessionId, updated);
    await this.resources?.remove(sessionId, path);
    return updated;
  }

  async recordAgent(
    sessionId: string,
    agent: RecordAgentInput,
  ): Promise<SessionAgent> {
    const existing = this.agents.get(sessionId) ?? [];
    const prior = existing.find((a) => a.id === agent.id);
    const homeConversationId = this.ensureHomeConversation(
      sessionId,
      agent.id,
      prior?.homeConversationId ?? agent.homeConversationId,
    );
    const next = { ...mergeAgent(sessionId, agent, prior), homeConversationId };
    const updated = prior
      ? existing.map((a) => (a.id === agent.id ? next : a))
      : [...existing, next];
    this.agents.set(sessionId, updated);
    await this.participants?.put(participantFromAgent(next));
    return next;
  }

  /**
   * Resolves an agent's home Conversation, minting one when it has none. A
   * caller-supplied id (a spawner minting up front) wins; a legacy agent whose
   * transcript is already keyed by its own id keeps that id; anything else gets
   * a fresh one so a Conversation id stops naming an agent.
   */
  private ensureHomeConversation(
    sessionId: string,
    agentId: string,
    provided: string | undefined,
  ): string {
    const map = this.homeConversations.get(sessionId) ?? new Map();
    const existing = map.get(agentId);
    if (existing) return existing;

    const held = this.messages.get(sessionId) ?? [];
    const legacy = held.some((message) => message.conversationId === agentId);
    const resolved = provided ?? (legacy ? agentId : randomUUID());
    map.set(agentId, resolved);
    this.homeConversations.set(sessionId, map);
    return resolved;
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

  async detachActiveSubagents(): Promise<number> {
    let detached = 0;
    for (const [sessionId, agents] of this.agents) {
      const next = agents.map((agent) => {
        if (agent.role !== "subagent" || agent.status !== "active")
          return agent;
        detached += 1;
        return { ...agent, status: "detached" as const };
      });
      this.agents.set(sessionId, next);
    }
    return detached;
  }

  async listAgentsForEnvironment(
    environmentId: string,
  ): Promise<SessionAgent[]> {
    return [...this.agents.values()]
      .flat()
      .filter((agent) => agent.role === "subagent")
      .filter((agent) => agent.connector.environmentId === environmentId);
  }

  async markViewed(
    sessionId: string,
    userKey: string,
    at: string,
  ): Promise<void> {
    const forUser = this.views.get(userKey) ?? new Map<string, string>();
    forUser.set(sessionId, at);
    this.views.set(userKey, forUser);
  }

  async getLastViewedMap(userKey: string): Promise<Map<string, string>> {
    return new Map(this.views.get(userKey) ?? new Map());
  }
}
