import { BlockStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import type { MentionCandidate } from "@/features/chat/model/mentions";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Surface } from "@/shared/ui/patterns/surface";

interface MentionPickerProps {
  candidates: MentionCandidate[];
  highlight: number;
  onSelect: (candidate: MentionCandidate) => void;
}

/**
 * The `@mention` autocomplete popup, floated above the composer input. Selection
 * is keyboard-first (the composer owns arrow/Enter); clicking a row inserts it.
 */
export function MentionPicker({
  candidates,
  highlight,
  onSelect,
}: MentionPickerProps) {
  return (
    // local primitive — absolutely-positioned overlay anchored to the composer.
    <div className="absolute bottom-full left-0 z-20 mb-1 w-64 max-w-full">
      <Surface level={1}>
        <BlockStack as="ul" gap="0.5">
          {candidates.map((candidate, index) => (
            <ListRow
              key={candidate.id}
              as="li"
              density="cozy"
              hoverable
              selected={index === highlight}
              onClick={() => onSelect(candidate)}
            >
              <Text size="sm" truncate title={candidate.name}>
                {candidate.name}
              </Text>
            </ListRow>
          ))}
        </BlockStack>
      </Surface>
    </div>
  );
}
