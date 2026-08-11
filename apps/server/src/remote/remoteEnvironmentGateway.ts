import { randomUUID } from "node:crypto";

import {
  type ChatAuthor,
  connectorFields,
  type MessageDelivery,
  type RunId,
  type RunIngress,
  type SubagentInfo,
  type SubagentStatus,
} from "@tangent/shared/contracts.ts";
import {
  REMOTE_ENV_NAMESPACE,
  type RemoteAgentEvent,
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

import { REMOTE_ENV_TOKEN } from "../config.ts";
import {
  resolveSubagentConfig,
  type SubagentSpawnRequest,
} from "../pi/agentConfig.ts";
import type { SpawnedSubagent } from "../pi/piAgentManager.ts";
import type { AgentDescriptor, PiAgentHandlers } from "../pi/types.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";
import type { SessionStore } from "../store/sessionStore.ts";

/** Default and maximum number of transcript messages a room read returns. */
const DEFAULT_ROOM_LIMIT = 30;
const MAX_ROOM_LIMIT = 200;

/**
 * Relays a remote sub-agent's reply/report into the session's Prime process.
 * Wired in `index.ts` to `pi.sendToAgent(sessionId, PRIME_AGENT_ID, text)`, so
 * the gateway stays decoupled from {@link import("../pi/piAgentManager.ts").PiAgentManager}.
 */
export type DeliverToPrime = (sessionId: string, text: string) => void;

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
 * Inbound streamed events are relayed through the same {@link PiAgentHandlers}
 * a local sub-agent uses, so a remote sub-agent renders and persists
 * identically; finalized replies and reports are relayed into Prime via
 * {@link DeliverToPrime}.
 *
 * The protocol has no run-end marker: an environment reports its events and its
 * agent's lifecycle, not run boundaries. So the gateway opens a Run when it
 * sends work and settles it from what the protocol does say — the next piece of
 * work for that participant, a status change, or the environment dropping.
 */
export class RemoteEnvironmentGateway {
  private readonly io: SocketIOServer;
  private readonly handlers: PiAgentHandlers;
  private readonly store: SessionStore;
  private readonly deliverToPrime: DeliverToPrime;
  private readonly runs: RunRegistry;

  /** Connected environments, keyed by their handshake `environmentId`. */
  private readonly environments = new Map<string, RemoteEnvConnection>();
  /** Per-session remote sub-agent rosters, keyed by sessionId then agentId. */
  private readonly sessions = new Map<string, Map<string, RemoteSubagent>>();

  constructor(
    io: SocketIOServer,
    handlers: PiAgentHandlers,
    store: SessionStore,
    deliverToPrime: DeliverToPrime,
    runs: RunRegistry,
  ) {
    this.io = io;
    this.handlers = handlers;
    this.store = store;
    this.deliverToPrime = deliverToPrime;
    this.runs = runs;
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

    // An initial task is work, so it gets a Run; a sub-agent spawned idle does
    // not until something asks it for something.
    const runId = request.task?.trim()
      ? this.runs.open({ sessionId, participantId: agentId, ingress: "tool" })
          .id
      : undefined;

    const command: RemoteSpawnCommand = {
      sessionId,
      agentId,
      name: request.name,
      tools,
      systemPrompt: config.appendSystemPrompt,
      model: config.model,
      thinkingDepth: config.thinkingDepth,
      template: request.template,
      task: request.task,
      autoRelayToPrime,
      runId,
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
   * Delivers a directed message/task to a remote sub-agent. When
   * `surfaceAuthor` is given, the message is also surfaced into the sub-agent's
   * transcript (matching the local manager), so directed tasks read as a real
   * conversation. No-op for an unknown agent or a disconnected environment.
   *
   * Opens a Run for the message and puts its id on the command, so the
   * environment can echo it back on the events it streams.
   */
  sendToAgent(
    sessionId: string,
    agentId: string,
    text: string,
    surfaceAuthor?: ChatAuthor,
    delivery: MessageDelivery = "auto",
    ingress: RunIngress = "reaction",
  ): void {
    const environment = this.environmentFor(sessionId, agentId);
    if (!environment) return;

    if (surfaceAuthor) {
      this.handlers.onAgentMessage(sessionId, agentId, surfaceAuthor, text);
    }

    const run = this.runs.open({ sessionId, participantId: agentId, ingress });
    const command: RemoteMessageCommand = {
      sessionId,
      agentId,
      text,
      delivery,
      runId: run.id,
    };
    environment.socket.emit(RemoteEnvEvents.Message, command);
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
    if (!REMOTE_ENV_TOKEN || auth.token !== REMOTE_ENV_TOKEN) {
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
      (payload: RemoteAgentMessagePayload) => this.handleAgentMessage(payload),
    );
    socket.on(
      RemoteEnvEvents.RoomRead,
      (
        request: RemoteRoomReadRequest,
        callback: (response: RemoteRoomReadResponse) => void,
      ) => void this.handleRoomRead(request, callback),
    );
    socket.on("disconnect", () => this.onDisconnect(environmentId));
  }

  /** Relays a streamed event to the chat layer, relaying finalized replies. */
  private handleAgentEvent(payload: RemoteAgentEventPayload): void {
    const subagent = this.sessions.get(payload.sessionId)?.get(payload.agentId);
    if (!subagent) return;
    this.handlers.onAgentEvent(
      payload.sessionId,
      this.descriptorFor(subagent),
      { ...payload.event, runId: this.runIdFor(payload) },
    );
    this.relayEndToPrime(payload.sessionId, subagent, payload.event);
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

  /** Feeds a finalized auto-relay reply into Prime as it lands. */
  private relayEndToPrime(
    sessionId: string,
    subagent: RemoteSubagent,
    event: RemoteAgentEvent,
  ): void {
    if (event.type !== "end") return;
    if (!subagent.autoRelayToPrime || !event.content.trim()) return;
    this.deliverToPrime(
      sessionId,
      `Sub-agent "${subagent.name}" replied:\n\n${event.content}`,
    );
  }

  /** Applies a remote sub-agent's status change to the roster + chat layer. */
  private handleSubagentUpdate(payload: RemoteSubagentUpdatePayload): void {
    const roster = this.sessions.get(payload.sessionId);
    const subagent = roster?.get(payload.agentId);
    if (!roster || !subagent) return;

    subagent.status = payload.status;
    if (payload.status !== "active") {
      roster.delete(payload.agentId);
      // The agent leaving `active` is the closest thing the protocol has to a
      // run-end marker: whatever it was working on is over either way.
      this.runs.settleOpenFor(
        payload.sessionId,
        payload.agentId,
        payload.status === "completed" ? "completed" : "failed",
      );
    }
    this.handlers.onSubagentUpdate(payload.sessionId, toInfo(subagent));
  }

  /** Surfaces a sub-agent's report in its thread and relays it into Prime. */
  private handleAgentMessage(payload: RemoteAgentMessagePayload): void {
    const subagent = this.sessions.get(payload.sessionId)?.get(payload.agentId);
    if (!subagent) return;

    const author: ChatAuthor = {
      id: subagent.agentId,
      kind: "agent",
      name: subagent.name,
      agentRole: "subagent",
    };
    this.handlers.onAgentMessage(
      payload.sessionId,
      payload.agentId,
      author,
      payload.text,
    );
    this.deliverToPrime(
      payload.sessionId,
      `Sub-agent "${subagent.name}" reported:\n\n${payload.text}`,
    );
  }

  /** Answers a remote room-read with the tail of the shared transcript. */
  private async handleRoomRead(
    request: RemoteRoomReadRequest,
    callback: (response: RemoteRoomReadResponse) => void,
  ): Promise<void> {
    const all = await this.store.getMessages(request.sessionId);
    callback({ messages: all.slice(-clampLimit(request.limit)) });
  }

  /** Drops a disconnected environment and fails its still-live sub-agents. */
  private onDisconnect(environmentId: string): void {
    this.environments.delete(environmentId);
    for (const [sessionId, roster] of this.sessions) {
      this.failEnvironmentAgents(sessionId, roster, environmentId);
    }
    console.log(`[remote-env] disconnected: ${environmentId}`);
  }

  /** Marks every sub-agent owned by `environmentId` in a roster as errored. */
  private failEnvironmentAgents(
    sessionId: string,
    roster: Map<string, RemoteSubagent>,
    environmentId: string,
  ): void {
    for (const subagent of [...roster.values()]) {
      if (subagent.environmentId !== environmentId) continue;
      subagent.status = "error";
      roster.delete(subagent.agentId);
      // The far side is gone mid-work: the Run stopped without finishing.
      this.runs.settleOpenFor(sessionId, subagent.agentId, "failed");
      this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
    }
  }
}
