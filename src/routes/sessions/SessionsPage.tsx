import { Link } from "@tanstack/react-router";
import { useRef } from "react";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPickBundle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file still fires `change`.
    event.target.value = "";
    if (file) createSession.mutate({ config: file });
  };

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
          <InlineStack gap="2" blockAlign="center" wrap="nowrap">
            <Button variant="ghost" asChild>
              <Link to="/agent-bundles">Agent bundles</Link>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              hidden
              onChange={onPickBundle}
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={createSession.isPending}
            >
              New from config
            </Button>
            <Button
              onClick={() => createSession.mutate({})}
              disabled={createSession.isPending}
            >
              {createSession.isPending ? "Creating..." : "New session"}
            </Button>
          </InlineStack>
        </InlineStack>

        {error ? (
          <Paragraph size="sm" tone="critical">
            Failed to load sessions: {error.message}
          </Paragraph>
        ) : null}

        {createSession.isError ? (
          <Paragraph size="sm" tone="critical">
            Failed to create session: {createSession.error.message}
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
              <Link
                to="/sessions/$sessionId"
                params={{ sessionId: session.id }}
              >
                <Surface hoverable>
                  <BlockStack gap="0.5">
                    <InlineStack gap="2" blockAlign="center" wrap="nowrap">
                      <Text weight="medium">{session.name}</Text>
                      {session.config ? (
                        <Text size="xs" tone="subdued">
                          {session.config.name} v{session.config.version}
                        </Text>
                      ) : null}
                    </InlineStack>
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
