import { useParams } from "@tanstack/react-router";

import { SessionChat } from "@/features/chat/components/SessionChat";
import { useSession } from "@/features/sessions/hooks/useSession";
import { BlockStack } from "@/shared/ui/layout";
import { Section } from "@/shared/ui/patterns/section";
import { Paragraph } from "@/shared/ui/typography";

export function SessionChatPage() {
  const { sessionId } = useParams({ from: "/app/sessions/$sessionId" });
  const { error } = useSession(sessionId);
  return (
    <BlockStack grow>
      {error ? (
        <Section tone="critical">
          <Paragraph size="sm" tone="critical">
            {error.message}
          </Paragraph>
        </Section>
      ) : (
        <SessionChat sessionId={sessionId} />
      )}
    </BlockStack>
  );
}
