import { Check } from "lucide-react";

import { cn } from "@/shared/lib/utils";

import { Text } from "./typography";

/**
 * Checkbox — Layer 2 base primitive.
 *
 * A controlled, token-styled checkbox row (box + optional label). The caller
 * owns the `checked` state; toggling calls `onCheckedChange` with the next
 * value. Added for the bundle UI vocabulary (`tangent-checkbox`).
 */

interface CheckboxProps {
  /** Whether the box is checked. Controlled by the caller. */
  checked: boolean;
  /** Optional text label rendered next to the box. */
  label?: string;
  /** Called with the next checked value when toggled. */
  onCheckedChange?: (checked: boolean) => void;
}

export function Checkbox({ checked, label, onCheckedChange }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      className="flex w-full cursor-pointer items-center gap-2 text-left outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={cn(
          "border-input focus-visible:border-ring focus-visible:ring-ring/50 flex size-4 shrink-0 items-center justify-center rounded border shadow-xs transition-[color,box-shadow]",
          checked && "bg-primary border-primary text-primary-foreground",
        )}
      >
        {checked && <Check className="size-3" />}
      </span>
      {label != null && <Text size="sm">{label}</Text>}
    </button>
  );
}

export type { CheckboxProps };
