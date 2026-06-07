import { Link, useParams } from "@tanstack/react-router";

import { SessionChat } from "@/features/chat/components/SessionChat";
import { useSession } from "@/features/sessions/hooks/useSession";
import { Page } from "@/shared/ui/patterns/page";
import { Section } from "@/shared/ui/patterns/section";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Truncating } from "@/shared/ui/patterns/truncating";
import { Heading, Paragraph, Text } from "@/shared/ui/typography";

export function SessionChatPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  const { data: session, error } = useSession(sessionId);

  return (
    <Page height="screen" padded={false}>
      <Toolbar as="header" chrome="light" density="comfortable" gap="3">
        <Link to="/sessions">
          <Text size="sm" tone="subdued">
            &larr; Sessions
          </Text>
        </Link>
        <Truncating>
          <Heading level={1} truncate>
            {session?.name ?? "Session"}
          </Heading>
          {session ? (
            <Paragraph font="mono" size="xs" tone="subdued" truncate>
              {session.rootPath}
            </Paragraph>
          ) : null}
        </Truncating>
      </Toolbar>

      {error ? (
        <Section tone="critical">
          <Paragraph size="sm" tone="critical">
            {error.message}
          </Paragraph>
        </Section>
      ) : (
        <SessionChat sessionId={sessionId} />
      )}
    </Page>
  );
}
