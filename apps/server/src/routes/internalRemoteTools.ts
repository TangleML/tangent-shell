import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";

/**
 * `GET /list` query: the session, and the agent whose turn is asking — its Run's
 * audience picks whose host catalog to read.
 */
const listQuerySchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
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

/** `GET /list`: the tools the prompting human's connected host currently offers. */
function handleList(
  gateway: RemoteEnvironmentGateway,
  runs: RunRegistry,
  query: ListQuery,
  res: Response,
): void {
  const audienceId = runs.audienceFor(query.sessionId, query.agentId);
  const { tools, reason } = gateway.listToolsFor(query.sessionId, audienceId);
  res.json({ tools, reason });
}

/**
 * `POST /call`: routes one tool call to the prompting human's host and returns
 * its result. A missing host or unknown tool is a 400 the agent surfaces to
 * itself, not a server error.
 */
async function handleCall(
  gateway: RemoteEnvironmentGateway,
  runs: RunRegistry,
  body: CallBody,
  res: Response,
): Promise<void> {
  try {
    const audienceId = runs.audienceFor(body.sessionId, body.agentId);
    const response = await gateway.callTool(
      body.sessionId,
      body.agentId,
      body.name,
      body.arguments,
      audienceId,
    );
    res.json(response);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

/**
 * Internal API used only by the remote-tools extension running inside each Pi
 * process. It lets any agent list and invoke the RPC tools a connected remote
 * environment offers, without spawning a browser sub-agent. The turn's Run
 * decides whose host is reached: the human whose prompt woke the agent. Guarded
 * by the same bearer token as the other internal APIs so arbitrary local callers
 * can't drive a session's host.
 */
export function createInternalRemoteToolsRouter(
  gateway: RemoteEnvironmentGateway,
  runs: RunRegistry,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.get(
    "/list",
    validate({ query: listQuerySchema }),
    (req: Request, res: Response) =>
      handleList(
        gateway,
        runs,
        getValidated<unknown, unknown, ListQuery>(req).query,
        res,
      ),
  );

  router.post(
    "/call",
    validate({ body: callBodySchema }),
    (req: Request, res: Response) =>
      void handleCall(gateway, runs, getValidated<CallBody>(req).body, res),
  );

  return router;
}
