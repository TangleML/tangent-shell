import type { Trigger } from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { BlockStack } from "@tangent/ui-primitives/layout";

import type { Asset } from "@/features/chat/model/assets";
import { useDeleteTrigger } from "@/features/triggers/hooks/useDeleteTrigger";
import { useUpdateTrigger } from "@/features/triggers/hooks/useUpdateTrigger";
import { apiUrl } from "@/shared/lib/basePath";
import { EmptyState } from "@/shared/ui/patterns/empty-state";

import { AssetCard } from "./AssetCard";
import { AssetRowActions } from "./AssetRowActions";

interface AssetListProps {
  sessionId: string;
  assets: Asset[];
  /** The active tab's id, so the matching card reads as selected. */
  selectedId: string | null;
  /** Opens (or focuses) an asset's in-app tab. */
  onOpen: (asset: Asset) => void;
  /** Unpins an artifact by its workspace-relative path. */
  onUnpin: (path: string) => void;
}

/**
 * Unified sidebar list of the session's assets — pages, files, and triggers
 * (apps in future) — each rendered as a uniform {@link AssetCard}. Replaces the
 * former separate sub-agent, trigger, and pinned-artifact panels. Trigger
 * management (enable/disable, copy callback URL, delete) happens inline via
 * hover actions; artifact assets expose an unpin action.
 */
export function AssetList({
  sessionId,
  assets,
  selectedId,
  onOpen,
  onUnpin,
}: AssetListProps) {
  const update = useUpdateTrigger(sessionId);
  const remove = useDeleteTrigger(sessionId);
  const triggerBusy = update.isPending || remove.isPending;

  const copyCallback = (trigger: Trigger): void => {
    if (!trigger.callbackPath) return;
    // In dev the API lives behind the Vite proxy at API_TARGET, so the copied
    // callback URL must use that origin (not the dev server) to be reachable by
    // external callers. In production __API_ORIGIN__ is empty and the app is
    // served from the backend, so the current origin is correct.
    const base = __API_ORIGIN__ || window.location.origin;
    const url = `${base}${apiUrl(trigger.callbackPath)}`;
    void navigator.clipboard?.writeText(url);
  };

  return (
    <BlockStack align="stretch">
      {assets.length === 0 ? (
        <Box padding="base">
          <EmptyState
            size="sm"
            title=""
            description="Pages, files, and triggers Prime creates show up here."
          />
        </Box>
      ) : (
        <Box padding="sm">
          <BlockStack as="ul" gap="1">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                selected={selectedId === asset.id}
                onOpen={() => onOpen(asset)}
                actions={
                  <AssetRowActions
                    asset={asset}
                    triggerBusy={triggerBusy}
                    onUnpin={onUnpin}
                    onToggleTrigger={(trigger) =>
                      update.mutate({
                        triggerId: trigger.id,
                        input: { enabled: !trigger.enabled },
                      })
                    }
                    onCopyCallback={copyCallback}
                    onDeleteTrigger={(trigger) => remove.mutate(trigger.id)}
                  />
                }
              />
            ))}
          </BlockStack>
        </Box>
      )}
    </BlockStack>
  );
}
