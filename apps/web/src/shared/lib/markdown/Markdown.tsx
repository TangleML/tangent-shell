// local primitive — renders agent markdown output, styling the raw markdown
// HTML elements (h1/ul/a/img/code/table/...). These are not Tangle UI
// primitives, so the scoped classNames here are an allowed escape hatch.
import type { ReactNode } from "react";
import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { BundleUiHost } from "@/features/bundle-ui/BundleUiHost";
import { apiUrl } from "@/shared/lib/basePath";
import {
  artifactPath,
  isAbsoluteUrl,
  isViewableArtifact,
  resolveUrl,
} from "@/shared/lib/markdown/artifact";
import { cn } from "@/shared/lib/utils";
import { Icon } from "@/shared/ui/icon";
import { InlineStack } from "@/shared/ui/layout";
import { Link } from "@/shared/ui/link";
import { Separator } from "@/shared/ui/separator";
import { Heading, Paragraph, Text } from "@/shared/ui/typography";

import { CodeBlock } from "./CodeBlock";

/**
 * Matches a bundle-UI message token's language class, e.g.
 * `language-tangent-ui:pipeline-progress`. The plain `/language-(\w+)/` used
 * for normal code blocks cannot match this (the name has a hyphen and the class
 * a colon), so this prefix is checked first.
 */
const BUNDLE_UI_LANGUAGE = /language-tangent-ui:([a-z0-9][a-z0-9-]*)/;

/** Body-text size for flowing markdown content (paragraphs, list items, links). */
type MarkdownSize = "xs" | "sm" | "md";

/** Text tone applied to flowing body content (paragraphs, list items, headings). */
type MarkdownTone = "inherit" | "subdued";

interface MarkdownProps {
  children: string;
  className?: string;
  /**
   * Default text size for flowing body content (paragraphs, list items, inline
   * links). Structural elements (headings, tables, code) keep their own sizing.
   * @default "sm"
   */
  size?: MarkdownSize;
  /**
   * Text tone for flowing body content (paragraphs, list items, headings). Use
   * `"subdued"` to render muted text. Links, code, and tables keep their own
   * styling.
   * @default "inherit"
   */
  tone?: MarkdownTone;
  /**
   * Base URL (e.g. `/api/sessions/<id>/files`) used to resolve relative
   * artifact references in agent output. Relative `img`/`a` URLs are rewritten
   * to point at this session's file API; absolute and non-http schemes are
   * left untouched. When set, relative `a` links render as artifact chips.
   */
  artifactBaseUrl?: string;
  /**
   * The agent bundle this session was created from, if any. When set, fenced
   * `tangent-ui:<name>` blocks the agent emits render that bundle's sandboxed
   * message component instead of a code block. Absent outside a bundle session,
   * where such blocks fall back to a normal code block.
   */
  bundleId?: string;
  /**
   * Forwards a composed prompt from an interactive `tangent-ui:<name>` message
   * component to the chat, exactly as if the user had typed it. Omitted in
   * read-only contexts (e.g. sub-agent threads), where such components stay
   * inert.
   */
  onSendPrompt?: (text: string) => void;
  /**
   * Opens a browser-viewable "page" artifact (HTML, PDF, image, text) in an
   * in-app tab instead of a new browser window. When omitted, viewable artifact
   * links fall back to the same download chip as plain file artifacts.
   */
  onOpenArtifact?: (url: string, title: string) => void;
  /**
   * The set of currently pinned artifact paths (workspace-relative), used to
   * show whether an artifact chip is already pinned.
   */
  pinnedPaths?: Set<string>;
  /**
   * Toggles an artifact's pinned state from its chip, identified by its
   * workspace-relative path. When omitted, chips render without a pin control
   * (e.g. read-only contexts).
   */
  onTogglePinArtifact?: (path: string, title: string) => void;
  /**
   * The chat session id, combined with `messageId` to namespace a bundle
   * message component's persisted state. Omitted disables `host.getState`/
   * `setState` persistence for any `tangent-ui:<name>` blocks.
   */
  sessionId?: string;
  /**
   * The id of the message this markdown belongs to. Used (with `sessionId`) as
   * the stable state namespace for bundle message components.
   */
  messageId?: string;
  /**
   * Collapses the message this markdown belongs to. Forwarded to bundle message
   * components so they can request collapse via `host.execUICommand`.
   */
  onCollapse?: () => void;
}

