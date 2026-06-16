import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ChatMessage } from "@tangent/shared/contracts.ts";

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
 * Parses a JSONL file's contents into messages, tolerating a torn or blank
 * trailing line (e.g. a crash mid-append). Unparseable lines are skipped.
 */
function parseLines(raw: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as ChatMessage);
    } catch {
      // Skip a partial/corrupt line rather than failing the whole read.
    }
  }
  return messages;
}

/**
 * Stable global ordering for a session's merged transcript. Within one
 * conversation file append order already matches id order; across files we sort
 * by `createdAt` then `id` so consumers that rely on global order (history
 * replay, `slice(-limit)`) see a deterministic sequence.
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
 * Reads a single conversation's messages in append (id) order, or `[]` when the
 * log doesn't exist yet.
 */
export async function readMessages(
  rootPath: string,
  conversationId: string,
): Promise<ChatMessage[]> {
  if (isUnsafeConversationId(conversationId)) return [];
  try {
    return parseLines(
      await readFile(logFile(rootPath, conversationId), "utf8"),
    );
  } catch {
    return [];
  }
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
