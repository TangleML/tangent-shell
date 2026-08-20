import type { IconName } from "@tangent/ui-primitives/icon";

export type Theme = "light" | "dark" | "xterm" | "piforge";

export interface ThemeOption {
  value: Theme;
  label: string;
  icon: IconName;
}

export const THEMES: ThemeOption[] = [
  { value: "light", label: "Light", icon: "Sun" },
  { value: "dark", label: "Dark", icon: "Moon" },
  { value: "xterm", label: "Xterm", icon: "Terminal" },
  { value: "piforge", label: "PiForge", icon: "Flame" },
];

export const DEFAULT_THEME: Theme = "light";

export const THEME_STORAGE_KEY = "tangent-theme";

function isTheme(value: unknown): value is Theme {
  return (
    value === "light" ||
    value === "dark" ||
    value === "xterm" ||
    value === "piforge"
  );
}

/**
 * Apply a theme by toggling classes on `target` (the document root by default).
 * Light uses no class, dark adds `dark`, and the dark-derived themes (xterm,
 * piforge) add `dark <theme>` so `dark:` utilities keep working while the
 * theme's token overrides win (they are defined after `.dark`).
 *
 * Embedded mode passes its shadow-root wrapper as `target` so themes scope to
 * the embed rather than the host document.
 */
export function applyTheme(
  theme: Theme,
  target: HTMLElement = document.documentElement,
): void {
  const root = target;
  root.classList.remove("dark", "xterm", "piforge");
  if (theme === "dark" || theme === "xterm" || theme === "piforge") {
    root.classList.add("dark");
  }
  if (theme === "xterm" || theme === "piforge") {
    root.classList.add(theme);
  }
}

export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) {
      return stored;
    }
  } catch {
    // localStorage can be unavailable (private mode, SSR); fall back to default.
  }
  return DEFAULT_THEME;
}

export function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persistence is best-effort; ignore storage failures.
  }
}
