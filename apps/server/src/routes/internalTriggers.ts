import { THINKING_LEVELS } from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import {
  agentCallerFrom,
  type AgentCallerResolver,
  enforceAgentCaller,
  requireAgentCaller,
} from "../auth/agentCaller.ts";
import { EGRESS_IDENTITY_HEADER } from "../config.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import {
  bindToParticipant,
  patchTrigger,
  reauthored,
  type TriggerBindingDeps,
} from "../pi/triggers/triggerBinding.ts";
import type { TriggerEngine } from "../pi/triggers/triggerEngine.ts";
import type { TriggerManager } from "../pi/triggers/triggerManager.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";
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

/** What a trigger needs to act for the person who asked for it. */
export interface TriggerIdentityDeps extends TriggerBindingDeps {
  runs: Pick<RunRegistry, "audienceFor">;
  identityHeader?: string;
}

/** Whether identity forwarding is on, so every trigger call must name its agent. */
function forwardingConfigured(identity: TriggerIdentityDeps | undefined) {
  return (identity?.identityHeader ?? EGRESS_IDENTITY_HEADER).length > 0;
}

/**
 * Binds a trigger to the human behind the calling agent's turn. Nothing to
 * bind to when the caller is unidentified or its turn has nobody behind it.
 */
async function bindCreator(
  identity: TriggerIdentityDeps | undefined,
  triggers: TriggerManager,
  req: Request,
  sessionId: string,
  triggerId: string,
): Promise<void> {
  const caller = agentCallerFrom(req);
  if (!identity || !caller) return;
  const participantId = identity.runs.audienceFor(sessionId, caller.agentId);
  if (!participantId) return;
  await bindToParticipant(
    identity,
    triggers,
    sessionId,
    triggerId,
    participantId,
  );
}

async function handleCreate(
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
  identity: TriggerIdentityDeps | undefined,
  req: Request,
  res: Response,
): Promise<void> {
  const body = getValidated<CreateTriggerInput>(req).body;
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;
  triggers.register(session.id, session.rootPath);
  try {
    const trigger = triggers.create(session.id, session.rootPath, body);
    await bindCreator(identity, triggers, req, session.id, trigger.id);
    // Eagerly spawn the dedicated sub-agent so it exists before the first firing.
    await triggerEngine.provision(session.id, session.rootPath, trigger.id);
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

/**
 * Applies the patch. An edit that changes what a bound trigger does when it
 * fires is new authorship: the grant its creator gave is revoked and the
 * trigger is bound afresh to whoever is behind the editing agent's turn.
 * Toggling it or renaming it keeps the binding.
 */
async function handleUpdate(
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
  identity: TriggerIdentityDeps | undefined,
  req: Request,
  body: MutateInput,
  res: Response,
): Promise<void> {
  const target = await resolveTarget(store, triggers, body);
  if (!target.ok) {
    res.status(target.status).json({ error: target.message });
    return;
  }
  const { session, triggerId } = target;
  const patched = patchTrigger(triggers, session.id, triggerId, body);
  if (!patched) {
    res.status(404).json({ error: "Trigger not found" });
    return;
  }
  if (reauthored(patched)) {
    triggers.clearBinding(session.id, triggerId);
    await bindCreator(identity, triggers, req, session.id, triggerId);
  }
  triggerEngine.afterChange(session.id, session.rootPath);
  res.json({ trigger: triggers.get(session.id, triggerId) ?? patched.trigger });
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
 * can't drive a session's triggers; once identity forwarding is configured a
 * call must also name its agent, because a trigger is bound to the person
 * behind that agent's turn.
 */
export function createInternalTriggersRouter(
  store: SessionStore,
  triggers: TriggerManager,
  triggerEngine: TriggerEngine,
  agents?: AgentCallerResolver,
  identity?: TriggerIdentityDeps,
): Router {
  const router = Router();

  router.use(
    requireInternalToken,
    enforceAgentCaller(agents),
    requireAgentCaller(() => forwardingConfigured(identity)),
  );

  router.post(
    "/create",
    validate({ body: createTriggerSchema }),
    (req: Request, res: Response) =>
      handleCreate(store, triggers, triggerEngine, identity, req, res),
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
        identity,
        req,
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
