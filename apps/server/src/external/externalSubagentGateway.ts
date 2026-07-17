import { randomUUID } from "node:crypto";

import type {
  SubagentInfo,
  SubagentStatus,
  ThinkingLevel,
} from "@tangent/shared/contracts.ts";
import type { RemoteAgentEvent } from "@tangent/shared/remoteSubagent.ts";

import type { AgentDescriptor, PiAgentHandlers } from "../pi/types.ts";

/** Display metadata a caller supplies when registering an external sub-agent. */
export interface RegisterExternalSubagent {
  name: string;
  template?: string;
  model?: string;
  thinkingDepth?: ThinkingLevel;
}

/** An external sub-agent tab, tracked in the gateway roster (display only). */
interface ExternalSubagent {
  agentId: string;
  name: string;
  status: SubagentStatus;
  template?: string;
  model?: string;
  thinkingDepth?: ThinkingLevel;
  createdAt: string;
}

/** Projects a roster entry onto the wire {@link SubagentInfo}. */
function toInfo(subagent: ExternalSubagent): SubagentInfo {
  return {
    id: subagent.agentId,
    name: subagent.name,
    status: subagent.status,
    host: "external",
    template: subagent.template,
    model: subagent.model,
    thinkingDepth: subagent.thinkingDepth,
    createdAt: subagent.createdAt,
  };
}

/**
 * In-memory registry of **external sub-agent** tabs. An external sub-agent is
 * one whose work runs outside Tangent (e.g. driven by a bundle tool over the
 * `/internal/external-agents` API); the gateway only owns the sidebar tab and
 * relays streamed events into it via the shared {@link PiAgentHandlers}, so an
 * external sub-agent renders and persists like a local one.
 *
 * The gateway is transport-agnostic and carries no knowledge of what runtime
 * backs a tab — a caller `register`s a tab, `pushEvent`s streamed output into
 * it, and `setStatus` marks its lifecycle. Reserved for the `external` host
 * alongside {@link import("../remote/remoteEnvironmentGateway.ts").RemoteEnvironmentGateway}
 * and {@link import("../pi/piAgentManager.ts").PiAgentManager}.
 */
export class ExternalSubagentGateway {
  private readonly handlers: PiAgentHandlers;

  /** Per-session external sub-agent rosters, keyed by sessionId then agentId. */
  private readonly sessions = new Map<string, Map<string, ExternalSubagent>>();

  constructor(handlers: PiAgentHandlers) {
    this.handlers = handlers;
  }

  /** True when `agentId` is an external sub-agent of `sessionId`. */
  hasAgent(sessionId: string, agentId: string): boolean {
    return Boolean(this.sessions.get(sessionId)?.has(agentId));
  }

  /** The session's external sub-agent roster (Prime/local agents excluded). */
  listSubagents(sessionId: string): SubagentInfo[] {
    const roster = this.sessions.get(sessionId);
    if (!roster) return [];
    return [...roster.values()].map(toInfo);
  }

  /**
   * Registers a new external sub-agent tab, assigns it a UUID, records the
   * roster entry, and surfaces it to the session's chat layer. Returns the
   * assigned id the caller uses on subsequent `pushEvent`/`setStatus` calls.
   */
  register(sessionId: string, spec: RegisterExternalSubagent): { id: string } {
    const agentId = randomUUID();
    const subagent: ExternalSubagent = {
      agentId,
      name: spec.name,
      status: "active",
      template: spec.template,
      model: spec.model,
      thinkingDepth: spec.thinkingDepth,
      createdAt: new Date().toISOString(),
    };
    this.rosterFor(sessionId).set(agentId, subagent);
    this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
    return { id: agentId };
  }

  /** Relays a streamed event into the sub-agent's tab. No-op for an unknown id. */
  pushEvent(sessionId: string, agentId: string, event: RemoteAgentEvent): void {
    const subagent = this.sessions.get(sessionId)?.get(agentId);
    if (!subagent) return;
    this.handlers.onAgentEvent(sessionId, this.descriptorFor(subagent), event);
  }

  /**
   * Applies a lifecycle status change to a sub-agent tab. Terminal statuses
   * (anything other than `active`) drop the roster entry. No-op for an unknown
   * id.
   */
  setStatus(sessionId: string, agentId: string, status: SubagentStatus): void {
    const roster = this.sessions.get(sessionId);
    const subagent = roster?.get(agentId);
    if (!roster || !subagent) return;

    subagent.status = status;
    if (status !== "active") roster.delete(agentId);
    this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
  }

  /** Returns (creating if needed) the session's external sub-agent roster. */
  private rosterFor(sessionId: string): Map<string, ExternalSubagent> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created = new Map<string, ExternalSubagent>();
    this.sessions.set(sessionId, created);
    return created;
  }

  /** Builds the agent descriptor a relayed event is tagged with. */
  private descriptorFor(subagent: ExternalSubagent): AgentDescriptor {
    return { agentId: subagent.agentId, role: "subagent", name: subagent.name };
  }
}
