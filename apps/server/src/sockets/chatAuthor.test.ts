import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_USER } from "@tangent/shared/contracts.ts";

/**
 * `AUTH_JWT_TOKEN_COOKIE_NAME` is read once when `config.ts` is first imported,
 * so the cookie name is set before the module graph loads and both branches of
 * `resolveSocketAuthor` are reachable from one file.
 */
process.env.AUTH_JWT_TOKEN_COOKIE_NAME = "OKTASSO_TOKEN";
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
