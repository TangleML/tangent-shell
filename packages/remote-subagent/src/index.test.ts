import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRemoteEnvConnectArgs } from "./index.ts";

const base = {
  token: "env-token",
  environmentId: "env-1",
} as const;

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
