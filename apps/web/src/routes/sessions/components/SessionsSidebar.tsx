import type { AgentBundleMeta } from "@tangent/shared/contracts";
import { useRef } from "react";

import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import {
  SideNav,
  SideNavLink,
  SideNavSection,
} from "@/shared/ui/patterns/side-nav";

interface SessionsSidebarProps {
  bundles?: AgentBundleMeta[];
  /** Whether a session is currently being created. */
  creating: boolean;
  onCreateBlank: () => void;
  onPickConfig: (file: File) => void;
  onStartFromBundle: (bundleId: string, name: string) => void;
}

/** Left navigation rail for the sessions page: navigation plus creation entry points. */
export function SessionsSidebar({
  bundles,
  creating,
  onCreateBlank,
  onPickConfig,
  onStartFromBundle,
}: SessionsSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file still fires `change`.
    event.target.value = "";
    if (file) onPickConfig(file);
  };

  return (
    <SideNav>
      <SideNavSection title="Navigate">
        <SideNavLink to="/sessions">
          <Icon name="LayoutGrid" size="sm" />
          All sessions
        </SideNavLink>
        <SideNavLink to="/agent-bundles">
          <Icon name="Package" size="sm" />
          Agent bundles
        </SideNavLink>
      </SideNavSection>

      <SideNavSection title="New session">
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          hidden
          onChange={handleFilePicked}
        />
        <Button
          fullWidth
          variant="outline"
          align="start"
          onClick={onCreateBlank}
          disabled={creating}
        >
          <Icon name="Plus" size="sm" />
          Blank session
        </Button>
        <Button
          fullWidth
          align="start"
          variant="ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={creating}
        >
          <Icon name="Upload" size="sm" />
          From config (.zip)
        </Button>
      </SideNavSection>

      {bundles && bundles.length > 0 ? (
        <SideNavSection title="From bundle">
          {bundles.map((bundle) => (
            <Button
              key={bundle.id}
              fullWidth
              align="start"
              truncate
              variant="ghost"
              onClick={() => onStartFromBundle(bundle.id, bundle.name)}
              disabled={creating}
            >
              <Icon name="Package" size="sm" />
              <span>{bundle.name}</span>
            </Button>
          ))}
        </SideNavSection>
      ) : null}
    </SideNav>
  );
}
