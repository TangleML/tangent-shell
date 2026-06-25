import type { Session } from "@tangent/shared/contracts";
import { PI_AGENT } from "@tangent/shared/contracts";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { SessionChat } from "@/features/chat/components/SessionChat";
import { writeDraft } from "@/features/chat/model/chatDraft";
import { useCreateSession } from "@/features/sessions/hooks/useCreateSession";
import { setPendingNewSession } from "@/features/sessions/model/pendingNewSession";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";

export function NewSessionPage() {
  const { mutate: createSession, isPending } = useCreateSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Seed the detail cache to avoid a refetch flash, then swap the draft URL.
  const open = (session: Session) => {
    queryClient.setQueryData(SessionQueryKeys.Id(session.id), session);
    void navigate({
      to: "/sessions/$sessionId",
      params: { sessionId: session.id },
      replace: true,
    });
  };

  const onSend = (content: string) =>
    createSession(
      {},
      {
        onSuccess: (session) => {
          setPendingNewSession({ initialMessage: content });
          open(session);
        },
      },
    );

  const onAttach = (files: File[], content: string) =>
    createSession(
      {},
      {
        onSuccess: (session) => {
          if (content) writeDraft(session.id, PI_AGENT.id, content);
          setPendingNewSession({ files });
          open(session);
        },
      },
    );

  return (
    <BlockStack grow>
      <SessionChat
        sessionId=""
        draft
        draftActions={{ onSend, onAttach, busy: isPending }}
      />
    </BlockStack>
  );
}
