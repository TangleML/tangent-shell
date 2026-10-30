import assert from "node:assert/strict";
import { test } from "node:test";

import { RemoteEnvEvents } from "@tangent/shared/remoteSubagent.ts";
import type { Socket } from "socket.io-client";

import {
  buildRemoteEnvConnectArgs,
  connectRemoteEnvironment,
} from "./index.ts";

const base = {
  token: "env-token",
  environmentId: "env-1",
} as const;

/** A socket whose ack `emit` replies with `responder(event, payload)`. */
function fakeAckSocket(
  responder: (event: string, payload: unknown) => unknown,
): { socket: Socket; emitted: Array<{ event: string; payload: unknown }> } {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const socket = {
    on() {},
    emit() {},
    connected: false,
    disconnect() {},
    timeout() {
      return {
        emit(
          event: string,
          payload: unknown,
          cb: (err: Error | null, response: unknown) => void,
        ) {
          emitted.push({ event, payload });
          cb(null, responder(event, payload));
        },
      };
    },
  } as unknown as Socket;
  return { socket, emitted };
}

test("forwards socketPath as the transport path when set", () => {
  const { uri, opts } = buildRemoteEnvConnectArgs({
    ...base,
    url: "https://host",
    socketPath: "/tangent/socket.io",
  });

  assert.equal(uri, "https://host/remote-env");
  assert.equal(opts.path, "/tangent/socket.io");
});

test("omits path when socketPath is unset, preserving the default", () => {
  const { opts } = buildRemoteEnvConnectArgs({ ...base, url: "https://host" });

  assert.equal("path" in opts, false);
});

test("always requests the websocket transport and forwards auth", () => {
  const { opts } = buildRemoteEnvConnectArgs({ ...base, url: "https://host" });

  assert.deepEqual(opts.transports, ["websocket"]);
  assert.deepEqual(opts.auth, {
    token: "env-token",
    environmentId: "env-1",
  });
});

test("forwards metadata in the handshake auth when set", () => {
  const { opts } = buildRemoteEnvConnectArgs({
    ...base,
    url: "https://host",
    metadata: { windowName: "my-ws" },
  });

  assert.deepEqual(opts.auth, {
    token: "env-token",
    environmentId: "env-1",
    metadata: { windowName: "my-ws" },
  });
});

test("omits metadata from auth when unset", () => {
  const { opts } = buildRemoteEnvConnectArgs({ ...base, url: "https://host" });

  assert.deepEqual(opts.auth, { token: "env-token", environmentId: "env-1" });
});

test("forwards extraHeaders for the transport handshake when set", () => {
  const { opts } = buildRemoteEnvConnectArgs({
    ...base,
    url: "https://host",
    extraHeaders: { cookie: "MINERVA_TOKEN=abc" },
  });

  assert.deepEqual(opts.extraHeaders, { cookie: "MINERVA_TOKEN=abc" });
});

test("omits extraHeaders when unset", () => {
  const { opts } = buildRemoteEnvConnectArgs({ ...base, url: "https://host" });

  assert.equal("extraHeaders" in opts, false);
});

test("addResource emits the request and resolves the stored resource", async () => {
  const resource = { id: "r1", uri: "uploads/x.txt" };
  const { socket, emitted } = fakeAckSocket(() => ({ ok: true, resource }));
  const client = connectRemoteEnvironment(
    { ...base, url: "https://host" },
    () => socket,
  );

  const result = await client.addResource("s1", "a1", {
    kind: "file",
    path: "x.txt",
    content: "hi",
  });

  assert.deepEqual(result, resource);
  assert.deepEqual(emitted[0], {
    event: RemoteEnvEvents.ResourceAdd,
    payload: {
      sessionId: "s1",
      agentId: "a1",
      input: { kind: "file", path: "x.txt", content: "hi" },
    },
  });
});

test("addResource rejects when the server acks an error", async () => {
  const { socket } = fakeAckSocket(() => ({ ok: false, error: "nope" }));
  const client = connectRemoteEnvironment(
    { ...base, url: "https://host" },
    () => socket,
  );

  await assert.rejects(
    client.addResource("s1", "a1", { kind: "host", name: "n", uri: "u" }),
    /nope/,
  );
});

test("listResources resolves the catalog", async () => {
  const resources = [{ id: "r1", uri: "uploads/x.txt" }];
  const { socket } = fakeAckSocket(() => ({ resources }));
  const client = connectRemoteEnvironment(
    { ...base, url: "https://host" },
    () => socket,
  );

  assert.deepEqual(await client.listResources("s1"), resources);
});

test("readResource resolves the base64 content and type", async () => {
  const { socket } = fakeAckSocket(() => ({
    ok: true,
    content: "aGk=",
    contentType: "text/plain",
  }));
  const client = connectRemoteEnvironment(
    { ...base, url: "https://host" },
    () => socket,
  );

  assert.deepEqual(await client.readResource("s1", "uploads/x.txt"), {
    content: "aGk=",
    contentType: "text/plain",
  });
});

test("readResource rejects when the server denies it", async () => {
  const { socket } = fakeAckSocket(() => ({ ok: false, error: "denied" }));
  const client = connectRemoteEnvironment(
    { ...base, url: "https://host" },
    () => socket,
  );

  await assert.rejects(client.readResource("s1", "x"), /denied/);
});
