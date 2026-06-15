import type { Session } from "@shared/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useRef } from "react";

import { agentBundleIconUrl } from "@/features/agent-bundles/api/agentBundlesApi";
import { useAgentBundles } from "@/features/agent-bundles/hooks/useAgentBundles";
import { DEFAULT_BUNDLE_ID } from "@/features/sessions/constants";
import { useCreateSession } from "@/features/sessions/hooks/useCreateSession";
import { useSessions } from "@/features/sessions/hooks/useSessions";
import { BundleIconImage } from "@/routes/agent-bundles/bundle-grid";
import { Button } from "@/shared/ui/button";
import { ButtonGroup } from "@/shared/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { IconButton } from "@/shared/ui/patterns/icon-button";
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
import { Paragraph, Text } from "@/shared/ui/typography";

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
    if (file)
      createSession.mutate({ config: file }, { onSuccess: openSession });
  };

  const startFromBundle = (bundleId: string, name: string) =>
    createSession.mutate({ bundleId, name }, { onSuccess: openSession });

  const createDefaultSession = (
    <ButtonGroup aria-label="New session">
      <Button
        variant="outline"
        onClick={() => startFromBundle(DEFAULT_BUNDLE_ID, "Session")}
        disabled={createSession.isPending}
      >
        {createSession.isPending ? "Creating..." : "New session"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon="ChevronDown"
            variant="outline"
            size="lg"
            aria-label="Choose a bundle"
            disabled={createSession.isPending || !bundles?.length}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {bundles?.map((bundle) => (
            <DropdownMenuItem
              key={bundle.id}
              onSelect={() => startFromBundle(bundle.id, bundle.name)}
            >
              <InlineStack gap="2" blockAlign="center">
                {bundle.hasIcon ? (
                  <BundleIconImage
                    src={agentBundleIconUrl(bundle.id)}
                    alt=""
                    size="xs"
                  />
                ) : (
                  <Icon name="Package" size="sm" />
                )}
                <Text size="sm">{bundle.name}</Text>
              </InlineStack>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );

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
          variant="outline"
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
          variant="ghost"
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
            action={createDefaultSession}
          />
        ) : null}

        {sessions && sessions.length > 0 ? (
          <BlockStack gap="2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Bundle</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow
                    key={session.id}
                    onClick={() => openSession(session)}
                  >
                    <TableCell>
                      <Text weight="medium" truncate>
                        {session.name}
                      </Text>
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
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => openSession(session)}
                      >
                        <Icon name="ArrowRight" size="xs" tone="subdued" />
                        <Text tone="subdued">Open session</Text>
                      </Button>
                      <Button variant="ghost" size="xs" disabled>
                        <Icon name="Trash" size="xs" tone="subdued" />
                        <Text tone="subdued">Delete session</Text>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {createDefaultSession}
          </BlockStack>
        ) : null}
      </BlockStack>
    </WorkArea>
  );
}
