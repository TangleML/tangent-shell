import { createElement, type ReactNode } from "react";

import { EmbeddedChat } from "../components/EmbeddedChat";
import type { TangentRuntime } from "../types";
import { EmbeddedElement } from "./embeddedElement";

const TAG = "tangent-chat";

/**
 * Mounts the embedded chat surface. `sessionId`, `agentId`, and `initialPrompt`
 * are properties; `open-artifact` and `send-prompt` are emitted as composed
 * `CustomEvent`s for the npm wrapper to surface as `on*` props.
 */
export class TangentChatElement extends EmbeddedElement {
  private currentSessionId = "";
  private currentAgentId = "";
  private queuedInitialPrompt: string | undefined;

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

  set initialPrompt(value: string | undefined) {
    this.queuedInitialPrompt = value || undefined;
    this.rerender();
  }
  get initialPrompt(): string | undefined {
    return this.queuedInitialPrompt;
  }

  attributeChangedCallback(name: string, _prev: string, next: string): void {
    if (name === "session-id") this.sessionId = next ?? "";
    if (name === "agent-id") this.agentId = next ?? "";
  }

  protected renderContent(runtime: TangentRuntime): ReactNode {
    if (!this.currentSessionId) return null;

    if (this.queuedInitialPrompt) {
      runtime.queuePrompt(this.currentSessionId, {
        prompt: this.queuedInitialPrompt,
      });
      this.queuedInitialPrompt = undefined;
    }

    return createElement(EmbeddedChat, {
      sessionId: this.currentSessionId,
      agentId: this.currentAgentId || undefined,
      runtime,
      onOpenArtifact: (url: string, title: string) =>
        this.emit("open-artifact", { url, title }),
      onSendPrompt: (content: string) => this.emit("send-prompt", { content }),
    });
  }
}

/** Idempotently registers `<tangent-chat>` (safe across HMR/re-import). */
export function defineChatElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentChatElement);
  }
}
