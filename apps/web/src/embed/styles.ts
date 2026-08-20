import memoryMessageCss from "@/features/chat/components/message/MemoryMessage.css?inline";
import embedCss from "@/index.css?inline";
import { applyTheme, type Theme } from "@/shared/theme/theme";

import type { EmbedTheme } from "./types";

/**
 * `:host` supplies what the standalone app's `html`/`body` normally would: the
 * base layer targets `body` (background/foreground) and preflight targets
 * `html` (font stack), and neither selector matches inside a shadow root.
 */
const HOST_BASE = `
:host {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background-color: var(--background);
  color: var(--foreground);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`;

let sharedSheet: CSSStyleSheet | null = null;
let propertiesHoisted = false;

/** Token blocks use `:root {}`; map them onto the shadow host. */
function rewriteRootToHost(css: string): string {
  return css.replace(/:root\b/g, ":host");
}

/**
 * Tailwind v4 declares its `--tw-*` defaults with `@property`, which is
 * document-scoped and silently ignored inside a shadow root
 * (tailwindcss#15005). Hoist those rules into the document so transforms,
 * gradients, and shadows work. They are all `--tw-*` prefixed, so they cannot
 * collide with host tokens.
 */
function hoistPropertyRules(sheet: CSSStyleSheet): void {
  if (propertiesHoisted) return;
  propertiesHoisted = true;
  const chunks: string[] = [];
  for (const rule of Array.from(sheet.cssRules)) {
    if (rule.constructor.name === "CSSPropertyRule") chunks.push(rule.cssText);
  }
  if (chunks.length === 0) return;
  const docSheet = new CSSStyleSheet();
  docSheet.replaceSync(chunks.join("\n"));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, docSheet];
}

/** Builds (once) and returns the shared adopted stylesheet for embed shadows. */
export function getEmbedStyleSheet(): CSSStyleSheet {
  if (sharedSheet) return sharedSheet;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(rewriteRootToHost(embedCss) + memoryMessageCss + HOST_BASE);
  hoistPropertyRules(sheet);
  sharedSheet = sheet;
  return sheet;
}

/** Adopts the shared embed stylesheet into a shadow root (idempotent). */
export function adoptEmbedStyles(root: ShadowRoot): void {
  const sheet = getEmbedStyleSheet();
  if (!root.adoptedStyleSheets.includes(sheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
}

function resolveColorScheme(scheme: EmbedTheme["colorScheme"]): Theme {
  if (scheme === "dark") return "dark";
  if (scheme === "system") {
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
}

/** Applies the resolved color scheme and any token overrides to `target`. */
export function applyEmbedTheme(theme: EmbedTheme, target: HTMLElement): void {
  applyTheme(resolveColorScheme(theme.colorScheme), target);
  for (const [name, value] of Object.entries(theme.tokens ?? {})) {
    target.style.setProperty(name.startsWith("--") ? name : `--${name}`, value);
  }
}

let overlayWrapper: HTMLDivElement | null = null;

/**
 * A shared, document-level overlay layer with its own shadow root and the same
 * adopted styles, so portalled menus/tooltips paint over host chrome while
 * staying styled and isolated. Radix positions content with `position: fixed`,
 * so the zero-size wrapper does not need to fill the viewport.
 */
export function ensureOverlayContainer(): HTMLElement {
  if (overlayWrapper?.isConnected) return overlayWrapper;
  const host = document.createElement("tangent-overlay-root");
  host.setAttribute(
    "style",
    "position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;",
  );
  const shadow = host.attachShadow({ mode: "open" });
  adoptEmbedStyles(shadow);
  const wrapper = document.createElement("div");
  shadow.append(wrapper);
  document.body.append(host);
  overlayWrapper = wrapper;
  return wrapper;
}
