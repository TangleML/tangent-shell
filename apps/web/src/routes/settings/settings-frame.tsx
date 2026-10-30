// local primitive — header row and section nav column for the settings layout.
// Styles raw elements, so it is exempt from tangle-ui/no-classname-on-primitives.
import type { PropsWithChildren, ReactNode } from "react";

interface SettingsHeaderProps {
  title: ReactNode;
}

export function SettingsHeader({
  title,
  children,
}: PropsWithChildren<SettingsHeaderProps>) {
  return (
    <div className="relative flex w-full items-center">
      {children}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {title}
      </div>
    </div>
  );
}

export function SettingsNav({ children }: PropsWithChildren) {
  return (
    <nav
      aria-label="Settings sections"
      className="flex min-h-100 w-48 shrink-0 flex-col gap-1 border-r border-border pr-4"
    >
      {children}
    </nav>
  );
}
