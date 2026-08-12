import {
  type ArtifactPinPayload,
  type ArtifactUnpinPayload,
  SocketEvents,
  type UiCommandPayload,
} from "@tangent/shared/contracts.ts";
import type { Socket } from "socket.io";

import type { SessionStore } from "../store/sessionStore.ts";
import type { UiCommandEmitter } from "./sessionRoster.ts";

/** A validated artifact reference extracted from a pin/unpin payload. */
interface ArtifactRef {
  sessionId: string;
  path: string;
}

/** Validates a pin/unpin payload, returning a trimmed ref or null if invalid. */
function readArtifactRef(payload?: {
  sessionId?: string;
  path?: string;
}): ArtifactRef | null {
  if (!payload) return null;
  const path = payload.path?.trim();
  if (!payload.sessionId || !path) return null;
  return { sessionId: payload.sessionId, path };
}

/**
 * Surfaces the session's current pinned-artifact list to just the joining
 * socket, using the same `artifacts.update` directive that broadcasts later
 * mutations.
 */
export async function replayArtifacts(
  socket: Socket,
  store: SessionStore,
  sessionId: string,
): Promise<void> {
  const artifacts = await store.getArtifacts(sessionId);
  const payload: UiCommandPayload = {
    sessionId,
    command: { kind: "artifacts.update", artifacts },
  };
  socket.emit(SocketEvents.UiCommand, payload);
}

/** Pins an artifact, then broadcasts the updated list to the session room. */
export async function handleArtifactPin(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  payload: ArtifactPinPayload,
): Promise<void> {
  const ref = readArtifactRef(payload);
  if (!ref) return;
  const session = await store.getSession(ref.sessionId);
  if (!session) return;

  const artifacts = await store.pinArtifact(session.id, {
    path: ref.path,
    title: payload.title?.trim() || ref.path,
  });
  emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
}

/** Unpins an artifact, then broadcasts the updated list to the session room. */
export async function handleArtifactUnpin(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  payload: ArtifactUnpinPayload,
): Promise<void> {
  const ref = readArtifactRef(payload);
  if (!ref) return;
  const session = await store.getSession(ref.sessionId);
  if (!session) return;

  const artifacts = await store.unpinArtifact(session.id, ref.path);
  emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
}
