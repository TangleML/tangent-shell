import { type Request, type Response, Router } from "express";
import { z } from "zod";

import type { MemoryResolver, ResolvedMemory } from "../memory/resolver.ts";
import type { AgentRole, MemoryEffect } from "../memory/types.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type {
  MemoryRememberedHandler,
  MemorySuggestionHandler,
} from "../sockets/chatMemory.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { loadSession } from "./sessions/utils.ts";

/** `POST /call` body: a dispatcher memory tool call for a session. */
const callBodySchema = z.object({
  sessionId: z.string(),
  agentId: z.string().optional(),
  name: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});
type CallBody = z.infer<typeof callBodySchema>;

/** The live agents whose spawn-time memory a call runs against. */
type MemoryCallers = Pick<PiAgentManager, "memoryCaller">;

/** Everything `/call` needs to resolve a caller and apply its effects. */
export interface MemoryCallDeps {
  store: SessionStore;
  resolver: MemoryResolver;
  agents: MemoryCallers;
  onRemembered: MemoryRememberedHandler;
  onSuggestion: MemorySuggestionHandler;
}

/** The caller's recorded role; an unknown or missing agent gets the least
 * privileged one. */
async function callerRole(
  store: SessionStore,
  sessionId: string,
  agentId: string | undefined,
): Promise<AgentRole> {
  if (!agentId) return "subagent";
  const agents = await store.listAgents(sessionId);
  const agent = agents.find((row) => row.id === agentId);
  return agent?.role === "prime" ? "prime" : "subagent";
}

/**
 * The memory and role a call runs with: the live agent's spawn-time resolution
 * when it is running here, else a fresh resolution and the recorded role.
 */
async function callerMemory(
  deps: MemoryCallDeps,
  sessionId: string,
  rootPath: string,
  agentId: string | undefined,
): Promise<{ memory: ResolvedMemory; role: AgentRole }> {
  const live = agentId && deps.agents.memoryCaller(sessionId, agentId);
  if (live) return live;
  return {
    memory: await deps.resolver.resolve(sessionId, rootPath),
    role: await callerRole(deps.store, sessionId, agentId),
  };
}

/** Applies a backend's side-effects (chat highlight, suggestion card). */
async function applyEffects(
  effects: MemoryEffect[] | undefined,
  sessionId: string,
  onRemembered: MemoryRememberedHandler,
  onSuggestion: MemorySuggestionHandler,
): Promise<void> {
  for (const effect of effects ?? []) {
    if (effect.kind === "remembered") {
      await onRemembered(sessionId, effect.scope, effect.text);
    } else {
      onSuggestion({
        sessionId,
        suggestionId: effect.suggestionId,
        scope: effect.scope,
        text: effect.text,
      });
    }
  }
}

/**
 * `POST /call`: dispatches the named tool to the backend that owns it in the
 * caller's memory, performs any side-effects it asks for, and returns the
 * agent-facing text. Writes are applied here (the server is the sole writer) so
 * the UI highlight reflects the real file change rather than the agent's claim.
 */
async function handleCall(
  deps: MemoryCallDeps,
  body: CallBody,
  res: Response,
): Promise<void> {
  const session = await loadSession(deps.store, res, body.sessionId);
  if (!session) return;

  const { memory, role } = await callerMemory(
    deps,
    session.id,
    session.rootPath,
    body.agentId,
  );
  const result = await memory.execute(body.name, body.params, role);
  if (!result) {
    res.status(400).json({ error: `Unknown memory tool "${body.name}"` });
    return;
  }
  if (result.error) {
    res.status(400).json({ error: result.text });
    return;
  }

  await applyEffects(
    result.effects,
    session.id,
    deps.onRemembered,
    deps.onSuggestion,
  );
  res.json({ text: result.text });
}

/**
 * Internal API used only by the memory extension running inside each Pi process.
 * It dispatches a dispatcher-backed tool against the calling agent's memory and
 * surfaces side-effects to the room. Guarded by the same bearer token as the
 * agent API so arbitrary local callers can't mutate memory.
 */
export function createInternalMemoryRouter(deps: MemoryCallDeps): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.post(
    "/call",
    validate({ body: callBodySchema }),
    (req: Request, res: Response) =>
      handleCall(deps, getValidated<CallBody>(req).body, res),
  );

  return router;
}
