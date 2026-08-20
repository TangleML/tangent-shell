import type { EmbedApiConfig } from "@/shared/lib/basePath";

import { createRuntime, registerRuntime } from "../runtime";
import type { EmbedTheme, TangentRuntime } from "../types";

const TAG = "tangent-provider";

/**
 * Owns the shared {@link TangentRuntime} for its subtree. Renders nothing of its
 * own (`display: contents`) and keeps its light-DOM children — the host app,
 * including any `<tangent-chat>` — in the normal flow, so children resolve the
 * runtime by climbing to `closest("tangent-provider")`.
 */
export class TangentProviderElement extends HTMLElement {
  runtime: TangentRuntime | null = null;
  private currentConfig: EmbedApiConfig = {};
  private currentTheme: EmbedTheme = {};

  set config(value: EmbedApiConfig) {
    this.currentConfig = value ?? {};
    this.sync();
  }
  get config(): EmbedApiConfig {
    return this.currentConfig;
  }

  set theme(value: EmbedTheme) {
    this.currentTheme = value ?? {};
    this.runtime?.setTheme(this.currentTheme);
  }
  get theme(): EmbedTheme {
    return this.currentTheme;
  }

  connectedCallback(): void {
    this.style.display = "contents";
    this.sync();
  }

  private sync(): void {
    if (!this.isConnected) return;
    if (this.runtime) {
      this.runtime.setConfig(this.currentConfig);
      this.runtime.setTheme(this.currentTheme);
      return;
    }
    this.runtime = createRuntime({
      config: this.currentConfig,
      theme: this.currentTheme,
    });
    registerRuntime(this.getAttribute("instance"), this.runtime);
  }
}

/** Idempotently registers `<tangent-provider>` (safe across HMR/re-import). */
export function defineProviderElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentProviderElement);
  }
}
