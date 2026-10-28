import type { Request } from "express";

import type { RunRegistry } from "../runs/runRegistry.ts";

/** Header a Pi process presents its per-process `TANGENT_AGENT_TOKEN` on. */
export const AGENT_TOKEN_HEADER = "x-tangent-agent-token";

/** A live agent in a session. */
export interface AgentCaller {
  sessionId: string;
  agentId: string;
}

/** Resolves the live agent a per-process token belongs to. */
export type AgentTokenResolver = (
  token: string | undefined,
) => AgentCaller | undefined;

/**
 * The team the calling agent's open Run may act as. The caller is whoever the
 * request's agent token names, never ids in the body; a route acting for a
 * named participant passes it as `expected`, and any other caller gets no team.
 */
export function callerActingTeam(
  req: Request,
  agents: AgentTokenResolver,
  runs: RunRegistry,
  expected?: AgentCaller,
): string | undefined {
  const caller = agents(req.get(AGENT_TOKEN_HEADER));
  if (!caller) return undefined;
  if (
    expected &&
    (expected.sessionId !== caller.sessionId ||
      expected.agentId !== caller.agentId)
  ) {
    return undefined;
  }
  return runs.actingTeamFor(caller.sessionId, caller.agentId);
}
