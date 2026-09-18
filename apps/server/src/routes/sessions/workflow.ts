import type { WorkflowViewResponse } from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import {
  workflowView,
  type WorkflowViewDeps,
} from "../../conversation/workflowView.ts";
import { getValidated, validate } from "../../middleware/validate.ts";
import type { SessionParams, WorkflowQuery } from "./schemas.ts";
import { sessionParamsSchema, workflowQuerySchema } from "./schemas.ts";
import { loadSession } from "./utils.ts";

/** Everything the workflow-view route needs: a session loader plus the fold's
 * engine reads. A bag so the sessions router's arg list stays flat. */
export type WorkflowRouteDeps = WorkflowViewDeps;

/**
 * `GET /:id/workflow` → the Conversation's (or Session's) workflow state, folded
 * from state the engines already keep (unified-model §9.8). A `conversationId`
 * scopes it; adding a `participantId` projects that Participant's room read.
 */
async function handleWorkflowView(
  deps: WorkflowRouteDeps,
  id: string,
  query: WorkflowQuery,
  res: Response,
): Promise<void> {
  const session = await loadSession(deps.store, res, id);
  if (!session) return;
  const workflow = await workflowView(deps, {
    sessionId: id,
    conversationId: query.conversationId,
    participantId: query.participantId,
  });
  const body: WorkflowViewResponse = { workflow };
  res.json(body);
}

/** Registers the read-only workflow view route on a session. */
export function registerWorkflowRoutes(
  router: Router,
  deps: WorkflowRouteDeps,
): void {
  router.get(
    "/:id/workflow",
    validate({ params: sessionParamsSchema, query: workflowQuerySchema }),
    (req: Request, res: Response) => {
      const { params, query } = getValidated<
        unknown,
        SessionParams,
        WorkflowQuery
      >(req);
      return handleWorkflowView(deps, params.id, query, res);
    },
  );
}
