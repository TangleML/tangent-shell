import { type Request, type Response, Router } from "express";
import { z } from "zod";

import type { MemoryResolver } from "../memory/resolver.ts";
import type { MemoryEffect } from "../memory/types.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type {
  MemoryRememberedHandler,
  MemorySuggestionHandler,
} from "../sockets/chatMemory.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { loadSession } from "./sessions/utils.ts";

/** `POST /call` body: a dispatcher memory tool call for a session. */
const callBodySchema = z.object({
  sessionId: z.string(),
  name: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});
type CallBody = z.infer<typeof callBodySchema>;

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
 * `POST /call`: resolves the session's memory, dispatches the named tool to the
 * backend that owns it, performs any side-effects it asks for, and returns the
 * agent-facing text. Writes are applied here (the server is the sole writer) so
 * the UI highlight reflects the real file change rather than the agent's claim.
 */
async function handleCall(
  store: SessionStore,
  resolver: MemoryResolver,
  onRemembered: MemoryRememberedHandler,
  onSuggestion: MemorySuggestionHandler,
  body: CallBody,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;

  const resolved = await resolver.resolve(session.id, session.rootPath);
  const result = resolved.execute(body.name, body.params);
  if (!result) {
    res.status(400).json({ error: `Unknown memory tool "${body.name}"` });
    return;
  }

  await applyEffects(result.effects, session.id, onRemembered, onSuggestion);
  res.json({ text: result.text });
}

/**
 * Internal API used only by the memory extension running inside each Pi process.
 * It resolves the session's pluggable memory, dispatches a dispatcher-backed
 * tool, and surfaces side-effects to the room. Guarded by the same bearer token
 * as the agent API so arbitrary local callers can't mutate memory.
 */
export function createInternalMemoryRouter(
  store: SessionStore,
  resolver: MemoryResolver,
  onRemembered: MemoryRememberedHandler,
  onSuggestion: MemorySuggestionHandler,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.post(
    "/call",
    validate({ body: callBodySchema }),
    (req: Request, res: Response) =>
      handleCall(
        store,
        resolver,
        onRemembered,
        onSuggestion,
        getValidated<CallBody>(req).body,
        res,
      ),
  );

  return router;
}
