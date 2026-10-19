import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  connectorFor,
  type EnvironmentUpdatePayload,
  isTerminalStatus,
  type MessageDelivery,
  type RemoteEnvironmentInfo,
  RESTORABLE_STATUSES,
  type RunId,
  type RunIngress,
  type Session,
  SocketEvents,
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
import { orchestratorIdentity } from "../conversation/participantRegistry.ts";
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

/** How often the defensive sweep reaps environments whose socket is gone. */
const ENV_SWEEP_INTERVAL_MS = 20_000;

/**
 * How long an environment may go without a received packet or heartbeat before
 * it is treated as dead. Must exceed `pingInterval + pingTimeout` so a healthy
 * but idle host (whose pong lands every ping cycle) is never falsely reaped.
 */
const ENV_IDLE_TTL_MS = 60_000;

/** One message to deliver to one remote sub-agent. */
export interface RemoteSendOptions {
  sessionId: string;
  agentId: string;
  text: string;
  /** Whether a mid-run message steers or queues. Defaults to `auto`. */
  delivery?: MessageDelivery;
  /** What the message counts as for the Run it opens. Defaults to `reaction`. */
  ingress?: RunIngress;
  /** The human whose message this is, when it came from a person; stamped on the
   * Run this opens so remote tools route to their host. */
  audienceParticipantId?: string;
}

/**
 * A connected remote environment and its live Socket.IO connection.
 *
 * Its scope is one of four kinds, classified by the scoped token's claims:
 * unscoped (no `sub`, a shared-secret dev host), session-scoped (`sub` +
 * `sessionId`, a browser embed), user-scoped (`sub`, no `sessionId`/`selector`,
 * serves every session its `sub` prompts in), and selector-scoped (`sub` +
 * `selector`, serves every session whose tags include the selector).
 */
interface RemoteEnvConnection {
  environmentId: string;
  /** Set when the environment authenticated with a scoped per-session token. */
  sessionId?: string;
  /** A session selector this host serves (e.g. `projectId:<GUID>`), when set. */
  selector?: string;
  /** The human this environment belongs to (scoped token `sub`), when scoped. */
  sub?: string;
  socket: Socket;
  /** The RPC tools this environment currently offers, keyed by tool name. */
  tools: Map<string, RemoteToolDef>;
  /** Monotonic connection order, so the most recent of a person's hosts wins. */
  seq: number;
  /**
   * When the far end last proved it was alive — bumped on every received packet
   * and heartbeat (pong). A half-open socket stops producing these while still
   * reporting `connected`, so idle past the TTL is the only reliable "dead" tell.
   */
  lastSeenAt: number;
}

/** Looks up a session's installed bundle config for remote spawn resolution. */
export type SessionConfigLookup = (
  sessionId: string,
) => ResolvedSessionConfig | undefined;

/** True when `email` holds a Membership in `sessionId` — the gate chat/mint use. */
export type SessionMemberCheck = (
  sessionId: string,
  email: string,
) => Promise<boolean>;

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

/** Whether `sub` owns `session` or it is open to anyone — the mint gate, minus
 * the async membership check its one caller layers on top. */
