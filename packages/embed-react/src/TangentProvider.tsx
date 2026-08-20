import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { TangentContext, type TangentContextValue } from "./context";
import { defaultChannelUrl, loadEmbedRuntime } from "./loader";
import type { ColorScheme, TangentProviderElementLike } from "./types";

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

  const context: TangentContextValue = {
    getProvider: () => ref.current as TangentProviderElementLike | null,
    ready: readyPromise,
  };

  return (
    <TangentContext.Provider value={context}>
      <tangent-provider ref={ref} instance={instance}>
        {ready ? children : null}
      </tangent-provider>
    </TangentContext.Provider>
  );
}
