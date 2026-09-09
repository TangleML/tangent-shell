import type { ChatMessage } from "@tangent/shared/contracts";

/** Messages bucketed by the `conversationId` they belong to. */
export type MessageMap = Map<string, ChatMessage[]>;

/** Stable empty result so an unknown Conversation doesn't churn renders. */
export const NO_MESSAGES: ChatMessage[] = [];

/** Within one Conversation, order by `seq`; `id` breaks a tie deterministically. */
function bySeq(a: ChatMessage, b: ChatMessage): number {
  return a.seq - b.seq || a.id.localeCompare(b.id);
}

/** Groups a flat history into per-Conversation buckets, each sorted by `seq`. */
export function groupByConversation(history: ChatMessage[]): MessageMap {
  const map: MessageMap = new Map();
  for (const message of history) {
    const bucket = map.get(message.conversationId);
    if (bucket) bucket.push(message);
    else map.set(message.conversationId, [message]);
  }
  for (const bucket of map.values()) bucket.sort(bySeq);
  return map;
}

/** Merges one Conversation's history in, deduped by id (incoming wins). */
export function mergeConversation(
  prev: MessageMap,
  conversationId: string,
  incoming: ChatMessage[],
): MessageMap {
  const byId = new Map<string, ChatMessage>();
  for (const message of prev.get(conversationId) ?? [])
    byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  const next = new Map(prev);
  next.set(conversationId, [...byId.values()].sort(bySeq));
  return next;
}

/**
 * Inserts a message into an already-`seq`-sorted bucket at its ordered slot.
 * A live append is usually the newest, so scan from the end — but two humans
 * typing while an agent streams can interleave, and the tiebreak keeps every
 * client rendering the same order regardless of arrival order.
 */
function insertBySeq(
  bucket: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  let i = bucket.length;
  while (i > 0 && bySeq(bucket[i - 1], message) > 0) i--;
  const next = bucket.slice();
  next.splice(i, 0, message);
  return next;
}

/** Appends a message to its Conversation bucket in `seq` order. */
export function appendToConversation(
  prev: MessageMap,
  message: ChatMessage,
): MessageMap {
  const next = new Map(prev);
  const bucket = next.get(message.conversationId) ?? NO_MESSAGES;
  next.set(message.conversationId, insertBySeq(bucket, message));
  return next;
}

/** Replaces one message by id in a Conversation bucket via an updater. */
export function editInConversation(
  prev: MessageMap,
  conversationId: string,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): MessageMap {
  const bucket = prev.get(conversationId);
  if (!bucket) return prev;
  const next = new Map(prev);
  next.set(
    conversationId,
    bucket.map((m) => (m.id === messageId ? update(m) : m)),
  );
  return next;
}
