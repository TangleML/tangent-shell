import { Box } from "@tangent/ui-primitives/box";
import { Button } from "@tangent/ui-primitives/button";
import { Icon, type IconName } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@tangent/ui-primitives/popover";
import { Text } from "@tangent/ui-primitives/typography";
import { type ReactNode, useId, useState } from "react";

interface ComposerPillProps {
  icon: IconName;
  /** The pill's text, e.g. `3 agents · 1 working`. */
  label: string;
  /** Titles the popover's list. */
  heading: string;
  /** Shown beside the heading when `onClear` is set. */
  clearLabel?: string;
  onClear?: () => void;
  /** The popover's list; `close` dismisses it, e.g. once an item opens. */
  children: (close: () => void) => ReactNode;
}

/**
 * A pill above the chat box that opens a short list of what the chat has, such
 * as its agents or files. Render it only while there's something to list, so
 * it closes, and stays closed, once the list empties.
 */
export function ComposerPill({
  icon,
  label,
  heading,
  clearLabel,
  onClear,
  children,
}: ComposerPillProps) {
  const [open, setOpen] = useState(false);
  const headingId = useId();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="xs">
          <Icon name={icon} size="xs" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" aria-labelledby={headingId}>
        <BlockStack gap="0.5" align="stretch">
          <Box paddingInline="sm" paddingBlockStart="xs">
            <InlineStack align="space-between" gap="2" wrap="nowrap">
              <Text id={headingId} size="xs" weight="medium" tone="subdued">
                {heading}
              </Text>
              {onClear && clearLabel ? (
                <Button variant="ghost" size="xs" onClick={onClear}>
                  {clearLabel}
                </Button>
              ) : null}
            </InlineStack>
          </Box>
          <Box maxBlockSize="xl" overflow="scroll-y">
            {children(() => setOpen(false))}
          </Box>
        </BlockStack>
      </PopoverContent>
    </Popover>
  );
}
