import type { Trigger } from "@tangent/shared/contracts";

import { SidebarColumn } from "@/features/chat/components/SidebarColumn";
import type { Asset } from "@/features/chat/model/assets";
import { useDeleteTrigger } from "@/features/triggers/hooks/useDeleteTrigger";
import { useUpdateTrigger } from "@/features/triggers/hooks/useUpdateTrigger";
import { apiUrl } from "@/shared/lib/basePath";
import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Text } from "@/shared/ui/typography";

import { AssetCard } from "./AssetCard";

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

/** Stops a row action from also triggering the card's open-on-click. */
function withStop(handler: () => void) {
  return (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    handler();
  };
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

  function renderActions(asset: Asset) {
    if (asset.kind !== "trigger") {
      return (
        <IconButton
          icon="PinOff"
          size="xs"
          tone="critical"
          aria-label="Unpin artifact"
          onClick={withStop(() => onUnpin(asset.path))}
        />
      );
    }

    const { trigger } = asset;
    return (
      <InlineStack gap="1" wrap="nowrap" blockAlign="center">
        <IconButton
          icon="Power"
          size="xs"
          tone={trigger.enabled ? "success" : "default"}
          disabled={triggerBusy}
          aria-label={trigger.enabled ? "Disable trigger" : "Enable trigger"}
          onClick={withStop(() =>
            update.mutate({
              triggerId: trigger.id,
              input: { enabled: !trigger.enabled },
            }),
          )}
        />
        {trigger.kind === "callback" && trigger.callbackPath ? (
          <IconButton
            icon="Copy"
            size="xs"
            aria-label="Copy callback URL"
            onClick={withStop(() => copyCallback(trigger))}
          />
        ) : null}
        <IconButton
          icon="Trash2"
          size="xs"
          tone="critical"
          disabled={triggerBusy}
          aria-label="Delete trigger"
          onClick={withStop(() => remove.mutate(trigger.id))}
        />
      </InlineStack>
    );
  }

  return (
    <SidebarColumn>
      <Toolbar chrome="light" gap="2" align="space-between">
        <InlineStack gap="2" blockAlign="center" wrap="nowrap">
          <Icon name="LayoutGrid" size="md" tone="subdued" />
          <Text size="xs" weight="medium">
            Assets
          </Text>
        </InlineStack>
        {assets.length > 0 ? (
          <Text size="xs" tone="subdued">
            {assets.length}
          </Text>
        ) : null}
      </Toolbar>
      <ScrollRegion axis="y">
        {assets.length === 0 ? (
          <Box padding="base">
            <EmptyState
              icon="LayoutGrid"
              title="No assets yet"
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
                  actions={renderActions(asset)}
                />
              ))}
            </BlockStack>
          </Box>
        )}
      </ScrollRegion>
    </SidebarColumn>
  );
}
