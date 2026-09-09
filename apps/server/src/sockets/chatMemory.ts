import {
  MEMORY_AUTHOR,
  type MemoryConfirmPayload,
  type MemoryDismissPayload,
  type MemoryScope,
  type MemorySuggestionPayload,
  SocketEvents,
} from "@tangent/shared/contracts.ts";
import type { Server } from "socket.io";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import {
  orchestratorConversationFor,
  orchestratorIdentity,
} from "../conversation/participantRegistry.ts";
import type { ParticipantService } from "../conversation/participantService.ts";
import type { MemoryManager } from "../pi/memory.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { roomFor } from "./rooms.ts";

/**
 * Handler that surfaces an applied memory write as a highlighted, persisted
 * chat message. Built from the actual stored text (not the agent's claim) so
 * the user always sees ground truth.
 */
export type MemoryRememberedHandler = (
  sessionId: string,
  scope: MemoryScope,
  text: string,
) => Promise<void>;

/** Builds the {@link MemoryRememberedHandler} bound to the conversation router. */
export function createMemoryRememberedHandler(
  conversations: ConversationRouter,
  store: SessionStore,
  participants: ParticipantService,
): MemoryRememberedHandler {
  return async (sessionId, scope, text) => {
    // Memory is an Automation Participant: the row it authors from is real and
    // listable, even though the Message still carries the MEMORY_AUTHOR label.
    await participants.ensureAutomation(
      sessionId,
      MEMORY_AUTHOR.id,
      MEMORY_AUTHOR.name,
      "reaction",
    );
    await conversations.post({
      sessionId,
      conversationId: await orchestratorConversationFor(store, sessionId),
      author: MEMORY_AUTHOR,
      content: text,
      memory: { scope },
    });
  };
}

/** Emits a memory suggestion card into the session room. */
export type MemorySuggestionHandler = (
  payload: MemorySuggestionPayload,
) => void;

/** Builds the {@link MemorySuggestionHandler} bound to the room. */
export function createMemorySuggestionHandler(
  io: Server,
): MemorySuggestionHandler {
  return (payload) => {
    io.to(roomFor(payload.sessionId)).emit(
      SocketEvents.MemorySuggestion,
      payload,
    );
  };
}

/**
 * Applies a confirmed suggestion: writes it to the resolved store, surfaces the
 * highlight, and tells Prime the user approved so it can continue honestly.
 *
 * The confirmation itself is delivered rather than posted: the user already sees
 * the highlight, and a second bubble saying they clicked "yes" is noise.
 */
export async function handleMemoryConfirm(
  store: SessionStore,
  connectors: ConnectorRegistry,
  memory: MemoryManager,
  onRemembered: MemoryRememberedHandler,
  payload: MemoryConfirmPayload,
): Promise<void> {
  const suggestion = memory.takeSuggestion(payload?.suggestionId);
  if (!suggestion || suggestion.sessionId !== payload.sessionId) return;

  const session = await store.getSession(suggestion.sessionId);
  if (!session) return;

  const result = memory.write(
    session.rootPath,
    suggestion.scope,
    suggestion.text,
  );
  await onRemembered(suggestion.sessionId, result.scope, result.added);
  const orchestratorId = (
    await orchestratorIdentity(store, suggestion.sessionId)
  ).orchestratorId;
  connectors.resolve(suggestion.sessionId, orchestratorId).deliver({
    sessionId: suggestion.sessionId,
    participantId: orchestratorId,
    text:
      `The user confirmed your suggestion. It has been stored to ${result.scope} ` +
      `memory: "${result.added}".`,
  });
}

/** Tells Prime a suggestion was declined; nothing is written. */
export async function handleMemoryDismiss(
  store: SessionStore,
  connectors: ConnectorRegistry,
  memory: MemoryManager,
  payload: MemoryDismissPayload,
): Promise<void> {
  const suggestion = memory.takeSuggestion(payload?.suggestionId);
  if (!suggestion || suggestion.sessionId !== payload.sessionId) return;
  const orchestratorId = (
    await orchestratorIdentity(store, suggestion.sessionId)
  ).orchestratorId;
  connectors.resolve(suggestion.sessionId, orchestratorId).deliver({
    sessionId: suggestion.sessionId,
    participantId: orchestratorId,
    text: `The user declined to remember: "${suggestion.text}". Do not store it.`,
  });
}
