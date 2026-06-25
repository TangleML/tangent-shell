import { Box } from "@tangent/ui-primitives/box";
import { Button } from "@tangent/ui-primitives/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@tangent/ui-primitives/collapsible";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack } from "@tangent/ui-primitives/layout";

import { useThinkingCollapse } from "@/features/chat/hooks/useThinkingCollapse";
import { Markdown } from "@/shared/lib/markdown/Markdown";

interface ThinkingDisclosureProps {
  thinking: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Shared trigger + bordered thinking body for inline and full-bubble disclosures. */
export function ThinkingDisclosure({
  thinking,
  open,
  onOpenChange,
}: ThinkingDisclosureProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <BlockStack gap="1">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="xs">
            <Icon name={open ? "ChevronDown" : "ChevronRight"} size="xs" />
            Thinking
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Box padding="base" borderInlineStart="md" paddingInlineStart="sm">
            <Markdown size="xs" tone="subdued">
              {thinking}
            </Markdown>
          </Box>
        </CollapsibleContent>
      </BlockStack>
    </Collapsible>
  );
}

interface AgentThinkingProps {
  thinking: string;
  /**
   * Whether the agent has moved on from reasoning (the answer has started or
   * the message is finalized). Drives auto-collapse: the disclosure stays open
   * while reasoning is live and collapses once `done` flips true.
   */
  done: boolean;
}

export function AgentThinking({ thinking, done }: AgentThinkingProps) {
  const { open, onOpenChange } = useThinkingCollapse(done);

  return (
    <ThinkingDisclosure
      thinking={thinking}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}
