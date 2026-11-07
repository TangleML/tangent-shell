import type { Session } from "@tangent/shared/contracts";

import { useAgentBundles } from "@/features/agent-bundles/hooks/useAgentBundles";

export interface BundleUpdate {
  installedVersion: string;
  /** The stored bundle's version; `undefined` when it is no longer stored. */
  storedVersion?: string;
  /** The store holds one version per bundle, so any difference is an update. */
  updateAvailable: boolean;
}

/** Compares a session's installed bundle with the stored one; `undefined` for a
 * session not created from a bundle. */
export function useBundleUpdate(session: Session): BundleUpdate | undefined {
  const { data: bundles } = useAgentBundles();
  if (!session.config) return undefined;

  const installedVersion = session.config.version;
  const storedVersion = bundles?.find(
    (bundle) => bundle.id === session.config?.id,
  )?.version;
  return {
    installedVersion,
    storedVersion,
    updateAvailable:
      storedVersion !== undefined && storedVersion !== installedVersion,
  };
}
