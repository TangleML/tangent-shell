import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { EmbedRoot } from "../components/EmbedRoot";
import { resolveRuntime } from "../runtime";
import {
  adoptEmbedStyles,
  applyEmbedTheme,
  ensureOverlayContainer,
} from "../styles";
import type { TangentRuntime } from "../types";

type ProviderHost = Element & { runtime?: TangentRuntime | null };

/**
 * Base for the embed custom elements. Owns the shadow root, adopted styles,
 * runtime resolution (climbing to the nearest `<tangent-provider>`), theme
 * application + subscription, and the React root lifecycle. Subclasses implement
 * {@link renderContent} and call {@link rerender} when their inputs change; the
 * subtree is always wrapped in {@link EmbedRoot} so it shares the query client
 * and portals menus/tooltips to the overlay root.
 */
export abstract class EmbeddedElement extends HTMLElement {
  private root: Root | null = null;
  private mountPoint: HTMLDivElement | null = null;
  private themeUnsubscribe: (() => void) | null = null;
  protected runtime: TangentRuntime | null = null;

  /** Tag name, used only for missing-provider diagnostics. */
  protected abstract get tag(): string;

  /** The subtree to render inside `EmbedRoot`, or null to render nothing yet. */
  protected abstract renderContent(runtime: TangentRuntime): ReactNode;

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: "open" });
      adoptEmbedStyles(shadow);
      const mountPoint = document.createElement("div");
      mountPoint.style.height = "100%";
      mountPoint.style.minHeight = "0";
      mountPoint.style.display = "flex";
      mountPoint.style.flexDirection = "column";
      shadow.append(mountPoint);
      this.mountPoint = mountPoint;
    }
    this.runtime = this.resolveRuntime();
    this.applyTheme();
    this.themeUnsubscribe =
      this.runtime?.subscribeTheme(() => this.applyTheme()) ?? null;
    this.rerender();
  }

  disconnectedCallback(): void {
    this.themeUnsubscribe?.();
    this.themeUnsubscribe = null;
    this.root?.unmount();
    this.root = null;
  }

  private resolveRuntime(): TangentRuntime | null {
    const provider = this.closest("tangent-provider") as ProviderHost | null;
    return provider?.runtime ?? resolveRuntime(this.getAttribute("instance"));
  }

  private applyTheme(): void {
    if (!this.runtime || !this.mountPoint) return;
    applyEmbedTheme(this.runtime.theme, this.mountPoint);
    applyEmbedTheme(this.runtime.theme, ensureOverlayContainer());
  }

  /** (Re)renders the element's React subtree over the resolved runtime. */
  protected rerender(): void {
    if (!this.mountPoint) return;
    const runtime = this.runtime ?? this.resolveRuntime();
    if (!runtime) {
      console.error(`[${this.tag}] no <tangent-provider> ancestor found`);
      return;
    }
    this.runtime = runtime;
    const content = this.renderContent(runtime);
    if (content == null) return;
    if (!this.root) this.root = createRoot(this.mountPoint);
    this.root.render(
      createElement(
        EmbedRoot,
        { portalContainer: ensureOverlayContainer() },
        content,
      ),
    );
  }

  /** Dispatches a composed `CustomEvent` for the npm wrapper to surface. */
  protected emit(type: string, detail: object): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }
}
