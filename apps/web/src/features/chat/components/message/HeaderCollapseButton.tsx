import { HoverReveal } from "@/shared/ui/patterns/hover-reveal";
import { IconButton } from "@/shared/ui/patterns/icon-button";

interface HeaderCollapseButtonProps {
  onCollapse?: () => void;
}

/** Standalone collapse control for headers that lack a copy action. */
export function HeaderCollapseButton({
  onCollapse,
}: HeaderCollapseButtonProps) {
  if (!onCollapse) return null;
  return (
    <HoverReveal>
      <IconButton
        icon="ChevronsDownUp"
        size="xs"
        variant="ghost"
        aria-label="Collapse message"
        onClick={onCollapse}
      />
    </HoverReveal>
  );
}
