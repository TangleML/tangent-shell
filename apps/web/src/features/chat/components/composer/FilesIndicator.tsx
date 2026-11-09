import { Box } from "@tangent/ui-primitives/box";
import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@tangent/ui-primitives/popover";
import { Text } from "@tangent/ui-primitives/typography";
import { useId, useState } from "react";

import type { Asset } from "@/features/chat/model/assets";

import { AssetList } from "../sidebar/assets/AssetList";

interface FilesIndicatorProps {
  sessionId: string;
  assets: Asset[];
  onOpen: (asset: Asset) => void;
  onUnpin: (path: string) => void;
}

function pillLabel(assets: Asset[]): string {
  const triggers = assets.filter((asset) => asset.kind === "trigger").length;
  const files = assets.length - triggers;
  const parts = [
    files > 0 ? (files === 1 ? "1 file" : `${files} files`) : undefined,
    triggers > 0
      ? triggers === 1
        ? "1 trigger"
        : `${triggers} triggers`
      : undefined,
  ];
  return parts.filter(Boolean).join(" · ");
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
  const [open, setOpen] = useState(false);
  const headingId = useId();

  if (assets.length === 0) {
    if (open) setOpen(false);
    return null;
  }

  const files = assets.flatMap((asset) =>
    asset.kind === "trigger" ? [] : [asset],
  );
  const hasTriggers = files.length < assets.length;

  const clearFiles = () => {
    for (const file of files) onUnpin(file.path);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="xs">
          <Icon name="Files" size="xs" />
          {pillLabel(assets)}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top">
        <BlockStack gap="0.5" align="stretch">
          <Box paddingInline="sm" paddingBlockStart="xs">
            <InlineStack align="space-between" gap="2" wrap="nowrap">
              <Text id={headingId} size="xs" weight="medium" tone="subdued">
                Made in this chat
              </Text>
              {files.length > 0 && (
                <Button variant="ghost" size="xs" onClick={clearFiles}>
                  {hasTriggers ? "Clear files" : "Clear all"}
                </Button>
              )}
            </InlineStack>
          </Box>
          <Box maxBlockSize="xl" overflow="scroll-y">
            <AssetList
              sessionId={sessionId}
              assets={assets}
              selectedId={null}
              onOpen={(asset) => {
                setOpen(false);
                onOpen(asset);
              }}
              onUnpin={onUnpin}
            />
          </Box>
        </BlockStack>
      </PopoverContent>
    </Popover>
  );
}
