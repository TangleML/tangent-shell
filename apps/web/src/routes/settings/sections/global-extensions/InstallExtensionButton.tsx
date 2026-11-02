import { Button } from "@tangent/ui-primitives/button";
import { ButtonGroup } from "@tangent/ui-primitives/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tangent/ui-primitives/dropdown-menu";
import { Icon } from "@tangent/ui-primitives/icon";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import { marketplaceLabel } from "./marketplaceLabels";

interface Marketplace {
  id: string;
  canSearch: boolean;
}

interface InstallExtensionButtonProps {
  marketplaces: Marketplace[];
  disabled?: boolean;
  onStart: (marketplaceId: string) => void;
}

function defaultMarketplace(
  marketplaces: Marketplace[],
): Marketplace | undefined {
  return marketplaces.find((m) => m.id === "npm") ?? marketplaces[0];
}

export function InstallExtensionButton({
  marketplaces,
  disabled,
  onStart,
}: InstallExtensionButtonProps) {
  const fallback = defaultMarketplace(marketplaces);
  if (!fallback) return null;

  return (
    <ButtonGroup aria-label="Install extension">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onStart(fallback.id)}
      >
        Install extension
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label="Choose an install source"
            disabled={disabled || marketplaces.length === 0}
          >
            <Icon name="ChevronDown" size="sm" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {marketplaces.map((marketplace) => {
            const { label, icon } = marketplaceLabel(marketplace.id);
            return (
              <DropdownMenuItem
                key={marketplace.id}
                onSelect={() => onStart(marketplace.id)}
              >
                <InlineStack gap="2" blockAlign="center">
                  <Icon name={icon} size="sm" tone="subdued" />
                  <Text size="sm">{label}</Text>
                </InlineStack>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
