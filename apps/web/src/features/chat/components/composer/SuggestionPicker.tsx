import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import { Fragment } from "react";

import { ListRow } from "@/shared/ui/patterns/list-row";
import { Surface } from "@/shared/ui/patterns/surface";
import { Truncating } from "@/shared/ui/patterns/truncating";

import type { ComposerSuggestion } from "./useComposerAutocomplete";

interface SuggestionPickerProps {
  suggestions: ComposerSuggestion[];
  highlight: number;
  onSelect: (suggestion: ComposerSuggestion) => void;
}

/**
 * The composer's `@` / `#` autocomplete popup, floated above the input.
 * Selection is keyboard-first (the composer owns arrow/Enter); clicking a row
 * inserts it.
 */
export function SuggestionPicker({
  suggestions,
  highlight,
  onSelect,
}: SuggestionPickerProps) {
  return (
    // local primitive — absolutely-positioned overlay anchored to the composer.
    <div className="absolute bottom-full left-0 z-20 mb-1 w-80 max-w-full">
      <Surface level={1}>
        <BlockStack as="ul" gap="0.5">
          {suggestions.map((suggestion, index) => (
            <Fragment key={suggestion.key}>
              {suggestion.group &&
              suggestion.group !== suggestions[index - 1]?.group ? (
                <li className="px-2 pt-1.5 pb-0.5">
                  <Text size="xs" weight="medium" tone="subdued">
                    {suggestion.group}
                  </Text>
                </li>
              ) : null}
              <ListRow
                as="li"
                density="cozy"
                hoverable
                selected={index === highlight}
                onClick={() => onSelect(suggestion)}
              >
                {suggestion.icon ? (
                  <Icon name={suggestion.icon} size="sm" tone="subdued" />
                ) : null}
                <Truncating>
                  <Text size="sm" truncate title={suggestion.label}>
                    {suggestion.label}
                  </Text>
                </Truncating>
                {suggestion.detail ? (
                  <Truncating grow="fit">
                    <Text size="xs" tone="subdued" truncate>
                      {suggestion.detail}
                    </Text>
                  </Truncating>
                ) : null}
              </ListRow>
            </Fragment>
          ))}
        </BlockStack>
      </Surface>
    </div>
  );
}
