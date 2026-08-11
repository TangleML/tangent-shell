import type { Session } from "@tangent/shared/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useAgentBundles } from "@/features/agent-bundles/hooks/useAgentBundles";
import { useCreateSession } from "@/features/sessions/hooks/useCreateSession";
import { env } from "@/shared/config/env";

import { NewSessionButton } from "../sessions/components/NewSessionButton";

export function NewSessionTopNavAction() {
  const { data: bundles } = useAgentBundles();
  const {
    mutate: createSession,
    isPending: isCreating,
    isError,
    error,
  } = useCreateSession();
  const navigate = useNavigate();
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

  return (
    <>
      {isError ? (
        <span
          role="alert"
          className="text-xs text-destructive"
          title={error.message}
        >
          Failed to create session
        </span>
      ) : null}
      <NewSessionButton
        bundles={bundles}
        creating={isCreating}
        onStartDefaultBundle={startDefaultBundle}
        onStartFromBundle={startFromBundle}
      />
    </>
  );
}
