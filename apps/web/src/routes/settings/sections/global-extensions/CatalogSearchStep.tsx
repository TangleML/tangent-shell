import type { GlobalExtensionMeta } from "@tangent/shared/contracts";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Paragraph, Text } from "@tangent/ui-primitives/typography";
import { type PropsWithChildren, useState } from "react";

import { useDebouncedValue } from "@/features/global-extensions/hooks/useDebouncedValue";
import { useMarketplaceSearch } from "@/features/global-extensions/hooks/useMarketplaceSearch";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Pill } from "@/shared/ui/patterns/pill";
import { TextInput } from "@/shared/ui/patterns/text-input";
import { Truncating } from "@/shared/ui/patterns/truncating";

import type { InstallTarget } from "./installTarget";

// local primitive — bounded, scrollable result list with a visible thin scrollbar.
function ResultsScroll({ children }: PropsWithChildren) {
  return (
    <div className="visible-scrollbar max-h-80 w-full overflow-y-scroll overflow-x-hidden">
      {children}
    </div>
  );
}

interface CatalogSearchStepProps {
  marketplaceId: string;
  installed: GlobalExtensionMeta[];
  onSelect: (target: InstallTarget) => void;
}

export function CatalogSearchStep({
  marketplaceId,
  installed,
  onSelect,
}: CatalogSearchStepProps) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim());
  const results = useMarketplaceSearch(marketplaceId, debounced);

  const installedNames = new Set(installed.map((ext) => ext.name));

  return (
    <BlockStack gap="3">
      <TextInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search the Pi catalog..."
        aria-label="Search the Pi catalog"
        autoFocus
      />

      {results.isError ? (
        <Paragraph size="sm" tone="critical" role="alert">
          Search failed: {results.error.message}
        </Paragraph>
      ) : null}

      <ResultsScroll>
        {results.isPending ? (
          <Paragraph size="sm" tone="subdued">
            Searching...
          </Paragraph>
        ) : null}

        {results.data && results.data.length === 0 ? (
          <Paragraph size="sm" tone="subdued">
            No Pi packages match.
          </Paragraph>
        ) : null}

        {results.data && results.data.length > 0 ? (
          <BlockStack as="ul" gap="1">
            {results.data.map((listing) => {
              const alreadyInstalled = installedNames.has(listing.name);
              return (
                <ListRow
                  as="li"
                  key={listing.ref}
                  hoverable
                  onClick={() =>
                    onSelect({
                      kind: "source",
                      source: `${marketplaceId}:${listing.ref}`,
                      name: listing.name,
                      version: listing.version,
                      installed: alreadyInstalled,
                    })
                  }
                >
                  <Truncating>
                    <BlockStack gap="0.5" align="stretch">
                      <InlineStack gap="2" blockAlign="baseline">
                        <Truncating>
                          <Text size="sm" weight="medium" truncate>
                            {listing.name}
                          </Text>
                        </Truncating>
                        {listing.version ? (
                          <Text size="xs" tone="subdued">
                            v{listing.version}
                          </Text>
                        ) : null}
                      </InlineStack>
                      {listing.description ? (
                        <Text size="xs" tone="subdued" truncate>
                          {listing.description}
                        </Text>
                      ) : null}
                    </BlockStack>
                  </Truncating>
                  {alreadyInstalled ? (
                    <Pill size="xs" tone="subdued">
                      Installed
                    </Pill>
                  ) : null}
                </ListRow>
              );
            })}
          </BlockStack>
        ) : null}
      </ResultsScroll>
    </BlockStack>
  );
}
