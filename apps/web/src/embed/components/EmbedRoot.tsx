import { PortalContainerContext } from "@tangent/ui-primitives/portal-container";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { queryClient } from "@/shared/api/queryClient";

interface EmbedRootProps {
  /** Container Radix portals target (the shared overlay root). */
  portalContainer: HTMLElement;
}

/**
 * Provider stack for an embed element's React root. Uses the shared query
 * client (one per `embed.js` instance, so roots stay in sync) and points Radix
 * portals at the overlay root so menus/tooltips stay styled and isolated.
 */
export function EmbedRoot({
  portalContainer,
  children,
}: PropsWithChildren<EmbedRootProps>) {
  return (
    <QueryClientProvider client={queryClient}>
      <PortalContainerContext.Provider value={portalContainer}>
        {children}
      </PortalContainerContext.Provider>
    </QueryClientProvider>
  );
}
