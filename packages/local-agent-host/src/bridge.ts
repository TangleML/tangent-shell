import {
  connectRemoteEnvironment,
  type RemoteEnvironmentClient,
  type RemoteKillCommand,
  type RemoteMessageCommand,
  type RemoteResourceInput,
  type RemoteSpawnCommand,
  type RemoteToolMap,
} from "@tangent/remote-subagent";
import type { RunId } from "@tangent/shared/contracts.ts";

import { type HostApi, type HostApiRoutes, startHostApi } from "./hostApi.ts";
import { PiAgent, type PiLaunchOptions } from "./piAdapter.ts";

export type BridgeState = "connecting" | "connected" | "disconnected";

export interface BridgeOptions {
  url: string;
  /**
   * engine.io transport path for a mounted-prefix deployment (e.g.
   * `/api/.../socket.io`). Omit for a root-mounted Shell (default `/socket.io`).
   */
  socketPath?: string;
  /** The project selector this host is scoped to, e.g. `projectId:<id>`. */
  selector: string;
  /**
   * Self-description advertised in the handshake (e.g. `description`,
   * `capabilities`, `editor`, `workspacePath`) so Prime can tell this host apart
   * from others and match work to it. Free string->string pairs.
   */
  metadata?: Record<string, string>;
  /**
   * Resolves extra transport handshake headers (Node only), e.g. an SSO
   * `cookie` so an Okta-protected Shell admits the websocket the way it admits
   * HTTP requests. Called on every (re)connect so a rotated cookie is picked up.
   */
  extraHeaders?(): Record<string, string> | undefined;
  /** RPC tools Prime can call on this window without spawning a sub-agent. */
  tools?: RemoteToolMap;
  /** Resolved per spawn so setting changes apply without reconnecting. */
  piLaunchOptions(): Promise<PiLaunchOptions>;
  log(line: string): void;
  /** Fires on any connection or roster change, for the status bar. */
  onChange(): void;
  /** Fires when Prime starts a local sub-agent, so the user can see and stop it. */
  onSpawned(agent: HostedAgent): void;
}

/** A sub-agent this window hosts. */
export interface HostedAgent {
  sessionId: string;
  agentId: string;
  name: string;
  /** The Run of the latest message, echoed on every event it produces. */
  runId?: RunId;
  /** Set once the server asked for the kill, so the exit is not an error. */
  stopping: boolean;
  agent?: PiAgent;
}

/**
 * Hosts Tangent sub-agents as local pi processes. Connects to the Shell's
 * `/remote-env` namespace and maps each spawn/message/kill command onto a
 * {@link PiAgent}, streaming its events back under the server-assigned id.
 */
export class LocalAgentBridge {
  environmentId: string | undefined;
  private readonly options: BridgeOptions;
  private readonly connectFactory: typeof connectRemoteEnvironment;
  private readonly startApi: typeof startHostApi;
  private client: RemoteEnvironmentClient | undefined;
  private readonly agents = new Map<string, HostedAgent>();
  private connectionState: BridgeState = "disconnected";
  private connectionError: string | undefined;
  /** Memoized loopback API the hosted sub-agents' resource extension calls. */
  private hostApi: Promise<HostApi> | undefined;

  constructor(
    options: BridgeOptions,
    connect: typeof connectRemoteEnvironment = connectRemoteEnvironment,
    startApi: typeof startHostApi = startHostApi,
  ) {
    this.options = options;
    this.connectFactory = connect;
    this.startApi = startApi;
  }

  get state(): BridgeState {
    return this.connectionState;
  }

  get lastError(): string | undefined {
    return this.connectionError;
  }

  listAgents(): HostedAgent[] {
    return [...this.agents.values()];
  }

  /**
   * (Re)connects with a freshly minted scoped token, keeping hosted sub-agents
   * so a token refresh does not interrupt them. The SDK (re)registers the tool
   * catalog on every connect; the server binds it to the token's selector, so it
   * is offered to every session in the project rather than a single one.
   */
  connect(token: string, environmentId: string): void {
    this.client?.disconnect();
    this.environmentId = environmentId;
    this.setState("connecting");
    const extraHeaders = this.options.extraHeaders?.();
    this.client = this.connectFactory({
      url: this.options.url,
      ...(this.options.socketPath
        ? { socketPath: this.options.socketPath }
        : {}),
      token,
      environmentId,
      ...(this.options.metadata ? { metadata: this.options.metadata } : {}),
      ...(extraHeaders ? { extraHeaders } : {}),
      tools: this.options.tools,
      handlers: {
        onSpawn: (command) => this.onSpawn(command),
        onMessage: (command) => this.onMessage(command),
        onKill: (command) => this.onKill(command),
      },
    });
    this.watchConnection(this.client);
  }

  /** Stops every local sub-agent and closes the connection. */
  dispose(): void {
    for (const hosted of this.agents.values()) {
      hosted.stopping = true;
      hosted.agent?.kill();
    }
    this.agents.clear();
    this.client?.disconnect();
    this.client = undefined;
    void this.hostApi?.then((api) => api.close());
    this.hostApi = undefined;
    this.setState("disconnected");
  }

