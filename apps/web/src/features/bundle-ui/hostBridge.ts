/**
 * Host-side implementation of the {@link HostBridge} exposed to a worker.
 *
 * One bridge is created per {@link BundleUiHost} instance and passed to the
 * worker as `@quilted/threads` exports. It is the host's chance to mediate every
 * side effect: props come from the mounting component, prompts are forwarded to
 * the chat, and `fetch` is routed through the server-side egress allowlist.
 */

import { apiUrl } from "@/shared/lib/basePath";

import type {
  HostBridge,
  HostRequestInit,
  HostResponse,
  UICommand,
} from "./types";

/** Default server route that proxies allowlisted egress. */
export const EGRESS_ENDPOINT = "/api/agent-bundles/ui-egress";

export interface HostBridgeOptions {
  /** Returns the current JSON props for a `message` component. */
  getProps: () => Record<string, unknown>;
  /** Forwards a composed prompt to the chat; omitted in read-only contexts. */
  onSendPrompt?: (text: string) => void;
  /** Reads the persisted value for `key`; omitted disables `getState`. */
  loadState?: (key: string) => unknown;
  /** Persists `value` under `key`; omitted disables `setState`. */
  saveState?: (key: string, value: unknown) => void;
  /** Handles a host UI command; omitted makes `execUICommand` a no-op. */
  onUICommand?: (command: UICommand) => void;
  /** Override the egress endpoint (tests / harness). */
  egressEndpoint?: string;
}

export function createHostBridge(options: HostBridgeOptions): HostBridge {
  const endpoint = options.egressEndpoint ?? EGRESS_ENDPOINT;

  return {
    async getProps() {
      return options.getProps();
    },

    async sendPrompt(text: string) {
      const trimmed = typeof text === "string" ? text.trim() : "";
      if (!trimmed) return;
      options.onSendPrompt?.(trimmed);
    },

    async getState(key: string) {
      if (typeof key !== "string" || !key) return null;
      return options.loadState?.(key) ?? null;
    },

    async setState(key: string, value: unknown) {
      if (typeof key !== "string" || !key) return;
      options.saveState?.(key, value);
    },

    async execUICommand(command: UICommand) {
      if (!command || typeof command !== "object") return;
      options.onUICommand?.(command);
    },

    async fetch(input: string, init?: HostRequestInit): Promise<HostResponse> {
      const response = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, init }),
      });

      if (!response.ok) {
        let message = `bundle-ui egress failed (${response.status})`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // Non-JSON error body; keep the generic message.
        }
        throw new Error(message);
      }

      return (await response.json()) as HostResponse;
    },
  };
}
