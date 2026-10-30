import type { ListEnvironmentsResponse } from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import { getValidated, validate } from "../../middleware/validate.ts";
import type { RemoteEnvironmentGateway } from "../../remote/remoteEnvironmentGateway.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type { SessionParams } from "./schemas.ts";
import { sessionParamsSchema } from "./schemas.ts";
import { loadSession } from "./utils.ts";

/** The slice of the remote gateway the environments route reads. */
export type EnvironmentLister = Pick<
  RemoteEnvironmentGateway,
  "listEnvironments"
>;

/** `GET /:id/environments` → the connected remote environments this session can use. */
async function handleListEnvironments(
  store: SessionStore,
  environments: EnvironmentLister,
  id: string,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, id);
  if (!session) return;
  const body: ListEnvironmentsResponse = {
    environments: environments.listEnvironments(session.id),
  };
  res.json(body);
}

/** Registers the read-only connected-environments route on a session. */
export function registerEnvironmentRoutes(
  router: Router,
  store: SessionStore,
  environments: EnvironmentLister,
): void {
  router.get(
    "/:id/environments",
    validate({ params: sessionParamsSchema }),
    (req: Request, res: Response) =>
      handleListEnvironments(
        store,
        environments,
        getValidated<unknown, SessionParams>(req).params.id,
        res,
      ),
  );
}
