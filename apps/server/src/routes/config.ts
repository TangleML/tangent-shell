import type {
  AvailableModelsResponse,
  PublicConfig,
} from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import { PUBLIC_URL } from "../config.ts";
import { modelCatalog } from "../modelCatalog.ts";
import { listPiModels } from "../pi/piModels.ts";

/**
 * Handles `GET /api/config`. Returns the public, non-sensitive client config —
 * currently just the shell's externally reachable base URL ({@link PUBLIC_URL}),
 * which an attach command must dial. Empty when `TANGENT_PUBLIC_URL` is unset.
 */
function handleGetConfig(_req: Request, res: Response): void {
  const body: PublicConfig = { shellUrl: PUBLIC_URL };
  res.json(body);
}

/**
 * Handles `GET /api/config/models`. Returns the deployment model catalog, or
 * 404 when none is configured. Unlike `/api/config` this is installation-private
 * data, so the router must sit behind the deployment's authentication gateway.
 */
function handleGetModels(_req: Request, res: Response): void {
  res.setHeader("Cache-Control", "private, max-age=60");
  if (!modelCatalog) {
    res.status(404).json({ error: "No deployment catalog configured" });
    return;
  }
  res.json(modelCatalog);
}

/**
 * Handles `GET /api/config/available-models`. Returns the models Pi can resolve
 * (or the built-in list when Pi can't be queried), for installations without a
 * deployment catalog.
 */
async function handleGetAvailableModels(
  _req: Request,
  res: Response,
): Promise<void> {
  const body: AvailableModelsResponse = { models: await listPiModels() };
  res.setHeader("Cache-Control", "private, max-age=60");
  res.json(body);
}

/**
 * Client config router: `GET /api/config` (public), plus `GET /api/config/models`
 * and `GET /api/config/available-models` (installation-private; keep behind the
 * auth gateway).
 */
export function createConfigRouter(): Router {
  const router = Router();
  router.get("/models", (req: Request, res: Response) =>
    handleGetModels(req, res),
  );
  router.get("/available-models", (req: Request, res: Response) => {
    void handleGetAvailableModels(req, res);
  });
  router.get("/", (req: Request, res: Response) => handleGetConfig(req, res));
  return router;
}
