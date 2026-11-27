import type { IncomingHttpHeaders } from "node:http";

import type { NextFunction, Request, RequestHandler, Response } from "express";

import { headerValue } from "./headers.ts";

/** Header a Pi process presents its own spawn-time token in. */
export const AGENT_TOKEN_HEADER = "x-tangent-agent-token";

/** The agent behind an `/internal/*` call, as its token resolves it. */
export interface AgentCaller {
  sessionId: string;
  agentId: string;
}

/** Whatever holds the live agents and their spawn-time tokens. */
export interface AgentCallerResolver {
  resolveAgentToken(agentToken: string): AgentCaller | undefined;
}

/** The ids a request asserts about itself, read before validation. */
export interface AssertedIds {
  sessionId?: string;
  agentId?: string;
}

/**
 * Resolves the calling agent from its token header. `undefined` when the
 * header is absent or names no live agent; the caller decides what an unknown
 * token means, so a route can stay open to older extensions that send none.
 */
export function agentCallerOf(
  headers: IncomingHttpHeaders,
  resolver: AgentCallerResolver,
): AgentCaller | undefined {
  const token = headerValue(headers, AGENT_TOKEN_HEADER);
  if (!token) return undefined;
  return resolver.resolveAgentToken(token);
}

/** The caller {@link enforceAgentCaller} resolved for this request, if any. */
export function agentCallerFrom(req: Request): AgentCaller | undefined {
  return req.agentCaller;
}

function stringField(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/** The `sessionId` a request asserts in its body or query. */
export function assertedSession(req: Request): AssertedIds {
  return {
    sessionId:
      stringField(req.body, "sessionId") ?? stringField(req.query, "sessionId"),
  };
}

/** The `sessionId` and the caller-naming field a request asserts. */
export function assertedSessionAndAgent(
  field = "agentId",
): (req: Request) => AssertedIds {
  return (req) => ({
    ...assertedSession(req),
    agentId: stringField(req.body, field) ?? stringField(req.query, field),
  });
}

function mismatches(caller: AgentCaller, asserted: AssertedIds): boolean {
  if (
    asserted.sessionId !== undefined &&
    asserted.sessionId !== caller.sessionId
  )
    return true;
  return asserted.agentId !== undefined && asserted.agentId !== caller.agentId;
}

function describeAsserted(asserted: AssertedIds): string {
  const parts = [
    asserted.sessionId && `session ${asserted.sessionId}`,
    asserted.agentId && `agent ${asserted.agentId}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no session or agent";
}

/**
 * Refuses a request that identified no agent, once `required()` says the
 * deployment needs one: with identity forwarding configured, a trigger or
 * egress call that cannot be tied to an agent must not act at all. Mounted
 * after {@link enforceAgentCaller}, which resolves the token this reads.
 */
export function requireAgentCaller(required: () => boolean): RequestHandler {
  return function guard(req: Request, res: Response, next: NextFunction): void {
    if (!required() || req.agentCaller) {
      next();
      return;
    }
    console.warn(
      `[agent-caller] refused ${req.method} ${req.path}: no agent token, and identity forwarding is configured`,
    );
    res.status(403).json({
      error: "This call needs the calling agent's token.",
      code: "caller_required",
    });
  };
}

/**
 * Holds a request to the identity its agent token proves. A request that
 * asserts a session or agent other than the token's is refused, as is one
 * whose token no live agent holds. One with no token at all passes through
 * unchanged so routes keep working for extensions that do not send one yet.
 * With no resolver to ask, every request passes.
 */
export function enforceAgentCaller(
  resolver: AgentCallerResolver | undefined,
  asserted: (req: Request) => AssertedIds = assertedSession,
): RequestHandler {
  if (!resolver) return (_req, _res, next) => next();
  return function guard(req: Request, res: Response, next: NextFunction): void {
    const token = headerValue(req.headers, AGENT_TOKEN_HEADER);
    if (!token) {
      next();
      return;
    }
    const caller = resolver.resolveAgentToken(token);
    if (!caller) {
      console.warn(
        `[agent-caller] refused ${req.method} ${req.path}: the agent token names no live agent (asserted ${describeAsserted(asserted(req))})`,
      );
      res.status(401).json({
        error: "The agent token names no live agent.",
        code: "agent_unknown",
      });
      return;
    }
    if (mismatches(caller, asserted(req))) {
      res.status(403).json({
        error: "The request names a session or agent other than the caller.",
        code: "agent_mismatch",
      });
      return;
    }
    req.agentCaller = caller;
    next();
  };
}
