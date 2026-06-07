import { useState } from "react";

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
  // Auto-open while reasoning, auto-collapse once done — but preserve a manual
  // toggle until `done` flips again. The override remembers which `done` value
  // it applies to, so a change in `done` transparently falls back to the auto
  // behavior without needing a state-syncing effect.
  const [override, setOverride] = useState<{
    open: boolean;
    done: boolean;
  } | null>(null);
  const open = override && override.done === done ? override.open : !done;

  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => setOverride({ open: value, done })}
    >
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
