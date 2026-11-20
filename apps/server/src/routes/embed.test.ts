import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";

import { DEFAULT_USER } from "@tangent/shared/contracts.ts";
import express, { type Request, type Response } from "express";
import { z } from "zod";

import { MAX_JSON_BODY_BYTES } from "../config.ts";
import { ScopedTokenCredential } from "../connectors/credentials.ts";
import { createEmbedCors } from "../middleware/embedCors.ts";
import { errorHandler } from "../middleware/errorHandler.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import { createEmbedRouter, handleMintRemoteEnvToken } from "./embed.ts";

class TestResponse {
  statusCode = 200;
  body: unknown;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    return this;
  }
}

const USER = {
  email: "owner@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
};

function fakeJwt(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email })).toString("base64url");
  return `hdr.${payload}.sig`;
}

function requestWithBearer(email: string): Request {
  return {
    headers: { authorization: `Bearer ${fakeJwt(email)}` },
  } as Request;
}

function validatedRequest(
  sessionId: string,
  email: string,
  environmentId?: string,
): Request {
  const req = requestWithBearer(email) as Request & {
    validated: {
      body: { sessionId: string; environmentId?: string };
      params: unknown;
      query: unknown;
    };
  };
  req.validated = {
    body: { sessionId, environmentId },
    params: undefined,
    query: undefined,
  };
  return req;
}

/** A mint request with no `sessionId` — a user- or selector-scoped host. */
function sessionlessRequest(email: string, selector?: string): Request {
  const req = requestWithBearer(email) as Request & {
    validated: { body: { selector?: string }; params: unknown; query: unknown };
  };
  req.validated = {
    body: selector ? { selector } : {},
    params: undefined,
    query: undefined,
  };
  return req;
}

/** A credential-less request (no cookie, no bearer) carrying a validated body. */
function anonymousRequest(body: Record<string, unknown>): Request {
  return {
    headers: {},
    validated: { body, params: undefined, query: undefined },
  } as unknown as Request;
}

test("an unauthenticated caller mints as the anonymous DEFAULT_USER", async () => {
  const store = new InMemorySessionStore();
  const session = await store.createSession({ name: "Dev" });
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    anonymousRequest({ sessionId: session.id }),
    response as unknown as Response,
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as { token: string };
  const claims = scoped.parse(body.token);
  assert.ok(claims);
  assert.equal(claims.sessionId, session.id);
  assert.equal(claims.sub, DEFAULT_USER.email);
});

test("minting a remote-env token 404s for an unknown session", async () => {
  const store = new InMemorySessionStore();
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    validatedRequest("missing-session", USER.email),
    response as unknown as Response,
  );

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Session not found" });
});

test("an invited member can mint, not just the session owner", async () => {
  const store = new InMemorySessionStore();
  const session = await store.createSession({ name: "Owned", user: USER });
  await store.updateSession(session.id, { accessPolicy: "restricted" });
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    validatedRequest(session.id, "guest@example.com"),
    response as unknown as Response,
    () => false,
    () => Promise.resolve(true),
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as { token: string };
  const claims = scoped.parse(body.token);
  assert.ok(claims);
  assert.equal(claims.sub, "guest@example.com");
});

test("a non-member with only the session id cannot mint on a restricted session", async () => {
  const store = new InMemorySessionStore();
  const session = await store.createSession({ name: "Owned", user: USER });
  await store.updateSession(session.id, { accessPolicy: "restricted" });
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    validatedRequest(session.id, "stranger@example.com"),
    response as unknown as Response,
    () => false,
    () => Promise.resolve(false),
  );

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: "Forbidden" });
});

test("a non-member can mint on an open session", async () => {
  const store = new InMemorySessionStore();
  const session = await store.createSession({ name: "Owned", user: USER });
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    validatedRequest(session.id, "stranger@example.com"),
    response as unknown as Response,
    () => false,
    () => Promise.resolve(false),
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as { token: string };
  const claims = scoped.parse(body.token);
  assert.ok(claims);
  assert.equal(claims.sub, "stranger@example.com");
});

test("minting a remote-env token succeeds when the caller owns the session", async () => {
  const store = new InMemorySessionStore();
  const session = await store.createSession({ name: "Owned", user: USER });
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    validatedRequest(session.id, USER.email),
    response as unknown as Response,
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as {
    token: string;
    environmentId: string;
    expiresAt: string;
  };
  assert.equal(typeof body.token, "string");
  assert.equal(typeof body.environmentId, "string");
  assert.equal(typeof body.expiresAt, "string");

  const claims = scoped.parse(body.token);
  assert.ok(claims);
  assert.equal(claims.sessionId, session.id);
  assert.equal(claims.environmentId, body.environmentId);
  assert.equal(claims.sub, USER.email);
});

