import type { RemoteAgentEvent } from "@tangent/shared/remoteSubagent.ts";
import { type Response, Router } from "express";
import { z } from "zod";

import { externalCredential } from "../connectors/credentials.ts";
import type { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import { requireCredential } from "../middleware/requireCredential.ts";
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
  /** The run the event belongs to; resolved from the tab when omitted. */
  runId: z.string().optional(),
});
type EventBody = z.infer<typeof eventSchema>;

/** Run body: open a run for one turn of external work. */
const runSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  /** The far side's own id for the work (e.g. an Aquifer World session id). */
  externalId: z.string().optional(),
  /** Where the far side's stream is being read from, to resume by. */
  cursor: z.string().optional(),
});
type RunBody = z.infer<typeof runSchema>;

/** Run-end body: settle a run, recording how far its stream was read. */
const runEndSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  status: z.enum(["completed", "cancelled", "failed"]),
  runId: z.string().optional(),
  cursor: z.string().optional(),
});
type RunEndBody = z.infer<typeof runEndSchema>;

/** Status body: a lifecycle status change for an external sub-agent tab. */
const statusSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  status: z.enum(["active", "completed", "killed", "error"]),
});
type StatusBody = z.infer<typeof statusSchema>;

/** Opens a run for a turn of external work, answering with its id. */
function handleOpenRun(
  gateway: ExternalSubagentGateway,
  body: RunBody,
  res: Response,
): void {
  const runId = gateway.openRun(body.sessionId, body.agentId, {
    externalId: body.externalId,
    cursor: body.cursor,
  });
  if (!runId) {
    res.status(404).json({ error: "Unknown external sub-agent." });
    return;
  }
  res.json({ runId });
}

/**
 * Internal API for driving **external sub-agent** tabs. A bundle tool extension
 * (running inside a session's Pi process) registers a tab, streams the external
 * runtime's output into it, and marks its lifecycle. Guarded by the external
 * connector's own credential, which checks the same internal token the other
 * internal APIs do; the gateway stays transport-agnostic and
 * proprietary-runtime specifics live entirely in the caller.
 */
export function createInternalExternalAgentsRouter(
  gateway: ExternalSubagentGateway,
): Router {
  const router = Router();

  router.use(requireCredential(externalCredential));

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

  // A turn of external work is a Run: the driving tool declares its start and
  // end, because only it can see the far side's boundaries.
  router.post("/run", validate({ body: runSchema }), (req, res) =>
    handleOpenRun(gateway, getValidated<RunBody>(req).body, res),
  );

  router.post("/run/end", validate({ body: runEndSchema }), (req, res) => {
    const body = getValidated<RunEndBody>(req).body;
    gateway.endRun(body.sessionId, body.agentId, body.status, {
      runId: body.runId,
      cursor: body.cursor,
    });
    res.json({ ok: true });
  });

  router.post("/event", validate({ body: eventSchema }), (req, res) => {
    const body = getValidated<EventBody>(req).body;
    gateway.pushEvent(
      body.sessionId,
      body.agentId,
      body.event as unknown as RemoteAgentEvent,
      body.runId,
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
