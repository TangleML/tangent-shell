import assert from "node:assert/strict";
import { test } from "node:test";

import type { Request, Response } from "express";

import { ScopedTokenCredential } from "../connectors/credentials.ts";
import { InMemorySessionStore } from "../store/inMemorySessionStore.ts";
import { handleMintRemoteEnvToken } from "./embed.ts";

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

test("minting a remote-env token requires an identity", async () => {
  const store = new InMemorySessionStore();
  const scoped = new ScopedTokenCredential("signing-secret");
  const response = new TestResponse();

  await handleMintRemoteEnvToken(
    store,
    scoped,
    { headers: {} } as Request,
    response as unknown as Response,
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: "Invalid or missing token" });
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

test("a non-member with only the session id cannot mint", async () => {
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

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: "Forbidden" });
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
