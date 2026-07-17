import { type Request, type Response, Router } from "express";

import { REMOTE_ENV_TOKEN } from "../config.ts";

/**
 * Tells the SPA whether remote CSOM hosting is enabled and, if so, hands it the
 * shared `/remote-env` token so the Pipeline Editor tab can connect as its
 * session's CSOM executor.
 *
 * The token is the same shared secret external remote environments use. Remote
 * hosting is opt-in (empty by default), so this only exposes a token an operator
 * has explicitly configured. It is a same-origin dev convenience; production
 * deployments that gate the app behind auth should front this route with it.
 */
function handleGetToken(_req: Request, res: Response): void {
  if (!REMOTE_ENV_TOKEN) {
    res.json({ enabled: false });
    return;
  }
  res.json({ enabled: true, token: REMOTE_ENV_TOKEN });
}

/** Public REST router exposing the remote-env connection token to the SPA. */
export function createRemoteEnvRouter(): Router {
  const router = Router();
  router.get("/token", (req: Request, res: Response) =>
    handleGetToken(req, res),
  );
  return router;
}
