import { Text } from "@/shared/ui/typography";

import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";
import { WindowHeaderContent } from "./WindowHeaderContent";

export function AgentsWindowHeader() {
  const { agents } = useSessionChatWindowsContext();

  return (
    <WindowHeaderContent
      icon="Bot"
      title="Agents"
      suffix={
        <Text size="xs" tone="subdued">
          {agents.length}
        </Text>
      }
    />
  );
}
