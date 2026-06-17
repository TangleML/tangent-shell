import { THINKING_LEVELS } from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { TriggerEngine } from "../pi/triggers/triggerEngine.ts";
import type { TriggerManager } from "../pi/triggers/triggerManager.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { loadSession } from "./sessions/utils.ts";

const triggerScheduleSchema = z.object({
  every: z.string().optional(),
  cron: z.string().optional(),
});

/** Revival spec for a `subagent`-target trigger's dedicated sub-agent. */
const triggerSubagentSchema = z.object({
  name: z.string().optional(),
  template: z.string().optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  thinkingDepth: z.enum(THINKING_LEVELS).optional(),
});

/** Create-trigger body; mirrors the shared `CreateTriggerRequest` plus `sessionId`. */
const createTriggerSchema = z.object({
  sessionId: z.string(),
  name: z.string(),
  kind: z.enum(["schedule", "callback"]),
  title: z.string().optional(),
  prompt: z.string().optional(),
  schedule: triggerScheduleSchema.optional(),
  enabled: z.boolean().optional(),
  target: z.enum(["prime", "subagent"]).optional(),
  subagent: triggerSubagentSchema.optional(),
});
type CreateTriggerInput = z.infer<typeof createTriggerSchema>;

/**
 * Update/delete body. Identifies the target by `name` (preferred for the Prime
 * tool) or `id`; the "name or triggerId required" cross-field rule is enforced
 * in {@link resolveTarget}.
 */
const mutateTriggerSchema = z.object({
  sessionId: z.string(),
  name: z.string().optional(),
  triggerId: z.string().optional(),
  enabled: z.boolean().optional(),
  prompt: z.string().optional(),
  title: z.string().optional(),
  schedule: triggerScheduleSchema.optional(),
});
type MutateInput = z.infer<typeof mutateTriggerSchema>;

/** List query: the session whose triggers to return. */
const listTriggersQuerySchema = z.object({
  sessionId: z.string(),
});
type ListTriggersQuery = z.infer<typeof listTriggersQuerySchema>;

/** A minimal session shape the trigger handlers need. */
interface SessionRef {
  id: string;
  rootPath: string;
}

type Resolved =
  | { ok: true; session: SessionRef; triggerId: string }
  | { ok: false; status: number; message: string };

/** Resolves the target trigger id from a name-or-id mutate body. */
function resolveTriggerId(
  triggers: TriggerManager,
  sessionId: string,
  body: MutateInput,
): string | undefined {
  if (body.triggerId) return body.triggerId;
  if (!body.name) return undefined;
  return triggers.list(sessionId).find((t) => t.name === body.name)?.id;
}

/** Resolves the session + target trigger for a mutate request. */
async function resolveTarget(
  store: SessionStore,
  triggers: TriggerManager,
  body: MutateInput,
): Promise<Resolved> {
  if (!body.name && !body.triggerId) {
    return { ok: false, status: 400, message: "name or triggerId is required" };
  }
  const session = await store.getSession(body.sessionId);
  if (!session) {
    return { ok: false, status: 404, message: "Session not found" };
  }
  triggers.register(session.id, session.rootPath);
  const triggerId = resolveTriggerId(triggers, session.id, body);
  if (!triggerId) {
    return { ok: false, status: 404, message: "Trigger not found" };
  }
  return { ok: true, session, triggerId };
}

async function handleCreate(
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
  body: CreateTriggerInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;
  triggers.register(session.id, session.rootPath);
  try {
    const trigger = triggers.create(session.id, session.rootPath, body);
    // Eagerly spawn the dedicated sub-agent so it exists before the first firing.
    triggerEngine.provision(session.id, session.rootPath, trigger.id);
    triggerEngine.afterChange(session.id, session.rootPath);
    res.json({ trigger: triggers.get(session.id, trigger.id) ?? trigger });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

async function handleList(
  store: SessionStore,
  triggers: TriggerManager,
  sessionId: string,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, sessionId);
  if (!session) return;
  triggers.register(session.id, session.rootPath);
  res.json({ triggers: triggers.list(session.id) });
}

async function handleUpdate(
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
  body: MutateInput,
  res: Response,
): Promise<void> {
  const target = await resolveTarget(store, triggers, body);
  if (!target.ok) {
    res.status(target.status).json({ error: target.message });
    return;
  }
  const trigger = triggers.update(target.session.id, target.triggerId, body);
  if (!trigger) {
    res.status(404).json({ error: "Trigger not found" });
    return;
  }
  triggerEngine.afterChange(target.session.id, target.session.rootPath);
  res.json({ trigger });
}

async function handleDelete(
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
  body: MutateInput,
  res: Response,
): Promise<void> {
  const target = await resolveTarget(store, triggers, body);
  if (!target.ok) {
    res.status(target.status).json({ error: target.message });
    return;
  }
  if (!triggers.remove(target.session.id, target.triggerId)) {
    res.status(404).json({ error: "Trigger not found" });
    return;
  }
  triggerEngine.afterChange(target.session.id, target.session.rootPath);
  res.json({ ok: true });
}

/**
 * Internal API used only by the triggers extension running inside each Pi
 * process. It lets Prime create/list/enable/disable/delete the session's
 * triggers; the server owns persistence, scheduling, and delivery. Guarded by
 * the same bearer token as the other internal APIs so arbitrary local callers
 * can't drive a session's triggers.
 */
export function createInternalTriggersRouter(
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.post(
    "/create",
    validate({ body: createTriggerSchema }),
    (req: Request, res: Response) =>
      handleCreate(
        store,
        triggers,
        triggerEngine,
        getValidated<CreateTriggerInput>(req).body,
        res,
      ),
  );
  router.get(
    "/list",
    validate({ query: listTriggersQuerySchema }),
    (req: Request, res: Response) =>
      handleList(
        store,
        triggers,
        getValidated<unknown, unknown, ListTriggersQuery>(req).query.sessionId,
        res,
      ),
  );
  router.post(
    "/update",
    validate({ body: mutateTriggerSchema }),
    (req: Request, res: Response) =>
      handleUpdate(
        store,
        triggers,
        triggerEngine,
        getValidated<MutateInput>(req).body,
        res,
      ),
  );
  router.post(
    "/delete",
    validate({ body: mutateTriggerSchema }),
    (req: Request, res: Response) =>
      handleDelete(
        store,
        triggers,
        triggerEngine,
        getValidated<MutateInput>(req).body,
        res,
      ),
  );

  return router;
}
