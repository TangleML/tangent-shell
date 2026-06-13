import type {
  ChatMessage,
  CreateSessionRequest,
  PinnedArtifact,
  Session,
  SessionConfigMeta,
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
  /** Records the Configuration Bundle a session was created from. */
  attachConfig(
    id: string,
    config: SessionConfigMeta,
  ): Promise<Session | undefined>;
  deleteSession(id: string): Promise<boolean>;

  getMessages(sessionId: string): Promise<ChatMessage[]>;
  appendMessage(message: ChatMessage): Promise<void>;

  /** Returns the session's pinned artifacts, oldest first. */
  getArtifacts(sessionId: string): Promise<PinnedArtifact[]>;
  /**
   * Pins an artifact (deduped by `path`) and returns the updated list. Re-pinning
   * an existing `path` refreshes its title without creating a duplicate.
   */
  pinArtifact(
    sessionId: string,
    artifact: { path: string; title: string },
  ): Promise<PinnedArtifact[]>;
  /** Unpins an artifact by `path` and returns the updated list. */
  unpinArtifact(sessionId: string, path: string): Promise<PinnedArtifact[]>;
}
