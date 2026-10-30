import type {
  AddBundleEditorResponse,
  ListBundleEditorsResponse,
} from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { normalizeEmail, requestEmail } from "../auth/permissions.ts";
import { ADMIN_EMAILS } from "../config.ts";
import { requireAdmin } from "../middleware/requireRole.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { BundleEditorStore } from "../store/bundleEditorStore.ts";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

const addBodySchema = z.object({ email: emailSchema });
type AddBody = z.infer<typeof addBodySchema>;

const emailParamsSchema = z.object({ email: emailSchema });
type EmailParams = z.infer<typeof emailParamsSchema>;

/** Handles `GET /api/bundle-editors`: listed editors plus the env admins. */
async function handleList(
  editors: BundleEditorStore,
  admins: ReadonlySet<string>,
  res: Response,
): Promise<void> {
  const response: ListBundleEditorsResponse = {
    editors: await editors.list(),
    admins: [...admins].sort(),
  };
  res.json(response);
}

/** Handles `POST /api/bundle-editors`: adds an editor (idempotent). */
async function handleAdd(
  editors: BundleEditorStore,
  email: string,
  req: Request,
  res: Response,
): Promise<void> {
  const addedBy = normalizeEmail(requestEmail(req) ?? "local");
  const response: AddBundleEditorResponse = {
    editor: await editors.add(email, addedBy),
  };
  res.status(201).json(response);
}

/** Handles `DELETE /api/bundle-editors/:email`. */
async function handleRemove(
  editors: BundleEditorStore,
  email: string,
  res: Response,
): Promise<void> {
  const removed = await editors.remove(email);
  if (!removed) {
    res.status(404).json({ error: "Bundle editor not found" });
    return;
  }
  res.status(204).end();
}

/** Admin-only REST router managing who may upload and delete agent bundles. */
export function createBundleEditorsRouter(
  editors: BundleEditorStore,
  admins: ReadonlySet<string> = ADMIN_EMAILS,
): Router {
  const router = Router();

  router.use(requireAdmin(admins));

  router.get("/", (_req: Request, res: Response) =>
    handleList(editors, admins, res),
  );

  router.post(
    "/",
    validate({ body: addBodySchema }),
    (req: Request, res: Response) =>
      handleAdd(editors, getValidated<AddBody>(req).body.email, req, res),
  );

  router.delete(
    "/:email",
    validate({ params: emailParamsSchema }),
    (req: Request, res: Response) =>
      handleRemove(
        editors,
        getValidated<unknown, EmailParams>(req).params.email,
        res,
      ),
  );

  return router;
}
