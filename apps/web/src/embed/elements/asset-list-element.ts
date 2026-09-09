import { createElement, type ReactNode } from "react";

import { EmbeddedAssetList } from "../components/EmbeddedAssetList";
import type { EmbedAssetPayload } from "../types";
import { EmbeddedElement } from "./embeddedElement";

const TAG = "tangent-asset-list";

/**
 * Mounts the embedded asset list. `sessionId` and `selectedId` are
 * properties/attributes; `open-asset` and `unpin-asset` are emitted as
 * composed `CustomEvent`s for the npm wrapper to surface as `on*` props.
 */
export class TangentAssetListElement extends EmbeddedElement {
  private currentSessionId = "";
  private currentSelectedId = "";

  static get observedAttributes(): string[] {
    return ["session-id", "selected-id"];
  }

  protected get tag(): string {
    return TAG;
  }

  set sessionId(value: string) {
    this.currentSessionId = value ?? "";
    this.rerender();
  }
  get sessionId(): string {
    return this.currentSessionId;
  }

  set selectedId(value: string) {
    this.currentSelectedId = value ?? "";
    this.rerender();
  }
  get selectedId(): string {
    return this.currentSelectedId;
  }

  attributeChangedCallback(name: string, _prev: string, next: string): void {
    if (name === "session-id") this.sessionId = next ?? "";
    if (name === "selected-id") this.selectedId = next ?? "";
  }

  protected renderContent(): ReactNode {
    if (!this.currentSessionId) return null;
    return createElement(EmbeddedAssetList, {
      sessionId: this.currentSessionId,
      selectedId: this.currentSelectedId || undefined,
      onOpen: (asset: EmbedAssetPayload) =>
        this.emit("open-asset", { ...asset }),
      onUnpin: (path: string) => this.emit("unpin-asset", { path }),
    });
  }
}

/** Idempotently registers `<tangent-asset-list>` (safe across re-import). */
export function defineAssetListElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentAssetListElement);
  }
}
