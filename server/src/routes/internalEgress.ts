import { type Request, type Response, Router } from "express";

import {
  EgressDeniedError,
  type EgressRequestInit,
  resolveEgress,
} from "../bundleUi/egressAllowlist.ts";
import { INTERNAL_TOKEN } from "../config.ts";

interface EgressBody {
  input?: unknown;
  init?: EgressRequestInit;
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
 * arbitrary local callers can't drive egress.
 */
export function createInternalEgressRouter(): Router {
  const router = Router();

  router.use((req: Request, res: Response, next) => {
    if (req.get("authorization") !== `Bearer ${INTERNAL_TOKEN}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  router.post("/", async (req: Request, res: Response) => {
    const { input, init } = (req.body ?? {}) as EgressBody;
    if (typeof input !== "string" || input.length === 0) {
      res.status(400).json({ error: "Missing egress destination" });
      return;
    }
    try {
      const result = await resolveEgress(input, init);
      res.json(result);
    } catch (err) {
      if (err instanceof EgressDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: "egress request failed" });
    }
  });

  return router;
}
