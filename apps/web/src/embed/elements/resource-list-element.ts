import { createElement, type ReactNode } from "react";

import { EmbeddedResourceList } from "../components/EmbeddedResourceList";
import type { EmbedResourcePayload } from "../types";
import { EmbeddedElement } from "./embeddedElement";

const TAG = "tangent-resource-list";

/**
 * Mounts the embedded resource list. `sessionId` and `agentId` are
 * properties/attributes; `open-resource` is emitted as a composed `CustomEvent`
 * for the npm wrapper to surface as an `on*` prop.
 */
export class TangentResourceListElement extends EmbeddedElement {
  private currentSessionId = "";
  private currentAgentId = "";

  static get observedAttributes(): string[] {
    return ["session-id", "agent-id"];
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

  set agentId(value: string) {
    this.currentAgentId = value ?? "";
    this.rerender();
  }
  get agentId(): string {
    return this.currentAgentId;
  }

  attributeChangedCallback(name: string, _prev: string, next: string): void {
    if (name === "session-id") this.sessionId = next ?? "";
    if (name === "agent-id") this.agentId = next ?? "";
  }

  protected renderContent(): ReactNode {
    if (!this.currentSessionId) return null;
    return createElement(EmbeddedResourceList, {
      sessionId: this.currentSessionId,
      agentId: this.currentAgentId || undefined,
      onOpen: (resource: EmbedResourcePayload) =>
        this.emit("open-resource", { ...resource }),
    });
  }
}

/** Idempotently registers `<tangent-resource-list>` (safe across re-import). */
export function defineResourceListElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentResourceListElement);
  }
}
