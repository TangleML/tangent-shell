import { randomUUID } from "node:crypto";

import {
  connectorFields,
  connectorFor,
  isTerminalStatus,
  type Run,
  type RunId,
  type SubagentInfo,
  type SubagentStatus,
  type ThinkingLevel,
} from "@tangent/shared/contracts.ts";
import type { RemoteAgentEvent } from "@tangent/shared/remoteSubagent.ts";

import type { RelayRegistry } from "../mcp/relayRegistry.ts";
import { parseThinkingLevel } from "../pi/agentConfig.ts";
import type { AgentDescriptor, ConversationEventSink } from "../pi/types.ts";
import type { RunRegistry, SettledStatus } from "../runs/runRegistry.ts";
import type { SessionAgent, SessionStore } from "../store/sessionStore.ts";
import { DeliveryQueue, type PendingDelivery } from "./deliveryQueue.ts";

/** Display metadata a caller supplies when registering an external sub-agent. */
export interface RegisterExternalSubagent {
  name: string;
  template?: string;
  model?: string;
  thinkingDepth?: ThinkingLevel;
}

/** The callback channel a newly registered sub-agent's far end dials back on. */
export interface RegisteredCallback {
  channelId: string;
  secret: string;
}

/** A registered sub-agent tab and the callback channel opened alongside it. */
export interface RegisteredExternalSubagent {
  id: string;
  callback: RegisteredCallback;
}

/** What a caller supplies to open a Run for an external sub-agent's turn. */
export interface OpenExternalRun {
  /** The far side's own id for this work (an Aquifer World session id). */
  externalId?: string;
  /** Where the far side's stream is being read from, to resume by. */
  cursor?: string;
}

/** An external sub-agent tab, tracked in the gateway roster (display only). */
interface ExternalSubagent {
  agentId: string;
  /** The Conversation this tab lives in, distinct from its agent id. */
  homeConversationId: string;
  name: string;
  status: SubagentStatus;
  template?: string;
  model?: string;
  thinkingDepth?: ThinkingLevel;
  /** The callback channel opened for this tab, closed when it goes terminal. */
  channelId?: string;
  createdAt: string;
}

/** Whether a Run is this participant's, or another's (or none at all). */
function belongsTo(
  run: Run | undefined,
  sessionId: string,
  agentId: string,
): boolean {
  if (!run) return false;
  return run.sessionId === sessionId && run.participantId === agentId;
}

/** Projects a roster entry onto the wire {@link SubagentInfo}. */
function toInfo(subagent: ExternalSubagent): SubagentInfo {
  return {
    id: subagent.agentId,
    conversationId: subagent.homeConversationId,
    name: subagent.name,
    status: subagent.status,
    ...connectorFields("external-inbound"),
    template: subagent.template,
    model: subagent.model,
    thinkingDepth: subagent.thinkingDepth,
    createdAt: subagent.createdAt,
  };
}

/**
 * Registry of **external sub-agent** tabs, held in memory and persisted as
 * roster rows so a restart has something to reattach to. An external sub-agent
 * is one whose work runs outside Tangent (e.g. driven by a bundle tool over the
 * `/internal/external-agents` API); the gateway owns the sidebar tab, relays
 * streamed events into it via the shared {@link ConversationEventSink}, and holds
 * both directions of its transport, so an external sub-agent renders, persists
 * and is addressed like a local one.
 *
 * Both legs are this one gateway's business. Inbound is the event stream the
 * driver pushes; outbound is a {@link DeliveryQueue} the driver drains, because
 * only the driver holds a route to the runtime — the server hands the work over
 * and the driver performs the last hop. The callback channel a far end dials
 * back on is opened here too, bound to the participant, and closed when the tab
 * goes terminal.
 *
 * The gateway stays transport-agnostic and carries no knowledge of what runtime
 * backs a tab. Its connector is `external-inbound`: the far side is created and
 * destroyed by the bundle tool driving it, so the participant is owned rather
 * than attached. Sits alongside {@link
 * import("../remote/remoteEnvironmentGateway.ts").RemoteEnvironmentGateway} and
 * {@link import("../pi/piAgentManager.ts").PiAgentManager}.
 */
