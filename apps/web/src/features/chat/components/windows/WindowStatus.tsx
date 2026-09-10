import { Box } from "@tangent/ui-primitives/box";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Spinner } from "@tangent/ui-primitives/spinner";

import { EmptyState } from "@/shared/ui/patterns/empty-state";

/** The loading placeholder a docked window shows while its query is pending. */
export function WindowSpinner() {
  return (
    <Box padding="base">
      <InlineStack fill align="center">
        <Spinner size={20} />
      </InlineStack>
    </Box>
  );
}

interface WindowLoadErrorProps {
  title: string;
  description: string;
}

/** The placeholder a docked window shows when its query failed, so a failed
 * fetch reads as an error rather than an empty panel. */
export function WindowLoadError({ title, description }: WindowLoadErrorProps) {
  return (
    <Box padding="base">
      <EmptyState size="sm" title={title} description={description} />
    </Box>
  );
}
