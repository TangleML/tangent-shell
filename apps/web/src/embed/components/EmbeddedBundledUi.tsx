import { BundleUiHost } from "@/features/bundle-ui/BundleUiHost";
import type { BundleUiKind } from "@/features/bundle-ui/types";

interface EmbeddedBundledUiProps {
  /** URL of the compiled bundle component JS. */
  moduleUrl: string;
  /** Which surface the component renders on. */
  kind: BundleUiKind;
  /** JSON props for a `message` component (ignored for `panel`). */
  props?: Record<string, unknown>;
  /** localStorage namespace for the component's persisted state (optional). */
  stateNamespace?: string;
  /** Forwards a composed prompt from a `panel` component to the host. */
  onSendPrompt?: (text: string) => void;
  /** The component asked to collapse its host surface. */
  onCollapse?: () => void;
}

/**
 * The embedded bundle-UI slot: the shared `BundleUiHost`. The embed build aliases
 * the worker factory to an inlined variant (see `vite.embed.config.ts`), so the
 * runtime stays a single file. The host wires prompt/collapse via callbacks.
 */
export function EmbeddedBundledUi({
  moduleUrl,
  kind,
  props,
  stateNamespace,
  onSendPrompt,
  onCollapse,
}: EmbeddedBundledUiProps) {
  return (
    <BundleUiHost
      moduleUrl={moduleUrl}
      kind={kind}
      props={props}
      stateNamespace={stateNamespace}
      onSendPrompt={onSendPrompt}
      onCollapse={onCollapse}
    />
  );
}
