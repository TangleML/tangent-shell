import { useThinkingCollapse } from "@/features/chat/hooks/useThinkingCollapse";
import { Markdown } from "@/shared/lib/markdown/Markdown";
import { Box } from "@/shared/ui/box";
import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import { Icon } from "@/shared/ui/icon";
import { BlockStack } from "@/shared/ui/layout";

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
