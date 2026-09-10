import { createContext, useContext } from "react";

import type {
  AnchorProtocolMap,
  HostUIComponentMap,
  TangentProviderElementLike,
} from "./types";

export interface TangentContextValue {
  /** The live `<tangent-provider>` element, or null before it mounts. */
  getProvider: () => TangentProviderElementLike | null;
  /** Resolves once the runtime module has loaded and elements are registered. */
  ready: Promise<void>;
  /** Host-owned UI components that replace bundle components, keyed by name. */
  uiComponents: HostUIComponentMap;
  /** Host-owned anchor components, keyed by protocol scheme. */
  anchorProtocols: AnchorProtocolMap;
}

export const TangentContext = createContext<TangentContextValue | null>(null);

export function useTangentContext(): TangentContextValue {
  const context = useContext(TangentContext);
  if (!context) {
    throw new Error("useTangent must be used within a <TangentProvider>");
  }
  return context;
}
