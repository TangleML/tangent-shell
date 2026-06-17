import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Shorten a string by keeping its head and tail and replacing the middle with
 * an ellipsis (e.g. long file paths or URLs). Returns the input unchanged when
 * it is already within `maxLength`.
 */
export function truncateMiddle(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }
  const midLength = Math.floor(maxLength / 2);
  return text.slice(0, midLength) + "..." + text.slice(-midLength);
}
