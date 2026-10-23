import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createUnsignedJwt, mintRemoteEnvToken } from "./remoteEnvToken.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

test("createUnsignedJwt encodes claims with an alg:none header", () => {
  const jwt = createUnsignedJwt({ email: "dev@localhost" });
  const [header, payload, signature] = jwt.split(".");

  assert.deepEqual(decodeSegment(header), { alg: "none", typ: "JWT" });
  assert.deepEqual(decodeSegment(payload), { email: "dev@localhost" });
  assert.equal(signature, "");
});

test("mintRemoteEnvToken posts an identity JWT and parses the response", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        token: "scoped-token",
        environmentId: "env-minted",
        expiresAt: "2026-10-15T12:00:00.000Z",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await mintRemoteEnvToken({
    shellUrl: "http://shell.test/",
    selector: "projectId:project-a",
    email: "dev@localhost",
    environmentId: "env-pin",
  });

  assert.deepEqual(result, {
    token: "scoped-token",
    environmentId: "env-minted",
    expiresAtMs: Date.parse("2026-10-15T12:00:00.000Z"),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://shell.test/api/embed/remote-env-token");
  const headers: Record<string, string> = calls[0].init.headers as Record<
    string,
    string
  >;
  assert.equal(
    headers.Authorization,
    `Bearer ${createUnsignedJwt({ email: "dev@localhost" })}`,
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    selector: "projectId:project-a",
    environmentId: "env-pin",
  });
});

test("mintRemoteEnvToken throws on a non-ok response", async () => {
  globalThis.fetch = (async () =>
    new Response("nope", {
      status: 401,
      statusText: "Unauthorized",
    })) as typeof fetch;

  await assert.rejects(
    mintRemoteEnvToken({
      shellUrl: "http://shell.test",
      selector: "projectId:project-a",
      email: "dev@localhost",
    }),
    /Failed to mint remote-env token \(401 Unauthorized\)/,
  );
});
