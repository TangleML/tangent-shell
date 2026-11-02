import type { GlobalExtensionMeta } from "@tangent/shared/contracts";
import { useState } from "react";

import { IconButton } from "@/shared/ui/patterns/icon-button";
import { Section } from "@/shared/ui/patterns/section";

import { CatalogSearchStep } from "./CatalogSearchStep";
import { ConfirmInstallStep } from "./ConfirmInstallStep";
import { FileStep } from "./FileStep";
import type { InstallTarget } from "./installTarget";
import { marketplaceLabel } from "./marketplaceLabels";
import { SourceRefStep } from "./SourceRefStep";

interface Marketplace {
  id: string;
  canSearch: boolean;
}

interface InstallWizardProps {
  marketplace: Marketplace;
  installed: GlobalExtensionMeta[];
  onClose: () => void;
}

type Step = { kind: "select" } | { kind: "confirm"; target: InstallTarget };

export function InstallWizard({
  marketplace,
  installed,
  onClose,
}: InstallWizardProps) {
  const { label } = marketplaceLabel(marketplace.id);
  const [step, setStep] = useState<Step>({ kind: "select" });

  const select = (target: InstallTarget) =>
    setStep({ kind: "confirm", target });

  return (
    <Section
      title={`Install from ${label}`}
      actions={
        <IconButton icon="X" aria-label="Close installer" onClick={onClose} />
      }
    >
      {step.kind === "confirm" ? (
        <ConfirmInstallStep
          target={step.target}
          onBack={() => setStep({ kind: "select" })}
          onClose={onClose}
        />
      ) : marketplace.canSearch ? (
        <CatalogSearchStep
          marketplaceId={marketplace.id}
          installed={installed}
          onSelect={select}
        />
      ) : marketplace.id === "file" ? (
        <FileStep onSelect={select} />
      ) : (
        <SourceRefStep marketplaceId={marketplace.id} onSelect={select} />
      )}
    </Section>
  );
}
