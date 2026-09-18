import { Text } from "@tangent/ui-primitives/typography";

import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";
import { WindowHeaderContent } from "./WindowHeaderContent";

export function ResourcesWindowHeader() {
  const { resources } = useSessionChatWindowsContext();

  return (
    <WindowHeaderContent
      icon="Library"
      title="Resources"
      suffix={
        resources.length > 0 ? (
          <Text size="xs" tone="subdued">
            {resources.length}
          </Text>
        ) : null
      }
    />
  );
}
