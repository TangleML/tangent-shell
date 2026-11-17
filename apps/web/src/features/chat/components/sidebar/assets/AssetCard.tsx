import type { Asset } from "@/features/chat/model/assets";
import { ASSET_ICON, assetSubtitle } from "@/features/chat/model/assets";
import { ListItem, type ListItemAction } from "@/shared/ui/patterns/list-item";

interface AssetCardProps {
  asset: Asset;
  /** Whether this asset's tab is the active one. */
  selected: boolean;
  /** Opens (or focuses) the asset's in-app tab. */
  onOpen: () => void;
  /** Quick actions revealed on hover (kind-specific; built by the caller). */
  actions?: ListItemAction[];
}

/**
 * One session asset (page, file, trigger, and — in future — app) in the
 * sidebar. The icon conveys the asset type, hover actions handle inline
 * management, and clicking opens the asset in its own tab.
 */
export function AssetCard({
  asset,
  selected,
  onOpen,
  actions,
}: AssetCardProps) {
  return (
    <ListItem
      icon={ASSET_ICON[asset.kind]}
      title={asset.title}
      subtitle={assetSubtitle(asset)}
      flair={
        asset.kind === "trigger" && !asset.trigger.enabled
          ? { kind: "pill", label: "Off" }
          : undefined
      }
      selected={selected}
      onOpen={onOpen}
      actions={actions}
    />
  );
}
