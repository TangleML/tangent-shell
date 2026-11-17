import {
  type ArtifactPinPayload,
  type ArtifactUnpinPayload,
  type PinnedArtifact,
  SocketEvents,
  type UiCommandPayload,
} from "@tangent/shared/contracts.ts";
import type { Socket } from "socket.io";

import { ARTIFACTS_DIRNAME, UPLOADS_DIRNAME } from "../config.ts";
import { badRequest } from "../middleware/errorHandler.ts";
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
  if (typeof payload.path !== "string") return null;
  const path = payload.path.trim();
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

const MAX_PIN_PATH_CHARS = 1_024;
const MAX_PIN_TITLE_CHARS = 300;
const PINNABLE_DIRS = [ARTIFACTS_DIRNAME, UPLOADS_DIRNAME];
// eslint-disable-next-line no-control-regex -- control characters are what it rejects
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f\\]/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const isDotSegment = (segment: string): boolean =>
  /^\.{1,2}$/.test(segment.replace(/%2e/gi, "."));

/** Whether a path names a file the session serves, relative to its workspace. */
function isServedPath(path: string): boolean {
  if (UNSAFE_PATH_CHARS.test(path) || SCHEME.test(path)) return false;
  const [dir, ...rest] = path.replace(/^\.\//, "").split("/");
  return (
    PINNABLE_DIRS.includes(dir) &&
    rest.some(Boolean) &&
    !rest.some(isDotSegment)
  );
}

/** Why a pin is refused, or nothing when it can be pinned. */
export function pinProblem(pin: {
  path: string;
  title?: string;
}): string | undefined {
  const title = pin.title?.trim() ?? "";
  if (title.length > MAX_PIN_TITLE_CHARS) {
    return `A pin's title can be at most ${MAX_PIN_TITLE_CHARS} characters`;
  }
  if (pin.path.length > MAX_PIN_PATH_CHARS) {
    return `A pinned path can be at most ${MAX_PIN_PATH_CHARS} characters`;
  }
  if (!isServedPath(pin.path)) {
    return "Only a file under artifacts/ or uploads/ can be pinned, by its path relative to the workspace";
  }
  return undefined;
}

/**
 * Pins a session's file, titled by its path when no title is given, and
 * broadcasts the updated list to the session room. Every way of pinning (chat,
 * agent, host page) goes through here, so this is where a bad pin is refused.
 */
export async function pinAndBroadcast(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  sessionId: string,
  pin: { path: string; title?: string },
): Promise<PinnedArtifact[]> {
  const problem = pinProblem(pin);
  if (problem) throw badRequest(problem);
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
  const title = typeof payload.title === "string" ? payload.title : undefined;
  if (pinProblem({ path: ref.path, title })) return;
  const session = await store.getSession(ref.sessionId);
  if (!session) return;
  await pinAndBroadcast(store, emitUiCommand, session.id, {
    path: ref.path,
    title,
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
