import type { RemoteEnvironmentInfo } from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import { ListRow } from "@/shared/ui/patterns/list-row";
import { Pill } from "@/shared/ui/patterns/pill";
import { Truncating } from "@/shared/ui/patterns/truncating";

import { PresenceDot } from "./PresenceDot";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Drops the `<sessionId>:` prefix a session-pinned dev host carries in its id. */
function environmentLabel(environmentId: string): string {
  const idx = environmentId.indexOf(":");
  return idx === -1 ? environmentId : environmentId.slice(idx + 1);
}

function environmentDetail(environment: RemoteEnvironmentInfo): string {
  const kind = environment.scoped ? "Session host" : "Dev host";
  return environment.owner ? `${kind} · ${environment.owner}` : kind;
}

/** A connected remote environment, listed read-only alongside the roster. */
export function EnvironmentRow({
  environment,
}: {
  environment: RemoteEnvironmentInfo;
}) {
  return (
    <ListRow
      as="li"
      density="cozy"
      gap="2"
      prefix={
        <Box background="info-subtle" blockSize="full" paddingInline="sm">
          <InlineStack fill>
            <Icon name="Monitor" size="lg" tone="subdued" />
          </InlineStack>
        </Box>
      }
    >
      <BlockStack align="stretch" grow>
        <InlineStack gap="2" wrap="nowrap" align="space-between" grow>
          <Truncating>
            <Text
              size="sm"
              weight="medium"
              truncate
              title={environment.environmentId}
            >
              {environmentLabel(environment.environmentId)}
            </Text>
          </Truncating>
          <InlineStack gap="1" wrap="nowrap">
            <Pill tone="subdued">{plural(environment.toolCount, "tool")}</Pill>
            <Pill tone="subdued">
              {plural(environment.subagentCount, "agent")}
            </Pill>
            <PresenceDot presence="connected" />
          </InlineStack>
        </InlineStack>
        <Text size="xs" tone="subdued" truncate>
          {environmentDetail(environment)}
        </Text>
      </BlockStack>
    </ListRow>
  );
}
