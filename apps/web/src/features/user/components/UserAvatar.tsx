import { Spinner } from "@tangent/ui-primitives/spinner";
import { useQuery } from "@tanstack/react-query";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";

import { resolveGravatarUrl } from "@/features/user/model/gravatar";
import { UserQueryKeys } from "@/features/user/model/userQueryKeys";

type AvatarSize = "sm" | "md";

const avatarImageVariants = cva("shrink-0 rounded-full object-cover", {
  variants: {
    size: {
      sm: "size-6",
      md: "size-8",
    },
    grayscale: {
      true: "opacity-70 grayscale",
      false: "",
    },
  },
  defaultVariants: {
    size: "md",
    grayscale: false,
  },
});

const AVATAR_SIZE_PX: Record<AvatarSize, number> = {
  sm: 48,
  md: 64,
};

interface UserAvatarProps {
  /** Email to resolve a Gravatar for; empty skips the lookup and shows `fallback`. */
  email: string;
  /** Accessible label and tooltip for the image. */
  name: string;
  /** Badge shown when the email has no Gravatar or the lookup hasn't resolved. */
  fallback: ReactNode;
  size?: AvatarSize;
  /** Desaturate the image, e.g. to mark an inactive participant. */
  grayscale?: boolean;
}

/**
 * UserAvatar — circular Gravatar image with a fallback badge. The existence
 * check lives in the query (Gravatar 404s for emails without an avatar), so a
 * missing avatar simply resolves to no URL and `fallback` renders — no separate
 * error state or image `onError`.
 *
 * Styles a raw `<img>` (the sanctioned escape hatch, like `StatusDot`), so it is
 * exempt from `tangle-ui/no-classname-on-primitives`.
 */
export function UserAvatar({
  email,
  name,
  fallback,
  size = "md",
  grayscale = false,
}: UserAvatarProps) {
  const { data: src, isLoading } = useQuery({
    queryKey: UserQueryKeys.Gravatar(email, AVATAR_SIZE_PX[size]),
    queryFn: () => resolveGravatarUrl(email, AVATAR_SIZE_PX[size]),
    enabled: email.trim().length > 0,
    staleTime: Infinity,
  });

  if (isLoading) return <Spinner />;

  if (!src) return <>{fallback}</>;

  return (
    <img
      src={src}
      title={name}
      alt={name}
      className={avatarImageVariants({ size, grayscale })}
    />
  );
}
