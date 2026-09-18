import { randomUUID } from "node:crypto";
import path from "node:path";

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
  type RemoteToolCallRequest,
  type RemoteToolCallResponse,
  type RemoteToolDef,
  type RemoteToolsRegisterPayload,
} from "@tangent/shared/remoteSubagent.ts";
import type { Namespace, Server as SocketIOServer, Socket } from "socket.io";

import { SESSIONS_ROOT } from "../config.ts";
import {
  type ConnectorCredential,
  remoteEnvCredential,
  scopedRemoteEnvCredential,
  type ScopedTokenCredential,
} from "../connectors/credentials.ts";
import { ContextEngine, projectRoom } from "../conversation/context.ts";
import type { MembershipRegistry } from "../conversation/membershipRegistry.ts";
import { orchestratorIdFor } from "../conversation/participantRegistry.ts";
import {
  parseThinkingLevel,
  type ResolvedSessionConfig,
  resolveSubagentConfig,
  type SubagentSpawnRequest,
} from "../pi/agentConfig.ts";
import { loadInstalledConfig } from "../pi/config/bundleLoader.ts";
import type { SpawnedSubagent } from "../pi/piAgentManager.ts";
import type { AgentDescriptor, ConversationEventSink } from "../pi/types.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";
import type { SessionAgent, SessionStore } from "../store/sessionStore.ts";

/** Default and maximum number of transcript messages a room read returns. */
const DEFAULT_ROOM_LIMIT = 30;
const MAX_ROOM_LIMIT = 200;

/** How long a remote tool call waits for the environment's ack before failing. */
const TOOL_CALL_TIMEOUT_MS = 30_000;

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
  /** Set when the environment authenticated with a scoped per-session token. */
  sessionId?: string;
  socket: Socket;
  /** The RPC tools this environment currently offers, keyed by tool name. */
  tools: Map<string, RemoteToolDef>;
}

/** Looks up a session's installed bundle config for remote spawn resolution. */
export type SessionConfigLookup = (
  sessionId: string,
) => ResolvedSessionConfig | undefined;

