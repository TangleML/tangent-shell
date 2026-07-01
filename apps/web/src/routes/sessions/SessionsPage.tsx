import type { Session } from "@tangent/shared/contracts";
import { Checkbox } from "@tangent/ui-primitives/checkbox";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { Paragraph } from "@tangent/ui-primitives/typography";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useAgentBundles } from "@/features/agent-bundles/hooks/useAgentBundles";
import { useCreateSession } from "@/features/sessions/hooks/useCreateSession";
import { useSessions } from "@/features/sessions/hooks/useSessions";
import { env } from "@/shared/config/env";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { PageHeader } from "@/shared/ui/patterns/page-header";
import { WorkArea } from "@/shared/ui/patterns/work-area";

import { NewSessionButton } from "./components/NewSessionButton";
import { SessionsTable } from "./components/SessionsTable";

export function SessionsPage() {
  const { data: sessions, isLoading, error } = useSessions();
  const { data: bundles } = useAgentBundles();
  const {
    mutate: createSession,
    isPending: isCreating,
    isError: isCreateError,
    error: createError,
  } = useCreateSession();
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);

  const archivedCount = sessions?.filter((s) => s.archived).length ?? 0;
  const visibleSessions = showArchived
    ? sessions
    : sessions?.filter((session) => !session.archived);
  const defaultBundle = bundles?.find(
    (bundle) => bundle.id === env.defaultSessionBundleId,
  );
  const defaultBundleName = defaultBundle?.name ?? env.defaultSessionBundleId;

  const openSession = (session: Session) =>
    void navigate({
      to: "/sessions/$sessionId",
      params: { sessionId: session.id },
    });

  const startDefaultBundle = () =>
    createSession(
      { bundleId: env.defaultSessionBundleId, name: defaultBundleName },
      { onSuccess: openSession },
    );

  const startFromBundle = (bundleId: string, name: string) =>
    createSession({ bundleId, name }, { onSuccess: openSession });

  const newSessionButton = (
    <NewSessionButton
      bundles={bundles}
      creating={isCreating}
      onStartDefaultBundle={startDefaultBundle}
      onStartFromBundle={startFromBundle}
    />
  );

  return (
    <WorkArea>
      <BlockStack gap="6">
        <PageHeader
          title="Sessions"
          description="Conversations with your agents. Start with the default bundle, choose another bundle, or resume where you left off."
        />

        {error ? (
          <Paragraph size="sm" tone="critical">
            Failed to load sessions: {error.message}
          </Paragraph>
        ) : null}

        {isCreateError ? (
          <Paragraph size="sm" tone="critical">
            Failed to create session: {createError.message}
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
            description="Start with the default bundle or choose another agent bundle to get started."
            action={newSessionButton}
          />
        ) : null}

        {sessions && sessions.length > 0 ? (
          <BlockStack gap="2">
            {archivedCount > 0 ? (
              <Checkbox
                checked={showArchived}
                label={`Show archived (${archivedCount})`}
                onCheckedChange={setShowArchived}
              />
            ) : null}
            <SessionsTable
              sessions={visibleSessions ?? []}
              onOpen={openSession}
            />
            {newSessionButton}
          </BlockStack>
        ) : null}
      </BlockStack>
    </WorkArea>
  );
}
