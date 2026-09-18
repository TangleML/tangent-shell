import { useTangentContext } from "./context";
import type {
  EmbedResource,
  EmbedRuntimeHandle,
  HostResourceInput,
  NewSessionOptions,
  NewSessionResult,
} from "./types";

export interface Tangent {
  /**
   * Creates a session from a bundle and queues an opening prompt. Resolves with
   * the new `sessionId` — render `<Chat sessionId={...} />` to show it. The
   * prompt is sent by the chat once it joins, so it never races Prime. Pass
   * `options.resources` to seed memory or host entries before the agent spawns.
   */
  newSession(
    prompt: string,
    bundleId: string,
    options?: NewSessionOptions,
  ): Promise<NewSessionResult>;
  /** Lists the session's catalogued resources (memory, host entries, files). */
  listResources(sessionId: string): Promise<EmbedResource[]>;
  /**
   * Adds one resource to a session: a memory write (writes the store the agent
   * reads) or a host entry (e.g. a known pipeline). Returns the stored resource;
   * re-adding the same `uri` updates it in place.
   */
  addResource(
    sessionId: string,
    input: HostResourceInput,
  ): Promise<EmbedResource>;
  /** Removes a resource by its `uri`. Removing a memory store clears it. */
  removeResource(sessionId: string, uri: string): Promise<void>;
}

/** Resolves the ready runtime handle, or throws a clear error if unavailable. */
async function useRuntime(
  ready: Promise<void>,
  getProvider: () => { runtime?: EmbedRuntimeHandle | null } | null,
): Promise<EmbedRuntimeHandle> {
  await ready;
  const runtime = getProvider()?.runtime;
  if (!runtime) {
    throw new Error("Tangent runtime is not ready");
  }
  if (typeof runtime.addResource !== "function") {
    throw new Error(
      "This Tangent runtime does not support resources. Update the served embed runtime.",
    );
  }
  return runtime;
}

/** Access the Tangent runtime API (session + resource operations). */
export function useTangent(): Tangent {
  const context = useTangentContext();
  return {
    async newSession(prompt, bundleId, options) {
      await context.ready;
      const runtime = context.getProvider()?.runtime;
      if (!runtime) {
        throw new Error("Tangent runtime is not ready");
      }
      return runtime.newSession(prompt, bundleId, options);
    },
    async listResources(sessionId) {
      const runtime = await useRuntime(context.ready, context.getProvider);
      return runtime.listResources(sessionId);
    },
    async addResource(sessionId, input) {
      const runtime = await useRuntime(context.ready, context.getProvider);
      return runtime.addResource(sessionId, input);
    },
    async removeResource(sessionId, uri) {
      const runtime = await useRuntime(context.ready, context.getProvider);
      return runtime.removeResource(sessionId, uri);
    },
  };
}
