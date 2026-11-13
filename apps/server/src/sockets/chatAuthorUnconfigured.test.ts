import assert from "node:assert/strict";
import { test } from "node:test";

import type { Socket } from "socket.io";

/** Local development: no sign-in cookie is configured, so nothing is refused. */
process.env.AUTH_JWT_TOKEN_COOKIE_NAME = "";
const { requireSignIn } = await import("./chat.ts");

test("without sign-in configured, a connection with no login is let through", () => {
  const socket = { handshake: { headers: {}, auth: {} } } as unknown as Socket;
  let outcome: Error | undefined = new Error("next was not called");
  requireSignIn(socket, (err) => {
    outcome = err;
  });
  assert.equal(outcome, undefined);
});