/**
 * Options for {@link buildComponents}. Mirrors the body-content and artifact
 * props on {@link MarkdownProps}, with `size`/`tone` resolved to concrete
 * defaults by the caller.
 */
interface MarkdownComponentsOptions {
  artifactBaseUrl?: string;
  size: MarkdownSize;
  tone: MarkdownTone;
  bundleId?: string;
  onSendPrompt?: (text: string) => void;
  onOpenArtifact?: (url: string, title: string) => void;
  pinnedPaths?: Set<string>;
  onTogglePinArtifact?: (path: string, title: string) => void;
  sessionId?: string;
  messageId?: string;
  onCollapse?: () => void;
}

const INLINE_CODE_CLASS =
  "rounded bg-message-code text-message-code-foreground px-1 py-0.5 text-xs font-mono break-words";

/**
 * Special link scheme that turns a markdown link into a chat action: clicking it
 * sends the payload to the chat via `onSendPrompt` instead of navigating.
 */
const PROMPT_SCHEME = "prompt://";

/** Returns the decoded prompt payload for a `prompt://` href, else undefined. */
function parsePromptHref(href: string | undefined): string | undefined {
  if (typeof href !== "string" || !href.startsWith(PROMPT_SCHEME))
    return undefined;
  const raw = href.slice(PROMPT_SCHEME.length);
  try {
    return decodeURIComponent(raw).trim() || undefined;
  } catch {
    return raw.trim() || undefined;
  }
}

/**
 * URL sanitizer for `react-markdown`. The default transform drops unknown
 * protocols (keeping only http/https/mailto/etc.), which would blank our
 * `prompt://` links before the `a` handler runs. Preserve those; defer to the
 * default for everything else.
 */
function urlTransform(url: string): string {
  return url.startsWith(PROMPT_SCHEME) ? url : defaultUrlTransform(url);
}

