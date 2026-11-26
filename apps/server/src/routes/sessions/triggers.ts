import { type Request, type Response, Router, urlencoded } from "express";

import { resolveUserIdentity } from "../../auth/identity.ts";
import { getValidated, validate } from "../../middleware/validate.ts";
import {
  bindToUser,
  patchTrigger,
  reauthored,
  type TriggerBindingDeps,
} from "../../pi/triggers/triggerBinding.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import type { TriggerManager } from "../../pi/triggers/triggerManager.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type {
  CallbackParams,
  CreateTriggerInput,
  SessionParams,
  TriggerParams,
  UpdateTriggerInput,
} from "./schemas.ts";
import {
  createTriggerSchema,
  sessionParamsSchema,
  triggerParamsSchema,
  updateTriggerSchema,
} from "./schemas.ts";
import { isUnsafeId, loadSession } from "./utils.ts";

/**
 * Lists a session's triggers. Loads them from disk first so the list survives a
 * server restart (the session record is in-memory, but triggers persist).
 */
async function handleListTriggers(
  store: SessionStore,
  triggers: TriggerManager,
  id: string,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, id);
  if (!session) return;
  triggers.register(session.id, session.rootPath);
  res.json({ triggers: triggers.list(session.id) });
}

/** Everything the trigger routes need beyond the store and the engine. */
export interface TriggerRouteDeps {
  store: SessionStore;
  triggers: TriggerManager;
  triggerEngine: TriggerEngine;
  identity?: TriggerBindingDeps;
}

/**
 * Binds a trigger to the person making this request, when the server can act
 * for them. Nothing happens without identity deps: binding is a feature of
 * identity forwarding, and without it a trigger acts as the instance as before.
 */
async function bindRequester(
  deps: TriggerRouteDeps,
  req: Request,
  sessionId: string,
  triggerId: string,
): Promise<void> {
  if (!deps.identity) return;
  await bindToUser(
    deps.identity,
    deps.triggers,
    sessionId,
    triggerId,
    resolveUserIdentity(req.headers)?.email,
  );
}

/**
 * Creates a runtime trigger (prompt-template only) on a session, bound to the
 * person who asked for it the way an agent-created one is bound to the person
 * behind the agent's turn.
 */
async function handleCreateTrigger(
  deps: TriggerRouteDeps,
  req: Request,
  id: string,
  body: CreateTriggerInput,
  res: Response,
): Promise<void> {
  const { store, triggers, triggerEngine } = deps;
  const session = await loadSession(store, res, id);
  if (!session) return;
  triggers.register(session.id, session.rootPath);
  try {
    const trigger = triggers.create(session.id, session.rootPath, body);
    await bindRequester(deps, req, session.id, trigger.id);
    // Eagerly spawn the dedicated sub-agent so it exists before the first firing.
    await triggerEngine.provision(session.id, session.rootPath, trigger.id);
    triggerEngine.afterChange(session.id, session.rootPath);
    res
      .status(201)
      .json({ trigger: triggers.get(session.id, trigger.id) ?? trigger });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

/**
 * Updates a mutable trigger field (enabled/prompt/title/schedule). An edit
 * that changes what a bound trigger does when it fires is new authorship: the
 * grant its creator gave is revoked and the trigger is bound afresh to the
 * editor, or left unbound when the server cannot act for them. Toggling it or
 * renaming it keeps the binding.
 */
async function handleUpdateTrigger(
  deps: TriggerRouteDeps,
  req: Request,
  params: TriggerParams,
  body: UpdateTriggerInput,
  res: Response,
): Promise<void> {
  const { store, triggers, triggerEngine } = deps;
  const session = await loadSession(store, res, params.id);
  if (!session) return;
  triggers.register(session.id, session.rootPath);
  const patched = patchTrigger(triggers, session.id, params.triggerId, body);
  if (!patched) {
    res.status(404).json({ error: "Trigger not found" });
    return;
  }
  if (reauthored(patched)) {
    triggers.clearBinding(session.id, params.triggerId);
    await bindRequester(deps, req, session.id, params.triggerId);
  }
  triggerEngine.afterChange(session.id, session.rootPath);
  res.json({
    trigger: triggers.get(session.id, params.triggerId) ?? patched.trigger,
  });
}

/** Deletes a trigger. */
async function handleDeleteTrigger(
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
  params: TriggerParams,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, params.id);
  if (!session) return;
  triggers.register(session.id, session.rootPath);
  if (!triggers.remove(session.id, params.triggerId)) {
    res.status(404).json({ error: "Trigger not found" });
    return;
  }
  triggerEngine.afterChange(session.id, session.rootPath);
  res.status(204).end();
}

/**
 * Public callback endpoint that fires a callback trigger. Modeled on the
 * artifact route's session-scoped shape, but — because firing mutates agent
 * state — gated by the per-trigger secret embedded in the URL. The JSON body
 * becomes the signal payload passed to the trigger's handler/template.
 */
const CALLBACK_FAILURE: Record<
  "not-found" | "forbidden" | "disabled",
  { status: number; error: string }
> = {
  "not-found": { status: 404, error: "Trigger not found" },
  forbidden: { status: 403, error: "Forbidden" },
  disabled: { status: 409, error: "Trigger is disabled" },
};

function createTriggerCallbackHandler(triggerEngine: TriggerEngine) {
  return async (req: Request<CallbackParams>, res: Response): Promise<void> => {
    const { id, triggerId, secret } = req.params;
    if (isUnsafeId(id)) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }

    const signal = {
      kind: "callback",
      receivedAt: new Date().toISOString(),
      body: req.body ?? {},
    };

    // Let an unexpected failure bubble to the central error handler (500); only
    // the known outcomes below map to a specific status.
    const outcome = await triggerEngine.fireCallback(
      id,
      triggerId,
      secret,
      signal,
    );
    if (outcome !== "ok") {
      const failure = CALLBACK_FAILURE[outcome];
      res.status(failure.status).json({ error: failure.error });
      return;
    }
    res.status(202).json({ ok: true });
  };
}

