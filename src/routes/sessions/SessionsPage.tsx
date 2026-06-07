import { Link } from "@tanstack/react-router";

import { useCreateSession } from "@/features/sessions/hooks/useCreateSession";
import { useSessions } from "@/features/sessions/hooks/useSessions";
import { Button } from "@/shared/ui/button";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Page } from "@/shared/ui/patterns/page";
import { Surface } from "@/shared/ui/patterns/surface";
import { Heading, Paragraph, Text } from "@/shared/ui/typography";

export function SessionsPage() {
  const { data: sessions, isLoading, error } = useSessions();
  const createSession = useCreateSession();

  return (
    <Page>
      <BlockStack gap="6">
        <InlineStack align="space-between" blockAlign="center" wrap="nowrap">
          <BlockStack gap="1">
            <Heading level={1} size="xl" weight="bold">
              Sessions
            </Heading>
            <Paragraph size="sm" tone="subdued">
              Each session runs a Pi coding agent in its own scoped folder.
            </Paragraph>
          </BlockStack>
          <Button
            onClick={() => createSession.mutate({})}
            disabled={createSession.isPending}
          >
            {createSession.isPending ? "Creating..." : "New session"}
          </Button>
        </InlineStack>

        {error ? (
          <Paragraph size="sm" tone="critical">
            Failed to load sessions: {error.message}
          </Paragraph>
        ) : null}

        {isLoading ? (
          <Paragraph size="sm" tone="subdued">
            Loading sessions...
          </Paragraph>
        ) : null}

        {sessions && sessions.length === 0 ? (
          <Paragraph size="sm" tone="subdued">
            No sessions yet. Create one to get started.
          </Paragraph>
        ) : null}

        <BlockStack as="ul" gap="2" align="stretch">
          {sessions?.map((session) => (
            <li key={session.id}>
              <Link to="/sessions/$sessionId" params={{ sessionId: session.id }}>
                <Surface hoverable>
                  <BlockStack gap="0.5">
                    <Text weight="medium">{session.name}</Text>
                    <Text font="mono" size="xs" tone="subdued">
                      {session.rootPath}
                    </Text>
                  </BlockStack>
                </Surface>
              </Link>
            </li>
          ))}
        </BlockStack>
      </BlockStack>
    </Page>
  );
}
