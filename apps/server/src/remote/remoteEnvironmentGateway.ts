import { randomUUID } from "node:crypto";

import {
  connectorFields,
  isTerminalStatus,
  type MessageDelivery,
  RESTORABLE_STATUSES,
  type RunId,
  type RunIngress,
  type SubagentInfo,
  type SubagentStatus,
} from "@tangent/shared/contracts.ts";
import {
  REMOTE_ENV_NAMESPACE,
  type RemoteAgentEventPayload,
  type RemoteAgentMessagePayload,
  RemoteEnvEvents,
  type RemoteEnvHandshake,
  type RemoteKillCommand,
  type RemoteMessageCommand,
  type RemoteRoomReadRequest,
  type RemoteRoomReadResponse,
  type RemoteSpawnCommand,
  type RemoteSubagentUpdatePayload,
} from "@tangent/shared/remoteSubagent.ts";
import type { Namespace, Server as SocketIOServer, Socket } from "socket.io";

import {
  type ConnectorCredential,
  remoteEnvCredential,
} from "../connectors/credentials.ts";
import { orchestratorIdFor } from "../conversation/participantRegistry.ts";
import {
  parseThinkingLevel,
  resolveSubagentConfig,
  type SubagentSpawnRequest,
} from "../pi/agentConfig.ts";
import type { SpawnedSubagent } from "../pi/piAgentManager.ts";
import type { AgentDescriptor, ConversationEventSink } from "../pi/types.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";
import type { SessionAgent, SessionStore } from "../store/sessionStore.ts";

/** Default and maximum number of transcript messages a room read returns. */
const DEFAULT_ROOM_LIMIT = 30;
const MAX_ROOM_LIMIT = 200;

/** One message to deliver to one remote sub-agent. */
export interface RemoteSendOptions {
  sessionId: string;
  agentId: string;
  text: string;
  /** Whether a mid-run message steers or queues. Defaults to `auto`. */
  delivery?: MessageDelivery;
  /** What the message counts as for the Run it opens. Defaults to `reaction`. */
  ingress?: RunIngress;
}

/** A connected remote environment and its live Socket.IO connection. */
interface RemoteEnvConnection {
  environmentId: string;
  socket: Socket;
}

/** A sub-agent hosted in a remote environment, tracked in the gateway roster. */
interface RemoteSubagent {
  agentId: string;
  name: string;
  status: SubagentStatus;
  template?: string;
  model?: string;
  thinkingDepth?: SubagentInfo["thinkingDepth"];
  createdAt: string;
  /** Which connected environment hosts this sub-agent. */
  environmentId: string;
  /** Whether finalized replies auto-relay back to Prime. */
  autoRelayToPrime: boolean;
}

/** Clamps a requested room-read limit to the allowed range. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_ROOM_LIMIT;
  }
  return Math.min(limit, MAX_ROOM_LIMIT);
}

/** Projects a roster entry onto the wire {@link SubagentInfo}. */
function toInfo(subagent: RemoteSubagent): SubagentInfo {
  return {
    id: subagent.agentId,
    name: subagent.name,
    status: subagent.status,
    ...connectorFields("remote-env", subagent.environmentId),
    template: subagent.template,
    model: subagent.model,
    thinkingDepth: subagent.thinkingDepth,
    createdAt: subagent.createdAt,
  };
}

/**
 * Server-side endpoint for the **remote sub-agent** transport. Accepts remote
 * environments on a dedicated Socket.IO namespace and exposes the same
 * spawn/message/kill/list surface as {@link
 * import("../pi/piAgentManager.ts").PiAgentManager}, so the internal agents API
 * can route a sub-agent to either host transparently.
 *
 * Inbound streamed events are relayed through the same {@link
 * ConversationEventSink} a local sub-agent uses, so a remote sub-agent renders
 * and persists identically. Whether a finalized reply or a report wakes Prime is
 * not this gateway's business: it posts what happened into the sub-agent's
 * Conversation, and the Memberships there decide.
 *
 * The protocol has no run-end marker: an environment reports its events and its
 * agent's lifecycle, not run boundaries. So the gateway opens a Run when it
 * sends work and settles it from what the protocol does say — the next piece of
 * work for that participant, a status change, or the environment dropping.
 */
export class RemoteEnvironmentGateway {
  private readonly io: SocketIOServer;
  private readonly handlers: ConversationEventSink;
  private readonly store: SessionStore;
  private readonly runs: RunRegistry;
  private readonly credential: ConnectorCredential;

  /** Connected environments, keyed by their handshake `environmentId`. */
  private readonly environments = new Map<string, RemoteEnvConnection>();
  /** Per-session remote sub-agent rosters, keyed by sessionId then agentId. */
  private readonly sessions = new Map<string, Map<string, RemoteSubagent>>();