/** Derives a short tab title from the link text, falling back to the filename. */
function artifactLabel(children: ReactNode, url: string): string {
  if (typeof children === "string" && children.trim()) return children.trim();
  const path = url.split(/[?#]/, 1)[0];
  const filename = path.split("/").pop() ?? url;
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

/**
 * Artifact chip — a recognizable, padded pill-style reference for artifact
 * output. The main action opens the artifact in an in-app tab (`onOpen`) or
 * links to it for download. When `onTogglePin` is set, an adjacent pin toggle
 * lets the user keep the artifact in the sidebar's quick-access list. Raw
 * `<span>`/`<a>`/`<button>`, so scoped classes are fine.
 */
const ARTIFACT_CHIP_CLASS =
  "inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 align-middle text-xs font-medium text-foreground";
const ARTIFACT_ACTION_CLASS =
  "inline-flex min-w-0 items-center gap-1 text-foreground no-underline transition hover:opacity-70";
const ARTIFACT_PIN_CLASS =
  "inline-flex shrink-0 items-center transition hover:opacity-70";

interface ArtifactChipProps {
  href?: string;
  title?: string;
  children?: ReactNode;
  onOpen?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}

function ArtifactChip({
  href,
  title,
  children,
  onOpen,
  pinned,
  onTogglePin,
}: ArtifactChipProps) {
  const action = onOpen ? (
    <button
      type="button"
      title={title}
      onClick={onOpen}
      className={ARTIFACT_ACTION_CLASS}
    >
      <Icon name="FileText" size="xs" tone="subdued" />
      <span className="truncate">{children}</span>
    </button>
  ) : (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer"
      className={ARTIFACT_ACTION_CLASS}
    >
      <Icon name="Paperclip" size="xs" tone="subdued" />
      <span className="truncate">{children}</span>
    </a>
  );

  return (
    <span className={ARTIFACT_CHIP_CLASS}>
      {action}
      {onTogglePin ? (
        <button
          type="button"
          title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
          aria-label={pinned ? "Unpin artifact" : "Pin artifact"}
          aria-pressed={pinned}
          onClick={onTogglePin}
          className={ARTIFACT_PIN_CLASS}
        >
          <Icon
            name={pinned ? "PinOff" : "Pin"}
            size="xs"
            tone={pinned ? "accent" : "subdued"}
          />
        </button>
      ) : null}
    </span>
  );
}

/**
 * Prompt action link — a `prompt://` markdown link that sends its payload to
 * the chat instead of navigating. Styled distinctly from regular links (dashed
 * underline + leading prompt icon). Raw `<button>`, so scoped classes are fine.
 * In read-only contexts (no `onSend`) it renders as inert text.
 */
const PROMPT_LINK_CLASS =
  "inline cursor-pointer text-primary underline decoration-dashed underline-offset-2 hover:decoration-solid";

interface PromptLinkProps {
  prompt: string;
  children?: ReactNode;
  onSend?: (text: string) => void;
  size: MarkdownSize;
}

function PromptLink({ prompt, children, onSend, size }: PromptLinkProps) {
  if (!onSend) {
    return (
      <Text as="span" size={size}>
        {children}
      </Text>
    );
  }

  return (
    <button
      type="button"
      title="Send as prompt"
      onClick={() => onSend(prompt)}
      className={PROMPT_LINK_CLASS}
    >
      <InlineStack gap="1" wrap="nowrap" grow>
        <Icon name="Sparkles" size="xs" tone="subdued" />
        {children}
      </InlineStack>
    </button>
  );
}

/**
 * Renders an agent-emitted `tangent-ui:<name>` block as a sandboxed bundle
 * message component. While the agent message is still streaming the JSON body
 * may be incomplete; a quiet placeholder is shown until it parses.
 */
interface BundleUiMessageProps {
  bundleId: string;
  name: string;
  body: string;
  /** Occurrence index of this component name within the message (0-based). */
  index: number;
  onSendPrompt?: (text: string) => void;
  sessionId?: string;
  messageId?: string;
  onCollapse?: () => void;
}

function BundleUiMessage({
  bundleId,
  name,
  body,
  index,
  onSendPrompt,
  sessionId,
  messageId,
  onCollapse,
}: BundleUiMessageProps) {
  let props: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      props = parsed as Record<string, unknown>;
    }
  } catch {
    // Incomplete/invalid JSON (e.g. mid-stream); fall through to placeholder.
  }

  if (!props) {
    return (
      <Text size="xs" tone="subdued">
        Loading component...
      </Text>
    );
  }

  // Stable per-instance namespace for `host.getState`/`setState`. Includes the
  // occurrence index so repeated components of the same name don't collide.
  const stateNamespace =
    sessionId && messageId
      ? `tangent-bundle-ui-state:${sessionId}:${messageId}:${name}:${index}`
      : undefined;

  return (
    <BundleUiHost
      kind="message"
      moduleUrl={apiUrl(`/api/agent-bundles/${bundleId}/ui/${name}.js`)}
      props={props}
      onSendPrompt={onSendPrompt}
      stateNamespace={stateNamespace}
      onCollapse={onCollapse}
    />
  );
}

function buildComponents(options: MarkdownComponentsOptions): Components {
  const {
    artifactBaseUrl,
    size,
    tone,
    bundleId,
    onSendPrompt,
    onOpenArtifact,
    pinnedPaths,
    onTogglePinArtifact,
    sessionId,
    messageId,
    onCollapse,
  } = options;

  // Counts occurrences of each bundle component name within a single render so
  // repeated components get a stable index for their persisted-state namespace.
  const componentIndex = new Map<string, number>();

  // Headings use the dedicated `--message-heading` token (via the `heading`
  // tone) unless the caller explicitly requested subdued body content.
  const headingTone = tone === "subdued" ? "subdued" : "heading";

  return {
    h1: ({ children }) => (
      <Heading level={1} size="sm" weight="bold" tone={headingTone}>
        {children}
      </Heading>
    ),
    h2: ({ children }) => (
      <Heading level={2} size="sm" weight="bold" tone={headingTone}>
        {children}
      </Heading>
    ),
    h3: ({ children }) => (
      <Heading level={3} size="sm" weight="semibold" tone={headingTone}>
        {children}
      </Heading>
    ),
    h4: ({ children }) => (
      <Heading level={4} size="sm" weight="semibold" tone={headingTone}>
        {children}
      </Heading>
    ),
    p: ({ children }) => (
      <Paragraph size={size} leading="relaxed" tone={tone}>
        {children}
      </Paragraph>
    ),
    ul: ({ children }) => <ul className="my-1 list-disc pl-4">{children}</ul>,
    ol: ({ children }) => (
      <ol className="my-1 list-decimal pl-4">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="my-0.5">
        <Text as="span" size={size} leading="relaxed" tone={tone}>
          {children}
        </Text>
      </li>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 rounded-sm border-l-4 border-message-quote-border bg-message-table-header py-1 pl-3">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto rounded-md border border-message-table-border">
        <table className="w-full text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-message-table-header">{children}</thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr className="border-b last:border-b-0">{children}</tr>
    ),
    th: ({ children }) => (
      <th className="px-2 py-1 text-left font-semibold">{children}</th>
    ),
    td: ({ children }) => <td className="px-2 py-1">{children}</td>,
    hr: () => <Separator />,
    a: ({ href, title, children }) => {
      if (typeof href === "string" && href.startsWith(PROMPT_SCHEME)) {
        const promptText = parsePromptHref(href);
        const text =
          promptText ?? (typeof children === "string" ? children.trim() : "");
        return (
          <PromptLink prompt={text} onSend={onSendPrompt} size={size}>
            {children}
          </PromptLink>
        );
      }

      const isArtifact =
        artifactBaseUrl != null &&
        typeof href === "string" &&
        !isAbsoluteUrl(href);

      if (isArtifact) {
        const resolved = resolveUrl(href, artifactBaseUrl) ?? href;
        const openable = onOpenArtifact != null && isViewableArtifact(href);
        // The workspace-relative path is the stable identity used for pinning.
        const path = artifactPath(href);
        const label = artifactLabel(children, resolved);
        return (
          <ArtifactChip
            href={resolved}
            title={title}
            onOpen={
              openable ? () => onOpenArtifact(resolved, label) : undefined
            }
            pinned={pinnedPaths?.has(path)}
            onTogglePin={
              onTogglePinArtifact
                ? () => onTogglePinArtifact(path, label)
                : undefined
            }
          >
            {children}
          </ArtifactChip>
        );
      }

      return (
        <Link href={href} title={title} variant="primary" size={size} external>
          {children}
        </Link>
      );
    },
    img: ({ src, alt, title }) => (
      <img
        src={
          artifactBaseUrl && typeof src === "string"
            ? resolveUrl(src, artifactBaseUrl)
            : src
        }
        alt={alt}
        title={title}
        className="max-w-full rounded border"
      />
    ),
    code: ({ className, children }) => {
      // Bundle-UI message token: render the bundle's sandboxed component when
      // we know which bundle to load it from; otherwise treat it as code.
      const bundleMatch = bundleId
        ? className?.match(BUNDLE_UI_LANGUAGE)
        : null;
      if (bundleMatch && bundleId) {
        const body = String(children).replace(/\n$/, "");
        const name = bundleMatch[1];
        const index = componentIndex.get(name) ?? 0;
        componentIndex.set(name, index + 1);
        return (
          <BundleUiMessage
            bundleId={bundleId}
            name={name}
            body={body}
            index={index}
            onSendPrompt={onSendPrompt}
            sessionId={sessionId}
            messageId={messageId}
            onCollapse={onCollapse}
          />
        );
      }

      const match = className?.match(/language-(\w+)/);

      if (match) {
        const code = String(children).replace(/\n$/, "");
        return (
          <CodeBlock
            code={code}
            language={match[1]}
            showLineNumbers={false}
            className="my-1 h-auto max-h-64 rounded-md text-xs"
          />
        );
      }

      return <code className={INLINE_CODE_CLASS}>{children}</code>;
    },
    // Fenced code blocks are rendered by the `code` handler above; the `pre`
    // wrapper is flattened so it does not add an extra <pre> around CodeBlock.
    pre: ({ children }) => <>{children}</>,
  };
}

export function Markdown({
  children,
  className,
  size = "sm",
  tone = "inherit",
  artifactBaseUrl,
  bundleId,
  onSendPrompt,
  onOpenArtifact,
  pinnedPaths,
  onTogglePinArtifact,
  sessionId,
  messageId,
  onCollapse,
}: MarkdownProps) {
  return (
    <div className={cn("w-full min-w-0 space-y-2", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={buildComponents({
          artifactBaseUrl,
          size,
          tone,
          bundleId,
          onSendPrompt,
          onOpenArtifact,
          pinnedPaths,
          onTogglePinArtifact,
          sessionId,
          messageId,
          onCollapse,
        })}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
