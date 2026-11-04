import type { Session } from "@tangent/shared/contracts.ts";
import type { Request, Response, Router } from "express";
import { z } from "zod";

import {
  formatTranscript,
  primeMessages,
  readSessionSummary,
  resolveTarget,
  scopedSessions,
  searchTranscripts,
} from "../conversation/sessionTranscript.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { loadSession } from "./sessions/utils.ts";

const MAX_RELATED = 20;

export const relatedQuerySchema = z.object({ sessionId: z.string() });
export type RelatedQuery = z.infer<typeof relatedQuerySchema>;

export const searchQuerySchema = z.object({
  sessionId: z.string(),
  query: z.string().trim().min(1),
  limit: z.coerce.number().int().optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const transcriptQuerySchema = z.object({
  sessionId: z.string(),
  target: z.string().trim().min(1),
  fromSeq: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
});
export type TranscriptQuery = z.infer<typeof transcriptQuerySchema>;

/** The sessions `current` may read other than itself, newest first. */
async function relatedTo(
  store: SessionStore,
  current: Session,
): Promise<Session[]> {
  return scopedSessions(await store.listSessions(), current)
    .filter((session) => session.id !== current.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** `GET /related`: in-scope sessions with their running `MEMORY.md` summary. */
async function handleRelated(
  store: SessionStore,
  query: RelatedQuery,
  res: Response,
): Promise<void> {
  const current = await loadSession(store, res, query.sessionId);
  if (!current) return;
  const related = (await relatedTo(store, current)).slice(0, MAX_RELATED);
  res.json({
    sessions: related.map((session) => ({
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      summary: readSessionSummary(session),
    })),
  });
}

/** `GET /search`: keyword hits across in-scope sessions' Prime conversations. */
async function handleSearch(
  store: SessionStore,
  query: SearchQuery,
  res: Response,
): Promise<void> {
  const current = await loadSession(store, res, query.sessionId);
  if (!current) return;
  const entries = await Promise.all(
    (await relatedTo(store, current)).map(async (session) => ({
      session,
      messages: await primeMessages(store, session.id),
    })),
  );
  res.json({ hits: searchTranscripts(entries, query.query, query.limit) });
}

/**
 * `GET /transcript`: one page of an in-scope session's Prime conversation. A
 * session that is out of scope or doesn't exist is refused with `403`.
 */
async function handleTranscript(
  store: SessionStore,
  query: TranscriptQuery,
  res: Response,
): Promise<void> {
  const current = await loadSession(store, res, query.sessionId);
  if (!current) return;
  const resolved = resolveTarget(
    await store.listSessions(),
    current,
    query.target,
  );
  if ("refused" in resolved) {
    res.status(403).json({ error: resolved.refused });
    return;
  }
  if ("ambiguous" in resolved) {
    res.status(400).json({ error: resolved.ambiguous });
    return;
  }
  const { session } = resolved;
  const page = formatTranscript(await primeMessages(store, session.id), {
    fromSeq: query.fromSeq,
    limit: query.limit,
  });
  res.json({
    session: {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    ...page,
  });
}

/**
 * Mounts Prime's cross-session recall reads. Every read is scoped on the
 * server by {@link scopedSessions}, so the spawn-time tool gate is not the only
 * boundary: an untagged session reaches nothing.
 */
export function mountSessionRecallRoutes(
  router: Router,
  store: SessionStore,
): void {
  router.get(
    "/related",
    validate({ query: relatedQuerySchema }),
    (req: Request, res: Response) =>
      handleRelated(
        store,
        getValidated<unknown, unknown, RelatedQuery>(req).query,
        res,
      ),
  );

  router.get(
    "/search",
    validate({ query: searchQuerySchema }),
    (req: Request, res: Response) =>
      handleSearch(
        store,
        getValidated<unknown, unknown, SearchQuery>(req).query,
        res,
      ),
  );

  router.get(
    "/transcript",
    validate({ query: transcriptQuerySchema }),
    (req: Request, res: Response) =>
      handleTranscript(
        store,
        getValidated<unknown, unknown, TranscriptQuery>(req).query,
        res,
      ),
  );
}
