// local primitive — a closeable sub-agent tab in the SessionChat tab strip.
// Composes the Tabs primitive's TabsTrigger with an overlaid close button and a
// live status indicator; the raw <div>/<span>/<button> wrappers carry the
// scoped classNames needed to position the close affordance and truncate the
// name, which the Tangle primitives don't express on a Radix tab trigger.
import type { SubagentStatus } from "@tangent/shared/contracts";

import { Icon } from "@/shared/ui/icon";
import { TabsTrigger } from "@/shared/ui/tabs";

import { AgentStatusIndicator } from "./AgentStatusIndicator";

interface AgentTabTriggerProps {
  value: string;
  name: string;
  status: SubagentStatus;
  /** Whether this sub-agent's run is in flight. */
  busy: boolean;
  onClose: () => void;
}

export function AgentTabTrigger({
  value,
  name,
  status,
  busy,
  onClose,
}: AgentTabTriggerProps) {
  return (
    <div className="relative inline-flex items-center">
      <TabsTrigger value={value} className="max-w-44 pr-7">
        <Icon name="Bot" size="xs" tone="subdued" />
        <span className="min-w-0 truncate">{name}</span>
        <AgentStatusIndicator status={status} busy={busy} />
      </TabsTrigger>
      <button
        type="button"
        aria-label={`Close ${name}`}
        title={`Close ${name}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="absolute right-1.5 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Icon name="X" size="xs" />
      </button>
    </div>
  );
}
