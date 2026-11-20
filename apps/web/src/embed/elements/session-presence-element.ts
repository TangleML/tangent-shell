import { createElement } from "react";

import { SessionPresence } from "../components/SessionPresence";
import { EmbeddedElement } from "./embeddedElement";

const TAG = "tangent-session-presence";

export class TangentSessionPresenceElement extends EmbeddedElement {
  static observedAttributes = ["session-id"];

  protected get tag() {
    return TAG;
  }

  protected get paintsBackground() {
    return false;
  }

  attributeChangedCallback(): void {
    this.rerender();
  }

  protected renderContent() {
    return createElement(SessionPresence, {
      sessionId: this.getAttribute("session-id") ?? "",
    });
  }
}

export function defineSessionPresenceElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentSessionPresenceElement);
  }
}
