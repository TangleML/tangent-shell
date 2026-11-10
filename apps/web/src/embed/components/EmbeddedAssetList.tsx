import { Box } from "@tangent/ui-primitives/box";

import { AssetList } from "@/features/chat/components/sidebar/assets/AssetList";
import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import { buildAssets, type TabAsset } from "@/features/chat/model/assets";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";

import type { EmbedAssetPayload } from "../types";

interface EmbeddedAssetListProps {
  sessionId: string;
  selectedId?: string;
  onOpen: (asset: EmbedAssetPayload) => void;
  onUnpin: (path: string) => void;
}

function toPayload(asset: TabAsset): EmbedAssetPayload {
  if (asset.kind === "trigger") {
    return {
      kind: "trigger",
      id: asset.id,
      title: asset.title,
      triggerKind: asset.trigger.kind,
      enabled: asset.trigger.enabled,
    };
  }
  return {
    kind: asset.kind,
    id: asset.id,
    title: asset.title,
    url: asset.url,
    path: asset.path,
  };
}

/**
 * The embedded asset list. `onOpen` lets the host place an artifact viewer;
 * link rows navigate on their own, so only an artifact unpin notifies the host.
 */
export function EmbeddedAssetList({
  sessionId,
  selectedId,
  onOpen,
  onUnpin,
}: EmbeddedAssetListProps) {
  const chat = useSessionChat(sessionId);
  const assets = buildAssets({
    sessionId,
    artifacts: chat.artifacts,
    triggers: chat.triggers,
  });

  return (
    <ScrollRegion>
      <Box inlineSize="full">
        <AssetList
          sessionId={sessionId}
          assets={assets}
          selectedId={selectedId ?? null}
          onOpen={(asset) => onOpen(toPayload(asset))}
          onUnpin={(key) => {
            if (chat.unpin(key) === "artifact") onUnpin(key);
          }}
        />
      </Box>
    </ScrollRegion>
  );
}
