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

import type { ChatMessage, SubagentStatus } from "@tangent/shared/contracts.ts";
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
import { io, type Socket } from "socket.io-client";

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
  /**
   * Execute a CSOM editing method against the environment's embedded pipeline
   * editor and return its result. Optional: environments that don't host an
   * editor can omit it (incoming CSOM calls are then rejected). Return the
   * method's raw value; the connector wraps thrown errors into an error ack.
   */
  onCsomCall?(request: RemoteCsomCallRequest): unknown | Promise<unknown>;
}

/** Options for {@link connectRemoteEnvironment}. */
export interface ConnectRemoteEnvironmentOptions {
  /** Base server URL, e.g. `http://localhost:8787` (namespace is appended). */
  url: string;
  /** Shared bearer token the server validates against `REMOTE_ENV_TOKEN`. */
  token: string;
  /** Stable id identifying this environment when several are connected. */
  environmentId: string;
  /**
   * When set, binds this connection as the CSOM executor for `sessionId` so the
   * server can route that session's `onCsomCall` invocations here.
   */
  sessionId?: string;
  /** Command handlers; any omitted handler throws when its command arrives. */
  handlers?: Partial<RemoteEnvironmentHandlers>;
}

/**
 * A connected remote environment. Holds the live Socket.IO connection and the
 * outbound half of the protocol: stream events back, push roster transitions,
 * report to Prime, and read the shared transcript.
 */
export interface RemoteEnvironmentClient {
  /** The underlying Socket.IO connection (for connection-state listeners). */
  readonly socket: Socket;
  /** Stream a single agent event (start/delta/thinking/end/...) to the server. */
  agentEvent(sessionId: string, agentId: string, event: RemoteAgentEvent): void;
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
    onCsomCall: handlers.onCsomCall,
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
  socket.on(
    RemoteEnvEvents.CsomCall,
    (
      request: RemoteCsomCallRequest,
      ack: (response: RemoteCsomCallResponse) => void,
    ) => void respondToCsomCall(handlers, request, ack),
  );
}

/** Runs the CSOM handler and answers the server's ack with a typed response. */
async function respondToCsomCall(
  handlers: RemoteEnvironmentHandlers,
  request: RemoteCsomCallRequest,
  ack: (response: RemoteCsomCallResponse) => void,
): Promise<void> {
  if (!handlers.onCsomCall) {
    ack({ ok: false, error: "This environment does not host a CSOM editor." });
    return;
  }
  try {
    const value = await handlers.onCsomCall(request);
    ack({ ok: true, value });
  } catch (err) {
    ack({ ok: false, error: (err as Error).message });
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
  const auth: RemoteEnvHandshake = {
    token: options.token,
    environmentId: options.environmentId,
    sessionId: options.sessionId,
  };
  const socket = io(`${normalizeUrl(options.url)}${REMOTE_ENV_NAMESPACE}`, {
    auth,
    transports: ["websocket"],
  });

  registerCommandHandlers(socket, handlers);

  return {
    socket,
    agentEvent(sessionId, agentId, event) {
      const payload: RemoteAgentEventPayload = { sessionId, agentId, event };
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
  RemoteCsomCallRequest,
  RemoteCsomCallResponse,
  RemoteKillCommand,
  RemoteMessageCommand,
  RemoteSpawnCommand,
} from "@tangent/shared/remoteSubagent.ts";
