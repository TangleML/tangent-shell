/**
 * `@tangent/remote-subagent` — the connector SDK a **remote environment**
 * installs to host Tangent sub-agents.
 *
 * This package is deliberately *just a connector*: it manages the Socket.IO
 * connection to the server's remote sub-agent gateway, dispatches incoming
 * orchestration commands (`spawn` / `message` / `kill`) to user-supplied
 * handlers, and exposes typed helpers to stream events, roster updates, and
 * reports back. It carries **no agent runtime** — the actual sub-agent
 * implementation (built on another agent SDK) is provided by the host via the
 * {@link RemoteEnvironmentHandlers}; unimplemented handlers throw so the gap is
 * obvious.
 */

import type {
  ChatMessage,
  RunId,
  SubagentStatus,
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
  type RemoteToolCallRequest,
  type RemoteToolCallResponse,
  type RemoteToolDef,
  type RemoteToolsRegisterPayload,
} from "@tangent/shared/remoteSubagent.ts";
import {
  io,
  type ManagerOptions,
  type Socket,
  type SocketOptions,
} from "socket.io-client";

/** How long {@link RemoteEnvironmentClient.readRoom} waits for the server ack. */
const READ_ROOM_TIMEOUT_MS = 10_000;

/**
 * The command surface a remote environment must implement to host sub-agents.
 * These are the inbound half of the orchestration protocol; the host wires its
 * own agent runtime in here. Any handler may be async.
 */
export interface RemoteEnvironmentHandlers {
  /** Create a sub-agent (and optionally start its initial task). */
  onSpawn(command: RemoteSpawnCommand): void | Promise<void>;
  /** Deliver a directed message/task to an existing sub-agent. */
  onMessage(command: RemoteMessageCommand): void | Promise<void>;
  /** Terminate a sub-agent. */
  onKill(command: RemoteKillCommand): void | Promise<void>;
}

/**
 * One RPC tool this environment hosts: a named async function the server can
 * invoke on behalf of an agent, without spawning a sub-agent. The `description`
 * and JSON `inputSchema` are advertised to agents; `execute` runs the call and
 * returns any JSON-serializable value (typically a string).
 */
export interface RemoteTool {
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: unknown): unknown | Promise<unknown>;
}

/** The tool catalog an environment offers, keyed by tool name. */
export type RemoteToolMap = Record<string, RemoteTool>;

/** Options for {@link connectRemoteEnvironment}. */
export interface ConnectRemoteEnvironmentOptions {
  /** Base server URL, e.g. `http://localhost:8787` (namespace is appended). */
  url: string;
  /**
   * engine.io transport path for mounted-prefix deployments
   * (e.g. `/tangent/socket.io`); defaults to Socket.IO's `/socket.io`.
   */
  socketPath?: string;
  /** Shared bearer token the server validates against `REMOTE_ENV_TOKEN`. */
  token: string;
  /** Stable id identifying this environment when several are connected. */
  environmentId: string;
  /** Command handlers; any omitted handler throws when its command arrives. */
  handlers?: Partial<RemoteEnvironmentHandlers>;
  /**
   * RPC tools this environment offers. Registered on connect and re-registered
   * on reconnect. Independent of {@link handlers}: an environment may host tools,
   * sub-agents, or both. Omit to host no tools.
   */
  tools?: RemoteToolMap;
  /**
   * The session this environment's {@link tools} are registered for. Required
   * when `tools` is set: a scoped embed host knows its session, and the server
   * only accepts a catalog matching the socket's bound session.
   */
  sessionId?: string;
}

/**
 * A connected remote environment. Holds the live Socket.IO connection and the
 * outbound half of the protocol: stream events back, push roster transitions,
 * report to Prime, and read the shared transcript.
 */
export interface RemoteEnvironmentClient {
  /** The underlying Socket.IO connection (for connection-state listeners). */
  readonly socket: Socket;
  /**
   * Stream a single agent event (start/delta/thinking/end/...) to the server.
   * Pass the `runId` from the command that asked for this work to attribute the
   * event to it; without one the server attributes it to whatever that
   * sub-agent has open.
   */
  agentEvent(
    sessionId: string,
    agentId: string,
    event: RemoteAgentEvent,
    runId?: RunId,
  ): void;
  /** Push a sub-agent's lifecycle status change to the server. */
  subagentUpdate(
    sessionId: string,
    agentId: string,
    status: SubagentStatus,
  ): void;
  /** Send a sub-agent's directed report to Prime. */
  report(sessionId: string, agentId: string, text: string): void;
  /** Read the tail of the shared session transcript (resolved via ack). */
  readRoom(sessionId: string, limit?: number): Promise<ChatMessage[]>;
  /** Close the connection. */
  disconnect(): void;
}

/** Throws for a handler the host did not supply. */
function notImplemented(method: keyof RemoteEnvironmentHandlers): never {
  throw new Error(
    `[remote-subagent] handler "${method}" is not implemented. ` +
      `Provide it via connectRemoteEnvironment({ handlers }).`,
  );
}

/** Fills in any missing handler with a throwing stub. */
function withDefaultHandlers(
  handlers: Partial<RemoteEnvironmentHandlers>,
): RemoteEnvironmentHandlers {
  return {
    onSpawn: handlers.onSpawn ?? (() => notImplemented("onSpawn")),
    onMessage: handlers.onMessage ?? (() => notImplemented("onMessage")),
    onKill: handlers.onKill ?? (() => notImplemented("onKill")),
  };
}

