/**
 * Cross-component enum tuples shared by more than one component contract. These
 * mirror the corresponding `cva` variant keys in `src/shared/ui` and are a
 * curated subset (display + simple input) safe for third-party bundle
 * components. Component-specific enums live inline in each `*.contract.ts`.
 */

/** Spacing scale shared by `BlockStack` / `InlineStack` `gap`. */
export const GAP = [
  "0",
  "0.5",
  "1",
  "1.5",
  "2",
  "3",
  "4",
  "5",
  "6",
  "8",
] as const;

/** Type scale shared by `Text` / `Heading` `size`. */
export const TEXT_SIZE = ["xs", "sm", "md", "lg", "xl", "2xl"] as const;

/** Semantic tone shared by `Text` / `Heading` `tone`. */
export const TEXT_TONE = [
  "inherit",
  "subdued",
  "strong",
  "weak",
  "critical",
  "inverted",
  "info",
  "warning",
  "success",
  "accent",
  "magic",
] as const;

/** Font weight shared by `Text` / `Heading` `weight`. */
export const TEXT_WEIGHT = [
  "regular",
  "semibold",
  "bold",
  "light",
  "medium",
] as const;
