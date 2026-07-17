import { type Response, Router } from "express";
import { z } from "zod";

import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";

/**
 * A CSOM invocation: the camelCase editor method (e.g. `addTask`,
 * `connectNodes`, `getSpecYaml`) and its positional args, scoped to a session.
 * `args` is permissive — it is forwarded verbatim to the editor bridge.
 */
const csomInvokeSchema = z.object({
  sessionId: z.string().min(1),
  method: z.string().min(1),
  args: z.array(z.unknown()).optional(),
});
type CsomInvokeBody = z.infer<typeof csomInvokeSchema>;

/** Forwards a CSOM call to the session's bound editor and returns its ack. */
async function handleInvoke(
  remoteGateway: RemoteEnvironmentGateway,
  body: CsomInvokeBody,
  res: Response,
): Promise<void> {
  const result = await remoteGateway.invokeCsom(
    body.sessionId,
    body.method,
    body.args ?? [],
  );
  res.json(result);
}

/**
 * Internal API used by the CSOM tool extension running inside each Pi process.
 * It lets Prime drive the embedded Tangle pipeline editor: each tool call is
 * relayed to the browser tab that opened the editor (the session's bound remote
 * environment) and the CSOM result is returned.
 *
 * Guarded by the same `INTERNAL_TOKEN` the other internal APIs use, so only the
 * spawned Pi processes (not arbitrary local callers) can drive the editor.
 */
export function createInternalCsomRouter(
  remoteGateway: RemoteEnvironmentGateway,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.post("/invoke", validate({ body: csomInvokeSchema }), (req, res) =>
    handleInvoke(remoteGateway, getValidated<CsomInvokeBody>(req).body, res),
  );

  return router;
}
