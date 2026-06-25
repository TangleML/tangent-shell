import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";

import { roleLabelFor } from "./messageRole";

/**
 * A single collapsed message: just the author and an Expand affordance, with no
 * bubble. Not selectable/copyable (the content is hidden until expanded).
 */
interface CollapsedMessageProps {
  message: ChatMessageType;
  onExpand: () => void;
}

export function CollapsedMessage({ message, onExpand }: CollapsedMessageProps) {
  // Raw <div> for the `select-none` escape hatch (collapsed content is hidden
  // and intentionally not selectable/copyable), exempt from
  // tangle-ui/no-classname-on-primitives.
  return (
    <div className="select-none">
      <InlineStack gap="2" blockAlign="center" wrap="nowrap">
        <Text size="xs" weight="medium" tone="subdued">
          {message.author.name}
          {roleLabelFor(message)}
        </Text>
        <Button variant="ghost" size="xs" onClick={onExpand}>
          <Icon name="ChevronDown" size="xs" />
          Expand
        </Button>
      </InlineStack>
    </div>
  );
}
