import { randomUUID } from "node:crypto";

import {
  connectorFor,
  type Run,
  type RunIngress,
  type SubagentInfo,
  type SubagentStatus,
  SYSTEM_AUTHOR,
} from "@tangent/shared/contracts.ts";

import {
  a2aCredential,
  type PeerBearerCredential,
} from "../connectors/credentials.ts";
import type {
  AgentDescriptor,
  AgentEvent,
  ConversationEventSink,
} from "../pi/types.ts";
import type { RunRegistry, SettledStatus } from "../runs/runRegistry.ts";
import type { UiCommandEmitter } from "../sockets/sessionRoster.ts";
import type { SessionAgent, SessionStore } from "../store/sessionStore.ts";
import { saveA2aArtifact } from "./a2aArtifacts.ts";
import {
  type A2aConnect,
  type A2aEvent,
  type A2aPeer,
  type A2aTaskPhase,
  awaitsInput,
  discoverPeer,
  endsTurn,
} from "./a2aClient.ts";

/** What a caller supplies to attach an A2A agent to a session. */
export interface AttachA2aAgent {
  /** Base URL the agent's card is served from. */
  endpointUrl: string;
  /** Overrides the name on the card, for a session with two of the same agent. */
  name?: string;
}

/** What to deliver to an attached peer. */
export interface SendToPeer {
  sessionId: string;
  participantId: string;
  text: string;
  ingress?: RunIngress;
}

/** An attached peer's tab, plus what its in-flight turn needs. */
interface A2aTab {
  agentId: string;
  /** The Conversation this peer's tab lives in, distinct from its agent id. */
  homeConversationId: string;
  name: string;
  status: SubagentStatus;
  endpointUrl: string;
  createdAt: string;
  /** The discovered client. Absent while the tab is detached. */
  peer?: A2aPeer;
  /** The peer's Task this exchange continues, while it stays open. */
  taskId?: string;
  /** Aborts the in-flight turn's stream. */
  abort?: AbortController;
}

/** One turn's accumulating state: what has streamed, and how it ended. */
interface Turn {
  sessionId: string;
  tab: A2aTab;
  run: Run;
  messageId: string;
  started: boolean;
  content: string;
  phase: A2aTaskPhase;
}

/** Projects a tab onto the wire {@link SubagentInfo}. */
function toInfo(tab: A2aTab): SubagentInfo {
  return {
    id: tab.agentId,
    conversationId: tab.homeConversationId,
    name: tab.name,
    status: tab.status,
    connector: { ...connectorFor("a2a"), endpointUrl: tab.endpointUrl },
    createdAt: tab.createdAt,
  };
}

/** The terminal state a Run reaches when its peer's Task ends in `phase`. */
function settledFor(phase: A2aTaskPhase): SettledStatus {
  if (phase === "failed") return "failed";
  if (phase === "canceled") return "cancelled";
  return "completed";
}

/**
 * Registry of **attached A2A agents**: heterogeneous agents that already run as
 * a service somewhere and speak the A2A protocol. Tangent is their client, so
 * there is no spawn and no kill — a tab is created by discovering an Agent Card
 * and ended by letting go of the address.
 *
 * A turn is one {@link Run}: the gateway opens it, records the peer's Task id on
 * it as `externalId`, relays the peer's stream into the tab through the shared
 * {@link ConversationEventSink}, and settles it when the peer's Task reaches a
 * terminal state. That is what makes a peer's work inspectable and cancellable
 * on the same terms as a local agent's, without Tangent owning the process.
 *
 * Sits alongside {@link
 * import("../external/externalSubagentGateway.ts").ExternalSubagentGateway} and
 * {@link import("../remote/remoteEnvironmentGateway.ts").RemoteEnvironmentGateway}.
 */
export class A2aPeerGateway {
  private readonly handlers: ConversationEventSink;
  private readonly runs: RunRegistry;
  private readonly store: SessionStore;
  private readonly emitUiCommand: UiCommandEmitter;
  private readonly credential: PeerBearerCredential;
  private readonly connect: A2aConnect;

  /** Per-session peer rosters, keyed by sessionId then agentId. */
  private readonly sessions = new Map<string, Map<string, A2aTab>>();

