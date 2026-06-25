import type { AgentBundleMeta } from "@tangent/shared/contracts";
import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import { useNavigate } from "@tanstack/react-router";

import { agentBundleIconUrl } from "@/features/agent-bundles/api/agentBundlesApi";
import { useDeleteAgentBundle } from "@/features/agent-bundles/hooks/useDeleteAgentBundle";
import { useCreateSession } from "@/features/sessions/hooks/useCreateSession";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { IconButton } from "@/shared/ui/patterns/icon-button";

import { BundleIconImage } from "./bundle-grid";

interface AgentBundleCardProps {
  bundle: AgentBundleMeta;
}

export function AgentBundleCard({ bundle }: AgentBundleCardProps) {
  const navigate = useNavigate();
  const createSession = useCreateSession();
  const deleteBundle = useDeleteAgentBundle();

  const onUse = () => {
    createSession.mutate(
      { bundleId: bundle.id, name: bundle.name },
      {
        onSuccess: (session) => {
          void navigate({
            to: "/sessions/$sessionId",
            params: { sessionId: session.id },
          });
        },
      },
    );
  };

  const onDelete = () => {
    if (!window.confirm(`Delete agent bundle "${bundle.name}"?`)) return;
    deleteBundle.mutate(bundle.id);
  };

  return (
    <Card density="cozy">
      <CardHeader density="cozy">
        <InlineStack gap="3" blockAlign="center" wrap="nowrap">
          {bundle.hasIcon ? (
            <BundleIconImage
              src={agentBundleIconUrl(bundle.id)}
              alt={`${bundle.name} icon`}
            />
          ) : (
            <Icon name="Package" size="xl" tone="subdued" />
          )}
          <BlockStack gap="0.5">
            <CardTitle>{bundle.name}</CardTitle>
            <Text size="xs" tone="subdued" font="mono">
              v{bundle.version}
            </Text>
          </BlockStack>
        </InlineStack>
      </CardHeader>

      <CardContent density="cozy">
        <BlockStack gap="2">
          {bundle.description ? (
            <Text size="sm" tone="subdued">
              {bundle.description}
            </Text>
          ) : null}
        </BlockStack>
      </CardContent>

      <CardFooter density="cozy">
        <InlineStack
          fill
          gap="2"
          blockAlign="center"
          align="space-between"
          wrap="nowrap"
        >
          <IconButton
            icon="Trash2"
            tone="critical"
            aria-label={`Delete ${bundle.name}`}
            onClick={onDelete}
            disabled={deleteBundle.isPending}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={onUse}
            disabled={createSession.isPending}
          >
            {createSession.isPending ? "Creating..." : "Use in new session"}
          </Button>
        </InlineStack>
      </CardFooter>
    </Card>
  );
}
