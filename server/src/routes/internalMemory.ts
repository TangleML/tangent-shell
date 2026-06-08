import type { MemoryScope } from "@shared/contracts.ts";
import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";

import { INTERNAL_TOKEN } from "../config.ts";
import type { MemoryManager } from "../pi/memory.ts";
import type {
  MemoryRememberedHandler,
  MemorySuggestionHandler,
} from "../sockets/chat.ts";
import type { SessionStore } from "../store/sessionStore.ts";

interface RememberBody {
  sessionId?: string;
  scope?: MemoryScope;
  text?: string;
  replaces?: string;
}

interface SuggestBody {
  sessionId?: string;
  scope?: MemoryScope;
  text?: string;
}

/** Normalizes an arbitrary scope value to a valid {@link MemoryScope}. */
function toScope(value: unknown): MemoryScope {
  return value === "global" ? "global" : "session";
}

/** Rejects any request not bearing the shared internal token. */
function requireInternalToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.get("authorization") !== `Bearer ${INTERNAL_TOKEN}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** `GET /read`: returns the current session + global memory text. */
async function handleRead(
  store: SessionStore,
  memory: MemoryManager,
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
  req: Request,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as RememberBody;
  if (!body.sessionId || !body.text?.trim()) {
    res.status(400).json({ error: "sessionId and text are required" });
    return;
  }
  const session = await store.getSession(body.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = memory.write(
    session.rootPath,
    toScope(body.scope),
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
  req: Request,
  res: Response,
): void {
  const body = (req.body ?? {}) as SuggestBody;
  if (!body.sessionId || !body.text?.trim()) {
    res.status(400).json({ error: "sessionId and text are required" });
    return;
  }
  const scope = toScope(body.scope);
  const suggestion = memory.addSuggestion(body.sessionId, scope, body.text);
  onSuggestion({
    sessionId: body.sessionId,
    suggestionId: suggestion.id,
    scope,
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

  router.get("/read", (req: Request, res: Response) =>
    handleRead(store, memory, req, res),
  );
  router.post("/remember", (req: Request, res: Response) =>
    handleRemember(store, memory, onRemembered, req, res),
  );
  router.post("/suggest", (req: Request, res: Response) =>
    handleSuggest(memory, onSuggestion, req, res),
  );

  return router;
}
