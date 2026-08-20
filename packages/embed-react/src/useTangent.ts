import { useTangentContext } from "./context";
import type { NewSessionOptions, NewSessionResult } from "./types";

export interface Tangent {
  /**
   * Creates a session from a bundle and queues an opening prompt. Resolves with
   * the new `sessionId` — render `<Chat sessionId={...} />` to show it. The
   * prompt is sent by the chat once it joins, so it never races Prime.
   */
  newSession(
    prompt: string,
    bundleId: string,
    options?: NewSessionOptions,
  ): Promise<NewSessionResult>;
}

/** Access the Tangent runtime API (currently `newSession`). */
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
  };
}
