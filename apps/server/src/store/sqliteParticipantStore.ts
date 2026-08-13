import {
  type Capability,
  type ConnectorDescriptor,
  connectorFor,
  type ConnectorKind,
  type ConnectorLifecycle,
  type ParticipantKind,
  type Presence,
  type SubagentHost,
} from "@tangent/shared/contracts.ts";
import { and, asc, eq } from "drizzle-orm";

import type { Db } from "./db/client.ts";
import { type ParticipantRow, participants } from "./db/schema.ts";
import type {
  AgentPayload,
  Participant,
  ParticipantStore,
} from "./participantStore.ts";
import { connectorFromHost } from "./sessionStore.ts";

/** Coerces a stored JSON value to `undefined` when it is absent or SQL null. */
function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value == null ? undefined : value;
}

/** Parses the JSON `capabilities` array, tolerating a malformed value. */
function parseCapabilities(raw: string): Capability[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Capability[]) : [];
  } catch {
    return [];
  }
}

/** Parses the JSON `agent_payload` blob into an {@link AgentPayload}. */
function parseAgentPayload(raw: string | null): AgentPayload | undefined {
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      role: (p.role as AgentPayload["role"]) ?? "subagent",
      model: orUndefined(p.model as string | null),
      thinkingDepth: orUndefined(p.thinkingDepth as string | null),
      template: orUndefined(p.template as string | null),
      tools: Array.isArray(p.tools) ? (p.tools as string[]) : undefined,
      systemPrompt: orUndefined(p.systemPrompt as string | null),
      autoRelayToPrime: orUndefined(p.autoRelayToPrime as boolean | null),
      host: orUndefined(p.host as SubagentHost | null),
      purpose: orUndefined(p.purpose as string | null),
      status: (p.status as AgentPayload["status"]) ?? "active",
    };
  } catch {
    return undefined;
  }
}

/**
 * Reads a participant row's connector facets, falling back to the legacy `host`
 * label (kept in `agent_payload`) for rows backfilled before the connector
 * columns were ever set — the same read-time fallback the roster store uses.
 */
function toConnector(
  row: ParticipantRow,
  agent: AgentPayload | undefined,
): ConnectorDescriptor {
  if (!row.connectorKind) return connectorFromHost(agent?.host);
  return {
    ...connectorFor(row.connectorKind as ConnectorKind),
    ...(row.connectorLifecycle
      ? { lifecycle: row.connectorLifecycle as ConnectorLifecycle }
      : {}),
    ...(row.connectorEnvironmentId
      ? { environmentId: row.connectorEnvironmentId }
      : {}),
    ...(row.connectorEndpointUrl
      ? { endpointUrl: row.connectorEndpointUrl }
      : {}),
  };
}

/** Maps a participants row onto the domain {@link Participant}. */
function toParticipant(row: ParticipantRow): Participant {
  const agent = parseAgentPayload(row.agentPayload);
  return {
    id: row.id,
    sessionId: row.sessionId,
    kind: row.kind as ParticipantKind,
    displayName: row.displayName,
    capabilities: parseCapabilities(row.capabilities),
    presence: row.presence as Presence,
    connector: toConnector(row, agent),
    agent,
    revokedAt: orUndefined(row.revokedAt),
    createdAt: row.createdAt,
  };
}

/** The connector columns a participant write persists. */
function connectorColumns(connector: ConnectorDescriptor) {
  return {
    connectorKind: connector.kind,
    connectorLifecycle: connector.lifecycle,
    connectorEnvironmentId: connector.environmentId,
    connectorEndpointUrl: connector.endpointUrl,
  };
}

/** SQLite-backed {@link ParticipantStore} over the shared session metadata DB. */
export class SqliteParticipantStore implements ParticipantStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async listForSession(sessionId: string): Promise<Participant[]> {
    const rows = this.db
      .select()
      .from(participants)
      .where(eq(participants.sessionId, sessionId))
      .orderBy(asc(participants.createdAt))
      .all();
    return rows.map(toParticipant);
  }

  async get(sessionId: string, id: string): Promise<Participant | undefined> {
    const row = this.db
      .select()
      .from(participants)
      .where(
        and(eq(participants.sessionId, sessionId), eq(participants.id, id)),
      )
      .get();
    return row ? toParticipant(row) : undefined;
  }

  async put(participant: Participant): Promise<void> {
    const capabilities = JSON.stringify(participant.capabilities);
    const agentPayload = participant.agent
      ? JSON.stringify(participant.agent)
      : null;
    const columns = connectorColumns(participant.connector);
    this.db
      .insert(participants)
      .values({
        id: participant.id,
        sessionId: participant.sessionId,
        kind: participant.kind,
        displayName: participant.displayName,
        capabilities,
        presence: participant.presence,
        ...columns,
        agentPayload,
        revokedAt: participant.revokedAt ?? null,
        createdAt: participant.createdAt,
      })
      .onConflictDoUpdate({
        target: [participants.sessionId, participants.id],
        set: {
          kind: participant.kind,
          displayName: participant.displayName,
          capabilities,
          presence: participant.presence,
          ...columns,
          agentPayload,
          revokedAt: participant.revokedAt ?? null,
        },
      })
      .run();
  }

  async updatePresence(
    sessionId: string,
    id: string,
    presence: Presence,
  ): Promise<void> {
    this.db
      .update(participants)
      .set({ presence })
      .where(
        and(eq(participants.sessionId, sessionId), eq(participants.id, id)),
      )
      .run();
  }

  async revoke(sessionId: string, id: string): Promise<void> {
    this.db
      .update(participants)
      .set({ revokedAt: new Date().toISOString(), capabilities: "[]" })
      .where(
        and(eq(participants.sessionId, sessionId), eq(participants.id, id)),
      )
      .run();
  }
}
