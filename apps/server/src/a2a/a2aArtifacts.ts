import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { UiCommandEmitter } from "../sockets/sessionRoster.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import type { A2aArtifact } from "./a2aClient.ts";

/** Workspace directory an attached peer's outputs land under. */
const A2A_DIR = "a2a";

/** Strips path separators and dots so a peer cannot name its way out of a2a/. */
function safeSegment(name: string): string {
  const flattened = name.replace(/[/\\]+/g, "-").replace(/^\.+/, "");
  return flattened.trim() || "artifact";
}

/**
 * Writes an A2A artifact into the session workspace and pins it, so a peer's
 * output arrives on the same path a local agent's pinned artifact does.
 *
 * Files land under `a2a/<taskId>/`, which keeps a peer's turns apart and gives
 * the pinned path something stable to point at. The artifact's name becomes the
 * pin title; re-pinning a path refreshes it rather than duplicating.
 */
export async function saveA2aArtifact(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  input: { sessionId: string; taskId: string; artifact: A2aArtifact },
): Promise<string[]> {
  const session = await store.getSession(input.sessionId);
  if (!session || input.artifact.parts.length === 0) return [];

  const relativeDir = path.join(A2A_DIR, safeSegment(input.taskId));
  await mkdir(path.join(session.rootPath, relativeDir), { recursive: true });

  const written: string[] = [];
  for (const part of input.artifact.parts) {
    const relativePath = path.join(relativeDir, safeSegment(part.filename));
    await writeFile(path.join(session.rootPath, relativePath), part.body);
    const artifacts = await store.pinArtifact(input.sessionId, {
      path: relativePath,
      title: input.artifact.name,
    });
    emitUiCommand(input.sessionId, { kind: "artifacts.update", artifacts });
    written.push(relativePath);
  }
  return written;
}
