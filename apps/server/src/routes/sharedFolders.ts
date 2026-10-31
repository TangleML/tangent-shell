import type {
  CreateSharedFolderResponse,
  ListSharedFoldersResponse,
} from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { resolveUserIdentity } from "../auth/identity.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { SharedFolderStore } from "../store/sharedFolderStore.ts";

/** Body for `POST /api/shared-folders`. */
const createSharedFolderSchema = z.object({
  name: z.string().optional(),
});
type CreateSharedFolderInput = z.infer<typeof createSharedFolderSchema>;

/** Handles `GET /api/shared-folders`: lists every shared folder, oldest first. */
async function handleList(
  store: SharedFolderStore,
  res: Response,
): Promise<void> {
  const response: ListSharedFoldersResponse = {
    folders: await store.listSharedFolders(),
  };
  res.json(response);
}

/** Handles `POST /api/shared-folders`: creates a folder and its backing dir. */
async function handleCreate(
  store: SharedFolderStore,
  req: Request,
  body: CreateSharedFolderInput,
  res: Response,
): Promise<void> {
  const user =
    resolveUserIdentity(req.headers.cookie, req.headers.authorization) ??
    undefined;
  const folder = await store.createSharedFolder({ name: body.name, user });
  const response: CreateSharedFolderResponse = { folder };
  res.status(201).json(response);
}

export function createSharedFoldersRouter(store: SharedFolderStore): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => handleList(store, res));

  router.post(
    "/",
    validate({ body: createSharedFolderSchema }),
    (req: Request, res: Response) =>
      handleCreate(
        store,
        req,
        getValidated<CreateSharedFolderInput>(req).body,
        res,
      ),
  );

  return router;
}
