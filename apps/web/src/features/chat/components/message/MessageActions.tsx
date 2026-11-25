import { InlineStack } from "@tangent/ui-primitives/layout";

import { HoverReveal } from "@/shared/ui/patterns/hover-reveal";
import { IconButton } from "@/shared/ui/patterns/icon-button";

import { CopyButton } from "./CopyButton";

interface MessageActionsProps {
  content?: string;
  messageLink?: string;
  onCollapse?: () => void;
}

export function MessageActions({
  content,
  messageLink,
  onCollapse,
}: MessageActionsProps) {
  return (
    <HoverReveal>
      <InlineStack gap="0.5" wrap="nowrap">
        {content !== undefined && <CopyButton content={content} />}
        {messageLink && <CopyButton content={messageLink} kind="link" />}
        {onCollapse ? (
          <IconButton
            icon="ChevronsDownUp"
            size="xs"
            variant="ghost"
            aria-label="Collapse message"
            onClick={onCollapse}
          />
        ) : null}
      </InlineStack>
    </HoverReveal>
  );
}
