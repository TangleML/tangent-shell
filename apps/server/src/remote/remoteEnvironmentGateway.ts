import { randomUUID } from "node:crypto";

import type {
  ChatAuthor,
  MessageDelivery,
  SubagentInfo,
  SubagentStatus,
} from "@tangent/shared/contracts.ts";
import {
  REMOTE_ENV_NAMESPACE,
  type RemoteAgentEvent,
  type RemoteAgentEventPayload,
  type RemoteAgentMessagePayload,
  type RemoteCsomCallRequest,
  type RemoteCsomCallResponse,
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
import type { SessionStore } from "../store/sessionStore.ts";

/** Default and maximum number of transcript messages a room read returns. */
const DEFAULT_ROOM_LIMIT = 30;
const MAX_ROOM_LIMIT = 200;

/** How long a CSOM invocation waits for the environment's ack before failing. */
const CSOM_CALL_TIMEOUT_MS = 20_000;

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
  /** Session this environment is bound to as the CSOM executor, if any. */
  sessionId?: string;
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
    host: "remote",
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
 */
export class RemoteEnvironmentGateway {
  private readonly io: SocketIOServer;
  private readonly handlers: PiAgentHandlers;
  private readonly store: SessionStore;
  private readonly deliverToPrime: DeliverToPrime;

  /** Connected environments, keyed by their handshake `environmentId`. */
  private readonly environments = new Map<string, RemoteEnvConnection>();
  /** Per-session remote sub-agent rosters, keyed by sessionId then agentId. */
  private readonly sessions = new Map<string, Map<string, RemoteSubagent>>();
  /** CSOM executor binding: sessionId -> environmentId (e.g. a browser tab). */
  private readonly csomBindings = new Map<string, string>();

  constructor(
    io: SocketIOServer,
    handlers: PiAgentHandlers,
    store: SessionStore,
    deliverToPrime: DeliverToPrime,
  ) {
    this.io = io;
    this.handlers = handlers;
    this.store = store;
    this.deliverToPrime = deliverToPrime;
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

  /** True when a session has a connected CSOM executor (pipeline editor). */
  hasCsomEditor(sessionId: string): boolean {
    const environmentId = this.csomBindings.get(sessionId);
    return environmentId !== undefined && this.environments.has(environmentId);
  }

  /**
   * Invokes a CSOM editing method on the session's bound editor environment and
   * resolves with its ack. Returns a structured `{ ok: false, error }` when no
   * editor is connected or the environment times out, so callers (Prime's CSOM
   * tools) can surface a helpful message rather than throw.
   */
  invokeCsom(
    sessionId: string,
    method: string,
    args: unknown[],
  ): Promise<RemoteCsomCallResponse> {
    const environmentId = this.csomBindings.get(sessionId);
    const environment = environmentId
      ? this.environments.get(environmentId)
      : undefined;
    if (!environment) {
      return Promise.resolve({
        ok: false,
        error:
          "No pipeline editor is connected for this session. Ask the user to " +
          "open the Pipeline Editor tab first.",
      });
    }

    const request: RemoteCsomCallRequest = { sessionId, method, args };
    return new Promise<RemoteCsomCallResponse>((resolve) => {
      environment.socket
        .timeout(CSOM_CALL_TIMEOUT_MS)
        .emit(
          RemoteEnvEvents.CsomCall,
          request,
          (err: Error | null, response: RemoteCsomCallResponse) => {
            if (err) {
              resolve({ ok: false, error: `CSOM call timed out: ${method}` });
              return;
            }
            resolve(response);
          },
        );
    });
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
   */
  sendToAgent(
    sessionId: string,
    agentId: string,
    text: string,
    surfaceAuthor?: ChatAuthor,
    delivery: MessageDelivery = "auto",
  ): void {
    const subagent = this.sessions.get(sessionId)?.get(agentId);
    if (!subagent) return;
    const environment = this.environments.get(subagent.environmentId);
    if (!environment) return;

    if (surfaceAuthor) {
      this.handlers.onAgentMessage(sessionId, agentId, surfaceAuthor, text);
    }

    const command: RemoteMessageCommand = {
      sessionId,
      agentId,
      text,
      delivery,
    };
    environment.socket.emit(RemoteEnvEvents.Message, command);
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
    const { environmentId, sessionId } = socket.handshake
      .auth as RemoteEnvHandshake;
    this.environments.set(environmentId, { environmentId, socket, sessionId });
    if (sessionId) this.csomBindings.set(sessionId, environmentId);
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
      payload.event,
    );
    this.relayEndToPrime(payload.sessionId, subagent, payload.event);
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
    if (payload.status !== "active") roster.delete(payload.agentId);
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
    for (const [sessionId, boundId] of this.csomBindings) {
      if (boundId === environmentId) this.csomBindings.delete(sessionId);
    }
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
      this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
    }
  }
}
