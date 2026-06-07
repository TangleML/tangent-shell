// local primitive — renders agent markdown output, styling the raw markdown
// HTML elements (h1/ul/a/img/...). These are not Tangle UI primitives, so the
// scoped classNames here are an allowed escape hatch.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/shared/lib/utils";

type MarkdownProps = {
  children: string;
  className?: string;
  /**
   * Base URL (e.g. `/api/sessions/<id>/files`) used to resolve relative
   * artifact references in agent output. Relative `img`/`a` URLs are rewritten
   * to point at this session's file API; absolute and non-http schemes are
   * left untouched.
   */
  artifactBaseUrl?: string;
};

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

function buildComponents(artifactBaseUrl?: string): Components {
  return {
    a: ({ href, title, children }) => (
      <a
        href={artifactBaseUrl ? resolveUrl(href, artifactBaseUrl) : href}
        title={title}
        target="_blank"
        rel="noreferrer"
        className="underline text-primary"
      >
        {children}
      </a>
    ),
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
  };
}

export function Markdown({ children, className, artifactBaseUrl }: MarkdownProps) {
  return (
    <div
      className={cn(
        "space-y-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={buildComponents(artifactBaseUrl)}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
