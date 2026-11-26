import { Icon, type IconName } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import type { ReactNode } from "react";

import { formatMessageTime } from "@/features/chat/model/messageTime";
import { Surface, type SurfaceTone } from "@/shared/ui/patterns/surface";

interface CalloutMessageProps {
  icon: IconName;
  /** Says where it came from, e.g. `Report from Scout`; the time follows. */
  title: string;
  tone?: SurfaceTone;
  createdAt: string;
  actions: ReactNode;
  children: ReactNode;
}

/**
 * A message set apart from the turns around it, as a callout saying where it
 * came from, for one no member wrote in this thread.
 */
export function CalloutMessage({
  icon,
  title,
  tone,
  createdAt,
  actions,
  children,
}: CalloutMessageProps) {
  return (
    <Surface tone={tone}>
      <BlockStack gap="1">
        <InlineStack gap="2" wrap="nowrap">
          <Icon name={icon} size="xs" tone="subdued" />
          <Text size="xs" weight="medium" tone="subdued" truncate>
            {`${title} · ${formatMessageTime(createdAt)}`}
          </Text>
          {actions}
        </InlineStack>
        {children}
      </BlockStack>
    </Surface>
  );
}
