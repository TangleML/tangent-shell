import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import { useTangentContext } from "./context";
import type { TangentBundledUiElementLike } from "./types";

export interface BundledUISlotProps {
  /** URL of the compiled bundle component JS (the worker fallback). */
  moduleUrl: string;
  /**
   * When set and registered in `TangentProvider`'s `uiComponents`, the host's
   * component renders directly (no sandbox worker) and `moduleUrl` is ignored.
   */
  name?: string;
  /** Which surface the component renders on. */
  kind: "message" | "panel";
  /** JSON props for a `message` component (ignored for `panel`). */
  props?: Record<string, unknown>;
  /** localStorage namespace for the component's persisted state (optional). */
  stateNamespace?: string;
  /** A `panel` component composed a prompt. */
  onSendPrompt?: (text: string) => void;
  /** The component asked to collapse its host surface. */
  onCollapse?: () => void;
  /** Disambiguates the provider when a page mounts more than one. */
  instance?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders a sandboxed bundle-UI component as `<tangent-bundled-ui>`. The
 * component runs in a Web Worker and streams a remote-dom tree; prompts and
 * collapse requests surface via `onSendPrompt` / `onCollapse`.
 */
export function BundledUISlot({
  moduleUrl,
  name,
  kind,
  props,
  stateNamespace,
  onSendPrompt,
  onCollapse,
  instance,
  className,
  style,
}: BundledUISlotProps) {
  const ref = useRef<HTMLElement | null>(null);
  const { uiComponents } = useTangentContext();
  const HostComponent = name ? uiComponents[name] : undefined;

  useEffect(() => {
    const element = ref.current as TangentBundledUiElementLike | null;
    if (element) element.moduleUrl = moduleUrl;
  }, [moduleUrl]);

  useEffect(() => {
    const element = ref.current as TangentBundledUiElementLike | null;
    if (element) element.kind = kind;
  }, [kind]);

  useEffect(() => {
    const element = ref.current as TangentBundledUiElementLike | null;
    if (element) element.props = props;
  }, [props]);

  useEffect(() => {
    const element = ref.current as TangentBundledUiElementLike | null;
    if (element) element.stateNamespace = stateNamespace;
  }, [stateNamespace]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleSend = (event: Event) => {
      onSendPrompt?.((event as CustomEvent<{ text: string }>).detail.text);
    };
    const handleCollapse = () => onCollapse?.();
    element.addEventListener("send-prompt", handleSend);
    element.addEventListener("collapse", handleCollapse);
    return () => {
      element.removeEventListener("send-prompt", handleSend);
      element.removeEventListener("collapse", handleCollapse);
    };
  }, [onSendPrompt, onCollapse]);

  if (HostComponent && name) {
    return (
      <div className={className} style={style}>
        <HostComponent
          name={name}
          kind={kind}
          props={props ?? {}}
          onSendPrompt={onSendPrompt}
          onCollapse={onCollapse}
        />
      </div>
    );
  }

  return (
    <tangent-bundled-ui
      ref={ref}
      instance={instance}
      className={className}
      style={style}
    />
  );
}
