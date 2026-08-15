import { Text } from "@tangent/ui-primitives/typography";

import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";
import { WindowHeaderContent } from "./WindowHeaderContent";

export function ParticipantsWindowHeader() {
  const { participants } = useSessionChatWindowsContext();
  const present = participants.filter((p) => !p.revokedAt).length;

  return (
    <WindowHeaderContent
      icon="Users"
      title="Participants"
      suffix={
        present > 0 ? (
          <Text size="xs" tone="subdued">
            {present}
          </Text>
        ) : null
      }
    />
  );
}
