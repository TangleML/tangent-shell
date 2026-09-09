/** Protocol version range this wrapper understands. */
const SUPPORTED_PROTOCOL = { min: 1, max: 1 };

const loaders = new Map<string, Promise<void>>();

/** The default channel URL for the runtime bundle served from Tangent's origin. */
export function defaultChannelUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/embed/v1/tangent-elements.js`;
}

/**
 * Imports the remote runtime module once per URL (idempotent). The import
 * registers the `tangent-*` custom elements as a side effect. The specifier is
 * a runtime value so host bundlers do not try to resolve it at build time.
 */
export function loadEmbedRuntime(url: string): Promise<void> {
  const existing = loaders.get(url);
  if (existing) return existing;
  const loading = import(/* @vite-ignore */ /* webpackIgnore: true */ url).then(
    () => warnOnProtocolMismatch(),
  );
  loaders.set(url, loading);
  return loading;
}

function warnOnProtocolMismatch(): void {
  const reported = (
    globalThis as { __TANGENT_EMBED__?: { protocolVersion?: number } }
  ).__TANGENT_EMBED__?.protocolVersion;
  if (reported == null) return;
  if (reported < SUPPORTED_PROTOCOL.min || reported > SUPPORTED_PROTOCOL.max) {
    console.warn(
      `[tangent] embed runtime protocol v${reported} is outside the range ` +
        `@tangent/embed-react supports (v${SUPPORTED_PROTOCOL.min}-v${SUPPORTED_PROTOCOL.max}). ` +
        `Update the package to match the runtime.`,
    );
  }
}