test("minting a remote-env token succeeds for a session with no user", async () => {
  const store = new InMemorySessionStore();
  const session = await store.createSession({ name: "Anonymous" });
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    validatedRequest(session.id, USER.email),
    response as unknown as Response,
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as { token: string };
  assert.ok(scoped.parse(body.token));
});

test("a selector mint authorizes on identity alone and carries no sessionId", async () => {
  const store = new InMemorySessionStore();
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    sessionlessRequest(USER.email, "projectId:abc"),
    response as unknown as Response,
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as { token: string };
  const claims = scoped.parse(body.token);
  assert.ok(claims);
  assert.equal(claims.selector, "projectId:abc");
  assert.equal(claims.sessionId, undefined);
  assert.equal(claims.sub, USER.email);
});

test("a user-scoped mint (no session, no selector) authorizes on identity alone", async () => {
  const store = new InMemorySessionStore();
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    sessionlessRequest(USER.email),
    response as unknown as Response,
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as { token: string };
  const claims = scoped.parse(body.token);
  assert.ok(claims);
  assert.equal(claims.sessionId, undefined);
  assert.equal(claims.selector, undefined);
  assert.equal(claims.sub, USER.email);
});

test("a session-less unauthenticated mint is a user-scoped DEFAULT_USER token", async () => {
  const store = new InMemorySessionStore();
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    anonymousRequest({ selector: "projectId:abc" }),
    response as unknown as Response,
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as { token: string };
  const claims = scoped.parse(body.token);
  assert.ok(claims);
  assert.equal(claims.sub, DEFAULT_USER.email);
  assert.equal(claims.selector, "projectId:abc");
  assert.equal(claims.sessionId, undefined);
});

test("minting honors a pinned environmentId when it is free", async () => {
  const store = new InMemorySessionStore();
  const session = await store.createSession({ name: "Owned", user: USER });
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    validatedRequest(session.id, USER.email, "env-pinned"),
    response as unknown as Response,
    () => false,
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as { environmentId: string };
  assert.equal(body.environmentId, "env-pinned");
});

test("minting refuses to reuse an id another person's live host holds", async () => {
  const store = new InMemorySessionStore();
  const session = await store.createSession({ name: "Owned", user: USER });
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    validatedRequest(session.id, "guest@example.com", "env-taken"),
    response as unknown as Response,
    (environmentId, sub) =>
      environmentId === "env-taken" && sub === "guest@example.com",
    () => Promise.resolve(true),
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as { environmentId: string };
  assert.notEqual(body.environmentId, "env-taken");
});

const HOST_ORIGIN = "https://host.example";
const TOKEN_PATH = "/api/embed/remote-env-token";

