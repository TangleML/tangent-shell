import { createElement, type ReactNode } from "react";

import { EmbeddedAgentList } from "../components/EmbeddedAgentList";
import type { EmbedAgentPayload } from "../types";
import { EmbeddedElement } from "./embeddedElement";

const TAG = "tangent-agent-list";

/**
 * Mounts the embedded agent list. `sessionId` and `selectedId` are
 * properties/attributes; `open-agent` and `remove-agent` are emitted as
 * composed `CustomEvent`s for the npm wrapper to surface as `on*` props.
 */
export class TangentAgentListElement extends EmbeddedElement {
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
    return createElement(EmbeddedAgentList, {
      sessionId: this.currentSessionId,
      selectedId: this.currentSelectedId || undefined,
      onOpen: (agent: EmbedAgentPayload) =>
        this.emit("open-agent", { ...agent }),
      onRemove: (id: string) => this.emit("remove-agent", { id }),
    });
  }
}

/** Idempotently registers `<tangent-agent-list>` (safe across re-import). */
export function defineAgentListElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentAgentListElement);
  }
}
