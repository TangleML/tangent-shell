import type { Session } from "@shared/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useRef } from "react";

import { useAgentBundles } from "@/features/agent-bundles/hooks/useAgentBundles";
import { useCreateSession } from "@/features/sessions/hooks/useCreateSession";
import { useSessions } from "@/features/sessions/hooks/useSessions";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Breadcrumbs, CrumbCurrent } from "@/shared/ui/patterns/breadcrumbs";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import {
  SideNav,
  SideNavLink,
  SideNavSection,
} from "@/shared/ui/patterns/side-nav";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/patterns/table";
import { WorkArea } from "@/shared/ui/patterns/work-area";
import { Heading, Paragraph, Text } from "@/shared/ui/typography";

export function SessionsPage() {
  const { data: sessions, isLoading, error } = useSessions();
  const { data: bundles } = useAgentBundles();
  const createSession = useCreateSession();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openSession = (session: Session) =>
    void navigate({
      to: "/sessions/$sessionId",
      params: { sessionId: session.id },
    });

  const createBlank = () =>
    createSession.mutate({}, { onSuccess: openSession });

  const onPickConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file still fires `change`.
    event.target.value = "";
    if (file) createSession.mutate({ config: file }, { onSuccess: openSession });
  };

  const startFromBundle = (bundleId: string, name: string) =>
    createSession.mutate({ bundleId, name }, { onSuccess: openSession });

  const sidebar = (
    <SideNav>
      <SideNavSection title="Navigate">
        <SideNavLink to="/sessions">
          <Icon name="LayoutGrid" size="sm" />
          All sessions
        </SideNavLink>
        <SideNavLink to="/agent-bundles">
          <Icon name="Package" size="sm" />
          Agent bundles
        </SideNavLink>
      </SideNavSection>

      <SideNavSection title="New session">
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          hidden
          onChange={onPickConfig}
        />
        <Button
          fullWidth
          align="start"
          onClick={createBlank}
          disabled={createSession.isPending}
        >
          <Icon name="Plus" size="sm" />
          Blank session
        </Button>
        <Button
          fullWidth
          align="start"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={createSession.isPending}
        >
          <Icon name="Upload" size="sm" />
          From config (.zip)
        </Button>
      </SideNavSection>

      {bundles && bundles.length > 0 ? (
        <SideNavSection title="From bundle">
          {bundles.map((bundle) => (
            <Button
              key={bundle.id}
              fullWidth
              align="start"
              truncate
              variant="ghost"
              onClick={() => startFromBundle(bundle.id, bundle.name)}
              disabled={createSession.isPending}
            >
              <Icon name="Package" size="sm" />
              <span>{bundle.name}</span>
            </Button>
          ))}
        </SideNavSection>
      ) : null}
    </SideNav>
  );

  return (
    <WorkArea sidebar={sidebar}>
      <BlockStack gap="6">
        <BlockStack gap="2">
          <Breadcrumbs>
            <CrumbCurrent>Sessions</CrumbCurrent>
          </Breadcrumbs>
          <InlineStack align="space-between" blockAlign="center" wrap="nowrap">
            <BlockStack gap="1">
              <Heading level={1} size="xl" weight="bold">
                Sessions
              </Heading>
              <Paragraph size="sm" tone="subdued">
                Each session runs a Pi coding agent in its own scoped folder.
              </Paragraph>
            </BlockStack>
            <Button onClick={createBlank} disabled={createSession.isPending}>
              {createSession.isPending ? "Creating..." : "New session"}
            </Button>
          </InlineStack>
        </BlockStack>

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
          <EmptyState
            icon="FolderOpen"
            title="No sessions yet"
            description="Create one from the sidebar to get started."
          />
        ) : null}

        {sessions && sessions.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Bundle</TableHead>
                <TableHead>Path</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id} onClick={() => openSession(session)}>
                  <TableCell>
                    <Text weight="medium">{session.name}</Text>
                  </TableCell>
                  <TableCell>
                    {session.config ? (
                      <Text size="sm" tone="subdued">
                        {session.config.name} v{session.config.version}
                      </Text>
                    ) : (
                      <Text size="sm" tone="subdued">
                        &mdash;
                      </Text>
                    )}
                  </TableCell>
                  <TableCell>
                    <Text font="mono" size="xs" tone="subdued">
                      {session.rootPath}
                    </Text>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </BlockStack>
    </WorkArea>
  );
}
