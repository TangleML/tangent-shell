import { type Request, type Response, Router } from "express";
import { z } from "zod";

import {
  AGENT_TOKEN_HEADER,
  type AgentTokenResolver,
  callerActingTeam,
} from "../auth/agentCaller.ts";
import {
  EgressDeniedError,
  type EgressInput,
  type EgressOptions,
  type EgressRequestInit,
  EgressUpstreamError,
  resolveEgressWithTeam,
  TeamNotGrantedError,
} from "../bundleUi/egressAllowlist.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";

/**
 * Egress request body. `input` must be a non-empty string (replacing the old
 * manual `typeof` guard); `init` stays permissive — it's a structural
 * {@link EgressRequestInit} passed straight through to
 * {@link resolveEgressWithTeam}, so we type it via `z.custom` rather than
 * re-describing its shape, keeping the validated value assignable without an
 * `as` cast.
 */
const egressInputSchema = z.union([
  z.string().min(1),
  z.object({
    target: z.literal("tangle"),
    path: z.string().min(1),
  }),
]);

const egressBodySchema = z.object({
  input: egressInputSchema,
  init: z.custom<EgressRequestInit>().optional(),
  actAsTeam: z.boolean().optional(),
});
type EgressBody = z.infer<typeof egressBodySchema>;

/**
 * Resolves the requested destination against the egress allowlist, mapping a
 * denied destination or an ungranted team to `403` and any other failure to
 * `502`, each with a stable `code` next to `error`. A resolved request reports
 * `appliedTeam`, `null` when it went upstream as no team.
 */
async function handleEgress(
  input: EgressInput,
  init: EgressRequestInit | undefined,
  options: EgressOptions,
  res: Response,
): Promise<void> {
  try {
    const { response, appliedTeam } = await resolveEgressWithTeam(
      input,
      init,
      "agent",
      options,
    );
    res.json({ ...response, appliedTeam: appliedTeam ?? null });
  } catch (err) {
    if (
      err instanceof EgressDeniedError ||
      err instanceof TeamNotGrantedError
    ) {
      res.status(403).json({ error: err.message, code: err.code });
      return;
    }
    res
      .status(502)
      .json(
        err instanceof EgressUpstreamError
          ? { error: err.message, code: err.code }
          : { error: "egress request failed", code: "egress_failed" },
      );
  }
}

/**
 * Internal egress API used by bundle tool extensions running inside each Pi
 * process (e.g. the Tangle API tool). It is the agent-side counterpart to the
 * public bundle-UI `host.fetch` proxy: the request is validated against the
 * same allowlist ({@link resolveEgressWithTeam}) and the server injects any
 * credentials, so the agent never holds them.
 *
 * Guarded by the bearer token shared with the spawned processes via env (the
 * same `INTERNAL_TOKEN` the orchestrator/memory extensions present), so
 * arbitrary local callers can't drive egress. A team-scoped request acts as a
 * team only when it sets `actAsTeam`, and then as the team granted to the Run
 * its agent token names; asking without a grant is refused.
 */
export function createInternalEgressRouter(
  agents: AgentTokenResolver,
  runs: RunRegistry,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  const grantedTeamOf = (req: Request) =>
    callerActingTeam(req.get(AGENT_TOKEN_HEADER), agents, runs);

  router.post(
    "/",
    validate({ body: egressBodySchema }),
    (req: Request, res: Response) => {
      const { input, init, actAsTeam } = getValidated<EgressBody>(req).body;
      const grantedTeam = grantedTeamOf(req);
      return handleEgress(input, init, { grantedTeam, actAsTeam }, res);
    },
  );

  // Lets a tool tell the agent which team its current turn may act as.
  router.get("/granted-team", (req: Request, res: Response) => {
    res.json({ grantedTeam: grantedTeamOf(req) ?? null });
  });

  return router;
}
