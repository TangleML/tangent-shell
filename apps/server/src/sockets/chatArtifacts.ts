import {
  type ArtifactPinPayload,
  type ArtifactUnpinPayload,
  type PinnedArtifact,
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

/**
 * Pins a session's file, titled by its path when no title is given, and
 * broadcasts the updated list to the session room. Every way of pinning (chat,
 * agent, host page) goes through here.
 */
export async function pinAndBroadcast(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  sessionId: string,
  pin: { path: string; title?: string },
): Promise<PinnedArtifact[]> {
  const artifacts = await store.pinArtifact(sessionId, {
    path: pin.path,
    title: pin.title?.trim() || pin.path,
  });
  emitUiCommand(sessionId, { kind: "artifacts.update", artifacts });
  return artifacts;
}

/** Unpins a session's file and broadcasts the updated list to the session room. */
export async function unpinAndBroadcast(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  sessionId: string,
  path: string,
): Promise<PinnedArtifact[]> {
  const artifacts = await store.unpinArtifact(sessionId, path);
  emitUiCommand(sessionId, { kind: "artifacts.update", artifacts });
  return artifacts;
}

/** Pins an artifact from the chat's pin toggle. */
export async function handleArtifactPin(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  payload: ArtifactPinPayload,
): Promise<void> {
  const ref = readArtifactRef(payload);
  if (!ref) return;
  const session = await store.getSession(ref.sessionId);
  if (!session) return;
  await pinAndBroadcast(store, emitUiCommand, session.id, {
    path: ref.path,
    title: payload.title,
  });
}

/** Unpins an artifact from the chat's pin toggle. */
export async function handleArtifactUnpin(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  payload: ArtifactUnpinPayload,
): Promise<void> {
  const ref = readArtifactRef(payload);
  if (!ref) return;
  const session = await store.getSession(ref.sessionId);
  if (!session) return;
  await unpinAndBroadcast(store, emitUiCommand, session.id, ref.path);
}
