import { type Request, type Response, Router } from "express";
import { z } from "zod";

import {
  agentCallerFrom,
  type AgentCallerResolver,
  enforceAgentCaller,
} from "../auth/agentCaller.ts";
import {
  CallerRequiredError,
  chooseEgressIdentity,
  type ChosenIdentity,
  describeTurnIdentity,
  type EgressIdentityDeps,
  ParticipantAssertionExpiredError,
} from "../auth/egressIdentity.ts";
import { identityAssertions } from "../auth/identityAssertions.ts";
import {
  EgressDeniedError,
  type EgressRequestInit,
  type EgressResponse,
  EgressUpstreamError,
  resolveEgress,
} from "../bundleUi/egressAllowlist.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";

/**
 * Egress request body. `init` is a structural {@link EgressRequestInit} passed
 * straight through to {@link resolveEgress}, so it is typed via `z.custom`
 * rather than re-described, keeping the validated value assignable as is.
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
 * A 401 means the backend refused the assertion the call carried, so it is
 * dropped from the cache and the next call is refused as
 * `participant_assertion_expired` rather than failing the same way.
 */
function chargeRefusal(
  identity: EgressIdentityDeps,
  chosen: ChosenIdentity,
  result: EgressResponse,
): void {
  if (result.status !== 401 || chosen.applied.kind !== "participant") return;
  (identity.assertions ?? identityAssertions).evict(chosen.applied.id);
}

/** Maps a failed proxy call to its status and stable code. */
function sendEgressError(err: unknown, res: Response): void {
  if (err instanceof EgressDeniedError) {
    res.status(403).json({ error: err.message, code: err.code });
    return;
  }
  if (
    err instanceof ParticipantAssertionExpiredError ||
    err instanceof CallerRequiredError
  ) {
    res.status(403).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof EgressUpstreamError) {
    res.status(502).json({ error: err.message, code: err.code });
    return;
  }
  res
    .status(502)
    .json({ error: "egress request failed", code: "egress_failed" });
}

/**
 * Resolves the requested destination against the egress allowlist as the
 * human behind the caller's turn, and reports who the call ran as. A backend
 * status is preserved in the envelope (an upstream 401 is a 200 here), so the
 * applied identity rides along with it either way.
 */
async function handleEgress(
  identity: EgressIdentityDeps,
  req: Request,
  res: Response,
): Promise<void> {
  const { input, init } = getValidated<EgressBody>(req).body;
  try {
    const caller = agentCallerFrom(req);
    const chosen = chooseEgressIdentity(identity, caller);
    const result = await resolveEgress(input, init, "agent", {
      identityToken: chosen.token,
    });
    chargeRefusal(identity, chosen, result);
    res.json({ ...result, appliedIdentity: chosen.applied });
  } catch (err) {
    sendEgressError(err, res);
  }
}

/**
 * Internal egress API used by bundle tool extensions running inside each Pi
 * process (e.g. the Tangle API tool). It is the agent-side counterpart to the
 * public bundle-UI `host.fetch` proxy: the request is validated against the
 * same {@link resolveEgress} allowlist and the server injects any credentials,
 * so the agent never holds them. With identity forwarding configured, the call
 * is made on behalf of the human behind the calling agent's turn; a call that
 * does not identify its agent, or whose participant's assertion has expired,
 * is refused rather than run as the instance; the agent never sets the
 * identity header itself.
 *
 * Guarded by the bearer token shared with the spawned processes via env (the
 * same `INTERNAL_TOKEN` the orchestrator/memory extensions present), so
 * arbitrary local callers can't drive egress.
 */
export function createInternalEgressRouter(
  agents?: AgentCallerResolver,
  identity: EgressIdentityDeps = { runs: { audienceFor: () => undefined } },
): Router {
  const router = Router();

  router.use(requireInternalToken, enforceAgentCaller(agents));

  router.post("/", validate({ body: egressBodySchema }), (req, res) =>
    handleEgress(identity, req, res),
  );

  router.get("/identity", (req: Request, res: Response) => {
    res.json(describeTurnIdentity(identity, agentCallerFrom(req)));
  });

  return router;
}
