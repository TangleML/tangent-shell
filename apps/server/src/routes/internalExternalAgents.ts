import type { RemoteAgentEvent } from "@tangent/shared/remoteSubagent.ts";
import { Router } from "express";
import { z } from "zod";

import type { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import { parseThinkingLevel } from "../pi/agentConfig.ts";

/** Register body: create an external sub-agent tab with optional display meta. */
const registerSchema = z.object({
  sessionId: z.string(),
  name: z.string(),
  template: z.string().optional(),
  model: z.string().optional(),
  thinkingDepth: z.string().optional(),
});
type RegisterBody = z.infer<typeof registerSchema>;

/** Event body: a streamed event tagged with its tab; the event is passed through. */
const eventSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  event: z.object({ type: z.string() }).passthrough(),
});
type EventBody = z.infer<typeof eventSchema>;

/** Status body: a lifecycle status change for an external sub-agent tab. */
const statusSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  status: z.enum(["active", "completed", "killed", "error"]),
});
type StatusBody = z.infer<typeof statusSchema>;

/**
 * Internal API for driving **external sub-agent** tabs. A bundle tool extension
 * (running inside a session's Pi process) registers a tab, streams the external
 * runtime's output into it, and marks its lifecycle. Guarded by the same
 * {@link import("../middleware/requireInternalToken.ts").requireInternalToken}
 * bearer as the other internal APIs; the gateway stays transport-agnostic and
 * proprietary-runtime specifics live entirely in the caller.
 */
export function createInternalExternalAgentsRouter(
  gateway: ExternalSubagentGateway,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.post("/register", validate({ body: registerSchema }), (req, res) => {
    const body = getValidated<RegisterBody>(req).body;
    const { id } = gateway.register(body.sessionId, {
      name: body.name,
      template: body.template,
      model: body.model,
      thinkingDepth: parseThinkingLevel(body.thinkingDepth),
    });
    res.json({ subagent: { id } });
  });

  router.post("/event", validate({ body: eventSchema }), (req, res) => {
    const body = getValidated<EventBody>(req).body;
    gateway.pushEvent(
      body.sessionId,
      body.agentId,
      body.event as unknown as RemoteAgentEvent,
    );
    res.json({ ok: true });
  });

  router.post("/status", validate({ body: statusSchema }), (req, res) => {
    const body = getValidated<StatusBody>(req).body;
    gateway.setStatus(body.sessionId, body.agentId, body.status);
    res.json({ ok: true });
  });

  return router;
}
