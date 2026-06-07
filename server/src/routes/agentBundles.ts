import type { ListAgentBundlesResponse } from "@shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import {
  AgentBundleConflictError,
  type AgentBundleStore,
  AgentBundleValidationError,
} from "../store/agentBundleStore.ts";
import { bundleUpload } from "./bundleUpload.ts";

/** Handles `GET /api/agent-bundles`: lists stored bundle metadata. */
async function handleList(
  store: AgentBundleStore,
  _req: Request,
  res: Response,
): Promise<void> {
  const bundles = await store.list();
  const response: ListAgentBundlesResponse = { bundles };
  res.json(response);
}

/** Handles `GET /api/agent-bundles/:id`. */
async function handleGet(
  store: AgentBundleStore,
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const bundle = await store.get(req.params.id);
  if (!bundle) {
    res.status(404).json({ error: "Agent bundle not found" });
    return;
  }
  res.json({ bundle });
}

/** Handles `GET /api/agent-bundles/:id/icon`: serves the preview SVG. */
async function handleIcon(
  store: AgentBundleStore,
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const icon = await store.readIcon(req.params.id);
  if (!icon) {
    res.status(404).json({ error: "Icon not found" });
    return;
  }
  res.type("image/svg+xml").send(icon);
}

/** Handles `GET /api/agent-bundles/:id/download`: serves the original ZIP. */
async function handleDownload(
  store: AgentBundleStore,
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const buffer = await store.readBundle(req.params.id);
  if (!buffer) {
    res.status(404).json({ error: "Agent bundle not found" });
    return;
  }
  res
    .type("application/zip")
    .setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.id}.zip"`,
    );
  res.send(buffer);
}

/** Handles `POST /api/agent-bundles`: validates and stores an uploaded bundle. */
async function handleUpload(
  store: AgentBundleStore,
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.file) {
    res.status(400).json({ error: "Missing bundle file" });
    return;
  }
  try {
    const bundle = await store.save(req.file.buffer);
    res.status(201).json({ bundle });
  } catch (err) {
    if (err instanceof AgentBundleConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof AgentBundleValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
}

/** Handles `DELETE /api/agent-bundles/:id`. */
async function handleDelete(
  store: AgentBundleStore,
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const deleted = await store.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Agent bundle not found" });
    return;
  }
  res.status(204).end();
}

export function createAgentBundlesRouter(store: AgentBundleStore): Router {
  const router = Router();

  router.get("/", (req: Request, res: Response) => handleList(store, req, res));

  router.post("/", bundleUpload.single("bundle"), (req: Request, res: Response) =>
    handleUpload(store, req, res),
  );

  router.get("/:id", (req: Request<{ id: string }>, res: Response) =>
    handleGet(store, req, res),
  );

  router.get("/:id/icon", (req: Request<{ id: string }>, res: Response) =>
    handleIcon(store, req, res),
  );

  router.get("/:id/download", (req: Request<{ id: string }>, res: Response) =>
    handleDownload(store, req, res),
  );

  router.delete("/:id", (req: Request<{ id: string }>, res: Response) =>
    handleDelete(store, req, res),
  );

  return router;
}