export class ExternalSubagentGateway {
  private readonly handlers: ConversationEventSink;
  private readonly runs: RunRegistry;
  private readonly store: SessionStore;
  private readonly relay: RelayRegistry;
  private readonly outbound = new DeliveryQueue();

  /** Per-session external sub-agent rosters, keyed by sessionId then agentId. */
  private readonly sessions = new Map<string, Map<string, ExternalSubagent>>();

  constructor(
    handlers: ConversationEventSink,
    runs: RunRegistry,
    store: SessionStore,
    relay: RelayRegistry,
  ) {
    this.handlers = handlers;
    this.runs = runs;
    this.store = store;
    this.relay = relay;
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
   * Registers a new external sub-agent tab, assigns it a UUID, opens the
   * callback channel its far end dials back on, records the roster entry, and
   * surfaces it to the session's chat layer. Returns the assigned id the caller
   * uses on subsequent `pushEvent`/`setStatus` calls, with the channel.
   *
   * The channel is opened here rather than by a separate call so that a tab and
   * the way back to it are one act: nothing can hold a channel for a
   * participant that was never registered, and nothing has to remember to close
   * one when the tab ends.
   *
   * The tab is persisted as a roster row, so a restart has something to reattach
   * to. Best-effort: `sessionId` comes from an external caller, and a bogus one
   * must fail the row rather than the process.
   */
  register(
    sessionId: string,
    spec: RegisterExternalSubagent,
  ): RegisteredExternalSubagent {
    const agentId = randomUUID();
    const homeConversationId = randomUUID();
    const channel = this.relay.open({
      sessionId,
      label: spec.name,
      participantId: agentId,
    });
    const subagent: ExternalSubagent = {
      agentId,
      homeConversationId,
      name: spec.name,
      status: "active",
      template: spec.template,
      model: spec.model,
      thinkingDepth: spec.thinkingDepth,
      channelId: channel.channelId,
      createdAt: new Date().toISOString(),
    };
    this.rosterFor(sessionId).set(agentId, subagent);
    void this.store
      .recordAgent(sessionId, {
        id: agentId,
        role: "subagent",
        name: subagent.name,
        status: subagent.status,
        model: subagent.model,
        thinkingDepth: subagent.thinkingDepth,
        template: subagent.template,
        host: "external",
        connector: connectorFor("external-inbound"),
        homeConversationId,
      })
      .catch((err: unknown) => {
        console.error(
          `[external] failed to persist sub-agent "${subagent.name}" in session ${sessionId}:`,
          err,
        );
      });
    this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
    return { id: agentId, callback: channel };
  }

  /**
   * Queues a message for one external sub-agent, to be carried by the driver
   * that next asks for it. False when there is no tab to carry it to, or when
   * the tab is `detached` — nothing is driving that runtime, so a wake left in
   * the queue would be a promise the transport cannot keep.
   */
  deliver(sessionId: string, agentId: string, text: string): boolean {
    const subagent = this.sessions.get(sessionId)?.get(agentId);
    if (!subagent || subagent.status === "detached") return false;
    this.outbound.push(sessionId, { agentId, text });
    return true;
  }

  /**
   * Hands the session's queued messages to its driver, waiting up to
   * `timeoutMs` for one to arrive. Empty when nothing is queued in that window,
   * so the driver polls in a loop rather than holding one request forever.
   */
  takeDeliveries(
    sessionId: string,
    timeoutMs: number,
  ): Promise<PendingDelivery[]> {
    return this.outbound.take(sessionId, timeoutMs);
  }

  /**
   * Restores a persisted tab as `detached`. Nothing here creates the far side —
   * the bundle tool driving it does — so the tab comes back as a place for its
   * next turn to land rather than as something claiming to be live.
   *
   * Idempotent, and never downgrades a live tab.
   */
  reattach(sessionId: string, agent: SessionAgent): void {
    const roster = this.rosterFor(sessionId);
    if (roster.get(agent.id)?.status === "active") return;

    const subagent: ExternalSubagent = {
      agentId: agent.id,
      homeConversationId: agent.homeConversationId,
      name: agent.name,
      status: "detached",
      template: agent.template,
      model: agent.model,
      thinkingDepth: parseThinkingLevel(agent.thinkingDepth),
      createdAt: agent.createdAt,
    };
    roster.set(agent.id, subagent);
    this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
  }

  /**
   * Opens a Run for a turn of external work, carrying the far side's own id for
   * it and where its stream is being read from. Returns the Run's id, which the
   * caller passes back on `pushEvent` and `endRun`. Undefined for an unknown id.
   *
   * The driving tool knows the turn's boundaries — the server cannot see them —
   * so it declares them rather than having them guessed from the event stream.
   */
  openRun(
    sessionId: string,
    agentId: string,
    input: OpenExternalRun = {},
  ): RunId | undefined {
    const subagent = this.sessions.get(sessionId)?.get(agentId);
    if (!subagent) return undefined;
    this.markAttached(sessionId, subagent);
    return this.runs.open({
      sessionId,
      participantId: agentId,
      homeConversationId: subagent.homeConversationId,
      ingress: "tool",
      externalId: input.externalId,
      cursor: input.cursor,
    }).id;
  }

  /**
   * Settles a turn's Run, recording how far its stream was read. Names the Run
   * explicitly or settles whatever the tab has open; a cursor with no Run to
   * record it against is dropped.
   */
  endRun(
    sessionId: string,
    agentId: string,
    status: SettledStatus,
    input: { runId?: RunId; cursor?: string } = {},
  ): void {
    const runId = this.attributeTo(sessionId, agentId, input.runId);
    if (!runId) return;
    if (input.cursor) this.runs.setCursor(runId, input.cursor);
    this.runs.settle(runId, status);
  }

  /**
   * Relays a streamed event into the sub-agent's tab, attributed to the Run the
   * caller opened for the turn (or to whatever that tab has open). No-op for an
   * unknown id.
   */
  pushEvent(
    sessionId: string,
    agentId: string,
    event: RemoteAgentEvent,
    runId?: RunId,
  ): void {
    const subagent = this.sessions.get(sessionId)?.get(agentId);
    if (!subagent) return;
    this.markAttached(sessionId, subagent);
    this.handlers.onAgentEvent(sessionId, this.descriptorFor(subagent), {
      ...event,
      runId: this.attributeTo(sessionId, agentId, runId),
    });
  }

  /**
   * Completes the reattach: a detached tab receiving a turn or streaming output
   * is the far side coming back. No-op — and no roster churn — for a live tab.
   */
  private markAttached(sessionId: string, subagent: ExternalSubagent): void {
    if (subagent.status !== "detached") return;
    subagent.status = "active";
    this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
  }

  /**
   * Resolves which Run an inbound event is attributed to. A supplied id must
   * name a Run of the addressed participant — the caller is an external tool, so
   * one tab's stream must not be able to land under another's Run.
   */
  private attributeTo(
    sessionId: string,
    agentId: string,
    runId: RunId | undefined,
  ): RunId | undefined {
    if (runId && belongsTo(this.runs.get(runId), sessionId, agentId)) {
      return runId;
    }
    return this.runs.current(sessionId, agentId)?.id;
  }

  /**
   * Applies a lifecycle status change to a sub-agent tab. A terminal status
   * drops the roster entry, closes the callback channel, discards whatever was
   * still queued for it, and settles whatever Run the tab still had open;
   * `detached` keeps it, because the point of that state is having something to
   * come back to. No-op for an unknown id.
   */
  setStatus(sessionId: string, agentId: string, status: SubagentStatus): void {
    const roster = this.sessions.get(sessionId);
    const subagent = roster?.get(agentId);
    if (!roster || !subagent) return;

    subagent.status = status;
    if (isTerminalStatus(status)) {
      roster.delete(agentId);
      this.retire(sessionId, subagent);
      this.runs.settleOpenFor(
        sessionId,
        agentId,
        status === "completed" ? "completed" : "failed",
      );
    }
    this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
  }

  /** Releases everything a finished tab was holding open. */
  private retire(sessionId: string, subagent: ExternalSubagent): void {
    if (subagent.channelId) this.relay.close(subagent.channelId);
    subagent.channelId = undefined;
    this.outbound.drop(sessionId, subagent.agentId);
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
    return {
      agentId: subagent.agentId,
      role: "subagent",
      name: subagent.name,
      homeConversationId: subagent.homeConversationId,
    };
  }
}
