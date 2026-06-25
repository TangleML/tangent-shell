import { Box } from "@tangent/ui-primitives/box";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import type { ReactNode } from "react";

import type { Asset } from "@/features/chat/model/assets";
import { ASSET_ICON, assetSubtitle } from "@/features/chat/model/assets";
import { HoverReveal } from "@/shared/ui/patterns/hover-reveal";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Truncating } from "@/shared/ui/patterns/truncating";

interface AssetCardProps {
  asset: Asset;
  /** Whether this asset's tab is the active one. */
  selected: boolean;
  /** Opens (or focuses) the asset's in-app tab. */
  onOpen: () => void;
  /** Quick actions revealed on hover (kind-specific; built by the caller). */
  actions?: ReactNode;
}

/**
 * A rich, condensed card representing one session asset (page, file, trigger,
 * and — in future — app). The leading icon conveys the asset type; the title
 * and subtitle describe it; hover-revealed actions handle inline management.
 * Clicking the card opens the asset in its own tab.
 */
export function AssetCard({
  asset,
  selected,
  onOpen,
  actions,
}: AssetCardProps) {
  return (
    <ListRow
      as="li"
      density="cozy"
      gap="2"
      hoverable
      selected={selected}
      onClick={onOpen}
      prefix={
        <Box background="info-subtle" blockSize="full" paddingInline="sm">
          <InlineStack fill blockAlign="center" align="center">
            <Icon name={ASSET_ICON[asset.kind]} size="lg" tone="subdued" />
          </InlineStack>
        </Box>
      }
    >
      <BlockStack gap="0">
        <InlineStack gap="2" blockAlign="center" wrap="nowrap">
          <Text size="xs" tone="subdued" truncate>
            {assetSubtitle(asset)}
          </Text>
          {actions ? <HoverReveal>{actions}</HoverReveal> : null}
        </InlineStack>
        <Truncating>
          <Text size="sm" weight="medium" truncate title={asset.title}>
            {asset.title}
          </Text>
        </Truncating>
      </BlockStack>
    </ListRow>
  );
}
