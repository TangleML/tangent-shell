import { observer } from "mobx-react-lite";

import { Window } from "./Window";
import { useWindowStore } from "./WindowStoreContext";

/**
 * Container component that renders floating (undocked) windows.
 * Docked windows are rendered by their respective DockArea components.
 */
export const WindowContainer = observer(function WindowContainer() {
  const windows = useWindowStore();
  return (
    <>
      {windows.getFloatingWindowIds().map((windowId) => (
        <Window key={windowId} windowId={windowId} />
      ))}
    </>
  );
});