/** Re-resolves the session's installed bundle, or `undefined` for a plain session. */
function loadSessionBundleConfig(
  sessionId: string,
): ResolvedSessionConfig | undefined {
  try {
    return loadInstalledConfig(path.join(SESSIONS_ROOT, sessionId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[remote-env] failed to load installed bundle config for "${sessionId}"; using default config. ${message}`,
    );
    return undefined;
  }
}

/** Reads a non-empty string off `socket.data`, or `undefined`. */
function socketDataString(socket: Socket, key: string): string | undefined {
  const value: unknown = socket.data[key];
  if (typeof value !== "string" || !value) return undefined;
  return value;
}

/** A sub-agent hosted in a remote environment, tracked in the gateway roster. */
interface RemoteSubagent {
  agentId: string;
  /** The Conversation this sub-agent's tab lives in, distinct from its id. */
  homeConversationId: string;
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
    conversationId: subagent.homeConversationId,
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
  private readonly scoped: ScopedTokenCredential;
  private readonly sessionConfig: SessionConfigLookup;
  /** Wired after construction (the engine and registry are built later): a room
   * read naming a Conversation + Participant is projected through its policy. */
  private context?: ContextEngine;
  private memberships?: MembershipRegistry;

  /** Connected environments, keyed by `environmentId`. */
  private readonly environments = new Map<string, RemoteEnvConnection>();
  /** Scoped environment bound to a session, keyed by sessionId. */
  private readonly sessionEnvironments = new Map<string, string>();
  /** Per-session remote sub-agent rosters, keyed by sessionId then agentId. */
  private readonly sessions = new Map<string, Map<string, RemoteSubagent>>();

  constructor(
    io: SocketIOServer,
    handlers: ConversationEventSink,
    store: SessionStore,
    runs: RunRegistry,
    credential: ConnectorCredential = remoteEnvCredential,
    scoped: ScopedTokenCredential = scopedRemoteEnvCredential,
    sessionConfig: SessionConfigLookup = loadSessionBundleConfig,
  ) {
    this.io = io;
    this.handlers = handlers;
    this.store = store;
    this.runs = runs;
    this.credential = credential;
    this.scoped = scoped;
    this.sessionConfig = sessionConfig;
    this.setupNamespace();
  }

  /**
   * Wires the context projection a room read uses when it names a Conversation
   * and Participant. Separate from the constructor because the engine and the
   * membership registry are built after the gateway.
   */
  useContextProjection(
    context: ContextEngine,
    memberships: MembershipRegistry,
  ): void {
    this.context = context;
    this.memberships = memberships;
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
   * effective config from the session's installed bundle templates/defaults
   * (falling back to the global templates), records the roster entry, and emits
   * the spawn command. Throws when no environment is connected for the session.
   */
  spawnSubagent(
    sessionId: string,
    request: SubagentSpawnRequest,
  ): SpawnedSubagent {
    const environment = this.pickEnvironment(sessionId);
    if (!environment) {
      throw new Error("No remote environment is connected.");
    }

    const agentId = randomUUID();
    const homeConversationId = randomUUID();
    const sessionConfig = this.sessionConfig(sessionId);
    const config = resolveSubagentConfig(request, {
      templates: sessionConfig?.templates,
      defaults: sessionConfig?.subagentDefaults,
    });
    const autoRelayToPrime = request.autoRelayToPrime ?? true;
    const tools = [...config.tools];

    const subagent: RemoteSubagent = {
      agentId,
      homeConversationId,
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
      homeConversationId: this.homeConversationOf(sessionId, agentId),
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
      homeConversationId: agent.homeConversationId,
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

  /** The environment bound to `sessionId`, or the first unscoped shared-secret env. */
  private pickEnvironment(sessionId: string): RemoteEnvConnection | undefined {
    const bound = this.boundEnvironment(sessionId);
    if (bound) return bound;
    return this.firstUnscopedEnvironment();
  }

  /** The live environment recorded against `sessionId`, if still connected. */
  private boundEnvironment(sessionId: string): RemoteEnvConnection | undefined {
    const boundId = this.sessionEnvironments.get(sessionId);
    if (!boundId) return undefined;
    return this.environments.get(boundId);
  }

  /** First connected environment that is not bound to a session. */
  private firstUnscopedEnvironment(): RemoteEnvConnection | undefined {
    for (const environment of this.environments.values()) {
      if (environment.sessionId) continue;
      return environment;
    }
    return undefined;
  }

  /** Returns (creating if needed) the session's remote sub-agent roster. */
  /** A sub-agent's home Conversation, falling back to its id for a legacy row. */
  private homeConversationOf(sessionId: string, agentId: string): string {
    return (
      this.sessions.get(sessionId)?.get(agentId)?.homeConversationId ?? agentId
    );
  }

  private rosterFor(sessionId: string): Map<string, RemoteSubagent> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created = new Map<string, RemoteSubagent>();
    this.sessions.set(sessionId, created);
    return created;
  }

  /** Builds the agent descriptor a relayed event is tagged with. */
  private descriptorFor(subagent: RemoteSubagent): AgentDescriptor {
    return {
      agentId: subagent.agentId,
      role: "subagent",
      name: subagent.name,
      homeConversationId: subagent.homeConversationId,
    };
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
    const scoped = this.scoped.parse(auth.token);
    if (scoped) {
      socket.data.environmentId = scoped.environmentId;
      socket.data.sessionId = scoped.sessionId;
      next();
      return;
    }
    if (!this.credential.verify({ token: auth.token })) {
      next(new Error("Unauthorized"));
      return;
    }
    if (!auth.environmentId) {
      next(new Error("Missing environmentId"));
      return;
    }
    socket.data.environmentId = auth.environmentId;
    next();
  }

  /** Registers a connected environment and wires its inbound listeners. */
  private onConnection(_namespace: Namespace, socket: Socket): void {
    const environmentId = socketDataString(socket, "environmentId");
    if (!environmentId) return;
    const sessionId = socketDataString(socket, "sessionId");

    if (sessionId) this.bindSessionEnvironment(sessionId, environmentId);
    this.environments.set(environmentId, {
      environmentId,
      sessionId,
      socket,
      tools: new Map(),
    });
    console.log(`[remote-env] connected: ${environmentId}`);

    this.wireInbound(socket, sessionId);
    socket.on("disconnect", () => this.onDisconnect(environmentId, socket));

    void this.replayRoster(environmentId);
  }

  /**
   * Records `environmentId` as the host for `sessionId`, disconnecting any
   * previous scoped environment still bound to that session.
   */
  private bindSessionEnvironment(
    sessionId: string,
    environmentId: string,
  ): void {
    const previousId = this.sessionEnvironments.get(sessionId);
    this.sessionEnvironments.set(sessionId, environmentId);
    if (!previousId || previousId === environmentId) return;
    this.environments.get(previousId)?.socket.disconnect();
  }

  /** True when an unscoped env may speak for any session, or the ids match. */
  private acceptsSession(
    boundSessionId: string | undefined,
    sessionId: string,
  ): boolean {
    if (!boundSessionId) return true;
    return boundSessionId === sessionId;
  }

  /** Wires protocol listeners, dropping cross-session traffic on scoped envs. */
  private wireInbound(socket: Socket, sessionId: string | undefined): void {
    socket.on(
      RemoteEnvEvents.AgentEvent,
      (payload: RemoteAgentEventPayload) => {
        if (!this.acceptsSession(sessionId, payload.sessionId)) return;
        this.handleAgentEvent(payload);
      },
    );
    socket.on(
      RemoteEnvEvents.SubagentUpdate,
      (payload: RemoteSubagentUpdatePayload) => {
        if (!this.acceptsSession(sessionId, payload.sessionId)) return;
        this.handleSubagentUpdate(payload);
      },
    );
    socket.on(
      RemoteEnvEvents.AgentMessage,
      (payload: RemoteAgentMessagePayload) => {
        if (!this.acceptsSession(sessionId, payload.sessionId)) return;
        void this.handleAgentMessage(payload);
      },
    );
    socket.on(
      RemoteEnvEvents.RoomRead,
      (
        request: RemoteRoomReadRequest,
        callback: (response: RemoteRoomReadResponse) => void,
      ) => {
        if (!this.acceptsSession(sessionId, request.sessionId)) {
          callback({ messages: [] });
          return;
        }
        void this.handleRoomRead(request, callback);
      },
    );
    socket.on(
      RemoteEnvEvents.ToolsRegister,
      (payload: RemoteToolsRegisterPayload) => {
        if (!this.acceptsSession(sessionId, payload.sessionId)) return;
        this.handleToolsRegister(socket, payload);
      },
    );
  }

  /** Records the catalog an environment declares, replacing any prior one. */
  private handleToolsRegister(
    socket: Socket,
    payload: RemoteToolsRegisterPayload,
  ): void {
    const environmentId = socketDataString(socket, "environmentId");
    if (!environmentId) return;
    const environment = this.environments.get(environmentId);
    if (!environment || environment.socket !== socket) return;
    environment.tools = new Map(payload.tools.map((tool) => [tool.name, tool]));
    console.log(
      `[remote-env] ${environmentId} registered ${environment.tools.size} tool(s)`,
    );
  }

  /**
   * The tools available to a session: the catalog of the environment bound to it
   * (or the shared unscoped one it would spawn on). Empty when no environment is
   * connected, so a caller can tell "no host" from "host offers nothing".
   */
  listTools(sessionId: string): RemoteToolDef[] {
    const environment = this.pickEnvironment(sessionId);
    if (!environment) return [];
    return [...environment.tools.values()];
  }

  /**
   * Invokes one registered tool on the session's environment and resolves with
   * its result. Rejects when no environment is connected, the tool is not in the
   * environment's catalog, or the environment does not ack before the timeout.
   */
  async callTool(
    sessionId: string,
    agentId: string,
    name: string,
    args: unknown,
  ): Promise<RemoteToolCallResponse> {
    const environment = this.pickEnvironment(sessionId);
    if (!environment) {
      throw new Error("No remote environment is connected.");
    }
    if (!environment.tools.has(name)) {
      throw new Error(`No remote tool named "${name}" is registered.`);
    }
    const request: RemoteToolCallRequest = {
      callId: randomUUID(),
      sessionId,
      agentId,
      name,
      arguments: args,
    };
    return new Promise<RemoteToolCallResponse>((resolve, reject) => {
      environment.socket
        .timeout(TOOL_CALL_TIMEOUT_MS)
        .emit(
          RemoteEnvEvents.ToolsCall,
          request,
          (err: Error | null, response: RemoteToolCallResponse) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(response);
          },
        );
    });
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
      conversationId: subagent.homeConversationId,
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

  /**
   * Answers a remote room-read. With a Conversation + Participant and a wired
   * context engine, it is that Conversation projected through the reader's
   * `transcriptVisibility`; otherwise the session-wide tail, unchanged.
   */
  private async handleRoomRead(
    request: RemoteRoomReadRequest,
    callback: (response: RemoteRoomReadResponse) => void,
  ): Promise<void> {
    if (
      this.context &&
      this.memberships &&
      request.conversationId &&
      request.participantId
    ) {
      const projected = await projectRoom(
        this.context,
        this.store,
        this.memberships,
        {
          sessionId: request.sessionId,
          conversationId: request.conversationId,
          participantId: request.participantId,
          limit: clampLimit(request.limit),
        },
      );
      callback({ messages: projected.messages, digests: projected.digests });
      return;
    }
    const all = await this.store.getMessages(request.sessionId);
    callback({ messages: all.slice(-clampLimit(request.limit)) });
  }

  /** Drops a disconnected environment and detaches its sub-agents. */
  private onDisconnect(environmentId: string, socket: Socket): void {
    const current = this.environments.get(environmentId);
    if (current?.socket && current.socket !== socket) return;
    this.dropEnvironment(environmentId, current?.sessionId);
  }

  /** Clears the session binding if it still names this environment. */
  private unbindSession(
    boundSessionId: string | undefined,
    environmentId: string,
  ): void {
    if (!boundSessionId) return;
    if (this.sessionEnvironments.get(boundSessionId) !== environmentId) return;
    this.sessionEnvironments.delete(boundSessionId);
  }

  /** Removes a dropped environment from the maps and detaches its agents. */
  private dropEnvironment(
    environmentId: string,
    boundSessionId: string | undefined,
  ): void {
    this.environments.delete(environmentId);
    this.unbindSession(boundSessionId, environmentId);
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
