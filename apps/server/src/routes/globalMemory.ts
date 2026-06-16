import type {
  GetGlobalMemoryResponse,
  UpdateGlobalMemoryResponse,
} from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { getValidated, validate } from "../middleware/validate.ts";
import type { MemoryManager } from "../pi/memory.ts";

/** Body for `PUT /api/global-memory`: the full file contents to store. */
const updateBodySchema = z.object({
  content: z.string(),
});
type UpdateBody = z.infer<typeof updateBodySchema>;

/** Handles `GET /api/global-memory`: returns the global memory file contents. */
function handleGet(memory: MemoryManager, res: Response): void {
  const response: GetGlobalMemoryResponse = { content: memory.readGlobal() };
  res.json(response);
}

/** Handles `PUT /api/global-memory`: overwrites the global memory file. */
function handleUpdate(
  memory: MemoryManager,
  content: string,
  res: Response,
): void {
  const stored = memory.replaceGlobal(content);
  const response: UpdateGlobalMemoryResponse = { content: stored };
  res.json(response);
}

/**
 * Public REST router exposing the global memory file to the editor UI. Reads and
 * writes go through {@link MemoryManager} so the canonical store stays the single
 * source of truth.
 */
export function createGlobalMemoryRouter(memory: MemoryManager): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => handleGet(memory, res));

  router.put(
    "/",
    validate({ body: updateBodySchema }),
    (req: Request, res: Response) =>
      handleUpdate(memory, getValidated<UpdateBody>(req).body.content, res),
  );

  return router;
}
