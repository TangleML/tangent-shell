import {
  type ChatReference,
  type PickedReferences,
  REFERENCE_GROUPS,
} from "./references";

const DRAFT_KEY_PREFIX = "tangent-chat-draft";
const PICKS_KEY_PREFIX = "tangent-chat-draft-picks";

/**
 * The localStorage key for a session+agent draft. Drafts are scoped per session
 * and per agent (Prime or a sub-agent) so each composer keeps its own text.
 */
function draftStorageKey(sessionId: string, agentId: string): string {
  return `${DRAFT_KEY_PREFIX}:${sessionId}:${agentId}`;
}

function picksStorageKey(sessionId: string, agentId: string): string {
  return `${PICKS_KEY_PREFIX}:${sessionId}:${agentId}`;
}

function isChatReference(value: unknown): value is ChatReference {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value && "label" in value && "href" in value)) return false;
  return (
    REFERENCE_GROUPS.some(({ kind }) => kind === value.kind) &&
    typeof value.label === "string" &&
    typeof value.href === "string" &&
    (!("detail" in value) || typeof value.detail === "string")
  );
}

/** The persisted draft for a session+agent, or "" when none (or unavailable). */
export function readDraft(sessionId: string, agentId: string): string {
  try {
    return localStorage.getItem(draftStorageKey(sessionId, agentId)) ?? "";
  } catch {
    // localStorage can be unavailable (private mode, SSR); treat as no draft.
    return "";
  }
}

/**
 * Persists a draft for a session+agent. An empty/whitespace-only value removes
 * the key so a cleared composer leaves nothing behind.
 */
export function writeDraft(
  sessionId: string,
  agentId: string,
  value: string,
): void {
  if (value.trim().length === 0) {
    clearDraft(sessionId, agentId);
    return;
  }
  try {
    localStorage.setItem(draftStorageKey(sessionId, agentId), value);
  } catch {
    // Persistence is best-effort; ignore storage failures.
  }
}

/** The references picked into a session+agent draft, by their `#token`. */
export function readDraftPicks(
  sessionId: string,
  agentId: string,
): PickedReferences {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(picksStorageKey(sessionId, agentId)) ?? "{}",
    );
    if (typeof stored !== "object" || stored === null) return new Map();
    return new Map(
      Object.entries(stored).filter((entry): entry is [string, ChatReference] =>
        isChatReference(entry[1]),
      ),
    );
  } catch {
    // Unavailable storage or unreadable picks: the draft resolves by label.
    return new Map();
  }
}

/**
 * Persists a draft's picks beside its text. The composer is rebuilt whenever
 * its chat is left, and a `#token` alone can't say which of two references
 * with one label was picked.
 */
export function writeDraftPicks(
  sessionId: string,
  agentId: string,
  picked: PickedReferences,
): void {
  try {
    localStorage.setItem(
      picksStorageKey(sessionId, agentId),
      JSON.stringify(Object.fromEntries(picked)),
    );
  } catch {
    // Persistence is best-effort; ignore storage failures.
  }
}

/** Removes the persisted draft for a session+agent, and its picks. */
export function clearDraft(sessionId: string, agentId: string): void {
  try {
    localStorage.removeItem(draftStorageKey(sessionId, agentId));
    localStorage.removeItem(picksStorageKey(sessionId, agentId));
  } catch {
    // Persistence is best-effort; ignore storage failures.
  }
}
