import { createElement, type ReactNode } from "react";

import { EmbeddedSessionList } from "../components/EmbeddedSessionList";
import { EmbeddedElement } from "./embeddedElement";

const TAG = "tangent-session-list";

/**
 * Mounts the embedded session list. `selectedId` is a property/attribute;
 * `select-session` and `session-deleted` are emitted as composed `CustomEvent`s
 * for the npm wrapper to surface as `on*` props.
 */
export class TangentSessionListElement extends EmbeddedElement {
  private currentSelectedId = "";

  static get observedAttributes(): string[] {
    return ["selected-id"];
  }

  protected get tag(): string {
    return TAG;
  }

  set selectedId(value: string) {
    this.currentSelectedId = value ?? "";
    this.rerender();
  }
  get selectedId(): string {
    return this.currentSelectedId;
  }

  attributeChangedCallback(name: string, _prev: string, next: string): void {
    if (name === "selected-id") this.selectedId = next ?? "";
  }

  protected renderContent(): ReactNode {
    return createElement(EmbeddedSessionList, {
      selectedId: this.currentSelectedId || undefined,
      onSelect: (id: string) => this.emit("select-session", { id }),
      onDeleted: (id: string) => this.emit("session-deleted", { id }),
    });
  }
}

/** Idempotently registers `<tangent-session-list>` (safe across re-import). */
export function defineSessionListElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentSessionListElement);
  }
}
