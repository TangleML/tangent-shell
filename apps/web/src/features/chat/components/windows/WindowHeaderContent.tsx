import type { ReactNode } from "react";

import { Icon, type IconName } from "@/shared/ui/icon";
import { InlineStack } from "@/shared/ui/layout";
import { Text } from "@/shared/ui/typography";

interface WindowHeaderContentProps {
  icon: IconName;
  title: string;
  /** Optional right-aligned content (e.g. a count). Omit to hide it. */
  suffix?: ReactNode;
}

/**
 * Shared content for a dockable window's blended header: a leading icon, the
 * title, and an optional right-aligned suffix. Rendered by the windows package
 * inside the chrome header (see `WindowOptions.header`).
 */
export function WindowHeaderContent({
  icon,
  title,
  suffix,
}: WindowHeaderContentProps) {
  return (
    <InlineStack
      grow
      gap="2"
      blockAlign="center"
      wrap="nowrap"
      align="space-between"
    >
      <InlineStack gap="2" blockAlign="center" wrap="nowrap">
        <Icon name={icon} size="md" tone="subdued" />
        <Text size="xs" weight="medium">
          {title}
        </Text>
      </InlineStack>
      {suffix}
    </InlineStack>
  );
}
