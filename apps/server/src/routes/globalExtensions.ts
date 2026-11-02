import type {
  ListGlobalExtensionsResponse,
  ListMarketplacesResponse,
  SearchMarketplaceResponse,
} from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import {
  ExtensionConflictError,
  ExtensionValidationError,
  type GlobalExtensionService,
  type InstallOptions,
} from "../extensions/globalExtensionService.ts";
import { requireAdmin } from "../middleware/requireRole.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import { bundleUpload } from "./bundleUpload.ts";

/** `:id` route param for the single-extension routes. */
const idParamsSchema = z.object({ id: z.string() });
type IdParams = z.infer<typeof idParamsSchema>;

/** `:id` route param for the marketplace search route. */
const marketplaceParamsSchema = z.object({ id: z.string() });
type MarketplaceParams = z.infer<typeof marketplaceParamsSchema>;

/** `?q=` search query. */
const searchQuerySchema = z.object({ q: z.string().optional() });
type SearchQuery = z.infer<typeof searchQuerySchema>;

/** JSON install body (npm/git sources). */
const installBodySchema = z.object({
  source: z.string().min(1),
  id: z.string().optional(),
  tools: z.array(z.string()).optional(),
  replace: z.boolean().optional(),
});

/** PATCH body: update the tool allowlist and/or display name. */
const patchBodySchema = z
  .object({
    tools: z.array(z.string()).optional(),
    name: z.string().min(1).optional(),
  })
  .refine((body) => body.tools !== undefined || body.name !== undefined, {
    message: "provide `tools` or `name`",
  });
type PatchBody = z.infer<typeof patchBodySchema>;

/** Parses a multipart `tools` field: a JSON array or a comma-separated list. */
function parseToolsField(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((tool): tool is string => typeof tool === "string");
    }
  } catch {
    // Not JSON — fall through to the comma-separated form.
  }
  return raw
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}

/** Maps an install error to its HTTP status, defaulting to 400. */
function installErrorStatus(err: unknown): number {
  if (err instanceof ExtensionConflictError) return 409;
  if (err instanceof ExtensionValidationError) return 400;
  return 400;
}

async function handleList(
  service: GlobalExtensionService,
  res: Response,
): Promise<void> {
  const response: ListGlobalExtensionsResponse = {
    extensions: service.list(),
  };
  res.json(response);
}

function handleMarketplaces(
  service: GlobalExtensionService,
  res: Response,
): void {
  const response: ListMarketplacesResponse = {
    marketplaces: service.marketplaces(),
  };
  res.json(response);
}

async function handleSearch(
  service: GlobalExtensionService,
  id: string,
  query: SearchQuery,
  res: Response,
): Promise<void> {
  try {
    const listings = await service.search(id, query.q ?? "");
    if (listings === undefined) {
      res.status(404).json({ error: `Marketplace "${id}" has no search` });
      return;
    }
    const response: SearchMarketplaceResponse = { listings };
    res.json(response);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}

async function handleInstall(
  service: GlobalExtensionService,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const meta = req.file
      ? await service.installFromUpload(
          req.file.originalname,
          req.file.buffer,
          {
            id: typeof req.body.id === "string" ? req.body.id : undefined,
            tools: parseToolsField(req.body.tools),
            replace: req.body.replace === "true" || req.body.replace === true,
          },
        )
      : await installFromJson(service, req.body);
    res.status(201).json({ extension: meta });
  } catch (err) {
    res.status(installErrorStatus(err)).json({ error: (err as Error).message });
  }
}

/** Validates and runs a JSON (npm/git) install from the request body. */
async function installFromJson(
  service: GlobalExtensionService,
  body: unknown,
): Promise<Awaited<ReturnType<GlobalExtensionService["installFromSource"]>>> {
  const parsed = installBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ExtensionValidationError(
      "Missing or invalid install source (expected a file upload or `source`)",
    );
  }
  const options: InstallOptions = {
    id: parsed.data.id,
    tools: parsed.data.tools,
    replace: parsed.data.replace,
  };
  return service.installFromSource(parsed.data.source, options);
}

async function handlePatch(
  service: GlobalExtensionService,
  id: string,
  body: PatchBody,
  res: Response,
): Promise<void> {
  const meta = await service.update(id, body);
  if (!meta) {
    res.status(404).json({ error: "Extension not found" });
    return;
  }
  res.json({ extension: meta });
}

async function handleDelete(
  service: GlobalExtensionService,
  id: string,
  res: Response,
): Promise<void> {
  const deleted = await service.uninstall(id);
  if (!deleted) {
    res.status(404).json({ error: "Extension not found" });
    return;
  }
  res.status(204).end();
}

/**
 * Routes for the global extension registry. Reads are open; writes
 * (install/patch/uninstall) are admin-gated like the bundle marketplace.
 */
export function createGlobalExtensionsRouter(
  service: GlobalExtensionService,
): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => handleList(service, res));

  router.get("/marketplaces", (_req: Request, res: Response) =>
    handleMarketplaces(service, res),
  );

  router.get(
    "/marketplaces/:id/search",
    validate({ params: marketplaceParamsSchema, query: searchQuerySchema }),
    (req: Request, res: Response) => {
      const { params, query } = getValidated<
        unknown,
        MarketplaceParams,
        SearchQuery
      >(req);
      return handleSearch(service, params.id, query, res);
    },
  );

  router.post(
    "/",
    requireAdmin(),
    bundleUpload.single("file"),
    (req: Request, res: Response) => handleInstall(service, req, res),
  );

  router.patch(
    "/:id",
    requireAdmin(),
    validate({ params: idParamsSchema, body: patchBodySchema }),
    (req: Request, res: Response) => {
      const { params, body } = getValidated<PatchBody, IdParams>(req);
      return handlePatch(service, params.id, body, res);
    },
  );

  router.delete(
    "/:id",
    requireAdmin(),
    validate({ params: idParamsSchema }),
    (req: Request, res: Response) =>
      handleDelete(
        service,
        getValidated<unknown, IdParams>(req).params.id,
        res,
      ),
  );

  return router;
}