  constructor(
    io: SocketIOServer,
    handlers: ConversationEventSink,
    store: SessionStore,
    runs: RunRegistry,
    credential: ConnectorCredential = remoteEnvCredential,
  ) {
    this.io = io;
    this.handlers = handlers;
    this.store = store;
    this.runs = runs;
    this.credential = credential;
    this.setupNamespace();
  }

  /** True when at least one remote environment is connected. */
  hasConnectedEnvironment(): boolean {
    return this.environments.size > 0;
  }

  /** True when `agentId` is a remote sub-agent of `sessionId`. */
  hasAgent(sessionId: string, agentId: string): boolean {
    return Boolean(this.sessions.get(sessionId)?.has(agentId));
  }

  /** The session's remote sub-agent roster (Prime/local agents excluded). */
  listSubagents(sessionId: string): SubagentInfo[] {
    const roster = this.sessions.get(sessionId);
    if (!roster) return [];
    return [...roster.values()].map(toInfo);
  }

  /**
   * Spawns a sub-agent on a connected remote environment. Resolves the
   * effective config from the global templates/defaults (remote environments
   * are bundle-agnostic in this iteration), records the roster entry, and emits
   * the spawn command. Throws when no environment is connected.
   */
  spawnSubagent(
    sessionId: string,
    request: SubagentSpawnRequest,
  ): SpawnedSubagent {
    const environment = this.pickEnvironment();
    if (!environment) {
      throw new Error("No remote environment is connected.");
    }

    const agentId = randomUUID();
    const config = resolveSubagentConfig(request);
    const autoRelayToPrime = request.autoRelayToPrime ?? true;
    const tools = [...config.tools];

    const subagent: RemoteSubagent = {
      agentId,
      name: request.name,
      status: "active",
      template: request.template,
      model: config.model,
      thinkingDepth: config.thinkingDepth,
      createdAt: new Date().toISOString(),
      environmentId: environment.environmentId,
      autoRelayToPrime,
    };
    this.rosterFor(sessionId).set(agentId, subagent);

    // No `task`: an initial task is a Message posted into the new sub-agent's
    // Conversation, which arrives here as an ordinary delivery right after this
    // command. So the environment always spawns idle.
    const command: RemoteSpawnCommand = {
      sessionId,
      agentId,
      name: request.name,
      tools,
      systemPrompt: config.appendSystemPrompt,
      model: config.model,
      thinkingDepth: config.thinkingDepth,
      template: request.template,
      autoRelayToPrime,
    };
    environment.socket.emit(RemoteEnvEvents.Spawn, command);

    const info = toInfo(subagent);
    this.handlers.onSubagentUpdate(sessionId, info);
    return {
      info,
      tools,
      systemPrompt: config.appendSystemPrompt,
      autoRelayToPrime,
    };
  }

  /**
   * Delivers a directed message/task to a remote sub-agent. Opens a Run for the
   * message and puts its id on the command, so the environment can echo it back
   * on the events it streams.
   *
   * Returns whether the message reached an environment: a detached participant
   * stays in the roster, so its connector needs to hear that nothing was sent
   * rather than assume a silent success.
   */
  sendToAgent(options: RemoteSendOptions): boolean {
    const { sessionId, agentId, text } = options;
    const environment = this.environmentFor(sessionId, agentId);
    if (!environment) return false;

    const run = this.runs.open({
      sessionId,
      participantId: agentId,
      ingress: options.ingress ?? "reaction",
    });
    const command: RemoteMessageCommand = {
      sessionId,
      agentId,
      text,
      delivery: options.delivery ?? "auto",
      runId: run.id,
    };
    environment.socket.emit(RemoteEnvEvents.Message, command);
    return true;
  }

  /**
   * Restores a persisted sub-agent's roster entry as `detached`. The protocol
   * has no way to ask an environment what it still runs, so the entry exists to
   * be reattached to rather than claiming to be live: the far end reattaches by
   * sending a `subagent-update` marking the participant `active` again.
   *
   * Idempotent, and never downgrades a live entry — a reconnect that races a
   * join must not detach something the environment has already re-declared.
   */
  reattach(sessionId: string, agent: SessionAgent): void {
    const environmentId = agent.connector.environmentId;
    // Rows written before the connector columns existed never recorded which
    // environment hosted them, so there is nothing to reattach them to.
    if (!environmentId) return;

    const roster = this.rosterFor(sessionId);
    if (roster.get(agent.id)?.status === "active") return;

    const subagent: RemoteSubagent = {
      agentId: agent.id,
      name: agent.name,
      status: "detached",
      template: agent.template,
      model: agent.model,
      thinkingDepth: parseThinkingLevel(agent.thinkingDepth),
      createdAt: agent.createdAt,
      environmentId,
      autoRelayToPrime: agent.autoRelayToPrime ?? true,
    };
    roster.set(agent.id, subagent);
    this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
  }

