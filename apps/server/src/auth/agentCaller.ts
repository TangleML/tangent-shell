import type { IncomingHttpHeaders } from "node:http";

import type { NextFunction, Request, RequestHandler, Response } from "express";

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

interface RequestWithAgentCaller extends Request {
  agentCaller?: AgentCaller;
}

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) || undefined;
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
  return (req as RequestWithAgentCaller).agentCaller;
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

/**
 * Holds a request to the identity its agent token proves. A request that
 * asserts a session or agent other than the token's is refused; one with no
 * token, or a token no live agent holds, passes through unchanged so routes
 * keep working for extensions that do not send one yet. With no resolver to
 * ask, every request passes.
 */
export function enforceAgentCaller(
  resolver: AgentCallerResolver | undefined,
  asserted: (req: Request) => AssertedIds = assertedSession,
): RequestHandler {
  if (!resolver) return (_req, _res, next) => next();
  return function guard(req: Request, res: Response, next: NextFunction): void {
    const caller = agentCallerOf(req.headers, resolver);
    if (!caller) {
      next();
      return;
    }
    if (mismatches(caller, asserted(req))) {
      res.status(403).json({
        error: "The request names a session or agent other than the caller.",
        code: "agent_mismatch",
      });
      return;
    }
    (req as RequestWithAgentCaller).agentCaller = caller;
    next();
  };
}
