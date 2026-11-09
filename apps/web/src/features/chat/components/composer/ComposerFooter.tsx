import { Box } from "@tangent/ui-primitives/box";
import { InlineStack } from "@tangent/ui-primitives/layout";
import type { ReactNode } from "react";

interface ComposerFooterProps {
  agentsPill: ReactNode;
  modelPicker: ReactNode;
}

/**
 * The row above every chat input — Prime's and each sub-agent's — so the agents
 * pill and model picker stay put as the user moves between threads. The pill's
 * slot renders even when empty, keeping the picker right-aligned.
 */
export function ComposerFooter({
  agentsPill,
  modelPicker,
}: ComposerFooterProps) {
  return (
    <Box paddingInline="base" paddingBlock="sm">
      <InlineStack align="space-between" gap="2" wrap="nowrap">
        <InlineStack gap="1.5" wrap="nowrap">
          {agentsPill}
        </InlineStack>
        {modelPicker}
      </InlineStack>
    </Box>
  );
}
