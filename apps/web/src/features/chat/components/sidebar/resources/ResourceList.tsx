import type { Resource } from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { BlockStack } from "@tangent/ui-primitives/layout";

import {
  RESOURCE_ICON,
  resourceSubtitle,
} from "@/features/chat/model/resources";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { ListItem } from "@/shared/ui/patterns/list-item";

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
          title="Nothing catalogued yet"
          description="Artifacts, attachments, memory, and workspace files the session holds show up here."
        />
      </Box>
    );
  }

  return (
    <Box padding="sm">
      <BlockStack as="ul" gap="1">
        {resources.map((resource) => (
          <ListItem
            key={resource.id}
            icon={RESOURCE_ICON[resource.kind]}
            title={resource.name}
            subtitle={resourceSubtitle(resource)}
            onOpen={
              onOpen && isOpenable(resource)
                ? () => onOpen(resource)
                : undefined
            }
          />
        ))}
      </BlockStack>
    </Box>
  );
}
