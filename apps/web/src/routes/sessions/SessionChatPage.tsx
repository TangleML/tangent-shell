import { BlockStack } from "@tangent/ui-primitives/layout";
import { Paragraph } from "@tangent/ui-primitives/typography";
import { useParams } from "@tanstack/react-router";
import { useEffect } from "react";

import { SessionChat } from "@/features/chat/components/SessionChat";
import { useMarkSessionViewed } from "@/features/sessions/hooks/useMarkSessionViewed";
import { useSession } from "@/features/sessions/hooks/useSession";
import { Section } from "@/shared/ui/patterns/section";

export function SessionChatPage() {
  const { sessionId } = useParams({ from: "/app/sessions/$sessionId" });
  const { error } = useSession(sessionId);

  // Also mark viewed on leave, so messages that streamed in while open are seen.
  const { mutate: markViewed } = useMarkSessionViewed();
  useEffect(() => {
    markViewed(sessionId);
    return () => markViewed(sessionId);
  }, [sessionId, markViewed]);

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
