import type { AgentBundleMeta } from "@tangent/shared/contracts";
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

import { agentBundleIconUrl } from "@/features/agent-bundles/api/agentBundlesApi";
import { BundleIconImage } from "@/routes/agent-bundles/bundle-grid";
import { IconButton } from "@/shared/ui/patterns/icon-button";

interface NewSessionButtonProps {
  bundles?: AgentBundleMeta[];
  /** Whether a session is currently being created. */
  creating: boolean;
  onStartDefaultBundle: () => void;
  onStartFromBundle: (bundleId: string, name: string) => void;
}

export function NewSessionButton({
  bundles,
  creating,
  onStartDefaultBundle,
  onStartFromBundle,
}: NewSessionButtonProps) {
  return (
    <ButtonGroup aria-label="New session">
      <Button
        variant="outline"
        onClick={onStartDefaultBundle}
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
