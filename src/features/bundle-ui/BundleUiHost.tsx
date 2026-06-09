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
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Text } from "@/shared/ui/typography";

import {
  BUNDLE_UI_ELEMENT_NAMES,
  hostAdapters,
} from "./components/host-registry";
import { createHostBridge } from "./hostBridge";
import type { BundleUiKind, HostBridge, WorkerApi } from "./types";

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
}: BundleUiHostProps) {
  const receiver = useMemo(() => new RemoteReceiver(), []);
  const [failed, setFailed] = useState(false);

  // Keep the latest props/callback reachable from the stable host bridge.
  const propsRef = useRef<Record<string, unknown>>({});
  const sendPromptRef = useRef<((text: string) => void) | undefined>(undefined);
  useEffect(() => {
    propsRef.current = props ?? {};
    sendPromptRef.current = onSendPrompt;
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
