import type { PublicConfig } from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import { PUBLIC_URL } from "../config.ts";

/**
 * Handles `GET /api/config`. Returns the public, non-sensitive client config —
 * currently just the shell's externally reachable base URL ({@link PUBLIC_URL}),
 * which an attach command must dial. Empty when `TANGENT_PUBLIC_URL` is unset.
 */
function handleGetConfig(_req: Request, res: Response): void {
  const body: PublicConfig = { shellUrl: PUBLIC_URL };
  res.json(body);
}

/** Public REST router exposing non-sensitive client config (`GET /api/config`). */
export function createConfigRouter(): Router {
  const router = Router();
  router.get("/", (req: Request, res: Response) => handleGetConfig(req, res));
  return router;
}
