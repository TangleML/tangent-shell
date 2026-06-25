import { observer } from "mobx-react-lite";

import { DockedWindow } from "./components/DockedWindow";
import { FloatingWindow } from "./components/FloatingWindow";
import { WindowContextProvider } from "./ContentWindowStateContext";
import { useWindowStore } from "./WindowStoreContext";

interface WindowProps {
  windowId: string;
  docked?: boolean;
  dockIndex?: number;
}

export const Window = observer(function Window({
  windowId,
  docked = false,
  dockIndex,
}: WindowProps) {
  const windows = useWindowStore();
  const model = windows.getWindowById(windowId);
  if (!model || model.state === "hidden") return null;

  const content = windows.getWindowContent(windowId);
  const header = windows.getWindowHeader(windowId);

  return (
    <WindowContextProvider value={{ model, content, header, dockIndex }}>
      {docked ? <DockedWindow /> : <FloatingWindow />}
    </WindowContextProvider>
  );
});