  constructor(
    handlers: ConversationEventSink,
    runs: RunRegistry,
    store: SessionStore,
    emitUiCommand: UiCommandEmitter,
    credential: PeerBearerCredential = a2aCredential,
    connect: A2aConnect = discoverPeer,
  ) {
    this.handlers = handlers;
    this.runs = runs;
    this.store = store;
    this.emitUiCommand = emitUiCommand;
    this.credential = credential;
    this.connect = connect;
  }

  /** True when `agentId` is an attached A2A peer of `sessionId`. */
  hasAgent(sessionId: string, agentId: string): boolean {
    return this.tabFor(sessionId, agentId) !== undefined;
  }

  /** The session's attached peers. */
  listSubagents(sessionId: string): SubagentInfo[] {
    const roster = this.sessions.get(sessionId);
    if (!roster) return [];
    return [...roster.values()].map(toInfo);
  }

  /**
   * Attaches a peer: reads its Agent Card, takes the name from it, and records
   * the tab. Discovery is what replaces spawn here, so a card that cannot be
   * read is a failed attach rather than a tab that never works.
   *
   * The roster row is awaited, not fired off: a Membership is derived from it,
   * so a delivery arriving before it lands would find nobody to address.
   */
  async attach(sessionId: string, spec: AttachA2aAgent): Promise<SubagentInfo> {
    const headers = this.credential.headers();
    const peer = await this.connect(spec.endpointUrl, headers);
    const tab: A2aTab = {
      agentId: randomUUID(),
      homeConversationId: randomUUID(),
      name: spec.name?.trim() || peer.card.name,
      status: "active",
      endpointUrl: spec.endpointUrl,
      createdAt: new Date().toISOString(),
      peer,
    };
    this.rosterFor(sessionId).set(tab.agentId, tab);
    await this.store.recordAgent(sessionId, {
      id: tab.agentId,
      role: "subagent",
      name: tab.name,
      purpose: peer.card.description,
      status: tab.status,
      connector: { ...connectorFor("a2a"), endpointUrl: tab.endpointUrl },
      homeConversationId: tab.homeConversationId,
    });
    const info = toInfo(tab);
    this.handlers.onSubagentUpdate(sessionId, info);
    return info;
  }

  /**
   * Restores a persisted tab as `detached`, from the endpoint the row kept.
   * Nothing is dialled here: a peer is a service that may well be gone, and a
   * restart is no reason to wake it. The next delivery re-discovers it.
   *
   * Idempotent, and never downgrades a live tab.
   */
  reattach(sessionId: string, agent: SessionAgent): void {
    const roster = this.rosterFor(sessionId);
    if (roster.get(agent.id)?.status === "active") return;
    const endpointUrl = agent.connector.endpointUrl;
    if (!endpointUrl) return;

    const tab: A2aTab = {
      agentId: agent.id,
      homeConversationId: agent.homeConversationId,
      name: agent.name,
      status: "detached",
      endpointUrl,
      createdAt: agent.createdAt,
    };
    roster.set(agent.id, tab);
    this.handlers.onSubagentUpdate(sessionId, toInfo(tab));
  }

  /**
   * Starts a turn against an attached peer. Returns whether this gateway holds
   * the participant at all — the exchange itself runs behind, because an A2A
   * turn is a request/response the sender does not wait on.
   */
  send(input: SendToPeer): boolean {
    const tab = this.tabFor(input.sessionId, input.participantId);
    if (!tab) return false;
    void this.turn(input, tab).catch((err: unknown) => {
      console.error(
        `[a2a] turn for "${tab.name}" in session ${input.sessionId} failed:`,
        err,
      );
    });
    return true;
  }

  /**
   * Cancels a peer's turn: drops the local stream and asks the peer to cancel
   * its Task. Both matter — the first stops the tab from filling with output
   * nobody asked for, the second is the only thing that stops the work.
   */
  cancel(sessionId: string, agentId: string): boolean {
    const tab = this.tabFor(sessionId, agentId);
    if (!tab?.abort) return false;
    this.stop(tab);
    // Settled here rather than left to the aborted stream: a peer that ignores
    // the abort must not leave a Run running forever. The turn's own settle
    // finds nothing to do.
    this.runs.settleOpenFor(sessionId, agentId, "cancelled");
    return true;
  }

