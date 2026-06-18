import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Text } from "@/shared/ui/typography";

import { SessionSwitcherList } from "./SessionSwitcherList";
import { useSessionSwitcher } from "./useSessionSwitcher";

interface SessionSwitcherProps {
  currentSessionId: string;
}

export function SessionSwitcher({ currentSessionId }: SessionSwitcherProps) {
  const { sessions, onSelect, onDeleted } =
    useSessionSwitcher(currentSessionId);

  if (!sessions || sessions.length === 0) {
    return null;
  }

  return (
    <BlockStack gap="0">
      <Toolbar chrome="light" gap="2" align="space-between">
        <InlineStack gap="2" blockAlign="center" wrap="nowrap">
          <Icon name="Layers" size="md" tone="subdued" />
          <Text size="xs" weight="medium">
            Other sessions
          </Text>
        </InlineStack>
      </Toolbar>
      <Box
        inlineSize="full"
        maxBlockSize="md"
        overflow="scroll-y"
        data-testid="session-switcher"
      >
        <Box inlineSize="full" paddingBlock="sm" paddingInline="sm">
          <SessionSwitcherList
            sessions={sessions}
            onSelect={onSelect}
            selectedId={currentSessionId}
            onDeleted={onDeleted}
          />
        </Box>
      </Box>
    </BlockStack>
  );
}