/** Registers the read-style trigger routes (list + delete). */
function registerTriggerReadRoutes(
  router: Router,
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
): void {
  router.get(
    "/:id/triggers",
    validate({ params: sessionParamsSchema }),
    (req: Request, res: Response) =>
      handleListTriggers(
        store,
        triggers,
        getValidated<unknown, SessionParams>(req).params.id,
        res,
      ),
  );

  router.delete(
    "/:id/triggers/:triggerId",
    validate({ params: triggerParamsSchema }),
    (req: Request, res: Response) =>
      handleDeleteTrigger(
        store,
        triggers,
        triggerEngine,
        getValidated<unknown, TriggerParams>(req).params,
        res,
      ),
  );
}

/** Registers the body-mutating trigger routes (create + update). */
function registerTriggerWriteRoutes(
  router: Router,
  deps: TriggerRouteDeps,
): void {
  router.post(
    "/:id/triggers",
    validate({ params: sessionParamsSchema, body: createTriggerSchema }),
    (req: Request, res: Response) => {
      const { params, body } = getValidated<CreateTriggerInput, SessionParams>(
        req,
      );
      return handleCreateTrigger(deps, req, params.id, body, res);
    },
  );

  router.patch(
    "/:id/triggers/:triggerId",
    validate({ params: triggerParamsSchema, body: updateTriggerSchema }),
    (req: Request, res: Response) => {
      const { params, body } = getValidated<UpdateTriggerInput, TriggerParams>(
        req,
      );
      return handleUpdateTrigger(deps, req, params, body, res);
    },
  );
}

/** Registers the trigger management + callback routes on the sessions router. */
export function registerTriggerRoutes(
  router: Router,
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
  identity?: TriggerBindingDeps,
): void {
  registerTriggerReadRoutes(router, store, triggers, triggerEngine);
  registerTriggerWriteRoutes(router, {
    store,
    triggers,
    triggerEngine,
    identity,
  });

  // Public, secret-guarded inbound callback that fires a callback trigger.
  // Accepts both `application/json` (parsed globally) and
  // `application/x-www-form-urlencoded` (parsed here, scoped to this route).
  // Params keep the `Request<CallbackParams>` generic + manual `isUnsafeId`
  // guard rather than routing through `validate`.
  router.post(
    "/:id/triggers/:triggerId/callback/:secret",
    urlencoded({ extended: true }),
    createTriggerCallbackHandler(triggerEngine),
  );
}
