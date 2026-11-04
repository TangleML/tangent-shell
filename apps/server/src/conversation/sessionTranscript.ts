import { readFileSync } from "node:fs";
import path from "node:path";

import {
  type ChatMessage,
  PI_AGENT,
  type Session,
} from "@tangent/shared/contracts.ts";

import { SESSION_MEMORY_FILENAME } from "../config.ts";
import type { SessionStore } from "../store/sessionStore.ts";

/**
 * The one answer for a session that is out of scope or doesn't exist, so the
 * recall tools can't be used to probe which sessions exist.
 */
export const TRANSCRIPT_REFUSAL =
  "Refused: that session is not readable from this one. Only sessions that " +
  "carry every selector of this session (and, when restricted, share its " +
  "owner) can be read.";

/** The shortest id prefix accepted: the length pi-memory stamps entries with. */
const MIN_REF_LENGTH = 8;
const SUMMARY_MAX_CHARS = 2_000;
const SNIPPET_CHARS = 300;
const SNIPPET_LEAD_CHARS = 100;
const SEARCH_DEFAULT_LIMIT = 10;
const SEARCH_MAX_LIMIT = 50;
const TRANSCRIPT_DEFAULT_LIMIT = 50;
const TRANSCRIPT_MAX_LIMIT = 200;
const TRANSCRIPT_MAX_CHARS = 40_000;

/**
 * Whether `current` may read `target`'s transcript: `current` carries at least
 * one selector, `target` carries every one of them, and a restricted `target`
 * shares `current`'s owner.
 */
export function canReadTranscript(current: Session, target: Session): boolean {
  if (current.tags.length === 0) return false;
  if (!current.tags.every((tag) => target.tags.includes(tag))) return false;
  if (target.accessPolicy !== "restricted") return true;
  return target.user?.email === current.user?.email;
}

/** The sessions `current` may read, in their given order. */
export function scopedSessions(
  sessions: readonly Session[],
  current: Session,
): Session[] {
  return sessions.filter((session) => canReadTranscript(current, session));
}

export type TargetResolution =
  | { session: Session }
  | { refused: string }
  | { ambiguous: string };

/**
 * Resolves a full session id, an id prefix, or a `[xxxxxxxx]` memory stamp to
 * one session `current` may read. Only in-scope sessions are candidates, so a
 * miss never reveals whether an out-of-scope session exists.
 */
export function resolveTarget(
  sessions: readonly Session[],
  current: Session,
  ref: string,
): TargetResolution {
  const needle = ref
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (needle.length < MIN_REF_LENGTH) {
    return {
      refused: `Pass a session id of at least ${MIN_REF_LENGTH} characters.`,
    };
  }
  const inScope = scopedSessions(sessions, current);
  const exact = inScope.find((session) => session.id === needle);
  if (exact) return { session: exact };
  const matches = inScope.filter((session) => session.id.startsWith(needle));
  if (matches.length === 1) return { session: matches[0] };
  if (matches.length > 1) {
    return {
      ambiguous: `"${ref}" matches more than one related session; pass a longer id.`,
    };
  }
  return { refused: TRANSCRIPT_REFUSAL };
}

