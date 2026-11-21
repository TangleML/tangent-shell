import { type Request, type Response, Router } from "express";
import { z } from "zod";

import {
  agentCallerFrom,
  type AgentCallerResolver,
  enforceAgentCaller,
} from "../auth/agentCaller.ts";
import {
  chooseEgressIdentity,
  describeTurnIdentity,
  type EgressIdentityDeps,
  ParticipantNotInTurnError,
} from "../auth/egressIdentity.ts";
import {
  EgressDeniedError,
  type EgressInput,
  type EgressRequestInit,
  EgressUpstreamError,
  resolveEgress,
} from "../bundleUi/egressAllowlist.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";

/**
 * Egress request body. `input` must be a non-empty string (replacing the old
 * manual `typeof` guard); `init` stays permissive — it's a structural
 * {@link EgressRequestInit} passed straight through to {@link resolveEgress},
 * so we type it via `z.custom` rather than re-describing its shape, keeping the
 * validated value assignable without an `as` cast. `onBehalfOf` names a member
 * of the caller's identity set to act as instead of the most recent one.
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
  onBehalfOf: z.string().min(1).optional(),
});
type EgressBody = z.infer<typeof egressBodySchema>;

/** Maps a failed proxy call to its status and stable code. */
function sendEgressError(err: unknown, res: Response): void {
  if (err instanceof EgressDeniedError) {
    res.status(403).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ParticipantNotInTurnError) {
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
 * caller's chosen participant, and reports who the call ran as. A backend
 * status is preserved in the envelope (an upstream 401 is a 200 here), so the
 * applied identity rides along with it either way.
 */
async function handleEgress(
  identity: EgressIdentityDeps,
  req: Request,
  res: Response,
): Promise<void> {
  const { input, init, onBehalfOf } = getValidated<EgressBody>(req).body;
  try {
    const chosen = chooseEgressIdentity(
      identity,
      agentCallerFrom(req),
      onBehalfOf,
    );
    const result = await resolveEgress(input as EgressInput, init, "agent", {
      identityToken: chosen.token,
    });
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
 * so the agent never holds them. When the calling agent is known, the call is
 * made on behalf of the human behind its turn; the agent never sets the
 * identity header itself.
 *
 * Guarded by the bearer token shared with the spawned processes via env (the
 * same `INTERNAL_TOKEN` the orchestrator/memory extensions present), so
 * arbitrary local callers can't drive egress.
 */
export function createInternalEgressRouter(
  agents?: AgentCallerResolver,
  identity: EgressIdentityDeps = {
    runs: { participantsFor: () => [], delegationFor: () => undefined },
  },
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
