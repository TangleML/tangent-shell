import { Box } from "@tangent/ui-primitives/box";
import { BlockStack } from "@tangent/ui-primitives/layout";

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
      <Box
        inlineSize="full"
        paddingBlock="sm"
        paddingInline="sm"
        data-testid="session-switcher"
      >
        <SessionSwitcherList
          sessions={sessions}
          onSelect={onSelect}
          selectedId={currentSessionId}
          onDeleted={onDeleted}
        />
      </Box>
    </BlockStack>
  );
}
