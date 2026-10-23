import { Router } from "express";

import { externalCredential } from "../connectors/credentials.ts";
import type { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import { requireCredential } from "../middleware/requireCredential.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import {
  type DeliveriesBody,
  deliveriesSchema,
  type EventBody,
  eventSchema,
  handleDeliveries,
  handleEvent,
  handleOpenRun,
  handleRunEnd,
  handleStatus,
  type RegisterBody,
  registerExternalAgent,
  registerResponse,
  registerSchema,
  type RunBody,
  type RunEndBody,
  runEndSchema,
  runSchema,
  type StatusBody,
  statusSchema,
} from "./externalAgentHandlers.ts";

/**
 * Internal API for driving **external sub-agent** tabs. A bundle tool extension
 * (running inside a session's Pi process) registers a tab, streams the external
 * runtime's output into it, marks its lifecycle, and collects the messages
 * Tangent wants carried to it. Guarded by the external connector's own
 * credential, which checks the same internal token the other internal APIs do;
 * the gateway stays transport-agnostic and proprietary-runtime specifics live
 * entirely in the caller.
 */
export function createInternalExternalAgentsRouter(
  gateway: ExternalSubagentGateway,
): Router {
  const router = Router();

  router.use(requireCredential(externalCredential));

  router.post("/register", validate({ body: registerSchema }), (req, res) =>
    registerExternalAgent(gateway, getValidated<RegisterBody>(req).body).then(
      (result) => registerResponse(res, result),
    ),
  );

  // The outbound leg.
  router.post(
    "/deliveries",
    validate({ body: deliveriesSchema }),
    (req, res) => {
      const controller = new AbortController();
      req.on("close", () => controller.abort());
      return handleDeliveries(
        gateway,
        getValidated<DeliveriesBody>(req).body,
        res,
        controller.signal,
      );
    },
  );

  // A turn of external work is a Run: the driving tool declares its start and
  // end, because only it can see the far side's boundaries.
  router.post("/run", validate({ body: runSchema }), (req, res) =>
    handleOpenRun(gateway, getValidated<RunBody>(req).body, res),
  );

  router.post("/run/end", validate({ body: runEndSchema }), (req, res) =>
    handleRunEnd(gateway, getValidated<RunEndBody>(req).body, res),
  );

  router.post("/event", validate({ body: eventSchema }), (req, res) =>
    handleEvent(gateway, getValidated<EventBody>(req).body, res),
  );

  router.post("/status", validate({ body: statusSchema }), (req, res) =>
    handleStatus(gateway, getValidated<StatusBody>(req).body, res),
  );

  return router;
}
