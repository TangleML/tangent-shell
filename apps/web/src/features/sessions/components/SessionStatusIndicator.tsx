import { StatusDot } from "@/features/chat/components/sidebar/StatusDot";
import { useSessionStatus } from "@/features/sessions/model/sessionStatusContext";
import { SESSION_STATUS_DISPLAY } from "@/features/sessions/model/sessionStatusDisplay";
import { InlineStack } from "@/shared/ui/layout";
import { Text } from "@/shared/ui/typography";

interface SessionStatusIndicatorProps {
  sessionId: string;
}

/** Live run-status dot + label for a session, driven by the lobby socket. */
export function SessionStatusIndicator({
  sessionId,
}: SessionStatusIndicatorProps) {
  const status = useSessionStatus(sessionId);
  const { variant, label } = SESSION_STATUS_DISPLAY[status];

  return (
    <InlineStack gap="1" blockAlign="center" wrap="nowrap">
      <StatusDot variant={variant} />
      <Text size="xs" tone="subdued">
        {label}
      </Text>
    </InlineStack>
  );
}
