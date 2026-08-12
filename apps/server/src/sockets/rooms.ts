/** The Socket.IO room every client viewing one session joins. */
export function roomFor(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * Shared room every client viewing a session list (the switcher, the sessions
 * table) joins to receive live run-status updates for all sessions at once,
 * without subscribing to each session's individual room.
 */
export const SESSIONS_LOBBY = "sessions:lobby";