async function createHttpFixture(t: TestContext) {
  const store = new InMemorySessionStore();
  const session = await store.createSession({ name: "HTTP", user: USER });
  await store.updateSession(session.id, { accessPolicy: "restricted" });
  const scoped = new ScopedTokenCredential("http-test-signing-secret");
  const mint = t.mock.method(scoped, "mint");
  const app = express();
  app.use(createEmbedCors([HOST_ORIGIN, "http://localhost:3000"]));
  app.use(express.json({ limit: MAX_JSON_BODY_BYTES }));
  app.use(
    "/api/embed",
    createEmbedRouter(store, () => false, undefined, scoped),
  );
  app.use(errorHandler);

  const server = createServer(app);
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  function post(
    body: string,
    origin = HOST_ORIGIN,
    email: string | undefined = USER.email,
  ) {
    return fetch(`${baseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(email ? { Authorization: `Bearer ${fakeJwt(email)}` } : {}),
      },
      body,
    });
  }
  return { baseUrl, session, scoped, mint, post };
}

function assertAllowedCors(response: globalThis.Response) {
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    HOST_ORIGIN,
  );
  assert.equal(response.headers.get("vary"), "Origin");
  assert.equal(
    response.headers.get("access-control-allow-methods"),
    "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  );
  assert.equal(
    response.headers.get("access-control-allow-headers"),
    "Authorization, Content-Type",
  );
  assert.equal(response.headers.has("access-control-allow-credentials"), false);
}

function assertNoCorsPermissions(response: globalThis.Response) {
  for (const header of [
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-allow-credentials",
  ]) {
    assert.equal(response.headers.has(header), false, header);
  }
}

test("HTTP allowed preflight short-circuits before JSON parsing or token minting", async (t) => {
  const { baseUrl, mint } = await createHttpFixture(t);
  const response = await fetch(`${baseUrl}${TOKEN_PATH}`, {
    method: "OPTIONS",
    headers: {
      Origin: HOST_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
      "Content-Type": "application/json",
    },
    body: "{invalid json",
  });
  assert.equal(response.status, 204);
  assertAllowedCors(response);
  assert.equal(await response.text(), "");
  assert.equal(mint.mock.callCount(), 0);
});

test("HTTP authenticated JSON POST mints a session-scoped token with CORS", async (t) => {
  const { session, scoped, mint, post } = await createHttpFixture(t);
  const response = await post(JSON.stringify({ sessionId: session.id }));
  assert.equal(response.status, 200);
  assertAllowedCors(response);
  const body = z
    .object({
      token: z.string(),
      environmentId: z.string(),
      expiresAt: z.string(),
    })
    .parse(await response.json());
  const claims = scoped.parse(body.token);
  assert.ok(claims);
  assert.equal(claims.sessionId, session.id);
  assert.equal(claims.sub, USER.email);
  assert.equal(claims.environmentId, body.environmentId);
  assert.equal(mint.mock.callCount(), 1);
});

for (const { name, body, status, error } of [
  {
    name: "malformed JSON",
    body: "{invalid json",
    status: 400,
    error: undefined,
  },
  {
    name: "oversized JSON",
    body: JSON.stringify({ selector: "x".repeat(MAX_JSON_BODY_BYTES) }),
    status: 413,
    error: "request entity too large",
  },
  {
    name: "invalid schema",
    body: JSON.stringify({ sessionId: "" }),
    status: 400,
    error: "Invalid request",
  },
  {
    name: "unknown session",
    body: JSON.stringify({ sessionId: "missing-session" }),
    status: 404,
    error: "Session not found",
  },
]) {
  test(`HTTP ${name} retains CORS headers without minting`, async (t) => {
    const { mint, post } = await createHttpFixture(t);
    const response = await post(body);
    assert.equal(response.status, status);
    assertAllowedCors(response);
    const result = z.object({ error: z.string() }).parse(await response.json());
    if (error) assert.equal(result.error, error);
    else assert.match(result.error, /JSON/);
    assert.equal(mint.mock.callCount(), 0);
  });
}

for (const email of ["stranger@example.com", ""]) {
  test(`HTTP restricted session denies ${email || "anonymous caller"} with CORS`, async (t) => {
    const { session, mint, post } = await createHttpFixture(t);
    const response = await post(
      JSON.stringify({ sessionId: session.id }),
      HOST_ORIGIN,
      email,
    );
    assert.equal(response.status, 403);
    assertAllowedCors(response);
    assert.deepEqual(await response.json(), { error: "Forbidden" });
    assert.equal(mint.mock.callCount(), 0);
  });
}

test("HTTP unknown API path retains CORS headers", async (t) => {
  const { baseUrl, mint } = await createHttpFixture(t);
  const response = await fetch(`${baseUrl}/api/unknown`, {
    headers: { Origin: HOST_ORIGIN },
  });
  assert.equal(response.status, 404);
  assertAllowedCors(response);
  await response.text();
  assert.equal(mint.mock.callCount(), 0);
});

test("HTTP unlisted origin gets no permission on preflight, success, or denial", async (t) => {
  const { baseUrl, session, mint, post } = await createHttpFixture(t);
  const origin = "https://unlisted.example";
  const preflight = await fetch(`${baseUrl}${TOKEN_PATH}`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assertNoCorsPermissions(preflight);
  assert.equal(mint.mock.callCount(), 0);

  const success = await post(JSON.stringify({ sessionId: session.id }), origin);
  assert.equal(success.status, 200);
  assertNoCorsPermissions(success);
  await success.json();
  assert.equal(mint.mock.callCount(), 1);

  const denied = await post(
    JSON.stringify({ sessionId: session.id }),
    origin,
    "stranger@example.com",
  );
  assert.equal(denied.status, 403);
  assertNoCorsPermissions(denied);
  assert.deepEqual(await denied.json(), { error: "Forbidden" });
  assert.equal(mint.mock.callCount(), 1);
});
