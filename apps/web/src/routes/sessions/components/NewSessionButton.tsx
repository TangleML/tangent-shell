import type { AgentBundleMeta } from "@tangent/shared/contracts";

import { agentBundleIconUrl } from "@/features/agent-bundles/api/agentBundlesApi";
import { DEFAULT_BUNDLE_ID } from "@/features/sessions/constants";
import { BundleIconImage } from "@/routes/agent-bundles/bundle-grid";
import { Button } from "@/shared/ui/button";
import { ButtonGroup } from "@/shared/ui/button-group";
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

interface NewSessionButtonProps {
  bundles?: AgentBundleMeta[];
  /** Whether a session is currently being created. */
  creating: boolean;
  onStartFromBundle: (bundleId: string, name: string) => void;
}

/**
 * Split button that creates a session from the default bundle, with a dropdown
 * to instead start from any available bundle.
 */
export function NewSessionButton({
  bundles,
  creating,
  onStartFromBundle,
}: NewSessionButtonProps) {
  return (
    <ButtonGroup aria-label="New session">
      <Button
        variant="outline"
        onClick={() => onStartFromBundle(DEFAULT_BUNDLE_ID, "Session")}
        disabled={creating}
      >
        {creating ? "Creating..." : "New session"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon="ChevronDown"
            variant="outline"
            size="lg"
            aria-label="Choose a bundle"
            disabled={creating || !bundles?.length}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {bundles?.map((bundle) => (
            <DropdownMenuItem
              key={bundle.id}
              onSelect={() => onStartFromBundle(bundle.id, bundle.name)}
            >
              <InlineStack gap="2" blockAlign="center">
                {bundle.hasIcon ? (
                  <BundleIconImage
                    src={agentBundleIconUrl(bundle.id)}
                    alt=""
                    size="xs"
                  />
                ) : (
                  <Icon name="Package" size="sm" />
                )}
                <Text size="sm">{bundle.name}</Text>
              </InlineStack>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
