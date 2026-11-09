import { Icon } from "@tangent/ui-primitives/icon";
import type { ReactNode } from "react";

// local primitive
/**
 * Artifact chip — a recognizable pill-style reference for artifact output. The
 * main action opens the artifact in an in-app tab (`onOpen`) or links to it for
 * download. When `onTogglePin` is set, an adjacent pin toggle lets the user
 * keep the artifact in the sidebar's quick-access list. It matches the chips a
 * host draws for its own links, so a message mixing both reads as one set. Raw
 * `<span>`/`<a>`/`<button>`, so scoped classes are fine.
 */
const ARTIFACT_CHIP_CLASS =
  "inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 align-middle text-xs font-medium text-foreground transition-colors hover:bg-accent";
const ARTIFACT_ACTION_CLASS =
  "inline-flex min-w-0 cursor-pointer items-center gap-1 text-foreground no-underline";
const ARTIFACT_PIN_CLASS =
  "inline-flex shrink-0 cursor-pointer items-center transition hover:opacity-70";
const ARTIFACT_LABEL_CLASS = "max-w-[160px] truncate";

interface ArtifactChipProps {
  href?: string;
  title?: string;
  children?: ReactNode;
  onOpen?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}

export function ArtifactChip({
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
      <span className={ARTIFACT_LABEL_CLASS}>{children}</span>
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
      <span className={ARTIFACT_LABEL_CLASS}>{children}</span>
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
