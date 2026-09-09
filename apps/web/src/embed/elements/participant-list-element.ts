import { createElement, type ReactNode } from "react";

import { EmbeddedParticipantList } from "../components/EmbeddedParticipantList";
import type { EmbedMuteTogglePayload } from "../types";
import { EmbeddedElement } from "./embeddedElement";

const TAG = "tangent-participant-list";

/**
 * Mounts the embedded participant list. `sessionId` and `agentId` are
 * properties/attributes; `toggle-mute` is emitted as a composed `CustomEvent`
 * for the npm wrapper to surface as an `on*` prop.
 */
export class TangentParticipantListElement extends EmbeddedElement {
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
    return createElement(EmbeddedParticipantList, {
      sessionId: this.currentSessionId,
      agentId: this.currentAgentId || undefined,
      onToggleMute: (toggle: EmbedMuteTogglePayload) =>
        this.emit("toggle-mute", { ...toggle }),
    });
  }
}

/** Idempotently registers `<tangent-participant-list>` (safe across re-import). */
export function defineParticipantListElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentParticipantListElement);
  }
}