  /** The connected environment hosting a sub-agent, if both are still live. */
  private environmentFor(
    sessionId: string,
    agentId: string,
  ): RemoteEnvConnection | undefined {
    const subagent = this.sessions.get(sessionId)?.get(agentId);
    if (!subagent) return undefined;
    return this.environments.get(subagent.environmentId);
  }

  /**
   * Terminates a remote sub-agent and records its terminal status. `completed`
   * marks a graceful finish; otherwise it is "killed".
   */
  killAgent(sessionId: string, agentId: string, completed = false): void {
    const roster = this.sessions.get(sessionId);
    if (!roster) return;
    const subagent = roster.get(agentId);
    if (!subagent) return;

    subagent.status = completed ? "completed" : "killed";
    roster.delete(agentId);
    this.runs.settleOpenFor(
      sessionId,
      agentId,
      completed ? "completed" : "cancelled",
    );
    this.emitToEnvironment(subagent.environmentId, RemoteEnvEvents.Kill, {
      sessionId,
      agentId,
      completed,
    } satisfies RemoteKillCommand);
    this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
  }

  /** Emits an event to a specific environment's socket, if still connected. */
  private emitToEnvironment(
    environmentId: string,
    event: string,
    payload: unknown,
  ): void {
    this.environments.get(environmentId)?.socket.emit(event, payload);
  }

  /** Picks a connected environment to host a new sub-agent (first connected). */
  private pickEnvironment(): RemoteEnvConnection | undefined {
    const first = this.environments.values().next();
    return first.done ? undefined : first.value;
  }

