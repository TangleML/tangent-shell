import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { MemoryManager } from "../pi/memory.ts";
import type {
  MemoryRememberedHandler,
  MemorySuggestionHandler,
} from "../sockets/chat.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { loadSession } from "./sessions/utils.ts";

/** `GET /read` query: the session whose memory to read. */
const readQuerySchema = z.object({
  sessionId: z.string(),
});
type ReadQuery = z.infer<typeof readQuerySchema>;

// `scope` defaults to "session" so a missing scope behaves as before; an
// explicitly invalid scope is now rejected with a 400 rather than coerced.
const scopeSchema = z.enum(["global", "session"]).default("session");

/** `POST /remember` body: applies a memory write for a session. */
const rememberBodySchema = z.object({
  sessionId: z.string(),
  scope: scopeSchema,
  text: z.string().trim().min(1),
  replaces: z.string().optional(),
});
type RememberBody = z.infer<typeof rememberBodySchema>;

/** `POST /suggest` body: records a pending suggestion for a session. */
const suggestBodySchema = z.object({
  sessionId: z.string(),
  scope: scopeSchema,
  text: z.string().trim().min(1),
});
type SuggestBody = z.infer<typeof suggestBodySchema>;

/** `GET /read`: returns the current session + global memory text. */
async function handleRead(
  store: SessionStore,
  memory: MemoryManager,
  query: ReadQuery,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, query.sessionId);
  if (!session) return;
  res.json({
    session: memory.readSession(session.rootPath),
    global: memory.readGlobal(),
  });
}

/** `POST /remember`: applies a write and surfaces the highlight. */
async function handleRemember(
  store: SessionStore,
  memory: MemoryManager,
  onRemembered: MemoryRememberedHandler,
  body: RememberBody,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;

  const result = memory.write(
    session.rootPath,
    body.scope,
    body.text,
    body.replaces,
  );
  await onRemembered(body.sessionId, result.scope, result.added);
  res.json({ stored: result.stored, scope: result.scope });
}

/** `POST /suggest`: records a pending suggestion and emits its card. */
function handleSuggest(
  memory: MemoryManager,
  onSuggestion: MemorySuggestionHandler,
  body: SuggestBody,
  res: Response,
): void {
  const suggestion = memory.addSuggestion(
    body.sessionId,
    body.scope,
    body.text,
  );
  onSuggestion({
    sessionId: body.sessionId,
    suggestionId: suggestion.id,
    scope: body.scope,
    text: suggestion.text,
  });
  res.json({ ok: true, suggestionId: suggestion.id });
}

/**
 * Internal API used only by the memory extension running inside each Pi
 * process. It lets any agent read the session + global memory and lets Prime
 * write to (or propose changes to) them. Guarded by the same bearer token as
 * the agent API so arbitrary local callers can't mutate memory.
 *
 * Writes are applied here (the server is the sole writer) and surfaced to the
 * room via the injected handlers, so the UI highlight reflects the real file
 * change rather than the agent's narration.
 */
export function createInternalMemoryRouter(
  store: SessionStore,
  memory: MemoryManager,
  onRemembered: MemoryRememberedHandler,
  onSuggestion: MemorySuggestionHandler,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.get(
    "/read",
    validate({ query: readQuerySchema }),
    (req: Request, res: Response) =>
      handleRead(
        store,
        memory,
        getValidated<unknown, unknown, ReadQuery>(req).query,
        res,
      ),
  );
  router.post(
    "/remember",
    validate({ body: rememberBodySchema }),
    (req: Request, res: Response) =>
      handleRemember(
        store,
        memory,
        onRemembered,
        getValidated<RememberBody>(req).body,
        res,
      ),
  );
  router.post(
    "/suggest",
    validate({ body: suggestBodySchema }),
    (req: Request, res: Response) =>
      handleSuggest(
        memory,
        onSuggestion,
        getValidated<SuggestBody>(req).body,
        res,
      ),
  );

  return router;
}
