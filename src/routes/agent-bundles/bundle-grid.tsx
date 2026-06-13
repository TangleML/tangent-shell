// local primitive
import { cva, type VariantProps } from "class-variance-authority";
import type { ImgHTMLAttributes, PropsWithChildren } from "react";

/** Responsive card grid for the agent bundle marketplace. */
export function BundleGrid({ children }: PropsWithChildren) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}

const bundleIconCva = cva("rounded-md object-contain", {
  variants: {
    size: {
      xs: "h-4 w-4",
      sm: "h-6 w-6",
      md: "h-10 w-10",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

/** Square thumbnail rendering a bundle's preview SVG. */
export function BundleIconImage({
  src,
  alt,
  size,
  ...props
}: VariantProps<typeof bundleIconCva> & ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img src={src} alt={alt} className={bundleIconCva({ size })} {...props} />
  );
}
