import assert from "node:assert/strict";
import { test } from "node:test";

import type { Request, Response } from "express";

import {
  AGENT_TOKEN_HEADER,
  type AgentCaller,
  agentCallerFrom,
  agentCallerOf,
  type AgentCallerResolver,
  assertedSessionAndAgent,
  enforceAgentCaller,
} from "./agentCaller.ts";

const WORKER: AgentCaller = { sessionId: "s1", agentId: "worker" };

/** A resolver that knows exactly one live token. */
const resolver: AgentCallerResolver = {
  resolveAgentToken: (token) => (token === "live-token" ? WORKER : undefined),
};

interface Outcome {
  status?: number;
  body?: unknown;
  passed: boolean;
  caller?: AgentCaller;
}

/** Runs the guard over a fake request and reports what it did. */
function run(
  guard: ReturnType<typeof enforceAgentCaller>,
  request: {
    headers?: Record<string, string>;
    body?: unknown;
    query?: unknown;
  },
): Outcome {
  const outcome: Outcome = { passed: false };
  const req = {
    method: "POST",
    path: "/internal/test",
    headers: request.headers ?? {},
    body: request.body,
    query: request.query ?? {},
  } as unknown as Request;
  const res = {
    status(code: number) {
      outcome.status = code;
      return this;
    },
    json(body: unknown) {
      outcome.body = body;
      return this;
    },
  } as unknown as Response;
  guard(req, res, () => {
    outcome.passed = true;
    outcome.caller = agentCallerFrom(req);
  });
  return outcome;
}

test("agentCallerOf resolves the header through the resolver, or nothing", () => {
  assert.deepEqual(
    agentCallerOf({ [AGENT_TOKEN_HEADER]: "live-token" }, resolver),
    WORKER,
  );
  assert.equal(
    agentCallerOf({ [AGENT_TOKEN_HEADER]: "stale" }, resolver),
    undefined,
  );
  assert.equal(agentCallerOf({}, resolver), undefined);
  assert.equal(
    agentCallerOf({ [AGENT_TOKEN_HEADER]: "" }, resolver),
    undefined,
  );
});

test("a matching token passes and is remembered on the request", () => {
  const guard = enforceAgentCaller(resolver, assertedSessionAndAgent());
  const outcome = run(guard, {
    headers: { [AGENT_TOKEN_HEADER]: "live-token" },
    body: { sessionId: "s1", agentId: "worker" },
  });

  assert.equal(outcome.passed, true);
  assert.deepEqual(outcome.caller, WORKER);
});

test("a token naming another session or agent is refused as agent_mismatch", () => {
  const guard = enforceAgentCaller(resolver, assertedSessionAndAgent());

  for (const body of [
    { sessionId: "s2", agentId: "worker" },
    { sessionId: "s1", agentId: "prime" },
  ]) {
    const outcome = run(guard, {
      headers: { [AGENT_TOKEN_HEADER]: "live-token" },
      body,
    });
    assert.equal(outcome.passed, false);
    assert.equal(outcome.status, 403);
    assert.equal((outcome.body as { code: string }).code, "agent_mismatch");
  }
});

test("the default assertion reads only the session, from body or query", () => {
  const guard = enforceAgentCaller(resolver);
  const headers = { [AGENT_TOKEN_HEADER]: "live-token" };

  assert.equal(
    run(guard, { headers, body: { sessionId: "s1", agentId: "prime" } }).passed,
    true,
    "agentId is the target here, not the caller",
  );
  assert.equal(run(guard, { headers, query: { sessionId: "s2" } }).status, 403);
  assert.equal(run(guard, { headers, body: {} }).passed, true);
});

test("a missing token leaves the request alone", () => {
  const guard = enforceAgentCaller(resolver, assertedSessionAndAgent());
  const absent = run(guard, { body: { sessionId: "s9", agentId: "someone" } });

  assert.equal(absent.passed, true);
  assert.equal(absent.caller, undefined);
});

test("a token no live agent holds is refused as agent_unknown and logged without the token", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const guard = enforceAgentCaller(resolver, assertedSessionAndAgent());

  const stale = run(guard, {
    headers: { [AGENT_TOKEN_HEADER]: "stale-secret" },
    body: { sessionId: "s9", agentId: "someone" },
  });
  assert.equal(stale.passed, false);
  assert.equal(stale.status, 401);
  assert.equal((stale.body as { code: string }).code, "agent_unknown");

  const logged = warn.mock.calls.map((c) => c.arguments.join(" ")).join("\n");
  assert.match(logged, /session s9/);
  assert.match(logged, /agent someone/);
  assert.doesNotMatch(logged, /stale-secret/);

  const anonymous = run(guard, {
    headers: { [AGENT_TOKEN_HEADER]: "stale-secret" },
    body: {},
  });
  assert.equal(anonymous.status, 401);
});

test("the caller field can be named, and a guard without a resolver is a pass-through", () => {
  const byParticipant = enforceAgentCaller(
    resolver,
    assertedSessionAndAgent("participantId"),
  );
  const headers = { [AGENT_TOKEN_HEADER]: "live-token" };
  assert.equal(
    run(byParticipant, {
      headers,
      query: { sessionId: "s1", participantId: "worker" },
    }).passed,
    true,
  );
  assert.equal(
    run(byParticipant, {
      headers,
      query: { sessionId: "s1", participantId: "prime" },
    }).status,
    403,
  );

  const open = enforceAgentCaller(undefined, assertedSessionAndAgent());
  assert.equal(
    run(open, { headers, body: { sessionId: "s2", agentId: "prime" } }).passed,
    true,
  );
});
