import type { ListAgentBundlesResponse } from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import {
  EgressDeniedError,
  type EgressRequestInit,
  resolveEgress,
} from "../bundleUi/egressAllowlist.ts";
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

/** Matches a compiled UI component asset filename (`<slug>.js`). */
const UI_ASSET_PATTERN = /^([a-z0-9][a-z0-9-]*)\.js$/;

/**
 * Handles `GET /api/agent-bundles/:id/ui/:file`: serves a bundle's compiled UI
 * component JS (see Phase 3 of the bundle-ui spec).
 */
async function handleUiComponent(
  store: AgentBundleStore,
  req: Request<{ id: string; file: string }>,
  res: Response,
): Promise<void> {
  const match = UI_ASSET_PATTERN.exec(req.params.file);
  if (!match) {
    res.status(404).json({ error: "UI component not found" });
    return;
  }
  const js = await store.readUiComponent(req.params.id, match[1]);
  if (js === undefined) {
    res.status(404).json({ error: "UI component not found" });
    return;
  }
  res.type("application/javascript").send(js);
}

/**
 * Handles `POST /api/agent-bundles/ui-egress`: the bundle-UI `host.fetch` proxy.
 * Resolves the requested destination against the egress allowlist, denying any
 * destination that isn't registered (see Phase 5 of the bundle-ui spec).
 */
async function handleUiEgress(
  req: Request<unknown, unknown, { input?: unknown; init?: EgressRequestInit }>,
  res: Response,
): Promise<void> {
  const { input, init } = req.body ?? {};
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
    res.status(502).json({ error: "bundle-ui egress request failed" });
  }
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

  router.post(
    "/",
    bundleUpload.single("bundle"),
    (req: Request, res: Response) => handleUpload(store, req, res),
  );

  router.post("/ui-egress", (req: Request, res: Response) =>
    handleUiEgress(req, res),
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

  router.get(
    "/:id/ui/:file",
    (req: Request<{ id: string; file: string }>, res: Response) =>
      handleUiComponent(store, req, res),
  );

  router.delete("/:id", (req: Request<{ id: string }>, res: Response) =>
    handleDelete(store, req, res),
  );

  return router;
}
