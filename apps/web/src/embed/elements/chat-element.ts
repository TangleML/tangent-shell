import { createElement, type ReactNode } from "react";

import type { MessageLinkProps } from "@/features/chat/components/message/ChatMessageList";
import {
  createHostSlotRegistry,
  HostExtensionsContext,
  type HostSlotRecord,
} from "@/shared/lib/hostSlots";

import { EmbeddedChat } from "../components/EmbeddedChat";
import type {
  EmbedAgentPayload,
  EmbedCommandPayload,
  EmbedReferencePayload,
  TangentRuntime,
} from "../types";
import { EmbeddedElement } from "./embeddedElement";

const TAG = "tangent-chat";

/**
 * Mounts an embedded chat. Hosts set the session, agent, and optional inputs
 * as element properties. Chat actions such as `open-artifact` and `send-prompt`
 * bubble as composed events for the React wrapper's callbacks.
 */
export class TangentChatElement extends EmbeddedElement {
  private currentSessionId = "";
  private currentAgentId = "";
  private queuedInitialPrompt: string | undefined;
  private shouldAutoFocus = false;
  private currentReferences: EmbedReferencePayload[] = [];
  private currentCommands: EmbedCommandPayload[] = [];
  private messageLink: MessageLinkProps["getMessageLink"];
  private currentTargetMessageId?: string;
  private currentTargetAgentId?: string;
  private readonly hostSlots = createHostSlotRegistry();
  private hostExtUnsubscribe: (() => void) | null = null;

  static get observedAttributes(): string[] {
    return [
      "session-id",
      "agent-id",
      "auto-focus",
      "target-message-id",
      "target-agent-id",
    ];
  }

  protected get tag(): string {
    return TAG;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.hostExtUnsubscribe =
      this.runtime?.subscribeHostExtensions(() => this.rerender()) ?? null;
  }

  disconnectedCallback(): void {
    this.hostExtUnsubscribe?.();
    this.hostExtUnsubscribe = null;
    super.disconnectedCallback();
  }

  /** Current host-slot records for the npm wrapper to project. */
  getHostSlots(): HostSlotRecord[] {
    return this.hostSlots.getSlots();
  }

  /** Subscribes to host-slot changes; returns an unsubscribe. */
  subscribeHostSlots(listener: () => void): () => void {
    return this.hostSlots.subscribe(listener);
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

  /** Builds a host URL for a message in the thread displayed by this element. */
  set getMessageLink(value: MessageLinkProps["getMessageLink"]) {
    if (this.messageLink === value) return;
    this.messageLink = value;
    this.rerender();
  }
  get getMessageLink(): MessageLinkProps["getMessageLink"] {
    return this.messageLink;
  }

  /** Scrolls to this message once its thread history is available. */
  set targetMessageId(value: string | undefined) {
    if (this.currentTargetMessageId === value) return;
    this.currentTargetMessageId = value;
    this.rerender();
  }
  get targetMessageId(): string | undefined {
    return this.currentTargetMessageId;
  }

  /** Asks Prime to open this sub-agent through the host's normal open-agent event. */
  set targetAgentId(value: string | undefined) {
    if (this.currentTargetAgentId === value) return;
    this.currentTargetAgentId = value;
    this.rerender();
  }
  get targetAgentId(): string | undefined {
    return this.currentTargetAgentId;
  }

  set initialPrompt(value: string | undefined) {
    this.queuedInitialPrompt = value || undefined;
    this.rerender();
  }
  get initialPrompt(): string | undefined {
    return this.queuedInitialPrompt;
  }

  set autoFocus(value: boolean) {
    this.shouldAutoFocus = Boolean(value);
    this.rerender();
  }
  get autoFocus(): boolean {
    return this.shouldAutoFocus;
  }

  set references(value: EmbedReferencePayload[] | undefined) {
    this.currentReferences = value ?? [];
    this.rerender();
  }
  get references(): EmbedReferencePayload[] {
    return this.currentReferences;
  }

  set commands(value: EmbedCommandPayload[] | undefined) {
    this.currentCommands = value ?? [];
    this.rerender();
  }
  get commands(): EmbedCommandPayload[] {
    return this.currentCommands;
  }

  attributeChangedCallback(
    name: string,
    _prev: string | null,
    next: string | null,
  ): void {
    if (name === "session-id") this.sessionId = next ?? "";
    if (name === "agent-id") this.agentId = next ?? "";
    if (name === "target-message-id") this.targetMessageId = next || undefined;
    if (name === "target-agent-id") this.targetAgentId = next || undefined;
    if (name === "auto-focus")
      this.autoFocus = next != null && next !== "false";
  }

  protected renderContent(runtime: TangentRuntime): ReactNode {
    if (!this.currentSessionId) return null;

    if (this.queuedInitialPrompt) {
      runtime.queuePrompt(this.currentSessionId, {
        prompt: this.queuedInitialPrompt,
      });
      this.queuedInitialPrompt = undefined;
    }

    return createElement(
      HostExtensionsContext.Provider,
      {
        value: {
          registry: this.hostSlots,
          uiNames: runtime.hostUiNames,
          anchorProtocols: runtime.hostAnchorProtocols,
        },
      },
      createElement(EmbeddedChat, {
        sessionId: this.currentSessionId,
        agentId: this.currentAgentId || undefined,
        getMessageLink: this.messageLink,
        targetMessageId: this.currentTargetMessageId,
        targetAgentId: this.currentTargetAgentId,
        autoFocus: this.shouldAutoFocus,
        runtime,
        onOpenArtifact: (url: string, title: string) =>
          this.emit("open-artifact", { url, title }),
        onSendPrompt: (content: string) =>
          this.emit("send-prompt", { content }),
        onOpenAgent: (agent: EmbedAgentPayload) =>
          this.emit("open-agent", { ...agent }),
        onRemoveAgent: (id: string) => this.emit("remove-agent", { id }),
        onResourcesChange: () => this.emit("resources-change", {}),
        references: this.currentReferences,
        commands: this.currentCommands,
      }),
    );
  }
}

/** Idempotently registers `<tangent-chat>` (safe across HMR/re-import). */
export function defineChatElement(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, TangentChatElement);
  }
}
