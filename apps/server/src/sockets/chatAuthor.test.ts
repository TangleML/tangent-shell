import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_USER } from "@tangent/shared/contracts.ts";

/**
 * `AUTH_JWT_TOKEN_COOKIE_NAME` and `AUTH_JWT_TOKEN_HEADER_NAME` are read once when
 * `config.ts` is first imported, so both names are set before the module graph loads and every branch of
 * `resolveSocketAuthor` is reachable from one file.
 */
process.env.AUTH_JWT_TOKEN_COOKIE_NAME = "OKTASSO_TOKEN";
process.env.AUTH_JWT_TOKEN_HEADER_NAME = "X-Forwarded-Token";
const { resolveSocketAuthor } = await import("./chat.ts");

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

  assert.deepEqual(resolveSocketAuthor({ cookie }), {
    id: "ada@example.com",
    kind: "human",
    name: "Ada L.",
  });
});

test("no cookie falls back to the identity the UI also assumes", () => {
  const author = resolveSocketAuthor({});

  assert.equal(author.kind, "human");
  assert.equal(
    author.id,
    DEFAULT_USER.email,
    "server and UI must agree on the id, or your own messages look like someone else's",
  );
});

test("a malformed token falls back rather than throwing", () => {
  assert.equal(
    resolveSocketAuthor({ cookie: "OKTASSO_TOKEN=not-a-jwt" }).id,
    DEFAULT_USER.email,
  );
});

test("the configured header resolves when a proxy dropped the cookie", () => {
  const headers = {
    "x-forwarded-token": tokenFor({
      email: "grace@example.com",
      first_name: "Grace",
      last_name: "Hopper",
    }),
  };

  assert.deepEqual(resolveSocketAuthor(headers), {
    id: "grace@example.com",
    kind: "human",
    name: "Grace H.",
  });
});

test("the configured header wins over the cookie", () => {
  const headers = {
    "x-forwarded-token": tokenFor({ email: "grace@example.com" }),
    cookie: `OKTASSO_TOKEN=${tokenFor({ email: "ada@example.com" })}`,
  };

  assert.equal(resolveSocketAuthor(headers).id, "grace@example.com");
});

test("the handshake token wins over the configured header", () => {
  const headers = {
    "x-forwarded-token": tokenFor({ email: "grace@example.com" }),
  };

  assert.equal(
    resolveSocketAuthor(headers, tokenFor({ email: "ada@example.com" })).id,
    "ada@example.com",
  );
});

test("an Authorization header on the handshake is ignored", () => {
  const headers = {
    authorization: `Bearer ${tokenFor({ email: "mallory@example.com" })}`,
    cookie: `OKTASSO_TOKEN=${tokenFor({ email: "ada@example.com" })}`,
  };

  assert.equal(resolveSocketAuthor(headers).id, "ada@example.com");
});
