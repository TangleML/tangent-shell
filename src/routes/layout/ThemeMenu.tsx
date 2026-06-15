import { THEMES } from "@/shared/theme/theme";
import { useTheme } from "@/shared/theme/themeContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Icon } from "@/shared/ui/icon";
import { InlineStack } from "@/shared/ui/layout";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { Text } from "@/shared/ui/typography";

/**
 * ThemeMenu — top-nav control for choosing the active UI theme
 * (Light, Dark, or Xterm). Persists the selection via the ThemeProvider.
 */
export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const active = THEMES.find((option) => option.value === theme) ?? THEMES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={active.icon}
          variant="ghost"
          size="md"
          aria-label="Change theme"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {THEMES.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setTheme(option.value)}
          >
            <InlineStack fill align="space-between" blockAlign="center" gap="3">
              <InlineStack gap="2" blockAlign="center">
                <Icon name={option.icon} size="sm" />
                <Text size="sm">{option.label}</Text>
              </InlineStack>
              {option.value === theme ? <Icon name="Check" size="sm" /> : null}
            </InlineStack>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
