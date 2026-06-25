import { createContext, type ReactNode, useContext, useState } from "react";

import { WindowStoreImpl } from "./windowStore";

const WindowStoreContext = createContext<WindowStoreImpl | undefined>(
  undefined,
);

export function WindowStoreProvider({
  viewportTopOffset = 0,
  children,
}: {
  viewportTopOffset?: number;
  children: ReactNode;
}) {
  const [store] = useState(() => new WindowStoreImpl(viewportTopOffset));
  return <WindowStoreContext value={store}>{children}</WindowStoreContext>;
}

export function useWindowStore(): WindowStoreImpl {
  const store = useContext(WindowStoreContext);
  if (!store) {
    throw new Error("useWindowStore must be used within a WindowStoreProvider");
  }
  return store;
}
