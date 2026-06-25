import { useWindowStore, type WindowOptions } from "@tangent/windows";
import { useEffect } from "react";

import { AgentsWindow } from "./AgentsWindow";
import { AgentsWindowHeader } from "./AgentsWindowHeader";
import { AssetsWindow } from "./AssetsWindow";
import { AssetsWindowHeader } from "./AssetsWindowHeader";
import { SessionSwitcherWindow } from "./SessionSwitcherWindow";
import { SessionWindow } from "./SessionWindow";
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
    store.openWindow(<SessionWindow />, {
      id: "session",
      title: "Session",
      ...SHARED_OPTIONS,
    });
    store.openWindow(<AgentsWindow />, {
      id: "agents",
      title: "Agents",
      header: <AgentsWindowHeader />,
      ...SHARED_OPTIONS,
    });
    store.openWindow(<AssetsWindow />, {
      id: "assets",
      title: "Assets",
      header: <AssetsWindowHeader />,
      ...SHARED_OPTIONS,
    });
    store.openWindow(<SessionSwitcherWindow />, {
      id: "sessions",
      title: "Sessions",
      header: <WindowHeaderContent icon="Layers" title="Other sessions" />,
      ...SHARED_OPTIONS,
    });
  }, [store]);
}
