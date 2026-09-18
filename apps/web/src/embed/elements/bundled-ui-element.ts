import { createElement, type ReactNode } from "react";

import type { BundleUiKind } from "@/features/bundle-ui/types";

import { EmbeddedBundledUi } from "../components/EmbeddedBundledUi";
import { EmbeddedElement } from "./embeddedElement";

const TAG = "tangent-bundled-ui";

/**
 * Mounts a sandboxed bundle-UI component. `moduleUrl`, `kind`, `props`, and
 * `stateNamespace` are properties/attributes; `send-prompt` and `collapse` are
 * emitted as composed `CustomEvent`s for the npm wrapper to surface as `on*`
 * props.
 */
export class TangentBundledUiElement extends EmbeddedElement {
  private currentModuleUrl = "";
  private currentKind: BundleUiKind = "panel";
  private currentProps: Record<string, unknown> | undefined;
  private currentStateNamespace = "";

  static get observedAttributes(): string[] {
    return ["module-url", "kind", "state-namespace"];
  }

  protected get tag(): string {
    return TAG;
  }

  set moduleUrl(value: string) {
    this.currentModuleUrl = value ?? "";
    this.rerender();
  }
  get moduleUrl(): string {
    return this.currentModuleUrl;
  }

  set kind(value: BundleUiKind) {
    this.currentKind = value === "message" ? "message" : "panel";
    this.rerender();
  }
  get kind(): BundleUiKind {
    return this.currentKind;
  }

  set props(value: Record<string, unknown> | undefined) {
    this.currentProps = value ?? undefined;
    this.rerender();
  }
  get props(): Record<string, unknown> | undefined {
    return this.currentProps;
  }

  set stateNamespace(value: string) {
    this.currentStateNamespace = value ?? "";
    this.rerender();
  }
  get stateNamespace(): string {
    return this.currentStateNamespace;
  }

  attributeChangedCallback(name: string, _prev: string, next: string): void {
    const value = next ?? "";
    if (name === "module-url") this.moduleUrl = value;
    if (name === "kind") this.kind = value as BundleUiKind;
    if (name === "state-namespace") this.stateNamespace = value;
  }

  protected renderContent(): ReactNode {
    if (!this.currentModuleUrl) return null;
    return createElement(EmbeddedBundledUi, {
      moduleUrl: this.currentModuleUrl,
      kind: this.currentKind,
      props: this.currentProps,
      stateNamespace: this.currentStateNamespace || undefined,
      onSendPrompt: (text: string) => this.emit("send-prompt", { text }),
      onCollapse: () => this.emit("collapse", {}),
    });
  }
}

/** Idempotently registers `<tangent-bundled-ui>` (safe across re-import). */
export function defineBundledUiElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentBundledUiElement);
  }
}
