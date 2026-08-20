import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import type { TangentBundledUiElementLike } from "./types";

export interface BundledUISlotProps {
  /** URL of the compiled bundle component JS. */
  moduleUrl: string;
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

  return (
    <tangent-bundled-ui
      ref={ref}
      instance={instance}
      className={className}
      style={style}
    />
  );
}
