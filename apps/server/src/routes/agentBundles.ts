import type { ListAgentBundlesResponse } from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import {
  EgressDeniedError,
  type EgressInput,
  type EgressRequestInit,
  resolveEgress,
  resolveTargetUrl,
} from "../bundleUi/egressAllowlist.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import {
  AgentBundleConflictError,
  type AgentBundleStore,
  AgentBundleValidationError,
} from "../store/agentBundleStore.ts";
import { bundleUpload } from "./bundleUpload.ts";

/** `:id` route param shared by the single-bundle routes. */
const idParamsSchema = z.object({
  id: z.string(),
});
type IdParams = z.infer<typeof idParamsSchema>;

/** `:id/:file` route params for the compiled UI component route. */
const uiComponentParamsSchema = z.object({
  id: z.string(),
  file: z.string(),
});
type UiComponentParams = z.infer<typeof uiComponentParamsSchema>;

/**
 * Body for the `host.fetch` egress proxy. `input` must be a non-empty string
 * (replacing the old manual `typeof` guard); `init` stays permissive — it's a
 * structural {@link EgressRequestInit} passed straight through to
 * {@link resolveEgress}, so we type it via `z.custom` rather than re-describing
 * its shape, keeping the validated value assignable without an `as` cast.
 */
const uiEgressInputSchema = z.union([
  z.string().min(1),
  z.object({
    target: z.literal("tangle"),
    path: z.string().min(1),
  }),
]);

const uiTargetUrlBodySchema = z.object({
  target: z.literal("tangle"),
  path: z.string().min(1),
});

const uiEgressBodySchema = z.object({
  input: uiEgressInputSchema,
  init: z.custom<EgressRequestInit>().optional(),
});
type UiEgressInput = z.infer<typeof uiEgressBodySchema>;
type UiTargetUrlInput = z.infer<typeof uiTargetUrlBodySchema>;

/** Handles `GET /api/agent-bundles`: lists stored bundle metadata. */
async function handleList(
  store: AgentBundleStore,
  res: Response,
): Promise<void> {
  const bundles = await store.list();
  const response: ListAgentBundlesResponse = { bundles };
  res.json(response);
}

/** Handles `GET /api/agent-bundles/:id`. */
async function handleGet(
  store: AgentBundleStore,
  id: string,
  res: Response,
): Promise<void> {
  const bundle = await store.get(id);
  if (!bundle) {
    res.status(404).json({ error: "Agent bundle not found" });
    return;
  }
  res.json({ bundle });
}

/** Handles `GET /api/agent-bundles/:id/icon`: serves the preview SVG. */
async function handleIcon(
  store: AgentBundleStore,
  id: string,
  res: Response,
): Promise<void> {
  const icon = await store.readIcon(id);
  if (!icon) {
    res.status(404).json({ error: "Icon not found" });
    return;
  }
  res.type("image/svg+xml").send(icon);
}

/** Handles `GET /api/agent-bundles/:id/download`: serves the original ZIP. */
async function handleDownload(
  store: AgentBundleStore,
  id: string,
  res: Response,
): Promise<void> {
  const buffer = await store.readBundle(id);
  if (!buffer) {
    res.status(404).json({ error: "Agent bundle not found" });
    return;
  }
  res
    .type("application/zip")
    .setHeader("Content-Disposition", `attachment; filename="${id}.zip"`);
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
  id: string,
  file: string,
  res: Response,
): Promise<void> {
  const match = UI_ASSET_PATTERN.exec(file);
  if (!match) {
    res.status(404).json({ error: "UI component not found" });
    return;
  }
  const js = await store.readUiComponent(id, match[1]);
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
  input: EgressInput,
  init: EgressRequestInit | undefined,
  res: Response,
): Promise<void> {
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

/** Handles `POST /api/agent-bundles/ui-target-url`: resolves openable target URLs. */
function handleUiTargetUrl(input: UiTargetUrlInput, res: Response): void {
  const url = resolveTargetUrl(input);
  if (!url) {
    res.status(400).json({ error: "Invalid target URL" });
    return;
  }
  res.json({ url: url.href });
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
  id: string,
  res: Response,
): Promise<void> {
  const deleted = await store.delete(id);
  if (!deleted) {
    res.status(404).json({ error: "Agent bundle not found" });
    return;
  }
  res.status(204).end();
}

/** Registers the bundle collection routes (`GET /`, `POST /`, `POST /ui-egress`). */
function registerBundleCollectionRoutes(
  router: Router,
  store: AgentBundleStore,
): void {
  router.get("/", (_req: Request, res: Response) => handleList(store, res));

  router.post(
    "/",
    bundleUpload.single("bundle"),
    (req: Request, res: Response) => handleUpload(store, req, res),
  );

  router.post(
    "/ui-egress",
    validate({ body: uiEgressBodySchema }),
    (req: Request, res: Response) => {
      const { body } = getValidated<UiEgressInput>(req);
      return handleUiEgress(body.input, body.init, res);
    },
  );

  router.post(
    "/ui-target-url",
    validate({ body: uiTargetUrlBodySchema }),
    (req: Request, res: Response) => {
      const { body } = getValidated<UiTargetUrlInput>(req);
      handleUiTargetUrl(body, res);
    },
  );
}

/** Registers the single-bundle item routes (read/icon/download/ui/delete). */
function registerBundleItemRoutes(
  router: Router,
  store: AgentBundleStore,
): void {
  router.get(
    "/:id",
    validate({ params: idParamsSchema }),
    (req: Request, res: Response) =>
      handleGet(store, getValidated<unknown, IdParams>(req).params.id, res),
  );

  router.get(
    "/:id/icon",
    validate({ params: idParamsSchema }),
    (req: Request, res: Response) =>
      handleIcon(store, getValidated<unknown, IdParams>(req).params.id, res),
  );

  router.get(
    "/:id/download",
    validate({ params: idParamsSchema }),
    (req: Request, res: Response) =>
      handleDownload(
        store,
        getValidated<unknown, IdParams>(req).params.id,
        res,
      ),
  );

  router.get(
    "/:id/ui/:file",
    validate({ params: uiComponentParamsSchema }),
    (req: Request, res: Response) => {
      const { params } = getValidated<unknown, UiComponentParams>(req);
      return handleUiComponent(store, params.id, params.file, res);
    },
  );

  router.delete(
    "/:id",
    validate({ params: idParamsSchema }),
    (req: Request, res: Response) =>
      handleDelete(store, getValidated<unknown, IdParams>(req).params.id, res),
  );
}

export function createAgentBundlesRouter(store: AgentBundleStore): Router {
  const router = Router();

  registerBundleCollectionRoutes(router, store);
  registerBundleItemRoutes(router, store);

  return router;
}
