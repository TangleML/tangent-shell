import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  type ChatMessage,
  PI_AGENT,
  sourceFromAuthor,
} from "@tangent/shared/contracts.ts";

/** Per-session subdirectory (under `.tangent/`) holding chat JSONL files. */
const CHATS_DIR = path.join(".tangent", "chats");

/** File extension for a conversation's append-only message log. */
const LOG_EXT = ".jsonl";

/**
 * Rejects conversation ids that aren't a single, traversal-free path segment,
 * since the id becomes a filename. Prime's `prime` and subagent uuids both
 * pass; anything with a separator or `..` is refused.
 */
function isUnsafeConversationId(id: string): boolean {
  return (
    id.length === 0 ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("..")
  );
}

/** Absolute path to a session's chats directory. */
function chatsDir(rootPath: string): string {
  return path.join(rootPath, CHATS_DIR);
}

/** Absolute path to a single conversation's JSONL log. */
function logFile(rootPath: string, conversationId: string): string {
  return path.join(chatsDir(rootPath), `${conversationId}${LOG_EXT}`);
}

/**
 * Fills in the envelope fields a line written before they existed has no way to
 * carry. `position` is the line's 1-based place in the log, which is what a
 * legacy message's `seq` is: the conversation counter is seeded above this same
 * high-water mark, so old and new numbering form one sequence. The file itself
 * is never rewritten — this adapter runs on every read instead.
 */
function normalizeMessage(parsed: ChatMessage, position: number): ChatMessage {
  return {
    ...parsed,
    seq: parsed.seq ?? position,
    mentions: parsed.mentions ?? [],
    source: parsed.source ?? sourceFromAuthor(parsed.author),
  };
}

/**
 * Parses a JSONL file's contents into messages, tolerating a torn or blank
 * trailing line (e.g. a crash mid-append). Unparseable lines are skipped, so a
 * corrupt line shifts the positions the messages after it are numbered from.
 */
function parseLines(raw: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ChatMessage;
      messages.push(normalizeMessage(parsed, messages.length + 1));
    } catch {
      // Skip a partial/corrupt line rather than failing the whole read.
    }
  }
  return messages;
}

/**
 * Ordering within one Conversation: its `seq`, which is exactly what the
 * per-conversation counter exists to provide. Ties fall back to `id` so a
 * hand-edited or duplicated seq still sorts deterministically.
 */
function bySeq(a: ChatMessage, b: ChatMessage): number {
  return a.seq - b.seq || a.id.localeCompare(b.id);
}

/**
 * Stable global ordering for a session's merged transcript. `seq` is
 * per-conversation and says nothing across them, so the merge sorts by
 * `createdAt` then `id` — consumers that rely on global order (history replay,
 * `slice(-limit)`) still see a deterministic sequence.
 */
function byCreatedThenId(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Appends a single message to its conversation's JSONL log, creating the chats
 * directory on first write. One filesystem write per message; no DB touch.
 */
export async function appendMessage(
  rootPath: string,
  message: ChatMessage,
): Promise<void> {
  if (isUnsafeConversationId(message.conversationId)) {
    throw new Error(`unsafe conversationId "${message.conversationId}"`);
  }
  await mkdir(chatsDir(rootPath), { recursive: true });
  await appendFile(
    logFile(rootPath, message.conversationId),
    `${JSON.stringify(message)}\n`,
  );
}

/**
 * Reads a single conversation's messages in `seq` order, or `[]` when the log
 * doesn't exist yet.
 */
export async function readMessages(
  rootPath: string,
  conversationId: string,
): Promise<ChatMessage[]> {
  if (isUnsafeConversationId(conversationId)) return [];
  try {
    const raw = await readFile(logFile(rootPath, conversationId), "utf8");
    return parseLines(raw).sort(bySeq);
  } catch {
    return [];
  }
}

/**
 * The highest `seq` a conversation's log already occupies, or `0` when it has
 * none. Seeds the counter so allocation starts above every message persisted
 * before `seq` existed.
 */
export async function highestSeq(
  rootPath: string,
  conversationId: string,
): Promise<number> {
  const messages = await readMessages(rootPath, conversationId);
  return messages.at(-1)?.seq ?? 0;
}

export interface ChatActivity {
  unreadCount: number;
  lastActivityAt?: string;
}

export async function readActivity(
  rootPath: string,
  since?: string,
): Promise<ChatActivity> {
  const messages = await readAllMessages(rootPath);
  const isUnread = (message: ChatMessage): boolean =>
    message.author.kind === "agent" &&
    message.conversationId === PI_AGENT.id &&
    (!since || message.createdAt > since);
  const unreadCount = messages.filter(isUnread).length;
  const last = messages.at(-1);
  return { unreadCount, lastActivityAt: last?.createdAt };
}

/**
 * Reads every conversation file under the session's chats directory and returns
 * the merged transcript sorted by `(createdAt, id)`. Returns `[]` when no
 * messages have been written yet (directory absent).
 */
export async function readAllMessages(
  rootPath: string,
): Promise<ChatMessage[]> {
  let entries: string[];
  try {
    entries = await readdir(chatsDir(rootPath));
  } catch {
    return [];
  }

  const logs = entries.filter((name) => name.endsWith(LOG_EXT));
  const perFile = await Promise.all(
    logs.map(async (name) => {
      try {
        return parseLines(
          await readFile(path.join(chatsDir(rootPath), name), "utf8"),
        );
      } catch {
        return [];
      }
    }),
  );

  return perFile.flat().sort(byCreatedThenId);
}
