import type {
  CreateTriggerRequest,
  UpdateTriggerRequest,
} from "@tangent/shared/contracts.ts";
import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";

import { INTERNAL_TOKEN } from "../config.ts";
import type { TriggerEngine } from "../pi/triggers/triggerEngine.ts";
import type { TriggerManager } from "../pi/triggers/triggerManager.ts";
import type { SessionStore } from "../store/sessionStore.ts";

interface CreateBody extends Partial<CreateTriggerRequest> {
  sessionId?: string;
}

interface MutateBody extends UpdateTriggerRequest {
  sessionId?: string;
  /** Identify the target by name (preferred for the Prime tool) or id. */
  name?: string;
  triggerId?: string;
}

/** A minimal session shape the trigger handlers need. */
interface SessionRef {
  id: string;
  rootPath: string;
}

type Resolved =
  | { ok: true; session: SessionRef; triggerId: string }
  | { ok: false; status: number; message: string };

/** True when a create body is missing one of its required fields. */
function missingCreateFields(body: CreateBody): boolean {
  return !body.sessionId || !body.name || !body.kind;
}

/** Resolves the target trigger id from a name-or-id mutate body. */
function resolveTriggerId(
  triggers: TriggerManager,
  sessionId: string,
  body: MutateBody,
): string | undefined {
  if (body.triggerId) return body.triggerId;
  if (!body.name) return undefined;
  return triggers.list(sessionId).find((t) => t.name === body.name)?.id;
}

/** Resolves the session + target trigger for a mutate request. */
async function resolveTarget(
  store: SessionStore,
  triggers: TriggerManager,
  body: MutateBody,
): Promise<Resolved> {
  if (!body.sessionId) {
    return { ok: false, status: 400, message: "sessionId is required" };
  }
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
  req: Request,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as CreateBody;
  if (missingCreateFields(body)) {
    res.status(400).json({ error: "sessionId, name, and kind are required" });
    return;
  }
  const session = await store.getSession(body.sessionId as string);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  triggers.register(session.id, session.rootPath);
  try {
    const trigger = triggers.create(session.id, session.rootPath, {
      name: body.name as string,
      kind: body.kind as CreateTriggerRequest["kind"],
      title: body.title,
      prompt: body.prompt,
      schedule: body.schedule,
      enabled: body.enabled,
    });
    triggerEngine.afterChange(session.id, session.rootPath);
    res.json({ trigger });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

async function handleList(
  store: SessionStore,
  triggers: TriggerManager,
  req: Request,
  res: Response,
): Promise<void> {
  const sessionId = req.query.sessionId;
  if (typeof sessionId !== "string") {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const session = await store.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  triggers.register(session.id, session.rootPath);
  res.json({ triggers: triggers.list(session.id) });
}

async function handleUpdate(
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
  req: Request,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as MutateBody;
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
  req: Request,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as MutateBody;
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

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.get("authorization") !== `Bearer ${INTERNAL_TOKEN}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  router.post("/create", (req, res) =>
    handleCreate(store, triggers, triggerEngine, req, res),
  );
  router.get("/list", (req, res) => handleList(store, triggers, req, res));
  router.post("/update", (req, res) =>
    handleUpdate(store, triggers, triggerEngine, req, res),
  );
  router.post("/delete", (req, res) =>
    handleDelete(store, triggers, triggerEngine, req, res),
  );

  return router;
}
