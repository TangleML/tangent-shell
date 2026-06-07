// local primitive
import type { PropsWithChildren } from "react";

/** Responsive card grid for the agent bundle marketplace. */
export function BundleGrid({ children }: PropsWithChildren) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}

/** Square thumbnail rendering a bundle's preview SVG. */
export function BundleIconImage({ src, alt }: { src: string; alt: string }) {
  return (
    <img src={src} alt={alt} className="h-10 w-10 rounded-md object-contain" />
  );
}
