import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { Paragraph, Text } from "@tangent/ui-primitives/typography";
import { Fragment, useEffect, useRef } from "react";

import { ListRow } from "@/shared/ui/patterns/list-row";
import { Surface } from "@/shared/ui/patterns/surface";
import { Truncating } from "@/shared/ui/patterns/truncating";

import type { ComposerSuggestion } from "./useComposerAutocomplete";

interface SuggestionPickerProps {
  suggestions: ComposerSuggestion[];
  highlight: number;
  onSelect: (suggestion: ComposerSuggestion) => void;
}

function startsGroup(suggestions: ComposerSuggestion[], index: number) {
  const { group } = suggestions[index];
  return group !== undefined && group !== suggestions[index - 1]?.group;
}

/**
 * The composer's `@` / `#` autocomplete popup, floated above the input.
 * Selection is keyboard-first (the composer owns arrow/Enter); clicking a row
 * inserts it. A long list scrolls, following the highlighted row.
 */
export function SuggestionPicker({
  suggestions,
  highlight,
  onSelect,
}: SuggestionPickerProps) {
  const rows = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    rows.current[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  return (
    // local primitive — absolutely-positioned overlay anchored to the composer.
    <div className="absolute bottom-full left-0 z-20 mb-1 w-80 max-w-full">
      <Surface level={1}>
        <div className="subtle-scrollbar max-h-80 overflow-y-auto overscroll-contain">
          <BlockStack as="ul" gap="0.5">
            {suggestions.map((suggestion, index) => (
              <Fragment key={suggestion.key}>
                {startsGroup(suggestions, index) ? (
                  <li className="flex items-baseline justify-between gap-2 px-2 pt-1.5 pb-0.5">
                    <Text size="xs" weight="medium" tone="subdued">
                      {suggestion.group}
                    </Text>
                    {suggestion.groupDetail ? (
                      <Text size="xs" tone="subdued">
                        {suggestion.groupDetail}
                      </Text>
                    ) : null}
                  </li>
                ) : null}
                <ListRow
                  ref={(row) => {
                    rows.current[index] = row;
                  }}
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
                    <Paragraph size="sm" truncate title={suggestion.label}>
                      {suggestion.label}
                    </Paragraph>
                  </Truncating>
                  {suggestion.detail ? (
                    <div className="max-w-[45%] min-w-0 shrink-0">
                      <Paragraph
                        size="xs"
                        tone="subdued"
                        truncate
                        title={suggestion.detail}
                      >
                        {suggestion.detail}
                      </Paragraph>
                    </div>
                  ) : null}
                </ListRow>
              </Fragment>
            ))}
          </BlockStack>
        </div>
      </Surface>
    </div>
  );
}