/** A requested limit clamped to `[1, max]`, or `fallback` when unset/invalid. */
function clampLimit(
  requested: number | undefined,
  fallback: number,
  max: number,
): number {
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.min(Math.max(1, Math.floor(requested)), max);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function truncateTail(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(-max)}`;
}

/** The running summary Prime keeps in a session's `MEMORY.md`, capped to its
 * newest content; empty when the file is missing. The tail is kept because the
 * host seeds the head with boilerplate and Prime appends its notes after it. */
export function readSessionSummary(session: Session): string {
  try {
    const file = path.join(session.rootPath, SESSION_MEMORY_FILENAME);
    return truncateTail(readFileSync(file, "utf8").trim(), SUMMARY_MAX_CHARS);
  } catch {
    return "";
  }
}

/** A session's Prime conversation, in `seq` order; empty without a Prime. */
export async function primeMessages(
  store: Pick<SessionStore, "listAgents" | "getConversationMessages">,
  sessionId: string,
): Promise<ChatMessage[]> {
  const agents = await store.listAgents(sessionId);
  const prime = agents.find((agent) => agent.id === PI_AGENT.id);
  if (!prime) return [];
  return store.getConversationMessages(sessionId, prime.homeConversationId);
}

/** One session's Prime conversation, as searched by {@link searchTranscripts}. */
export interface TranscriptEntry {
  session: Session;
  messages: readonly ChatMessage[];
}

export interface TranscriptHit {
  sessionId: string;
  sessionName: string;
  updatedAt: string;
  seq: number;
  author: string;
  snippet: string;
}

function authorLabel(message: ChatMessage): string {
  return `${message.author.name} (${message.author.kind})`;
}

/** When a session was last used: its newest message's `createdAt`, or
 * `fallback` (the session's `createdAt`) when it holds no messages. */
export function lastActivityAt(
  messages: readonly ChatMessage[],
  fallback: string,
): string {
  return messages.at(-1)?.createdAt ?? fallback;
}

/** About {@link SNIPPET_CHARS} of `content` around `index`, whitespace folded. */
function snippetAround(content: string, index: number): string {
  const start = Math.max(0, index - SNIPPET_LEAD_CHARS);
  const end = Math.min(content.length, start + SNIPPET_CHARS);
  const body = content.slice(start, end).replace(/\s+/g, " ").trim();
  const lead = start > 0 ? "…" : "";
  const tail = end < content.length ? "…" : "";
  return `${lead}${body}${tail}`;
}

function sessionHits(entry: TranscriptEntry, terms: string[]): TranscriptHit[] {
  const { session } = entry;
  return entry.messages.flatMap((message) => {
    const lower = message.content.toLowerCase();
    if (!terms.every((term) => lower.includes(term))) return [];
    return [
      {
        sessionId: session.id,
        sessionName: session.name,
        updatedAt: session.updatedAt,
        seq: message.seq,
        author: authorLabel(message),
        snippet: snippetAround(message.content, lower.indexOf(terms[0])),
      },
    ];
  });
}

/**
 * Case-insensitive search for messages containing every term of `query`, the
 * most recently used session first and in `seq` order within a session.
 */
export function searchTranscripts(
  entries: readonly TranscriptEntry[],
  query: string,
  limit?: number,
): TranscriptHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const cap = clampLimit(limit, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT);
  const activity = (entry: TranscriptEntry): string =>
    lastActivityAt(entry.messages, entry.session.createdAt);
  return [...entries]
    .sort((a, b) => activity(b).localeCompare(activity(a)))
    .flatMap((entry) => sessionHits(entry, terms))
    .slice(0, cap);
}

export interface TranscriptPage {
  text: string;
  /** Messages in the whole conversation. */
  total: number;
  /** Messages rendered on this page. */
  shown: number;
  /** Where the next page starts; absent on the last page. */
  nextFromSeq?: number;
}

function formatMessage(message: ChatMessage): string {
  const line = `#${message.seq} ${authorLabel(message)}: ${message.content}`;
  return truncate(line, TRANSCRIPT_MAX_CHARS);
}

/**
 * One page of a conversation starting at `fromSeq`, capped by message count and
 * total characters (a page always holds at least one message). Reasoning
 * (`thinking`) is never included.
 */
export function formatTranscript(
  messages: readonly ChatMessage[],
  options: { fromSeq?: number; limit?: number } = {},
): TranscriptPage {
  const limit = clampLimit(
    options.limit,
    TRANSCRIPT_DEFAULT_LIMIT,
    TRANSCRIPT_MAX_LIMIT,
  );
  const pending = messages.filter((m) => m.seq >= (options.fromSeq ?? 0));
  const lines: string[] = [];
  let chars = 0;
  for (const message of pending.slice(0, limit)) {
    const line = formatMessage(message);
    if (lines.length > 0 && chars + line.length > TRANSCRIPT_MAX_CHARS) break;
    lines.push(line);
    chars += line.length;
  }
  return {
    text: lines.join("\n\n"),
    total: messages.length,
    shown: lines.length,
    nextFromSeq: pending[lines.length]?.seq,
  };
}
