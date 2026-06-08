/**
 * Bundle UI element vocabulary — the fixed contract between a sandboxed bundle
 * component (Web Worker, Phase 5) and the host renderer.
 *
 * This module is the **single source of truth** for which remote elements
 * exist, which attributes/events each one accepts, and (for enum attributes)
 * the set of valid values. It is deliberately **React-free** so the worker can
 * import it without pulling in the host design system. The host-side map that
 * turns each element into a real Tangle primitive lives in
 * `hostComponentMap.tsx` and keys off the names exported here, so the two
 * halves cannot drift.
 *
 * See `docs/bundle-ui/element-vocabulary.md` for the authored reference. Enum
 * value sets mirror each primitive's `cva` definition in `src/shared/ui`; they
 * are intentionally a curated subset (display + simple input), not the full
 * variant set. Invalid enum values are dropped by the host so the primitive
 * applies its own default (so we never duplicate defaults here).
 */

/** How an attribute's value is validated before reaching the host primitive. */
export type AttributeKind = "enum" | "string" | "number" | "boolean";

export interface AttributeSpec {
  kind: AttributeKind;
  /**
   * Allowed values for `kind: "enum"`. A value outside this set is dropped (the
   * primitive then uses its own default), per the vocabulary contract.
   */
  values?: readonly string[];
}

export interface ElementSpec {
  /** Allowed attributes, keyed by remote attribute name. */
  attributes: Readonly<Record<string, AttributeSpec>>;
  /** Remote event names this element emits (e.g. `press`, `input`). */
  events: readonly string[];
}

// --- Shared enum sets (copied from the primitives' cva definitions) ---------

const GAP = [
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

const TEXT_SIZE = ["xs", "sm", "md", "lg", "xl", "2xl"] as const;
const TEXT_TONE = [
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
const TEXT_WEIGHT = ["regular", "semibold", "bold", "light", "medium"] as const;

const ICON_SIZE = ["xs", "sm", "md", "lg", "xl", "2xl", "fill"] as const;
const ICON_TONE = [
  "inherit",
  "subdued",
  "strong",
  "weak",
  "critical",
  "warning",
  "success",
  "info",
  "accent",
  "magic",
] as const;

// Curated subset of Button variants/sizes safe for third-party components.
const BUTTON_VARIANT = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;
const BUTTON_SIZE = ["default", "xs", "sm", "lg"] as const;
const BUTTON_TONE = ["default", "critical", "warning", "success"] as const;

const PILL_TONE = [
  "default",
  "subdued",
  "critical",
  "warning",
  "info",
  "success",
  "magic",
] as const;
const PILL_SIZE = ["xs", "sm", "md"] as const;

const PROGRESS_TONE = [
  "default",
  "info",
  "success",
  "warning",
  "critical",
] as const;

const DENSITY = ["compact", "cozy", "comfortable"] as const;

const HEADING_LEVEL = ["1", "2", "3", "4", "5", "6"] as const;

const BLOCK_STACK_ALIGN = ["start", "center", "end", "stretch"] as const;
const BLOCK_STACK_INLINE_ALIGN = [
  "start",
  "center",
  "end",
  "space-around",
  "space-between",
  "space-evenly",
] as const;
const INLINE_STACK_ALIGN = [
  "start",
  "center",
  "end",
  "space-around",
  "space-between",
  "space-evenly",
] as const;
const INLINE_STACK_BLOCK_ALIGN = [
  "start",
  "center",
  "end",
  "baseline",
  "stretch",
] as const;
const WRAP = ["wrap", "nowrap"] as const;

const enumAttr = (values: readonly string[]): AttributeSpec => ({
  kind: "enum",
  values,
});

/**
 * The complete element vocabulary. Adding or removing an element here forces a
 * matching change in `hostComponentMap.tsx` (enforced by a `Record` type), so
 * the worker view and host view stay in lockstep.
 */
export const BUNDLE_UI_ELEMENTS = {
  "tangent-block-stack": {
    attributes: {
      gap: enumAttr(GAP),
      align: enumAttr(BLOCK_STACK_ALIGN),
      inlineAlign: enumAttr(BLOCK_STACK_INLINE_ALIGN),
    },
    events: [],
  },
  "tangent-inline-stack": {
    attributes: {
      gap: enumAttr(GAP),
      align: enumAttr(INLINE_STACK_ALIGN),
      blockAlign: enumAttr(INLINE_STACK_BLOCK_ALIGN),
      wrap: enumAttr(WRAP),
    },
    events: [],
  },
  "tangent-text": {
    attributes: {
      size: enumAttr(TEXT_SIZE),
      tone: enumAttr(TEXT_TONE),
      weight: enumAttr(TEXT_WEIGHT),
    },
    events: [],
  },
  "tangent-heading": {
    attributes: {
      level: enumAttr(HEADING_LEVEL),
      size: enumAttr(TEXT_SIZE),
      weight: enumAttr(TEXT_WEIGHT),
      tone: enumAttr(TEXT_TONE),
    },
    events: [],
  },
  "tangent-button": {
    attributes: {
      variant: enumAttr(BUTTON_VARIANT),
      size: enumAttr(BUTTON_SIZE),
      tone: enumAttr(BUTTON_TONE),
      disabled: { kind: "boolean" },
    },
    events: ["press"],
  },
  "tangent-icon": {
    attributes: {
      name: { kind: "string" },
      size: enumAttr(ICON_SIZE),
      tone: enumAttr(ICON_TONE),
    },
    events: [],
  },
  "tangent-textarea": {
    attributes: {
      value: { kind: "string" },
      placeholder: { kind: "string" },
      disabled: { kind: "boolean" },
    },
    events: ["input"],
  },
  "tangent-spinner": {
    attributes: {
      size: { kind: "number" },
    },
    events: [],
  },
  "tangent-card": {
    attributes: {
      density: enumAttr(DENSITY),
    },
    events: [],
  },
  "tangent-pill": {
    attributes: {
      tone: enumAttr(PILL_TONE),
      size: enumAttr(PILL_SIZE),
    },
    events: [],
  },
  "tangent-progress": {
    attributes: {
      value: { kind: "number" },
      tone: enumAttr(PROGRESS_TONE),
    },
    events: [],
  },
  "tangent-score-ring": {
    attributes: {
      score: { kind: "number" },
      size: { kind: "number" },
    },
    events: [],
  },
  "tangent-checkbox": {
    attributes: {
      checked: { kind: "boolean" },
      label: { kind: "string" },
    },
    events: ["change"],
  },
} as const satisfies Record<string, ElementSpec>;

/** Union of valid remote element names. */
export type BundleUiElementName = keyof typeof BUNDLE_UI_ELEMENTS;

/** Runtime list of every element name in the vocabulary. */
export const BUNDLE_UI_ELEMENT_NAMES = Object.keys(
  BUNDLE_UI_ELEMENTS,
) as BundleUiElementName[];

/** Type guard: is `name` a recognized remote element? */
export function isBundleUiElement(name: string): name is BundleUiElementName {
  return name in BUNDLE_UI_ELEMENTS;
}