function ownsOrOpen(session: Session, sub: string): boolean {
  if (session.accessPolicy === "open") return true;
  const owner = session.user?.email;
  return !owner || owner === sub;
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
    connector: connectorFor("remote-env", subagent.environmentId),
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
  /** Wired after construction: whether a human holds a Membership in a session,
   * used to authorize a user-scoped host's reads of a restricted session. */
  private isSessionMember?: SessionMemberCheck;

  /** Connected environments, keyed by `environmentId`. */
  private readonly environments = new Map<string, RemoteEnvConnection>();
  /** The human who first claimed each `environmentId`, kept past disconnect so a
   * pinned id cannot be reused by anyone else once its owner has left. */
  private readonly environmentOwners = new Map<string, string>();
  /** Per-session remote sub-agent rosters, keyed by sessionId then agentId. */
  private readonly sessions = new Map<string, Map<string, RemoteSubagent>>();
  /** Increments per connect so `seq` orders environments by recency. */
  private connectSeq = 0;

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
    // Defensive reaper for a socket whose `disconnect` never fired; unref'd so it
    // never keeps the process alive.
    setInterval(
      () => this.evictDisconnected(),
      ENV_SWEEP_INTERVAL_MS,
    ).unref?.();
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

  /**
   * Wires the session-membership check a user-scoped host's room read is
   * authorized against. Separate from the constructor because the participant
   * service that answers it is built after the gateway.
   */
  useSessionAuthorization(isSessionMember: SessionMemberCheck): void {
    this.isSessionMember = isSessionMember;
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
   * The connected environments `sessionId` can route to: its scoped hosts plus
   * the unscoped dev hosts eligible for it, most recent first.
   */
  listEnvironments(sessionId: string): RemoteEnvironmentInfo[] {
    const roster = [...(this.sessions.get(sessionId)?.values() ?? [])];
    return [
      ...this.scopedEnvironments(sessionId),
      ...this.unscopedEnvironmentsFor(sessionId),
    ]
      .sort((a, b) => b.seq - a.seq)
      .map((environment) => ({
        environmentId: environment.environmentId,
        sessionId: environment.sessionId,
        selector: environment.selector,
        owner: environment.sub,
        scoped: Boolean(environment.sub),
        toolCount: environment.tools.size,
        subagentCount: roster.filter(
          (subagent) =>
            subagent.environmentId === environment.environmentId &&
            !isTerminalStatus(subagent.status),
        ).length,
      }));
  }

  /**
   * Spawns a sub-agent on a connected remote environment. Resolves the
   * effective config from the session's installed bundle templates/defaults
   * (falling back to the global templates), records the roster entry, and emits
   * the spawn command. Routes to the prompting person's most recent host, the
   * same way a tool call does; throws when their host is not connected rather
   * than landing the spawn in another viewer's environment.
   */
  spawnSubagent(
    sessionId: string,
    request: SubagentSpawnRequest,
  ): SpawnedSubagent {
    const environment = this.spawnEnvironment(
      sessionId,
      request.audienceParticipantId,
    );

    const agentId = randomUUID();
    const homeConversationId = randomUUID();
    const sessionConfig = this.sessionConfig(sessionId);
    const config = resolveSubagentConfig(request, {
      templates: sessionConfig?.templates,
      defaults: sessionConfig?.subagentDefaults,
    });
    const autoRelayToPrime =
      request.autoRelayToPrime ?? config.autoRelayToPrime ?? true;
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
    this.emitEnvironmentsChanged(sessionId);
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
      audienceParticipantId: options.audienceParticipantId,
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
    this.clearActivity(sessionId, subagent);
    this.emitToEnvironment(subagent.environmentId, RemoteEnvEvents.Kill, {
      sessionId,
      agentId,
      completed,
    } satisfies RemoteKillCommand);
    this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
    this.emitEnvironmentsChanged(sessionId);
  }

  /** Tells every client that the connected environments changed. */
  private emitEnvironmentsChanged(sessionId?: string): void {
    const payload: EnvironmentUpdatePayload = sessionId ? { sessionId } : {};
    this.io.emit(SocketEvents.EnvironmentUpdate, payload);
  }

  /** Emits an event to a specific environment's socket, if still connected. */
  private emitToEnvironment(
    environmentId: string,
    event: string,
    payload: unknown,
  ): void {
    this.environments.get(environmentId)?.socket.emit(event, payload);
  }

  /**
   * Every scoped environment eligible for `sessionId`: a browser embed bound to
   * it, a user-scoped host (serves every session its `sub` prompts in), or a
   * selector-scoped host whose selector is one of the session's tags. All carry
   * a `sub`, so the audience owner-gate still decides whose prompts reach them.
   */
  private scopedEnvironments(sessionId: string): RemoteEnvConnection[] {
    const selectors = this.store.selectorsOf(sessionId);
    return [...this.environments.values()].filter(
      (e) =>
        Boolean(e.sub) &&
        (e.sessionId === sessionId ||
          (!e.sessionId && !e.selector) ||
          (e.selector !== undefined && selectors.includes(e.selector))),
    );
  }

  /** The scoped environments a given human has connected for `sessionId`. */
  private audienceEnvironments(
    sessionId: string,
    audienceId: string,
  ): RemoteEnvConnection[] {
    return this.scopedEnvironments(sessionId).filter(
      (environment) => environment.sub === audienceId,
    );
  }

  /** The session id an unscoped embed host encodes in `${sessionId}:${tab}`, or undefined. */
  private unscopedSessionOf(environmentId: string): string | undefined {
    const idx = environmentId.indexOf(":");
    return idx === -1 ? undefined : environmentId.slice(0, idx);
  }

  /**
   * Unscoped dev hosts eligible for `sessionId`: those whose `environmentId` is
   * prefixed with this session, else the hosts that encode no session at all (a
   * generic dev host). Never another session's prefixed host, so a first-wins
   * global list can no longer misroute across sessions.
   */
  private unscopedEnvironmentsFor(sessionId: string): RemoteEnvConnection[] {
    const unscoped = [...this.environments.values()].filter((e) => !e.sub);
    const mine = unscoped.filter(
      (e) => this.unscopedSessionOf(e.environmentId) === sessionId,
    );
    if (mine.length > 0) return mine;
    return unscoped.filter(
      (e) => this.unscopedSessionOf(e.environmentId) === undefined,
    );
  }

  /** The most recent of `envs`, optionally restricted to those offering `tool`. */
  private mostRecent(
    envs: RemoteEnvConnection[],
    tool?: string,
  ): RemoteEnvConnection | undefined {
    const eligible = tool ? envs.filter((e) => e.tools.has(tool)) : envs;
    if (eligible.length === 0) return undefined;
    return eligible.reduce((best, e) => (e.seq > best.seq ? e : best));
  }

  /**
   * The environments a remote-tool list/call may target, or a failure message.
   * With a known audience it is that person's hosts; the unscoped dev host is a
   * fallback only when the session has no scoped host at all — never a stand-in
   * for the prompting person when other people are connected.
   */
  private toolEnvironments(
    sessionId: string,
    audienceId: string | undefined,
  ): RemoteEnvConnection[] | string {
    if (audienceId) {
      const mine = this.audienceEnvironments(sessionId, audienceId);
      if (mine.length > 0) return mine;
      if (this.scopedEnvironments(sessionId).length > 0) {
        return "The prompting user's host is not connected.";
      }
    } else if (this.scopedEnvironments(sessionId).length > 0) {
      return "The prompting user's host is not connected.";
    }
    const unscoped = this.unscopedEnvironmentsFor(sessionId);
    if (unscoped.length > 0) return unscoped;
    return "No remote environment is connected.";
  }

  /**
   * The environment a remote sub-agent spawns into: the prompting person's most
   * recent host, resolved through the same fail-closed rules a tool call uses.
   * Throws rather than landing the spawn in another viewer's environment.
   */
  private spawnEnvironment(
    sessionId: string,
    audienceId: string | undefined,
  ): RemoteEnvConnection {
    const target = this.toolEnvironments(sessionId, audienceId);
    if (typeof target === "string") throw new Error(target);
    const environment = this.mostRecent(target);
    if (!environment) throw new Error("No remote environment is connected.");
    return environment;
  }

  /**
   * Whether `environmentId` is owned by a human other than `sub`, so a mint
   * cannot pin an id someone else claimed. Ownership outlives the connection: a
   * departed host's id stays reserved to whoever first claimed it, so a mint
   * cannot hijack an id merely because its owner is momentarily offline.
   */
  environmentClaimedByOther(environmentId: string, sub: string): boolean {
    const owner = this.environmentOwners.get(environmentId);
    return owner !== undefined && owner !== sub;
  }

  /** A sub-agent's home Conversation, falling back to its id for a legacy row. */
  private homeConversationOf(sessionId: string, agentId: string): string {
    return (
      this.sessions.get(sessionId)?.get(agentId)?.homeConversationId ?? agentId
    );
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
    return {
      agentId: subagent.agentId,
      role: "subagent",
      name: subagent.name,
      homeConversationId: subagent.homeConversationId,
    };
  }

  /**
   * Clears the sub-agent's ephemeral activity indicator. The protocol has no
   * run-end event, so a settled run never streams the `activity: null` that a
   * local agent's {@link import("../pi/piAgentManager.ts").PiAgentManager}
   * emits on `agent_end` — without it a last tool activity (e.g.
   * "Running send_to_prime") lingers as a busy spinner after the agent stops.
   */
  private clearActivity(sessionId: string, subagent: RemoteSubagent): void {
    this.handlers.onAgentEvent(sessionId, this.descriptorFor(subagent), {
      type: "activity",
      activity: null,
    });
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
      socket.data.selector = scoped.selector;
      socket.data.sub = scoped.sub;
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
    const selector = socketDataString(socket, "selector");
    const sub = socketDataString(socket, "sub");

    const connection: RemoteEnvConnection = {
      environmentId,
      sessionId,
      selector,
      sub,
      socket,
      tools: new Map(),
      seq: ++this.connectSeq,
      lastSeenAt: Date.now(),
    };
    this.environments.set(environmentId, connection);
    if (sub) this.environmentOwners.set(environmentId, sub);
    console.log(
      `[remote-env] connected: ${environmentId} scope=${sessionId ?? selector ?? (sub ? "user" : "unscoped")} socket=${socket.id}`,
    );

    this.trackLiveness(connection);
    this.wireInbound(socket, connection);
    socket.on("disconnect", () => this.onDisconnect(environmentId, socket));

    void this.replayRoster(environmentId);
  }

  /** True when a host may send a session-bound packet: a session-scoped host
   * only for its own session, any other kind (unscoped, user-, selector-scoped)
   * for any — those rely on the roster/ownership gate the handlers apply. */
  private acceptsSession(
    boundSessionId: string | undefined,
    sessionId: string | undefined,
  ): boolean {
    if (!boundSessionId) return true;
    return boundSessionId === sessionId;
  }

  /**
   * Whether `connection` may read `sessionId`'s transcript. A session-scoped
   * host only its own session; a selector-scoped host a session its selector
   * tags; a user-scoped host a session its owner could mint for (open, owned, or
   * joined) — the same gate the token mint enforces. An unscoped dev host (no
   * `sub`, shared secret) may read any session. Unlike the report events, a room
   * read has no roster entry to gate it, so this is the only check standing
   * between a scoped host and another session's messages.
   */
  private async mayReadSession(
    connection: RemoteEnvConnection,
    sessionId: string,
  ): Promise<boolean> {
    if (!connection.sub) return true;
    if (connection.sessionId) return connection.sessionId === sessionId;
    if (connection.selector) {
      return this.store.selectorsOf(sessionId).includes(connection.selector);
    }
    return this.userScopeMayAccess(connection.sub, sessionId);
  }

  /** Whether a user-scoped host's owner may reach `sessionId`: an open session,
   * one they own, or one they hold a Membership in — mirroring the mint gate. */
  private async userScopeMayAccess(
    sub: string,
    sessionId: string,
  ): Promise<boolean> {
    const session = await this.store.getSession(sessionId);
    if (!session) return false;
    if (ownsOrOpen(session, sub)) return true;
    if (!this.isSessionMember) return false;
    return this.isSessionMember(sessionId, sub);
  }

  /** Wires protocol listeners, dropping cross-session traffic on scoped envs. */
  private wireInbound(socket: Socket, connection: RemoteEnvConnection): void {
    const { environmentId, sessionId } = connection;
    socket.on(
      RemoteEnvEvents.AgentEvent,
      (payload: RemoteAgentEventPayload) => {
        if (!this.acceptsSession(sessionId, payload.sessionId)) return;
        this.handleAgentEvent(payload, environmentId);
      },
    );
    socket.on(
      RemoteEnvEvents.SubagentUpdate,
      (payload: RemoteSubagentUpdatePayload) => {
        if (!this.acceptsSession(sessionId, payload.sessionId)) return;
        this.handleSubagentUpdate(payload, environmentId);
      },
    );
    socket.on(
      RemoteEnvEvents.AgentMessage,
      (payload: RemoteAgentMessagePayload) => {
        if (!this.acceptsSession(sessionId, payload.sessionId)) return;
        void this.handleAgentMessage(payload, environmentId);
      },
    );
    socket.on(
      RemoteEnvEvents.RoomRead,
      (
        request: RemoteRoomReadRequest,
        callback: (response: RemoteRoomReadResponse) => void,
      ) => {
        void this.authorizeRoomRead(connection, request, callback);
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

  /** Answers a room read only when the host is authorized for the session. */
  private async authorizeRoomRead(
    connection: RemoteEnvConnection,
    request: RemoteRoomReadRequest,
    callback: (response: RemoteRoomReadResponse) => void,
  ): Promise<void> {
    if (!(await this.mayReadSession(connection, request.sessionId))) {
      callback({ messages: [] });
      return;
    }
    await this.handleRoomRead(request, callback);
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
    this.emitEnvironmentsChanged();
  }

  /**
   * The tools available for `audienceId`'s turn: the union of that person's
   * connected hosts (most recent wins on a name clash). When there is no catalog
   * to offer, `reason` says why — their host is gone versus none is connected —
   * so a caller can distinguish that from a host that offers nothing.
   */
  listToolsFor(
    sessionId: string,
    audienceId?: string,
  ): { tools: RemoteToolDef[]; reason?: string } {
    const target = this.toolEnvironments(sessionId, audienceId);
    if (typeof target === "string") return { tools: [], reason: target };
    const catalog = new Map<string, RemoteToolDef>();
    for (const environment of [...target].sort((a, b) => a.seq - b.seq)) {
      for (const [name, tool] of environment.tools) catalog.set(name, tool);
    }
    return { tools: [...catalog.values()] };
  }

  /** The catalog for `audienceId`'s turn; see {@link listToolsFor} for the miss reason. */
  listTools(sessionId: string, audienceId?: string): RemoteToolDef[] {
    return this.listToolsFor(sessionId, audienceId).tools;
  }

  /**
   * Invokes one registered tool on the prompting person's environment and
   * resolves with its result. Rejects when their host is not connected, the tool
   * is not in any of their catalogs, or the environment does not ack before the
   * timeout.
   */
  async callTool(
    sessionId: string,
    agentId: string,
    name: string,
    args: unknown,
    audienceId?: string,
  ): Promise<RemoteToolCallResponse> {
    const target = this.toolEnvironments(sessionId, audienceId);
    if (typeof target === "string") {
      console.warn(
        `[remote-env] call ${name} routing failed session=${sessionId} agent=${agentId} audience=${audienceId ?? "-"}: ${target}`,
      );
      throw new Error(target);
    }
    const environment = this.mostRecent(target, name);
    if (!environment) {
      console.warn(
        `[remote-env] call ${name} routing failed session=${sessionId} agent=${agentId} audience=${audienceId ?? "-"}: No remote tool named "${name}" is registered.`,
      );
      throw new Error(`No remote tool named "${name}" is registered.`);
    }
    const request: RemoteToolCallRequest = {
      callId: randomUUID(),
      sessionId,
      agentId,
      name,
      arguments: args,
    };
    const candidates = target.map((e) => e.environmentId).join(",");
    const started = Date.now();
    console.log(
      `[remote-env] call ${name} callId=${request.callId} session=${sessionId} agent=${agentId} audience=${audienceId ?? "-"} env=${environment.environmentId} socket=${environment.socket.id} candidates=${candidates}`,
    );
    return new Promise<RemoteToolCallResponse>((resolve, reject) => {
      environment.socket
        .timeout(TOOL_CALL_TIMEOUT_MS)
        .emit(
          RemoteEnvEvents.ToolsCall,
          request,
          (err: Error | null, response: RemoteToolCallResponse) => {
            const elapsed = Date.now() - started;
            if (err) {
              console.warn(
                `[remote-env] call ${name} callId=${request.callId} failed env=${environment.environmentId} socket=${environment.socket.id} connected=${environment.socket.connected} ${elapsed}ms: ${err.message}`,
              );
              reject(err);
              return;
            }
            console.log(
              `[remote-env] call ${name} callId=${request.callId} ok env=${environment.environmentId} socket=${environment.socket.id} ${elapsed}ms`,
            );
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
    this.emitEnvironmentsChanged();
  }

  /**
   * Relays a streamed event to the chat layer. A finalized one is persisted as a
   * Message there and fanned out from the sub-agent's own Conversation, so this
   * gateway no longer feeds Prime a second copy.
   */
  private handleAgentEvent(
    payload: RemoteAgentEventPayload,
    environmentId: string,
  ): void {
    const subagent = this.sessions.get(payload.sessionId)?.get(payload.agentId);
    if (!subagent || subagent.environmentId !== environmentId) return;
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
  private handleSubagentUpdate(
    payload: RemoteSubagentUpdatePayload,
    environmentId: string,
  ): void {
    const roster = this.sessions.get(payload.sessionId);
    const subagent = roster?.get(payload.agentId);
    if (!roster || !subagent || subagent.environmentId !== environmentId)
      return;

    subagent.status = payload.status;
    if (isTerminalStatus(payload.status)) {
      this.settleTerminalSubagent(roster, payload, subagent);
    }
    this.handlers.onSubagentUpdate(payload.sessionId, toInfo(subagent));
  }

  /** Retires a sub-agent that reached a terminal status: the closest thing the
   * protocol has to a run-end marker, so whatever it was doing is now over. */
  private settleTerminalSubagent(
    roster: Map<string, RemoteSubagent>,
    payload: RemoteSubagentUpdatePayload,
    subagent: RemoteSubagent,
  ): void {
    roster.delete(payload.agentId);
    this.runs.settleOpenFor(
      payload.sessionId,
      payload.agentId,
      payload.status === "completed" ? "completed" : "failed",
    );
    this.clearActivity(payload.sessionId, subagent);
    this.emitEnvironmentsChanged(payload.sessionId);
  }

  /**
   * Posts a sub-agent's report in its own thread, addressed to Prime. Being
   * addressed is what reaches Prime — the same mechanism a local sub-agent's
   * `message_prime` uses, so neither transport carries its own copy of "and now
   * tell Prime".
   */
  private async handleAgentMessage(
    payload: RemoteAgentMessagePayload,
    environmentId: string,
  ): Promise<void> {
    const subagent = this.sessions.get(payload.sessionId)?.get(payload.agentId);
    if (!subagent || subagent.environmentId !== environmentId) return;
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
      mentions: [
        (await orchestratorIdentity(this.store, payload.sessionId))
          .orchestratorId,
      ],
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

  /**
   * Bumps {@link RemoteEnvConnection.lastSeenAt} on every packet and heartbeat
   * the far end sends, so {@link evictDisconnected} can tell a live-but-idle host
   * (whose pong keeps landing) from a half-open one that has gone silent. Reads
   * the low-level engine socket defensively: a test double has no `conn`.
   */
  private trackLiveness(connection: RemoteEnvConnection): void {
    const engine = (
      connection.socket as unknown as {
        conn?: { on?: (event: string, listener: () => void) => void };
      }
    ).conn;
    if (!engine?.on) return;
    const bump = (): void => {
      connection.lastSeenAt = Date.now();
    };
    engine.on("packet", bump);
    engine.on("heartbeat", bump);
  }

  /**
   * Reaps dead environments: a socket already reporting gone (a missed or
   * late `disconnect`), and a half-open one that still reports `connected` but
   * has produced no packet or heartbeat within {@link ENV_IDLE_TTL_MS}. The
   * normal path is {@link onDisconnect}; this catches what it missed so a dead
   * host cannot linger in the roster with a green dot. Force-closing an idle
   * socket fires `disconnect`, which drops it through the same path; an
   * already-closed one is dropped here directly. Safe to mutate mid-iteration: a
   * Map's iterator tolerates removing the current entry.
   */
  evictDisconnected(): void {
    const now = Date.now();
    for (const [environmentId, environment] of this.environments) {
      if (environment.socket.connected) {
        if (now - environment.lastSeenAt <= ENV_IDLE_TTL_MS) continue;
        console.log(
          `[remote-env] force-closing idle environment: ${environmentId}`,
        );
        environment.socket.disconnect(true);
        continue;
      }
      console.log(`[remote-env] sweeping stale environment: ${environmentId}`);
      this.dropEnvironment(environmentId);
    }
  }

  /**
   * Drops a disconnected environment and detaches its sub-agents. Skips a row the
   * sweep already removed or a newer connection replaced, so a force-close
   * followed by its own `disconnect` cannot drop the environment twice.
   */
  private onDisconnect(environmentId: string, socket: Socket): void {
    const current = this.environments.get(environmentId);
    if (!current || current.socket !== socket) return;
    this.dropEnvironment(environmentId);
  }

  /** Removes a dropped environment from the maps and detaches its agents. */
  private dropEnvironment(environmentId: string): void {
    const dropped = this.environments.get(environmentId);
    this.environments.delete(environmentId);
    for (const [sessionId, roster] of this.sessions) {
      this.detachEnvironmentAgents(sessionId, roster, environmentId);
    }
    console.log(
      `[remote-env] disconnected: ${environmentId} session=${dropped?.sessionId ?? "unscoped"} socket=${dropped?.socket.id}`,
    );
    this.emitEnvironmentsChanged();
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
      this.clearActivity(sessionId, subagent);
      this.handlers.onSubagentUpdate(sessionId, toInfo(subagent));
    }
  }
}
