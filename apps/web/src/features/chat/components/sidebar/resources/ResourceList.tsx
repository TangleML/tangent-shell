import type { Resource } from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import {
  RESOURCE_ICON,
  resourceSubtitle,
} from "@/features/chat/model/resources";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Truncating } from "@/shared/ui/patterns/truncating";

interface ResourceListProps {
  resources: Resource[];
  /**
   * Opens a resource whose bytes are viewable (a `file` or `artifact`). Omitted
   * for kinds with no viewer (`memory`, `attachment`), which read as inert rows.
   */
  onOpen?: (resource: Resource) => void;
}

/** Whether a resource kind has a viewer the list can open. */
function isOpenable(resource: Resource): boolean {
  return resource.kind === "file" || resource.kind === "artifact";
}

/**
 * Read-only sidebar list of the session's catalogued content — pinned
 * artifacts, human attachments, memory documents, and workspace files — surfaced
 * from the resource catalog regardless of which mechanism produced it. A
 * viewable `file`/`artifact` opens its tab; other kinds are display-only. The
 * pin/unpin flow stays on the Assets list; this view only surfaces the catalog.
 */
export function ResourceList({ resources, onOpen }: ResourceListProps) {
  if (resources.length === 0) {
    return (
      <Box padding="base">
        <EmptyState
          size="sm"
          title=""
          description="Artifacts, attachments, memory, and workspace files the session holds show up here."
        />
      </Box>
    );
  }

  return (
    <Box padding="sm">
      <BlockStack as="ul" gap="1">
        {resources.map((resource) => {
          const openable = onOpen && isOpenable(resource);
          return (
            <ListRow
              key={resource.id}
              as="li"
              density="cozy"
              gap="2"
              hoverable={Boolean(openable)}
              onClick={openable ? () => onOpen?.(resource) : undefined}
              prefix={
                <Box
                  background="info-subtle"
                  blockSize="full"
                  paddingInline="sm"
                >
                  <InlineStack fill blockAlign="center" align="center">
                    <Icon
                      name={RESOURCE_ICON[resource.kind]}
                      size="lg"
                      tone="subdued"
                    />
                  </InlineStack>
                </Box>
              }
            >
              <BlockStack gap="0">
                <Text size="xs" tone="subdued" truncate>
                  {resourceSubtitle(resource)}
                </Text>
                <Truncating>
                  <Text
                    size="sm"
                    weight="medium"
                    truncate
                    title={resource.name}
                  >
                    {resource.name}
                  </Text>
                </Truncating>
              </BlockStack>
            </ListRow>
          );
        })}
      </BlockStack>
    </Box>
  );
}