  /**
   * Ends the attachment. What that is not: ending the agent. A peer outlives
   * every session that talks to it, so this drops the tab, stops listening, and
   * asks the peer to cancel whatever it was doing for us.
   */
  detach(sessionId: string, agentId: string, completed: boolean): void {
    const tab = this.tabFor(sessionId, agentId);
    if (!tab) return;

    this.stop(tab);
    tab.status = completed ? "completed" : "killed";
    this.rosterFor(sessionId).delete(agentId);
    this.runs.settleOpenFor(
      sessionId,
      agentId,
      completed ? "completed" : "failed",
    );
    this.handlers.onSubagentUpdate(sessionId, toInfo(tab));
  }

  /** Runs one exchange with a peer, relaying its stream into the tab. */
  private async turn(input: SendToPeer, tab: A2aTab): Promise<void> {
    const peer = await this.peerFor(input.sessionId, tab);
    if (!peer) {
      this.refuse(input, `Couldn't reach ${tab.name} at ${tab.endpointUrl}.`);
      return;
    }

    const abort = new AbortController();
    tab.abort = abort;
    const turn = this.openTurn(input, tab);

    try {
      await this.stream(
        turn,
        peer.send({
          text: input.text,
          taskId: tab.taskId,
          signal: abort.signal,
        }),
      );
    } catch (err) {
      // A cancelled turn is not a broken one: the stream ends because we asked
      // it to, and what the peer had said by then is still history.
      if (abort.signal.aborted) this.abortTurn(turn);
      else this.failTurn(turn, err);
      return;
    } finally {
      if (tab.abort === abort) tab.abort = undefined;
    }
    this.finishTurn(turn);
  }

  /** Opens the Run one turn is attributable to, and its accumulating state. */
  private openTurn(input: SendToPeer, tab: A2aTab): Turn {
    return {
      sessionId: input.sessionId,
      tab,
      run: this.runs.open({
        sessionId: input.sessionId,
        participantId: tab.agentId,
        homeConversationId: tab.homeConversationId,
        ingress: input.ingress ?? "reaction",
        externalId: tab.taskId,
      }),
      messageId: randomUUID(),
      started: false,
      content: "",
      phase: "working",
    };
  }

  /** Relays a peer's stream until it ends, or until its Task does. */
  private async stream(
    turn: Turn,
    events: AsyncIterable<A2aEvent>,
  ): Promise<void> {
    for await (const event of events) {
      await this.relay(turn, event);
      // A peer that keeps the stream open past a terminal state must not keep
      // the turn open with it.
      if (endsTurn(turn.phase)) break;
    }
  }

  /** Applies one normalized peer event to the turn. */
  private async relay(turn: Turn, event: A2aEvent): Promise<void> {
    this.noteTask(turn, event.taskId);
    if (event.kind === "artifact") {
      await saveA2aArtifact(this.store, this.emitUiCommand, {
        sessionId: turn.sessionId,
        taskId: event.taskId,
        artifact: event.artifact,
      });
      return;
    }
    if (event.kind === "task") {
      turn.phase = event.phase;
      return;
    }
    if (event.kind === "status") turn.phase = event.phase;
    this.append(turn, event.text);
  }

  /**
   * Records the peer's own id for this work against the Run, which is what makes
   * the two halves of a distributed turn reconcilable after the fact.
   */
  private noteTask(turn: Turn, taskId: string): void {
    if (!taskId || turn.tab.taskId === taskId) return;
    turn.tab.taskId = taskId;
    this.runs.setExternalId(turn.run.id, taskId);
  }

  /** Streams the peer's text into the tab, opening the bubble on first sight. */
  private append(turn: Turn, text: string): void {
    if (!text) return;
    if (!turn.started) {
      turn.started = true;
      this.emit(turn, { type: "start", messageId: turn.messageId });
    }
    turn.content += text;
    this.emit(turn, {
      type: "delta",
      messageId: turn.messageId,
      delta: text,
    });
  }

  /**
   * Finalizes a turn: persists what the peer said and settles the Run in the
   * state its Task reached. A Task left waiting for input keeps its id, so the
   * next delivery continues the same exchange rather than starting a new one.
   */
  private finishTurn(turn: Turn): void {
    if (turn.started) {
      this.emit(turn, {
        type: "end",
        messageId: turn.messageId,
        content: turn.content,
        thinking: "",
        aborted: turn.phase === "canceled",
      });
    }
    this.runs.settle(turn.run.id, settledFor(turn.phase));
    if (!awaitsInput(turn.phase)) turn.tab.taskId = undefined;
  }

