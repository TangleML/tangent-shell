import { type Request, type Response, Router } from "express";
import { z } from "zod";

import {
  type AgentTokenResolver,
  callerActingTeam,
} from "../auth/agentCaller.ts";
import {
  EgressDeniedError,
  type EgressInput,
  type EgressOptions,
  type EgressRequestInit,
  EgressUpstreamError,
  resolveEgress,
} from "../bundleUi/egressAllowlist.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";

/**
 * Egress request body. `input` must be a non-empty string (replacing the old
 * manual `typeof` guard); `init` stays permissive — it's a structural
 * {@link EgressRequestInit} passed straight through to {@link resolveEgress},
 * so we type it via `z.custom` rather than re-describing its shape, keeping the
 * validated value assignable without an `as` cast.
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
});
type EgressBody = z.infer<typeof egressBodySchema>;

/**
 * Resolves the requested destination against the egress allowlist, mapping a
 * denied destination to `403` and any other failure to `502`.
 */
async function handleEgress(
  input: EgressInput,
  init: EgressRequestInit | undefined,
  options: EgressOptions,
  res: Response,
): Promise<void> {
  try {
    const result = await resolveEgress(input, init, "agent", options);
    res.json(result);
  } catch (err) {
    if (err instanceof EgressDeniedError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(502).json({
      error:
        err instanceof EgressUpstreamError
          ? err.message
          : "egress request failed",
    });
  }
}

/**
 * Internal egress API used by bundle tool extensions running inside each Pi
 * process (e.g. the Tangle API tool). It is the agent-side counterpart to the
 * public bundle-UI `host.fetch` proxy: the request is validated against the
 * same {@link resolveEgress} allowlist and the server injects any credentials,
 * so the agent never holds them.
 *
 * Guarded by the bearer token shared with the spawned processes via env (the
 * same `INTERNAL_TOKEN` the orchestrator/memory extensions present), so
 * arbitrary local callers can't drive egress. A team-scoped request acts as the
 * team of the Run its agent token names; without the token it acts as none.
 */
export function createInternalEgressRouter(
  agents: AgentTokenResolver,
  runs: RunRegistry,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.post(
    "/",
    validate({ body: egressBodySchema }),
    (req: Request, res: Response) => {
      const { input, init } = getValidated<EgressBody>(req).body;
      const actingTeam = callerActingTeam(req, agents, runs);
      return handleEgress(input, init, { actingTeam }, res);
    },
  );

  // Lets a tool tell the agent which team its current turn acts as.
  router.get("/acting-team", (req: Request, res: Response) => {
    res.json({ actingTeam: callerActingTeam(req, agents, runs) ?? null });
  });

  return router;
}
