import type { Session } from "@tangent/shared/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useAgentBundles } from "@/features/agent-bundles/hooks/useAgentBundles";
import { useCreateSession } from "@/features/sessions/hooks/useCreateSession";
import { useSessions } from "@/features/sessions/hooks/useSessions";
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

  const openSession = (session: Session) =>
    void navigate({
      to: "/sessions/$sessionId",
      params: { sessionId: session.id },
    });

  const createBlank = () => createSession({}, { onSuccess: openSession });

  const startFromBundle = (bundleId: string, name: string) =>
    createSession({ bundleId, name }, { onSuccess: openSession });

  const pickConfig = (config: File) =>
    createSession({ config }, { onSuccess: openSession });

  const newSessionButton = (
    <NewSessionButton
      bundles={bundles}
      creating={isCreating}
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
            <SessionsTable sessions={sessions} onOpen={openSession} />
            {newSessionButton}
          </BlockStack>
        ) : null}
      </BlockStack>
    </WorkArea>
  );
}