/** Runs a command handler, logging (never throwing) so the socket stays alive. */
async function runHandler(
  method: keyof RemoteEnvironmentHandlers,
  run: () => void | Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error(`[remote-subagent] ${method} failed:`, err);
  }
}

/** Strips a trailing slash so the namespace concatenation is well-formed. */
function normalizeUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Builds the `io()` connection arguments from the connect options. Forwards an
 * explicit `path` only when {@link ConnectRemoteEnvironmentOptions.socketPath}
 * is set, so a mounted-prefix deployment reaches the right transport path while
 * the default `/socket.io` behavior is untouched otherwise.
 */
export function buildRemoteEnvConnectArgs(
  options: ConnectRemoteEnvironmentOptions,
): { uri: string; opts: Partial<ManagerOptions & SocketOptions> } {
  const auth: RemoteEnvHandshake = {
    token: options.token,
    environmentId: options.environmentId,
  };
  return {
    uri: `${normalizeUrl(options.url)}${REMOTE_ENV_NAMESPACE}`,
    opts: {
      auth,
      transports: ["websocket"],
      ...(options.socketPath ? { path: options.socketPath } : {}),
    },
  };
}

/** Wires the inbound command listeners onto the socket. */
function registerCommandHandlers(
  socket: Socket,
  handlers: RemoteEnvironmentHandlers,
): void {
  socket.on(RemoteEnvEvents.Spawn, (command: RemoteSpawnCommand) => {
    void runHandler("onSpawn", () => handlers.onSpawn(command));
  });
  socket.on(RemoteEnvEvents.Message, (command: RemoteMessageCommand) => {
    void runHandler("onMessage", () => handlers.onMessage(command));
  });
  socket.on(RemoteEnvEvents.Kill, (command: RemoteKillCommand) => {
    void runHandler("onKill", () => handlers.onKill(command));
  });
}

/** Projects a tool map onto the wire catalog the server advertises. */
function toolCatalog(tools: RemoteToolMap): RemoteToolDef[] {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

/**
 * Wires the tool-call listener and (re)registers the catalog on every connect,
 * so a reconnect re-declares the tools the server dropped when the socket fell.
 * No-op when the environment hosts no tools.
 */
function registerToolHost(
  socket: Socket,
  tools: RemoteToolMap | undefined,
  sessionId: string | undefined,
): void {
  if (!tools || Object.keys(tools).length === 0) return;

  const announce = (): void => {
    const payload: RemoteToolsRegisterPayload = {
      sessionId: sessionId ?? "",
      tools: toolCatalog(tools),
    };
    socket.emit(RemoteEnvEvents.ToolsRegister, payload);
  };
  socket.on("connect", announce);
  if (socket.connected) announce();

  socket.on(
    RemoteEnvEvents.ToolsCall,
    (
      request: RemoteToolCallRequest,
      callback: (response: RemoteToolCallResponse) => void,
    ) => {
      void runToolCall(tools, request, callback);
    },
  );
}

/** Runs one tool call and acks its result, turning a throw into an error ack. */
async function runToolCall(
  tools: RemoteToolMap,
  request: RemoteToolCallRequest,
  callback: (response: RemoteToolCallResponse) => void,
): Promise<void> {
  const tool = tools[request.name];
  if (!tool) {
    callback({ ok: false, error: `Unknown tool: ${request.name}` });
    return;
  }
  try {
    const result = await tool.execute(request.arguments);
    callback({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    callback({ ok: false, error: message });
  }
}

/**
 * Connects to the server's remote sub-agent gateway and returns a client. The
 * connection authenticates with the supplied token/environmentId; inbound
 * commands are routed to `handlers`, and the returned client is used to stream
 * results back.
 */
export function connectRemoteEnvironment(
  options: ConnectRemoteEnvironmentOptions,
): RemoteEnvironmentClient {
  const handlers = withDefaultHandlers(options.handlers ?? {});
  const { uri, opts } = buildRemoteEnvConnectArgs(options);
  const socket = io(uri, opts);

  registerCommandHandlers(socket, handlers);
  registerToolHost(socket, options.tools, options.sessionId);

  return {
    socket,
    agentEvent(sessionId, agentId, event, runId) {
      const payload: RemoteAgentEventPayload = {
        sessionId,
        agentId,
        event,
        runId,
      };
      socket.emit(RemoteEnvEvents.AgentEvent, payload);
    },
    subagentUpdate(sessionId, agentId, status) {
      const payload: RemoteSubagentUpdatePayload = {
        sessionId,
        agentId,
        status,
      };
      socket.emit(RemoteEnvEvents.SubagentUpdate, payload);
    },
    report(sessionId, agentId, text) {
      const payload: RemoteAgentMessagePayload = { sessionId, agentId, text };
      socket.emit(RemoteEnvEvents.AgentMessage, payload);
    },
    readRoom(sessionId, limit) {
      const request: RemoteRoomReadRequest = { sessionId, limit };
      return new Promise<ChatMessage[]>((resolve, reject) => {
        socket
          .timeout(READ_ROOM_TIMEOUT_MS)
          .emit(
            RemoteEnvEvents.RoomRead,
            request,
            (err: Error | null, response: RemoteRoomReadResponse) => {
              if (err) {
                reject(err);
                return;
              }
              resolve(response.messages);
            },
          );
      });
    },
    disconnect() {
      socket.disconnect();
    },
  };
}

export type {
  RemoteAgentEvent,
  RemoteKillCommand,
  RemoteMessageCommand,
  RemoteSpawnCommand,
  RemoteToolCallRequest,
  RemoteToolCallResponse,
  RemoteToolDef,
} from "@tangent/shared/remoteSubagent.ts";