  /** The loopback routes a hosted sub-agent's resource extension calls, each
   * forwarding to the live connection; a dropped connection fails clearly. */
  private hostApiRoutes(): HostApiRoutes {
    const requireClient = (): RemoteEnvironmentClient => {
      if (!this.client) throw new Error("Not connected to the Shell.");
      return this.client;
    };
    return {
      put: async (body) => {
        const { sessionId, agentId, input } = body as {
          sessionId: string;
          agentId: string;
          input: RemoteResourceInput;
        };
        return requireClient().addResource(sessionId, agentId, input);
      },
      list: async (body) => {
        const { sessionId } = body as { sessionId: string };
        return requireClient().listResources(sessionId);
      },
      read: async (body) => {
        const { sessionId, uri } = body as { sessionId: string; uri: string };
        return requireClient().readResource(sessionId, uri);
      },
    };
  }

  /** Starts the loopback API on first use, memoized for the host's lifetime. */
  private ensureHostApi(): Promise<HostApi> {
    this.hostApi ??= this.startApi(this.hostApiRoutes());
    return this.hostApi;
  }

  private watchConnection(client: RemoteEnvironmentClient): void {
    const { socket } = client;
    socket.on("connect", () => {
      this.connectionError = undefined;
      this.setState("connected");
      this.options.log(
        `connected to ${this.options.url} as ${this.environmentId} (selector ${this.options.selector})`,
      );
      this.reclaimAgents(client);
    });
    socket.on("disconnect", (reason) => {
      this.options.log(`disconnected: ${reason}`);
      this.setState("connecting");
    });
    socket.on("connect_error", (err) => {
      this.connectionError = err.message;
      this.options.log(`connection failed: ${err.message}`);
      this.setState("connecting");
    });
  }

  /**
   * A dropped socket leaves this host's sub-agents `detached` on the server;
   * declaring them active again is how the gateway learns they survived.
   */
  private reclaimAgents(client: RemoteEnvironmentClient): void {
    for (const hosted of this.agents.values()) {
      client.subagentUpdate(hosted.sessionId, hosted.agentId, "active");
    }
  }

  private setState(state: BridgeState): void {
    this.connectionState = state;
    this.options.onChange();
  }

  private async onSpawn(command: RemoteSpawnCommand): Promise<void> {
    const hosted: HostedAgent = {
      sessionId: command.sessionId,
      agentId: command.agentId,
      name: command.name,
      stopping: false,
    };
    this.agents.set(command.agentId, hosted);
    this.options.onChange();

    const base = await this.options.piLaunchOptions();
    if (!base.cwd) {
      this.fail(
        hosted,
        "No workspace folder is open to host local sub-agents.",
      );
      return;
    }
    const hostApi = await this.ensureHostApi();
    const launch = {
      ...base,
      hostApiUrl: hostApi.url,
      hostApiToken: hostApi.token,
    };
    this.options.log(
      `spawning "${command.name}" (${command.agentId}) in ${launch.cwd}`,
    );
    hosted.agent = new PiAgent(command, launch, {
      onEvent: (event) =>
        this.client?.agentEvent(
          hosted.sessionId,
          hosted.agentId,
          event,
          hosted.runId,
        ),
      onExit: (reason) => this.onAgentExit(hosted, reason),
      onLog: (line) => this.options.log(`[${hosted.name}] ${line}`),
    });
    this.options.onSpawned(hosted);
  }

  /** Stops a local sub-agent from this side and tells the server it was killed. */
  stopAgent(agentId: string): void {
    const hosted = this.agents.get(agentId);
    if (!hosted) return;
    this.onKill({
      sessionId: hosted.sessionId,
      agentId,
      completed: false,
    });
  }

  private onMessage(command: RemoteMessageCommand): void {
    const hosted = this.agents.get(command.agentId);
    if (!hosted?.agent) {
      this.options.log(`message for unknown sub-agent ${command.agentId}`);
      return;
    }
    hosted.runId = command.runId;
    hosted.agent.prompt(command.text, command.delivery);
  }

  private onKill(command: RemoteKillCommand): void {
    const hosted = this.agents.get(command.agentId);
    if (!hosted) return;
    hosted.stopping = true;
    hosted.agent?.kill();
    this.agents.delete(command.agentId);
    this.client?.subagentUpdate(
      command.sessionId,
      command.agentId,
      command.completed ? "completed" : "killed",
    );
    this.options.log(`stopped "${hosted.name}"`);
    this.options.onChange();
  }

  private onAgentExit(hosted: HostedAgent, reason: string): void {
    this.options.log(`[${hosted.name}] pi ${reason}`);
    if (hosted.stopping || this.agents.get(hosted.agentId) !== hosted) return;
    this.fail(hosted, `Local pi ${reason}.`);
  }

  /** Reports a sub-agent that cannot run, and drops it from the roster. */
  private fail(hosted: HostedAgent, message: string): void {
    this.agents.delete(hosted.agentId);
    this.client?.agentEvent(
      hosted.sessionId,
      hosted.agentId,
      { type: "error", message },
      hosted.runId,
    );
    this.client?.subagentUpdate(hosted.sessionId, hosted.agentId, "error");
    this.options.log(`[${hosted.name}] ${message}`);
    this.options.onChange();
  }
}
