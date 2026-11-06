import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_USER } from "@tangent/shared/contracts.ts";
import type { Socket } from "socket.io";

/**
 * `AUTH_JWT_TOKEN_COOKIE_NAME` is read once when `config.ts` is first imported,
 * so the cookie name is set before the module graph loads and both branches of
 * `resolveSocketAuthor` are reachable from one file.
 */
process.env.AUTH_JWT_TOKEN_COOKIE_NAME = "OKTASSO_TOKEN";
const { requireSignIn, resolveSocketAuthor } = await import("./chat.ts");

/** An unsigned JWT carrying just the claims the identity resolver reads. */
function tokenFor(claims: Record<string, string>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

test("the author comes from the connection's own JWT", () => {
  const cookie = `OKTASSO_TOKEN=${tokenFor({
    email: "ada@example.com",
    given_name: "Ada",
    family_name: "Lovelace",
  })}`;

  assert.deepEqual(resolveSocketAuthor(cookie), {
    id: "ada@example.com",
    kind: "human",
    name: "Ada L.",
  });
});

test("no cookie falls back to the identity the UI also assumes", () => {
  const author = resolveSocketAuthor(undefined);

  assert.equal(author.kind, "human");
  assert.equal(
    author.id,
    DEFAULT_USER.email,
    "server and UI must agree on the id, or your own messages look like someone else's",
  );
});

test("a malformed token falls back rather than throwing", () => {
  assert.equal(
    resolveSocketAuthor("OKTASSO_TOKEN=not-a-jwt").id,
    DEFAULT_USER.email,
  );
});

/** Runs the sign-in gate on a handshake and reports what it passed to `next`. */
function gate(handshake: {
  cookie?: string;
  token?: string;
}): Error | undefined {
  const socket = {
    handshake: {
      headers: { cookie: handshake.cookie },
      auth: handshake.token ? { token: handshake.token } : {},
    },
  } as unknown as Socket;
  let outcome: Error | undefined;
  requireSignIn(socket, (err) => {
    outcome = err;
  });
  return outcome;
}

const adaToken = tokenFor({ email: "ada@example.com" });

test("a signed-in cookie is let through", () => {
  assert.equal(gate({ cookie: `OKTASSO_TOKEN=${adaToken}` }), undefined);
});

test("a handshake token is let through when the cookie was dropped", () => {
  assert.equal(gate({ token: adaToken }), undefined);
});

test("no login is refused rather than chatting as the shared default user", () => {
  assert.match(gate({})?.message ?? "", /Not signed in/);
  assert.match(
    gate({ cookie: "OKTASSO_TOKEN=not-a-jwt" })?.message ?? "",
    /Not signed in/,
  );
});
