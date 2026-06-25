/**
 * BundleUiHost — renders a sandboxed bundle component (Phase 5).
 *
 * It boots the {@link bundle-ui worker}, wires a `@quilted/threads` channel that
 * exposes the host bridge, hands the worker a fresh `RemoteReceiver` connection,
 * and renders the streamed remote tree through the Phase-4 vocabulary map. A
 * crash in the worker or the rendered tree is contained to this instance and
 * replaced with a quiet placeholder (see `docs/bundle-ui/security.md`).
 */

import { ThreadWebWorker } from "@quilted/threads";
import {
  createRemoteComponentRenderer,
  type RemoteComponentRendererMap,
  RemoteFragmentRenderer,
  RemoteReceiver,
  RemoteRootRenderer,
} from "@remote-dom/react/host";
import { Text } from "@tangent/ui-primitives/typography";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import {
  BUNDLE_UI_ELEMENT_NAMES,
  hostAdapters,
} from "./components/host-registry";
import { createHostBridge } from "./hostBridge";
import type { BundleUiKind, HostBridge, UICommand, WorkerApi } from "./types";

/** Reads a JSON value persisted under `<namespace>:<key>`, or `null`. */
function readPersistedState(namespace: string, key: string): unknown {
  try {
    const raw = window.localStorage.getItem(`${namespace}:${key}`);
    return raw == null ? null : (JSON.parse(raw) as unknown);
  } catch {
    // Storage may be unavailable (private mode/quota) or hold invalid JSON.
    return null;
  }
}

/** Persists a JSON value under `<namespace>:<key>` (best-effort). */
function writePersistedState(
  namespace: string,
  key: string,
  value: unknown,
): void {
  try {
    window.localStorage.setItem(`${namespace}:${key}`, JSON.stringify(value));
  } catch {
    // Storage may be unavailable or over quota; persistence is best-effort.
  }
}

/**
 * Opens an `https:` destination in a new tab on the component's behalf. Anything
 * that is not an absolute `https:` URL is ignored, and the new context is
 * severed with `noopener,noreferrer` so it cannot reach back into the host.
 */
function openExternalUrl(url: unknown): void {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

const remoteComponents: RemoteComponentRendererMap = new Map([
  ...BUNDLE_UI_ELEMENT_NAMES.map(
    (name) =>
      [name, createRemoteComponentRenderer(hostAdapters[name])] as const,
  ),
  ["remote-fragment", RemoteFragmentRenderer],
]);

interface BundleUiHostProps {
  /** URL of the compiled component JS (Phase-3 asset, or a harness fixture). */
  moduleUrl: string;
  /** Which surface this component renders on. */
  kind: BundleUiKind;
  /** JSON props for a `message` component (ignored for `panel`). */
  props?: Record<string, unknown>;
  /** Called when a `panel` component composes a prompt. */
  onSendPrompt?: (text: string) => void;
  /**
   * Per-instance localStorage namespace for `host.getState`/`setState`. Each
   * component-chosen key is stored under `<stateNamespace>:<key>`. Omitted (e.g.
   * for `panel`) disables persistence.
   */
  stateNamespace?: string;
  /** Collapses the message this component is rendered in (message surface). */
  onCollapse?: () => void;
}

function Placeholder() {
  return (
    <Text size="xs" tone="subdued">
      This component could not be displayed.
    </Text>
  );
}

export function BundleUiHost({
  moduleUrl,
  kind,
  props,
  onSendPrompt,
  stateNamespace,
  onCollapse,
}: BundleUiHostProps) {
  const receiver = useMemo(() => new RemoteReceiver(), []);
  const [failed, setFailed] = useState(false);

  // Keep the latest props/callbacks reachable from the stable host bridge so a
  // changed prop/namespace never re-mounts the worker.
  const propsRef = useRef<Record<string, unknown>>({});
  const sendPromptRef = useRef<((text: string) => void) | undefined>(undefined);
  const stateNamespaceRef = useRef<string | undefined>(undefined);
  const collapseRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    propsRef.current = props ?? {};
    sendPromptRef.current = onSendPrompt;
    stateNamespaceRef.current = stateNamespace;
    collapseRef.current = onCollapse;
  });

  useEffect(() => {
    let cancelled = false;
    const worker = new Worker(
      new URL("./bundle-ui.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.addEventListener("error", (event) => {
      if (!cancelled) {
        console.error("[bundle-ui] worker error", event.message);
        setFailed(true);
      }
    });

    const bridge = createHostBridge({
      getProps: () => propsRef.current,
      onSendPrompt: (text) => sendPromptRef.current?.(text),
      loadState: (key) => {
        const namespace = stateNamespaceRef.current;
        return namespace ? readPersistedState(namespace, key) : null;
      },
      saveState: (key, value) => {
        const namespace = stateNamespaceRef.current;
        if (namespace) writePersistedState(namespace, key, value);
      },
      onUICommand: (command: UICommand) => {
        if (command.type === "collapse") collapseRef.current?.();
        if (command.type === "openUrl") openExternalUrl(command.url);
      },
    });

    const thread = new ThreadWebWorker<WorkerApi, HostBridge>(worker, {
      exports: bridge,
    });

    thread.imports
      .render(receiver.connection, { moduleUrl, kind })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("[bundle-ui] render failed", error);
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
      try {
        thread.close();
      } catch {
        // Thread may already be closed (e.g. StrictMode double-invoke).
      }
      worker.terminate();
    };
  }, [moduleUrl, kind, receiver]);

  if (failed) return <Placeholder />;

  return (
    <ErrorBoundary
      fallback={<Placeholder />}
      onError={(error) => console.error("[bundle-ui] component error", error)}
    >
      <RemoteRootRenderer receiver={receiver} components={remoteComponents} />
    </ErrorBoundary>
  );
}
