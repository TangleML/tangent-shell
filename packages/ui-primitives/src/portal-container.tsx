import { createContext, useContext } from "react";

/**
 * Target container for Radix portals (dropdown, popover, tooltip). Defaults to
 * `null`, which Radix resolves to `document.body` — the standalone SPA is
 * unaffected. Embedded mode provides an element inside its shadow tree (an
 * overlay root) so portalled overlays stay styled and isolated.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext);
}
