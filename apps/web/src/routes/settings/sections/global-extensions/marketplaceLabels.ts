import type { IconName } from "@tangent/ui-primitives/icon";

interface MarketplaceLabel {
  label: string;
  icon: IconName;
}

const LABELS: Record<string, MarketplaceLabel> = {
  npm: { label: "Pi catalog", icon: "Package" },
  git: { label: "Git repository", icon: "GitBranch" },
  file: { label: "Upload file", icon: "Upload" },
};

export function marketplaceLabel(id: string): MarketplaceLabel {
  return LABELS[id] ?? { label: id, icon: "Package" };
}
