import { Box } from "@tangent/ui-primitives/box";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import type { ReactNode } from "react";

import { Truncating } from "@/shared/ui/patterns/truncating";

interface DetailRowProps {
  label: string;
  children: ReactNode;
}

/** A labelled detail row in the trigger's definition list. */
export function DetailRow({ label, children }: DetailRowProps) {
  return (
    <InlineStack gap="3" wrap="nowrap" blockAlign="start" grow>
      <Box>
        <Text as="dt" size="sm" tone="subdued">
          {label}
        </Text>
      </Box>
      <Truncating>
        <Text as="dd" size="sm">
          {children}
        </Text>
      </Truncating>
    </InlineStack>
  );
}
