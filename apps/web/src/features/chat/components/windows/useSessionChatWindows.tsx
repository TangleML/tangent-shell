import { useWindowStore, type WindowOptions } from "@tangent/windows";
import { useEffect } from "react";

import { AgentsWindow } from "./AgentsWindow";
import { AgentsWindowHeader } from "./AgentsWindowHeader";
import { AssetsWindow } from "./AssetsWindow";
import { AssetsWindowHeader } from "./AssetsWindowHeader";
import { SessionSwitcherWindow } from "./SessionSwitcherWindow";
import { WindowHeaderContent } from "./WindowHeaderContent";

const SHARED_OPTIONS = {
  defaultDockState: "left",
  startVisible: true,
  persisted: true,
  disabledActions: ["close", "hide"],
} satisfies Partial<WindowOptions>;

/**
 * Opens the three SessionChat panels (Session, Agents, Assets) as docked
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
    store.openWindow(<AssetsWindow />, {
      ...SHARED_OPTIONS,
      id: "assets",
      title: "Assets",
      header: <AssetsWindowHeader />,
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
