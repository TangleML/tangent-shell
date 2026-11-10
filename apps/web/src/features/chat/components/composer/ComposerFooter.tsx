import { Box } from "@tangent/ui-primitives/box";
import { InlineStack } from "@tangent/ui-primitives/layout";
import type { ReactNode } from "react";

interface ComposerFooterProps {
  /** The agents, files and host pills. */
  pills: ReactNode;
  modelPicker: ReactNode;
}

/**
 * The row above every chat input — Prime's and each sub-agent's — so the pills
 * and model picker stay put as the user moves between threads. The pills' slot
 * renders even when empty, keeping the picker right-aligned.
 */
export function ComposerFooter({ pills, modelPicker }: ComposerFooterProps) {
  return (
    <Box paddingInline="base" paddingBlock="sm">
      <InlineStack align="space-between" gap="2" wrap="nowrap">
        <InlineStack gap="1.5" wrap="nowrap">
          {pills}
        </InlineStack>
        {modelPicker}
      </InlineStack>
    </Box>
  );
}
