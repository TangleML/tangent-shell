// local primitive — a sub-agent tab in the SessionChat tab strip. Driven by the
// live roster (not user-opened), so it has no close button; the raw <span>
// carries the scoped classNames for truncation the Tangle primitives don't
// express on a Radix tab trigger.
import type { SubagentStatus } from "@shared/contracts";

import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { InlineStack } from "@/shared/ui/layout";
import { TabsTrigger } from "@/shared/ui/tabs";

import { StatusDot } from "./StatusDot";

interface SubagentTabTriggerProps {
  value: string;
  name: string;
  status: SubagentStatus;
  /** Whether this sub-agent's run is in flight. */
  busy: boolean;
}

/** Status-tinted leading icon mirroring the sub-agent's lifecycle. */
function StatusIcon({
  status,
  busy,
}: {
  status: SubagentStatus;
  busy: boolean;
}) {
  if (busy) {
    return <StatusDot variant="busy" />;
  }

  switch (status) {
    case "active":
      return <StatusDot variant="active" />;
    case "completed":
      return <Icon name="Check" size="xs" tone="subdued" />;
    case "killed":
      return <Icon name="Ban" size="xs" tone="subdued" />;
    case "error":
      return <Icon name="TriangleAlert" size="xs" tone="critical" />;
  }
}

export function SubagentTabTrigger({
  value,
  name,
  status,
  busy,
}: SubagentTabTriggerProps) {
  return (
    <TabsTrigger value={value} className="max-w-44">
      <Box paddingInline="base" paddingBlock="sm" border="sm" inlineSize="full">
        <InlineStack gap="2" blockAlign="center" wrap="nowrap">
          <Icon name="Bot" size="xs" tone="subdued" />
          <span className="min-w-0 truncate">{name}</span>
          <StatusIcon status={status} busy={busy} />
        </InlineStack>
      </Box>
    </TabsTrigger>
  );
}
