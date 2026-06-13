import type { PinnedArtifact } from "@shared/contracts";

import { SidebarColumn } from "@/features/chat/components/SidebarColumn";
import { apiUrl } from "@/shared/lib/basePath";
import { isViewableArtifact, resolveUrl } from "@/shared/lib/markdown/artifact";
import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Truncating } from "@/shared/ui/patterns/truncating";
import { Text } from "@/shared/ui/typography";

interface PinnedArtifactListProps {
  sessionId: string;
  artifacts: PinnedArtifact[];
  /** Opens a browser-viewable artifact in an in-app tab. */
  onOpen: (url: string, title: string) => void;
  /** Unpins an artifact by its workspace-relative path. */
  onUnpin: (path: string) => void;
}

interface PinnedArtifactRowProps {
  artifact: PinnedArtifact;
  url: string;
  viewable: boolean;
  onOpen: () => void;
  onUnpin: () => void;
}

function PinnedArtifactRow({
  artifact,
  url,
  viewable,
  onOpen,
  onUnpin,
}: PinnedArtifactRowProps) {
  // Viewable artifacts open in an in-app tab; everything else opens in a new
  // browser tab for download/preview, mirroring the artifact chip behaviour.
  const open = viewable
    ? onOpen
    : () => window.open(url, "_blank", "noopener,noreferrer");

  return (
    <ListRow as="li" density="cozy" gap="2" onClick={open}>
      <Icon
        name={viewable ? "FileText" : "Paperclip"}
        size="sm"
        tone="subdued"
      />
      <Truncating>
        <Text as="p" size="sm" truncate title={artifact.title}>
          {artifact.title}
        </Text>
      </Truncating>
      <IconButton
        icon="PinOff"
        size="xs"
        tone="critical"
        aria-label="Unpin artifact"
        onClick={(event) => {
          event.stopPropagation();
          onUnpin();
        }}
      />
    </ListRow>
  );
}

/**
 * Sidebar panel listing the session's pinned artifacts for quick access.
 * Artifacts are pinned by the user (from a chat artifact chip) or by an agent
 * (via its tool); the list stays in sync over the `artifacts.update` directive,
 * so no manual refetch is needed. Hidden until at least one artifact is pinned.
 */
export function PinnedArtifactList({
  sessionId,
  artifacts,
  onOpen,
  onUnpin,
}: PinnedArtifactListProps) {
  if (artifacts.length === 0) {
    return null;
  }

  const base = apiUrl(`/api/sessions/${sessionId}/files`);

  return (
    <SidebarColumn>
      <Toolbar chrome="light" gap="2" align="space-between">
        <InlineStack gap="2" blockAlign="center" wrap="nowrap">
          <Icon name="Pin" size="md" tone="subdued" />
          <Text size="xs" weight="medium">
            Artifacts
          </Text>
        </InlineStack>
        <Text size="xs" tone="subdued">
          {artifacts.length}
        </Text>
      </Toolbar>
      <ScrollRegion axis="y">
        <Box padding="sm">
          <BlockStack as="ul" gap="1">
            {artifacts.map((artifact) => (
              <PinnedArtifactRow
                key={artifact.path}
                artifact={artifact}
                url={resolveUrl(artifact.path, base) ?? artifact.path}
                viewable={isViewableArtifact(artifact.path)}
                onOpen={() =>
                  onOpen(
                    resolveUrl(artifact.path, base) ?? artifact.path,
                    artifact.title,
                  )
                }
                onUnpin={() => onUnpin(artifact.path)}
              />
            ))}
          </BlockStack>
        </Box>
      </ScrollRegion>
    </SidebarColumn>
  );
}
