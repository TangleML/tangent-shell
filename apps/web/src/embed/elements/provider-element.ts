import type { EmbedApiConfig } from "@/shared/lib/basePath";

import { createRuntime, registerRuntime } from "../runtime";
import type { EmbedTheme, HostExtensionKeys, TangentRuntime } from "../types";

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
  private currentHostExtensions: HostExtensionKeys = {
    uiNames: [],
    anchorProtocols: [],
  };

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

  set hostExtensions(value: HostExtensionKeys) {
    this.currentHostExtensions = value ?? { uiNames: [], anchorProtocols: [] };
    this.runtime?.setHostExtensions(this.currentHostExtensions);
  }
  get hostExtensions(): HostExtensionKeys {
    return this.currentHostExtensions;
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
      this.runtime.setHostExtensions(this.currentHostExtensions);
      return;
    }
    this.runtime = createRuntime({
      config: this.currentConfig,
      theme: this.currentTheme,
    });
    this.runtime.setHostExtensions(this.currentHostExtensions);
    registerRuntime(this.getAttribute("instance"), this.runtime);
  }
}

/** Idempotently registers `<tangent-provider>` (safe across HMR/re-import). */
export function defineProviderElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentProviderElement);
  }
}
