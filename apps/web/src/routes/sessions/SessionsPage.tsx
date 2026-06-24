import type { Session } from "@tangent/shared/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useAgentBundles } from "@/features/agent-bundles/hooks/useAgentBundles";
import { useCreateSession } from "@/features/sessions/hooks/useCreateSession";
import { useSessions } from "@/features/sessions/hooks/useSessions";
import { Checkbox } from "@/shared/ui/checkbox";
import { BlockStack } from "@/shared/ui/layout";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { WorkArea } from "@/shared/ui/patterns/work-area";
import { Paragraph } from "@/shared/ui/typography";

import { NewSessionButton } from "./components/NewSessionButton";
import { SessionsSidebar } from "./components/SessionsSidebar";
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

  const openSession = (session: Session) =>
    void navigate({
      to: "/sessions/$sessionId",
      params: { sessionId: session.id },
    });

  // Defer creation until the first message; the draft screen is ephemeral.
  const createBlank = () => void navigate({ to: "/sessions/new" });

  const startFromBundle = (bundleId: string, name: string) =>
    createSession({ bundleId, name }, { onSuccess: openSession });

  const pickConfig = (config: File) =>
    createSession({ config }, { onSuccess: openSession });

  const newSessionButton = (
    <NewSessionButton
      bundles={bundles}
      creating={isCreating}
      onCreateBlank={createBlank}
      onStartFromBundle={startFromBundle}
    />
  );

  const sidebar = (
    <SessionsSidebar
      bundles={bundles}
      creating={isCreating}
      onCreateBlank={createBlank}
      onPickConfig={pickConfig}
      onStartFromBundle={startFromBundle}
    />
  );

  return (
    <WorkArea sidebar={sidebar}>
      <BlockStack gap="6">
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
            description="Create one from the sidebar to get started."
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