  /**
   * Closes a turn the user cut short: the partial reply is persisted as history
   * that provokes nobody, and the peer is kept — it did nothing wrong.
   */
  private abortTurn(turn: Turn): void {
    if (turn.started) {
      this.emit(turn, {
        type: "end",
        messageId: turn.messageId,
        content: turn.content,
        thinking: "",
        aborted: true,
      });
    }
    this.runs.settle(turn.run.id, "cancelled");
  }

  /**
   * Reports a broken exchange in the peer's own thread and lets go of the
   * client, so the next delivery re-discovers rather than retrying a peer that
   * may have been restarted or moved.
   */
  private failTurn(turn: Turn, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.emit(turn, {
      type: "error",
      messageId: turn.started ? turn.messageId : undefined,
      message: `${turn.tab.name} stopped responding: ${message}`,
    });
    this.runs.settle(turn.run.id, "failed");
    turn.tab.peer = undefined;
    turn.tab.taskId = undefined;
    this.markDetached(turn.sessionId, turn.tab);
  }

  /**
   * The peer's client, discovered on first use and after a restart. A tab whose
   * peer cannot be reached goes `detached` rather than being dropped: the
   * address is still good tomorrow.
   */
  private async peerFor(
    sessionId: string,
    tab: A2aTab,
  ): Promise<A2aPeer | undefined> {
    if (tab.peer) return tab.peer;
    try {
      tab.peer = await this.connect(tab.endpointUrl, this.credential.headers());
    } catch (err) {
      console.error(`[a2a] discovery of ${tab.endpointUrl} failed:`, err);
      this.markDetached(sessionId, tab);
      return undefined;
    }
    this.markAttached(sessionId, tab);
    return tab.peer;
  }

  /** Drops the in-flight turn: stops listening, and stops the peer working. */
  private stop(tab: A2aTab): void {
    tab.abort?.abort();
    tab.abort = undefined;
    this.cancelTask(tab);
  }

  /** Asks the peer to cancel the Task we have open with it, if any. */
  private cancelTask(tab: A2aTab): void {
    const taskId = tab.taskId;
    const peer = tab.peer;
    tab.taskId = undefined;
    if (!taskId || !peer) return;
    void peer.cancel(taskId).catch((err: unknown) => {
      console.error(`[a2a] cancelling task ${taskId} failed:`, err);
    });
  }

  /** Says in the peer's own thread why a message went nowhere. */
  private refuse(input: SendToPeer, reason: string): void {
    const tab = this.tabFor(input.sessionId, input.participantId);
    this.handlers.onAgentMessage({
      sessionId: input.sessionId,
      conversationId: tab?.homeConversationId ?? input.participantId,
      author: SYSTEM_AUTHOR,
      content: reason,
    });
  }

  /** Marks a tab live, surfacing the change only when it is one. */
  private markAttached(sessionId: string, tab: A2aTab): void {
    if (tab.status === "active") return;
    tab.status = "active";
    this.handlers.onSubagentUpdate(sessionId, toInfo(tab));
  }

  /** Marks a tab detached, surfacing the change only when it is one. */
  private markDetached(sessionId: string, tab: A2aTab): void {
    if (tab.status !== "active") return;
    tab.status = "detached";
    this.handlers.onSubagentUpdate(sessionId, toInfo(tab));
  }

  /** Relays one agent event, attributed to the turn's Run. */
  private emit(turn: Turn, event: AgentEvent): void {
    this.handlers.onAgentEvent(turn.sessionId, descriptorFor(turn.tab), {
      ...event,
      runId: turn.run.id,
    });
  }

  /** The tab for a participant, if this gateway holds one. */
  private tabFor(sessionId: string, agentId: string): A2aTab | undefined {
    return this.sessions.get(sessionId)?.get(agentId);
  }

  /** Returns (creating if needed) the session's peer roster. */
  private rosterFor(sessionId: string): Map<string, A2aTab> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created = new Map<string, A2aTab>();
    this.sessions.set(sessionId, created);
    return created;
  }
}

/** Builds the agent descriptor a relayed event is tagged with. */
function descriptorFor(tab: A2aTab): AgentDescriptor {
  return {
    agentId: tab.agentId,
    role: "subagent",
    name: tab.name,
    homeConversationId: tab.homeConversationId,
  };
}
