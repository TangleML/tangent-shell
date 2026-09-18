import { createElement, type ReactNode } from "react";

import { EmbeddedArtifactViewer } from "../components/EmbeddedArtifactViewer";
import { EmbeddedElement } from "./embeddedElement";

const TAG = "tangent-artifact-viewer";

/**
 * Mounts the embedded artifact viewer. `sessionId`, `url`, and `title` are
 * properties/attributes; `send-prompt` (a review submitted to Prime) is emitted
 * as a composed `CustomEvent` for the npm wrapper to surface as an `on*` prop.
 */
export class TangentArtifactViewerElement extends EmbeddedElement {
  private currentSessionId = "";
  private currentUrl = "";
  private currentTitle = "";

  static get observedAttributes(): string[] {
    return ["session-id", "url", "title"];
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

  set url(value: string) {
    this.currentUrl = value ?? "";
    this.rerender();
  }
  get url(): string {
    return this.currentUrl;
  }

  set title(value: string) {
    this.currentTitle = value ?? "";
    this.rerender();
  }
  get title(): string {
    return this.currentTitle;
  }

  attributeChangedCallback(name: string, _prev: string, next: string): void {
    const value = next ?? "";
    if (name === "session-id") this.sessionId = value;
    if (name === "url") this.url = value;
    if (name === "title") this.title = value;
  }

  protected renderContent(): ReactNode {
    if (!this.currentSessionId || !this.currentUrl) return null;
    return createElement(EmbeddedArtifactViewer, {
      sessionId: this.currentSessionId,
      url: this.currentUrl,
      title: this.currentTitle,
      onSendPrompt: (content, attachments) =>
        this.emit("send-prompt", { content, attachments }),
    });
  }
}

/** Idempotently registers `<tangent-artifact-viewer>` (safe across re-import). */
export function defineArtifactViewerElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentArtifactViewerElement);
  }
}
