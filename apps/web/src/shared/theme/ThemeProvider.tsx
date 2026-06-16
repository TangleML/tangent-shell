import { type PropsWithChildren, useEffect, useState } from "react";

import {
  applyTheme,
  readStoredTheme,
  type Theme,
  writeStoredTheme,
} from "./theme";
import { ThemeContext } from "./themeContext";

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    writeStoredTheme(theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
