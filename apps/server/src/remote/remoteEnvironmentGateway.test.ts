import assert from "node:assert/strict";
import { test } from "node:test";

import type { Server as SocketIOServer, Socket } from "socket.io";

import type { PiAgentHandlers } from "../pi/types.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { RemoteEnvironmentGateway } from "./remoteEnvironmentGateway.ts";

/**
 * A gateway wired to a fake namespace, plus a `connect` that registers an
 * environment by driving the captured connection handler (bypassing the token
 * middleware, which is not what these tests are about).
 */
function makeHarness() {
  let onConnection: ((socket: Socket) => void) | undefined;
  const namespace = {
    use: () => {},
    on: (event: string, handler: (socket: Socket) => void) => {
      if (event === "connection") onConnection = handler;
    },
  };

  const handlers: PiAgentHandlers = {
    onAgentEvent: () => {},
    onSubagentUpdate: () => {},
    onAgentMessage: () => {},
    onSessionStatus: () => {},
  };
  const store = { getMessages: async () => [] } as unknown as SessionStore;

  const gateway = new RemoteEnvironmentGateway(
    { of: () => namespace } as unknown as SocketIOServer,
    handlers,
    store,
    () => {},
  );

  const connect = (environmentId: string): void => {
    const socket = {
      handshake: { auth: { environmentId } },
      on: () => {},
      emit: () => {},
    } as unknown as Socket;
    onConnection?.(socket);
  };

  return { gateway, connect };
}

test("the remote roster describes its connector and environment", () => {
  const h = makeHarness();
  h.connect("env-1");

  const { info } = h.gateway.spawnSubagent("s1", { name: "Worker" });

  const expected = {
    kind: "remote-env",
    lifecycle: "owned",
    spawnAuthority: "remote-env",
    environmentId: "env-1",
  };
  assert.deepEqual(info.connector, expected);
  assert.equal(info.host, "remote");
  assert.deepEqual(h.gateway.listSubagents("s1")[0].connector, expected);
});
