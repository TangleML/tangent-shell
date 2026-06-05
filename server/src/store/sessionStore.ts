import type {
  ChatMessage,
  CreateSessionRequest,
  Session,
  UpdateSessionRequest,
} from "@shared/contracts.ts";

/**
 * Storage abstraction for sessions and their chat history.
 *
 * Phase 1 ships only an in-memory implementation, but everything depends on
 * this interface so a persistent store (DB, file, etc.) can be swapped in later
 * without touching the routes or socket handlers.
 */
export interface SessionStore {
  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | undefined>;
  createSession(input: CreateSessionRequest): Promise<Session>;
  updateSession(
    id: string,
    input: UpdateSessionRequest,
  ): Promise<Session | undefined>;
  deleteSession(id: string): Promise<boolean>;

  getMessages(sessionId: string): Promise<ChatMessage[]>;
  appendMessage(message: ChatMessage): Promise<void>;
}
