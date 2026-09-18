import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { TangentContext, type TangentContextValue } from "./context";
import { defaultChannelUrl, loadEmbedRuntime } from "./loader";
import type {
  AnchorProtocolMap,
  ColorScheme,
  HostUIComponentMap,
  TangentProviderElementLike,
} from "./types";

export interface TangentProviderProps {
  /** Tangent origin (optionally with a mount prefix), e.g. `https://tangent.example`. */
  baseUrl: string;
  /** Overrides the runtime channel URL (defaults to `${baseUrl}/embed/v1/tangent-elements.js`). */
  channelUrl?: string;
  /** Returns a bearer token for API/socket auth. May be sync or async. */
  getToken?: () => string | undefined | Promise<string | undefined>;
  /** `light`, `dark`, or `system`. Defaults to `light`. */
  colorScheme?: ColorScheme;
  /** Unstable per-token overrides keyed by Tangent's internal names. */
  tokens?: Record<string, string>;
  /** Overrides the Socket.IO origin (defaults to same-origin as the API base). */
  socketUrl?: string;
  /** Overrides the Socket.IO path (defaults to `/socket.io`). */
  socketPath?: string;
  /** Disambiguates when a page mounts more than one provider. */
  instance?: string;
  /**
   * Host-owned UI components, keyed by extension name. A matching
   * `tangent-ui:<name>` message block, composer panel, or {@link BundledUISlot}
   * renders the host component directly (no sandboxed Web Worker). The host
   * takes full responsibility for the component.
   */
  uiComponents?: HostUIComponentMap;
  /**
   * Host-owned anchor components, keyed by protocol scheme (no `://`). A
   * markdown link like `entity://123` renders the mapped component instead of a
   * plain link. `prompt://` is reserved and cannot be overridden.
   */
  anchorProtocols?: AnchorProtocolMap;
  children?: ReactNode;
}

/**
 * Loads the Tangent embed runtime once, owns the shared configuration (API base,
 * token getter, theme), and renders `<tangent-provider>` so descendant `<Chat>`
 * elements resolve the runtime. Children mount only after the runtime is ready.
 */
export function TangentProvider({
  baseUrl,
  channelUrl,
  getToken,
  colorScheme,
  tokens,
  socketUrl,
  socketPath,
  instance,
  uiComponents,
  anchorProtocols,
  children,
}: TangentProviderProps) {
  const url = channelUrl ?? defaultChannelUrl(baseUrl);
  const ref = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [readyPromise] = useState(() => loadEmbedRuntime(url));

  useEffect(() => {
    let active = true;
    void readyPromise.then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [readyPromise]);

  useEffect(() => {
    const element = ref.current as TangentProviderElementLike | null;
    if (!element || !ready) return;
    element.config = { apiBase: baseUrl, socketUrl, socketPath, getToken };
  }, [ready, baseUrl, socketUrl, socketPath, getToken]);

  useEffect(() => {
    const element = ref.current as TangentProviderElementLike | null;
    if (!element || !ready) return;
    element.theme = { colorScheme, tokens };
  }, [ready, colorScheme, tokens]);

  useEffect(() => {
    const element = ref.current as TangentProviderElementLike | null;
    if (!element || !ready) return;
    element.hostExtensions = {
      uiNames: Object.keys(uiComponents ?? {}),
      anchorProtocols: Object.keys(anchorProtocols ?? {}),
    };
  }, [ready, uiComponents, anchorProtocols]);

  const context: TangentContextValue = {
    getProvider: () => ref.current as TangentProviderElementLike | null,
    ready: readyPromise,
    uiComponents: uiComponents ?? {},
    anchorProtocols: anchorProtocols ?? {},
  };

  return (
    <TangentContext.Provider value={context}>
      <tangent-provider ref={ref} instance={instance}>
        {ready ? children : null}
      </tangent-provider>
    </TangentContext.Provider>
  );
}
