import type { Session } from "@tangent/shared/contracts";
import { Checkbox } from "@tangent/ui-primitives/checkbox";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { Paragraph } from "@tangent/ui-primitives/typography";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useSessions } from "@/features/sessions/hooks/useSessions";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { PageHeader } from "@/shared/ui/patterns/page-header";
import { WorkArea } from "@/shared/ui/patterns/work-area";

import { SessionsTable } from "./components/SessionsTable";

export function SessionsPage() {
  const { data: sessions, isLoading, error } = useSessions();
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
          </BlockStack>
        ) : null}
      </BlockStack>
    </WorkArea>
  );
}