  /** Returns (creating if needed) the session's remote sub-agent roster. */
  private rosterFor(sessionId: string): Map<string, RemoteSubagent> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created = new Map<string, RemoteSubagent>();
    this.sessions.set(sessionId, created);
    return created;
  }

  /** Builds the agent descriptor a relayed event is tagged with. */
  private descriptorFor(subagent: RemoteSubagent): AgentDescriptor {
    return { agentId: subagent.agentId, role: "subagent", name: subagent.name };
  }

  /** Creates the `/remote-env` namespace with auth + connection handlers. */
  private setupNamespace(): void {
    const namespace = this.io.of(REMOTE_ENV_NAMESPACE);
    namespace.use((socket, next) => this.authenticate(socket, next));
    namespace.on("connection", (socket) =>
      this.onConnection(namespace, socket),
    );
  }

  /** Rejects connections lacking a valid token / environment id. */
  private authenticate(socket: Socket, next: (err?: Error) => void): void {
    const auth = socket.handshake.auth as Partial<RemoteEnvHandshake>;
    if (!this.credential.verify({ token: auth.token })) {
      next(new Error("Unauthorized"));
      return;
    }
    if (!auth.environmentId) {
      next(new Error("Missing environmentId"));
      return;
    }
    next();
  }

  /** Registers a connected environment and wires its inbound listeners. */
  private onConnection(_namespace: Namespace, socket: Socket): void {
    const { environmentId } = socket.handshake.auth as RemoteEnvHandshake;
    this.environments.set(environmentId, { environmentId, socket });
    console.log(`[remote-env] connected: ${environmentId}`);

    socket.on(RemoteEnvEvents.AgentEvent, (payload: RemoteAgentEventPayload) =>
      this.handleAgentEvent(payload),
    );
    socket.on(
      RemoteEnvEvents.SubagentUpdate,
      (payload: RemoteSubagentUpdatePayload) =>
        this.handleSubagentUpdate(payload),
    );
    socket.on(
      RemoteEnvEvents.AgentMessage,
      (payload: RemoteAgentMessagePayload) =>
        void this.handleAgentMessage(payload),
    );
    socket.on(
      RemoteEnvEvents.RoomRead,
      (
        request: RemoteRoomReadRequest,
        callback: (response: RemoteRoomReadResponse) => void,
      ) => void this.handleRoomRead(request, callback),
    );
    socket.on("disconnect", () => this.onDisconnect(environmentId));

    void this.replayRoster(environmentId);
  }

  /**
   * Rebuilds the roster this environment's persisted sub-agents belong to, so a
   * reconnect after a server restart has tabs to reattach to instead of an empty
   * roster. Each comes back `detached`; the environment moves whichever it still
   * runs back to `active`.
   */
  private async replayRoster(environmentId: string): Promise<void> {
    const agents = await this.store.listAgentsForEnvironment(environmentId);
    for (const agent of agents) {
      if (!RESTORABLE_STATUSES.includes(agent.status)) continue;
      this.reattach(agent.sessionId, agent);
    }
  }

  /**
   * Relays a streamed event to the chat layer. A finalized one is persisted as a
   * Message there and fanned out from the sub-agent's own Conversation, so this
   * gateway no longer feeds Prime a second copy.
   */
  private handleAgentEvent(payload: RemoteAgentEventPayload): void {
    const subagent = this.sessions.get(payload.sessionId)?.get(payload.agentId);
    if (!subagent) return;
    this.markAttached(payload.sessionId, subagent);
    this.handlers.onAgentEvent(
      payload.sessionId,
      this.descriptorFor(subagent),
      { ...payload.event, runId: this.runIdFor(payload) },
    );
  }

  /**
   * Completes the reattach: a detached participant producing output is the far
   * end declaring itself live again, which is the only evidence this protocol
   * offers. No-op — and no roster churn — for one that was already live.
   */
  private markAttached(sessionId: string, subagent: RemoteSubagent): void {
    if (subagent.status !== "detached") return;
    subagent.status = "active";
    this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
  }

  /**
   * The Run an inbound event belongs to: the id the environment echoed, or the
   * one that participant currently has open. An environment that echoes nothing
   * still gets attribution, and an echoed id the server no longer holds open is
   * still trusted — it names the work, and the store has the rest.
   */
  private runIdFor(payload: RemoteAgentEventPayload): RunId | undefined {
    if (payload.runId) return payload.runId;
    return this.runs.current(payload.sessionId, payload.agentId)?.id;
  }

  /** Applies a remote sub-agent's status change to the roster + chat layer. */
  private handleSubagentUpdate(payload: RemoteSubagentUpdatePayload): void {
    const roster = this.sessions.get(payload.sessionId);
    const subagent = roster?.get(payload.agentId);
    if (!roster || !subagent) return;

    subagent.status = payload.status;
    if (isTerminalStatus(payload.status)) {
      roster.delete(payload.agentId);
      // The agent reaching a terminal status is the closest thing the protocol
      // has to a run-end marker: whatever it was working on is over either way.
      this.runs.settleOpenFor(
        payload.sessionId,
        payload.agentId,
        payload.status === "completed" ? "completed" : "failed",
      );
    }
    this.handlers.onSubagentUpdate(payload.sessionId, toInfo(subagent));
  }

  /**
   * Posts a sub-agent's report in its own thread, addressed to Prime. Being
   * addressed is what reaches Prime — the same mechanism a local sub-agent's
   * `message_prime` uses, so neither transport carries its own copy of "and now
   * tell Prime".
   */
  private async handleAgentMessage(
    payload: RemoteAgentMessagePayload,
  ): Promise<void> {
    const subagent = this.sessions.get(payload.sessionId)?.get(payload.agentId);
    if (!subagent) return;
    this.markAttached(payload.sessionId, subagent);

    this.handlers.onAgentMessage({
      sessionId: payload.sessionId,
      conversationId: payload.agentId,
      author: {
        id: subagent.agentId,
        kind: "agent",
        name: subagent.name,
        agentRole: "subagent",
      },
      content: payload.text,
      mentions: [await orchestratorIdFor(this.store, payload.sessionId)],
      ingress: "tool",
    });
  }

  /** Answers a remote room-read with the tail of the shared transcript. */
  private async handleRoomRead(
    request: RemoteRoomReadRequest,
    callback: (response: RemoteRoomReadResponse) => void,
  ): Promise<void> {
    const all = await this.store.getMessages(request.sessionId);
    callback({ messages: all.slice(-clampLimit(request.limit)) });
  }

  /** Drops a disconnected environment and detaches its sub-agents. */
  private onDisconnect(environmentId: string): void {
    this.environments.delete(environmentId);
    for (const [sessionId, roster] of this.sessions) {
      this.detachEnvironmentAgents(sessionId, roster, environmentId);
    }
    console.log(`[remote-env] disconnected: ${environmentId}`);
  }

  /**
   * Marks every sub-agent hosted by `environmentId` as `detached`, keeping its
   * roster entry. "The far end is gone" is not an error and not a kill, and the
   * entry has to survive for the environment to reattach to when it comes back.
   */
  private detachEnvironmentAgents(
    sessionId: string,
    roster: Map<string, RemoteSubagent>,
    environmentId: string,
  ): void {
    for (const subagent of roster.values()) {
      if (subagent.environmentId !== environmentId) continue;
      if (isTerminalStatus(subagent.status)) continue;
      subagent.status = "detached";
      // The far side is gone mid-work: the Run stopped without finishing.
      this.runs.settleOpenFor(sessionId, subagent.agentId, "failed");
      this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
    }
  }
}
