import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/utils";

/**
 * Progress — Layer 2 base primitive.
 *
 * A slim, token-styled progress bar. `value` is a fraction in `[0, 1]`; when it
 * is `undefined` the bar is indeterminate (animated). Introduced for the bundle
 * UI vocabulary (`tangent-progress`) since no progress primitive existed before.
 */

const fillVariants = cva("h-full rounded-full transition-[width]", {
  variants: {
    tone: {
      default: "bg-primary",
      info: "bg-info",
      success: "bg-success",
      warning: "bg-warning",
      critical: "bg-destructive",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

type FillVariantProps = VariantProps<typeof fillVariants>;

interface ProgressProps extends FillVariantProps {
  /** Completion fraction in `[0, 1]`. Omit for an indeterminate bar. */
  value?: number;
}

function clampFraction(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function Progress({ value, tone }: ProgressProps) {
  const indeterminate = value == null;
  const fraction = indeterminate ? 0 : clampFraction(value);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={indeterminate ? undefined : fraction}
      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
    >
      <div
        className={cn(
          fillVariants({ tone }),
          indeterminate && "w-2/5 animate-pulse",
        )}
        style={indeterminate ? undefined : { width: `${fraction * 100}%` }}
      />
    </div>
  );
}

export type { ProgressProps };
