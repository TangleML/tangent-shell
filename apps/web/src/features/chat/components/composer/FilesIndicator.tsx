import type { Asset } from "@/features/chat/model/assets";
import { plural } from "@/shared/lib/utils";

import { AssetList } from "../sidebar/assets/AssetList";
import { ComposerPill } from "./ComposerPill";

interface FilesIndicatorProps {
  sessionId: string;
  assets: Asset[];
  onOpen: (asset: Asset) => void;
  onUnpin: (path: string) => void;
}

function pillLabel(files: number, triggers: number): string {
  return [
    files > 0 ? plural(files, "file") : undefined,
    triggers > 0 ? plural(triggers, "trigger") : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Composer-anchored pill for everything this chat has made — its pinned files,
 * working files included, and its triggers — so the project's own lists can
 * keep to finished work.
 */
export function FilesIndicator({
  sessionId,
  assets,
  onOpen,
  onUnpin,
}: FilesIndicatorProps) {
  if (assets.length === 0) return null;

  const files = assets.flatMap((asset) =>
    asset.kind === "trigger" ? [] : [asset],
  );
  const triggers = assets.length - files.length;

  return (
    <ComposerPill
      icon="Files"
      label={pillLabel(files.length, triggers)}
      heading="Made in this chat"
      clearLabel={triggers > 0 ? "Clear files" : "Clear all"}
      onClear={
        files.length > 0
          ? () => {
              for (const file of files) onUnpin(file.path);
            }
          : undefined
      }
    >
      {(close) => (
        <AssetList
          sessionId={sessionId}
          assets={assets}
          selectedId={null}
          onOpen={(asset) => {
            close();
            onOpen(asset);
          }}
          onUnpin={onUnpin}
        />
      )}
    </ComposerPill>
  );
}
