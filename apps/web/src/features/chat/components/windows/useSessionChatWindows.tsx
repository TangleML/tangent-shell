import { useWindowStore, type WindowOptions } from "@tangent/windows";
import { useEffect } from "react";

import { AgentsWindow } from "./AgentsWindow";
import { AgentsWindowHeader } from "./AgentsWindowHeader";
import { AssetsWindow } from "./AssetsWindow";
import { AssetsWindowHeader } from "./AssetsWindowHeader";
import { ParticipantsWindow } from "./ParticipantsWindow";
import { ParticipantsWindowHeader } from "./ParticipantsWindowHeader";
import { ResourcesWindow } from "./ResourcesWindow";
import { ResourcesWindowHeader } from "./ResourcesWindowHeader";
import { SessionSwitcherWindow } from "./SessionSwitcherWindow";
import { WindowHeaderContent } from "./WindowHeaderContent";
import { WorkflowWindow } from "./WorkflowWindow";
import { WorkflowWindowHeader } from "./WorkflowWindowHeader";

const SHARED_OPTIONS = {
  defaultDockState: "left",
  startVisible: true,
  persisted: true,
  disabledActions: ["close", "hide"],
} satisfies Partial<WindowOptions>;

/**
 * Opens the SessionChat panels (Agents, Assets, Resources, Sessions) as docked
 * windows exactly once. Content reads live state from {@link
 * useSessionChatWindowsContext}, so opening once is enough — re-opening with the
 * same id would re-run `bringToFront` and churn the z-order every render.
 */
export function useSessionChatWindows() {
  const store = useWindowStore();
  useEffect(() => {
    store.openWindow(<AgentsWindow />, {
      ...SHARED_OPTIONS,
      id: "agents",
      title: "Agents",
      header: <AgentsWindowHeader />,
    });
    store.openWindow(<ParticipantsWindow />, {
      ...SHARED_OPTIONS,
      id: "participants",
      title: "Participants",
      header: <ParticipantsWindowHeader />,
    });
    store.openWindow(<AssetsWindow />, {
      ...SHARED_OPTIONS,
      id: "assets",
      title: "Assets",
      header: <AssetsWindowHeader />,
    });
    store.openWindow(<ResourcesWindow />, {
      ...SHARED_OPTIONS,
      id: "resources",
      title: "Resources",
      header: <ResourcesWindowHeader />,
    });
    store.openWindow(<WorkflowWindow />, {
      ...SHARED_OPTIONS,
      id: "workflow",
      title: "Workflow",
      header: <WorkflowWindowHeader />,
    });
    store.openWindow(<SessionSwitcherWindow />, {
      ...SHARED_OPTIONS,
      id: "sessions",
      title: "Sessions",
      header: <WindowHeaderContent icon="Layers" title="Other sessions" />,
      defaultDockState: "right",
    });
  }, [store]);
}
