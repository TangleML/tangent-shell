import {
  addResource,
  createSession,
  listResources,
  removeResource,
} from "@/features/sessions/api/sessionsApi";
import { configureEmbedApi, type EmbedApiConfig } from "@/shared/lib/basePath";

import type {
  EmbedTheme,
  NewSessionOptions,
  NewSessionResult,
  PendingPrompt,
  TangentRuntime,
} from "./types";

/**
 * Builds a runtime for one `<tangent-provider>`. Applies the API config
 * globally (single-provider is the common case; last write wins) and owns the
 * pending-prompt store plus the `newSession` composition.
 */
export function createRuntime(init: {
  config: EmbedApiConfig;
  theme: EmbedTheme;
}): TangentRuntime {
  let config = init.config;
  let theme = init.theme;
  const pending = new Map<string, PendingPrompt>();
  const themeListeners = new Set<(theme: EmbedTheme) => void>();

  configureEmbedApi(config);

  return {
    get config() {
      return config;
    },
    get theme() {
      return theme;
    },
    setConfig(next) {
      config = next;
      configureEmbedApi(next);
    },
    setTheme(next) {
      theme = next;
      for (const listener of themeListeners) listener(next);
    },
    subscribeTheme(listener) {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    queuePrompt(sessionId, prompt) {
      pending.set(sessionId, prompt);
    },
    takePendingPrompt(sessionId) {
      const value = pending.get(sessionId);
      pending.delete(sessionId);
      return value;
    },
    async newSession(
      prompt: string,
      bundleId: string,
      options?: NewSessionOptions,
    ): Promise<NewSessionResult> {
      const session = await createSession({
        bundleId,
        name: options?.name,
        resources: options?.resources,
      });
      pending.set(session.id, {
        prompt,
        delivery: options?.delivery,
        attachments: options?.attachments,
        model: options?.model,
        thinkingDepth: options?.thinkingDepth,
      });
      return { sessionId: session.id };
    },
    listResources(sessionId) {
      return listResources(sessionId);
    },
    addResource(sessionId, input) {
      return addResource(sessionId, input);
    },
    removeResource(sessionId, uri) {
      return removeResource(sessionId, uri);
    },
  };
}

const registry = new Map<string, TangentRuntime>();
let defaultRuntime: TangentRuntime | null = null;

/** Registers a runtime under an optional `instance` id and as the default. */
export function registerRuntime(
  instance: string | null,
  runtime: TangentRuntime,
): void {
  if (instance) registry.set(instance, runtime);
  defaultRuntime = runtime;
}

/** Resolves a runtime by `instance` id, falling back to the default. */
export function resolveRuntime(
  instance?: string | null,
): TangentRuntime | null {
  if (instance) return registry.get(instance) ?? null;
  return defaultRuntime;
}
