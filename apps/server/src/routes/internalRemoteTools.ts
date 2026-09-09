import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";

/** `GET /list` query: the session whose remote tool catalog to read. */
const listQuerySchema = z.object({
  sessionId: z.string(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

/** `POST /call` body: invoke one registered remote tool on behalf of an agent. */
const callBodySchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  name: z.string(),
  arguments: z.unknown(),
});
type CallBody = z.infer<typeof callBodySchema>;

/** `GET /list`: the tools the session's connected environment currently offers. */
function handleList(
  gateway: RemoteEnvironmentGateway,
  query: ListQuery,
  res: Response,
): void {
  res.json({ tools: gateway.listTools(query.sessionId) });
}

/**
 * `POST /call`: routes one tool call to the session's environment and returns
 * its result. A missing environment or unknown tool is a 400 the agent surfaces
 * to itself, not a server error.
 */
async function handleCall(
  gateway: RemoteEnvironmentGateway,
  body: CallBody,
  res: Response,
): Promise<void> {
  try {
    const response = await gateway.callTool(
      body.sessionId,
      body.agentId,
      body.name,
      body.arguments,
    );
    res.json(response);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

/**
 * Internal API used only by the remote-tools extension running inside each Pi
 * process. It lets any agent list and invoke the RPC tools a connected remote
 * environment offers, without spawning a browser sub-agent. Guarded by the same
 * bearer token as the other internal APIs so arbitrary local callers can't
 * drive a session's host.
 */
export function createInternalRemoteToolsRouter(
  gateway: RemoteEnvironmentGateway,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.get(
    "/list",
    validate({ query: listQuerySchema }),
    (req: Request, res: Response) =>
      handleList(
        gateway,
        getValidated<unknown, unknown, ListQuery>(req).query,
        res,
      ),
  );

  router.post(
    "/call",
    validate({ body: callBodySchema }),
    (req: Request, res: Response) =>
      void handleCall(gateway, getValidated<CallBody>(req).body, res),
  );

  return router;
}
