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
import { cn } from "@/shared/lib/utils";
import { Icon } from "@/shared/ui/icon";
import { Link } from "@/shared/ui/link";
import { Surface } from "@/shared/ui/patterns/surface";
import { Separator } from "@/shared/ui/separator";
import { Heading, Paragraph, Text } from "@/shared/ui/typography";

import { CodeBlock } from "./CodeBlock";
import { InlineStack } from "@/shared/ui/layout";

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

type MarkdownProps = {
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
};

const INLINE_CODE_CLASS =
  "rounded bg-muted px-1 py-0.5 text-xs font-mono break-words";

/** True for URLs we must not rewrite (absolute, anchor, or non-file schemes). */
function isAbsoluteUrl(url: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(url) || // http:, https:, data:, mailto:, ...
    url.startsWith("/") ||
    url.startsWith("#")
  );
}

/** Resolves a relative artifact reference against the session's file base. */
function resolveUrl(url: string | undefined, base: string): string | undefined {
  if (!url || isAbsoluteUrl(url)) return url;
  const cleaned = url.replace(/^\.\//, "");
  return `${base}/${cleaned}`;
}

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

/**
 * File extensions a browser can render inline (HTML pages, PDFs, images, and
 * plain-text formats). Links to these "page" artifacts open in an in-app tab;
 * anything else stays a download chip.
 */
const VIEWABLE_ARTIFACT_EXTENSIONS = new Set([
  "html",
  "htm",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "txt",
  "md",
  "json",
  "csv",
  "log",
]);

/** True when an artifact URL points at a browser-viewable "page" artifact. */
function isViewableArtifact(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  const ext = path.split(".").pop()?.toLowerCase();
  return ext != null && VIEWABLE_ARTIFACT_EXTENSIONS.has(ext);
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
 * output. With `onOpen` it renders a button that opens the artifact in an
 * in-app tab; otherwise a download link. Raw `<a>`/`<button>`, so scoped
 * classes are fine.
 */
const ARTIFACT_CHIP_CLASS =
  "inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 align-middle text-xs font-medium text-foreground no-underline transition hover:bg-muted/70";

function ArtifactChip({
  href,
  title,
  children,
  onOpen,
}: {
  href?: string;
  title?: string;
  children?: ReactNode;
  onOpen?: () => void;
}) {
  if (onOpen) {
    return (
      <button
        type="button"
        title={title}
        onClick={onOpen}
        className={ARTIFACT_CHIP_CLASS}
      >
        <Icon name="FileText" size="xs" tone="subdued" />
        <span className="truncate">{children}</span>
      </button>
    );
  }

  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer"
      className={ARTIFACT_CHIP_CLASS}
    >
      <Icon name="Paperclip" size="xs" tone="subdued" />
      <span className="truncate">{children}</span>
    </a>
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

function PromptLink({
  prompt,
  children,
  onSend,
  size,
}: {
  prompt: string;
  children?: ReactNode;
  onSend?: (text: string) => void;
  size: MarkdownSize;
}) {
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
function BundleUiMessage({
  bundleId,
  name,
  body,
  onSendPrompt,
}: {
  bundleId: string;
  name: string;
  body: string;
  onSendPrompt?: (text: string) => void;
}) {
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

  return (
    <BundleUiHost
      kind="message"
      moduleUrl={`/api/agent-bundles/${bundleId}/ui/${name}.js`}
      props={props}
      onSendPrompt={onSendPrompt}
    />
  );
}

function buildComponents(
  artifactBaseUrl?: string,
  size: MarkdownSize = "sm",
  tone: MarkdownTone = "inherit",
  bundleId?: string,
  onSendPrompt?: (text: string) => void,
  onOpenArtifact?: (url: string, title: string) => void,
): Components {
  return {
    h1: ({ children }) => (
      <Heading level={1} size="sm" weight="bold" tone={tone}>
        {children}
      </Heading>
    ),
    h2: ({ children }) => (
      <Heading level={2} size="sm" weight="bold" tone={tone}>
        {children}
      </Heading>
    ),
    h3: ({ children }) => (
      <Heading level={3} size="sm" weight="semibold" tone={tone}>
        {children}
      </Heading>
    ),
    h4: ({ children }) => (
      <Heading level={4} size="sm" weight="semibold" tone={tone}>
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
      <Surface as="aside" level={2}>
        {children}
      </Surface>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto rounded-md border">
        <table className="w-full text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
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
        return (
          <ArtifactChip
            href={resolved}
            title={title}
            onOpen={
              openable
                ? () =>
                    onOpenArtifact(resolved, artifactLabel(children, resolved))
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
        return (
          <BundleUiMessage
            bundleId={bundleId}
            name={bundleMatch[1]}
            body={body}
            onSendPrompt={onSendPrompt}
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
}: MarkdownProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={buildComponents(
          artifactBaseUrl,
          size,
          tone,
          bundleId,
          onSendPrompt,
          onOpenArtifact,
        )}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
