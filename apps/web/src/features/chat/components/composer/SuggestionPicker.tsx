import { Box } from "@tangent/ui-primitives/box";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Paragraph, Text } from "@tangent/ui-primitives/typography";
import { Fragment, useEffect, useRef } from "react";

import { ListRow } from "@/shared/ui/patterns/list-row";
import { Surface } from "@/shared/ui/patterns/surface";
import { Truncating } from "@/shared/ui/patterns/truncating";

import { SuggestionDetail } from "./SuggestionDetail";
import type { ComposerSuggestion } from "./useComposerAutocomplete";

interface SuggestionPickerProps {
  /** The listbox's id, which the composer's input points at. */
  id: string;
  optionId: (index: number) => string;
  suggestions: ComposerSuggestion[];
  highlight: number;
  onSelect: (suggestion: ComposerSuggestion) => void;
}

/** The index of the row a grouped row's group starts at, which heads it. */
function groupStart(
  suggestions: ComposerSuggestion[],
  index: number,
): number | undefined {
  const { group } = suggestions[index];
  if (group === undefined) return undefined;
  let start = index;
  while (start > 0 && suggestions[start - 1].group === group) start -= 1;
  return start;
}

/**
 * The composer's `@` / `#` / `/` autocomplete popup, floated above the input.
 * A listbox whose active option the input names, since focus stays in the
 * input: the composer owns arrow/Enter, and clicking a row inserts it. A long
 * list scrolls, following the highlighted row.
 */
export function SuggestionPicker({
  id,
  optionId,
  suggestions,
  highlight,
  onSelect,
}: SuggestionPickerProps) {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const groupHeadingId = (index: number) => `${optionId(index)}-group`;

  useEffect(() => {
    rows.current[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  return (
    // local primitive — absolutely-positioned overlay anchored to the composer.
    <div className="absolute bottom-full left-0 z-20 mb-1 w-80 max-w-full">
      <Surface level={1}>
        <Box maxBlockSize="lg" overflow="scroll-y">
          <BlockStack
            as="ul"
            gap="0.5"
            id={id}
            role="listbox"
            aria-label="Suggestions"
          >
            {suggestions.map((suggestion, index) => {
              const start = groupStart(suggestions, index);
              return (
                <Fragment key={suggestion.key}>
                  {start === index ? (
                    <li id={groupHeadingId(index)} aria-hidden>
                      <Box paddingInline="sm" paddingBlockStart="xs">
                        <InlineStack
                          align="space-between"
                          blockAlign="baseline"
                          gap="2"
                          wrap="nowrap"
                        >
                          <Text size="xs" weight="medium" tone="subdued">
                            {suggestion.group}
                          </Text>
                          {suggestion.groupDetail ? (
                            <Text size="xs" tone="subdued">
                              {suggestion.groupDetail}
                            </Text>
                          ) : null}
                        </InlineStack>
                      </Box>
                    </li>
                  ) : null}
                  <li
                    ref={(row) => {
                      rows.current[index] = row;
                    }}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === highlight}
                    aria-describedby={
                      start === undefined ? undefined : groupHeadingId(start)
                    }
                    onClick={() => onSelect(suggestion)}
                  >
                    <ListRow hoverable selected={index === highlight}>
                      {suggestion.icon ? (
                        <Icon name={suggestion.icon} size="sm" tone="subdued" />
                      ) : null}
                      <Truncating>
                        <Paragraph size="sm" truncate title={suggestion.label}>
                          {suggestion.label}
                        </Paragraph>
                      </Truncating>
                      {suggestion.detail ? (
                        <SuggestionDetail>
                          <Paragraph
                            size="xs"
                            tone="subdued"
                            truncate
                            title={suggestion.detail}
                          >
                            {suggestion.detail}
                          </Paragraph>
                        </SuggestionDetail>
                      ) : null}
                    </ListRow>
                  </li>
                </Fragment>
              );
            })}
          </BlockStack>
        </Box>
      </Surface>
    </div>
  );
}
