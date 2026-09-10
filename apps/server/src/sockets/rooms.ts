/** The Socket.IO room every client viewing one session joins. */
export function roomFor(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * The Socket.IO room a single Conversation's Messages are delivered to. A socket
 * joins one per Conversation its Participant is authorized for, so delivery is a
 * server-side decision rather than a client-side filter over one shared room.
 * Scoped by session id because a Conversation id is only unique within one.
 */
export function roomForConversation(
  sessionId: string,
  conversationId: string,
): string {
  return `conv:${sessionId}:${conversationId}`;
}

/**
 * Where a Message (or an agent's streaming event) for one Conversation is
 * broadcast: the per-Conversation room. Every session-level event (roster,
 * presence, triggers, artifacts) uses {@link roomFor} instead.
 */
export function messageRoomFor(
  sessionId: string,
  conversationId: string,
): string {
  return roomForConversation(sessionId, conversationId);
}

/**
 * Shared room every client viewing a session list (the switcher, the sessions
 * table) joins to receive live run-status updates for all sessions at once,
 * without subscribing to each session's individual room.
 */
export const SESSIONS_LOBBY = "sessions:lobby";
