/**
 * Host-side element-to-primitive map for the bundle UI vocabulary.
 *
 * Each entry turns a remote element (see `vocabulary.ts`) into a real Tangle
 * primitive from `src/shared/ui`, plus:
 *  - `mapProps`: validates/translates the serialized remote attributes into the
 *    primitive's props (unknown attrs dropped; invalid enum values dropped so
 *    the primitive falls back to its own default; never any `className`/style).
 *  - `events`: maps each remote event name to the primitive's handler prop and,
 *    where needed, an extractor that turns the DOM event into a serializable
 *    payload. Phase 5 supplies the actual worker callbacks; this phase only
 *    defines the mapping.
 *
 * The map is typed as `Record<BundleUiElementName, HostElementDef>`, so adding
 * or removing an element in the vocabulary forces a matching change here.
 */

import { icons } from "lucide-react";
import type { ComponentType } from "react";

import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Pill } from "@/shared/ui/patterns/pill";
import { Progress } from "@/shared/ui/progress";
import { ScoreRing } from "@/shared/ui/score-ring";
import { Spinner } from "@/shared/ui/spinner";
import { Textarea } from "@/shared/ui/textarea";
import { Heading, Text } from "@/shared/ui/typography";

import {
  type AttributeSpec,
  BUNDLE_UI_ELEMENTS,
  type BundleUiElementName,
  type ElementSpec,
} from "./vocabulary";

/** A remote event mapped to a primitive handler prop. */
export interface EventDef {
  /** The primitive prop the handler is passed as (e.g. `onClick`). */
  prop: string;
  /** Turn the host DOM event into a serializable payload for the worker. */
  extract?: (event: unknown) => unknown;
}

export interface HostElementDef {
  component: ComponentType<Record<string, unknown>>;
  /** Validate + translate raw remote attributes into primitive props. */
  mapProps: (attrs: Record<string, unknown>) => Record<string, unknown>;
  /** Remote event name -> primitive handler mapping. */
  events: Record<string, EventDef>;
}

function coerce(spec: AttributeSpec, value: unknown): unknown {
  switch (spec.kind) {
    case "enum":
      return typeof value === "string" && spec.values?.includes(value)
        ? value
        : undefined;
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "string":
      return typeof value === "string" ? value : undefined;
  }
}

/**
 * Generic attribute translation shared by every element: drops attributes not
 * declared in the spec and coerces/validates the rest, omitting invalid values
 * so the primitive applies its own default.
 */
function translateAttributes(
  spec: ElementSpec,
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const attrSpec = spec.attributes[key];
    if (!attrSpec) continue;
    const translated = coerce(attrSpec, value);
    if (translated !== undefined) out[key] = translated;
  }
  return out;
}

/** Build a `mapProps` that just runs the generic translation for `name`. */
function passthrough(name: BundleUiElementName) {
  const spec = BUNDLE_UI_ELEMENTS[name];
  return (attrs: Record<string, unknown>) => translateAttributes(spec, attrs);
}

function readInputValue(event: unknown): string {
  const target = (event as { target?: { value?: unknown } } | null)?.target;
  return typeof target?.value === "string" ? target.value : "";
}

/** The new checked value arrives directly as the event payload. */
function readCheckedValue(event: unknown): boolean {
  return typeof event === "boolean" ? event : Boolean(event);
}

export const hostComponentMap: Record<BundleUiElementName, HostElementDef> = {
  "tangent-block-stack": {
    component: BlockStack as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-block-stack"),
    events: {},
  },
  "tangent-inline-stack": {
    component: InlineStack as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-inline-stack"),
    events: {},
  },
  "tangent-text": {
    component: Text as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-text"),
    events: {},
  },
  "tangent-heading": {
    component: Heading as unknown as ComponentType<Record<string, unknown>>,
    mapProps: (attrs) => {
      const props = translateAttributes(BUNDLE_UI_ELEMENTS["tangent-heading"], attrs);
      // `level` is an enum string in the vocabulary; Heading expects a number.
      if (typeof props.level === "string") props.level = Number(props.level);
      return props;
    },
    events: {},
  },
  "tangent-button": {
    component: Button as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-button"),
    events: { press: { prop: "onClick" } },
  },
  "tangent-icon": {
    component: Icon as unknown as ComponentType<Record<string, unknown>>,
    mapProps: (attrs) => {
      const props = translateAttributes(BUNDLE_UI_ELEMENTS["tangent-icon"], attrs);
      // `name` must resolve to a real Lucide icon; drop it otherwise.
      if (typeof props.name === "string" && !(props.name in icons)) {
        delete props.name;
      }
      return props;
    },
    events: {},
  },
  "tangent-textarea": {
    component: Textarea as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-textarea"),
    events: { input: { prop: "onChange", extract: readInputValue } },
  },
  "tangent-spinner": {
    component: Spinner as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-spinner"),
    events: {},
  },
  "tangent-card": {
    component: Card as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-card"),
    events: {},
  },
  "tangent-pill": {
    component: Pill as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-pill"),
    events: {},
  },
  "tangent-progress": {
    component: Progress as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-progress"),
    events: {},
  },
  "tangent-score-ring": {
    component: ScoreRing as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-score-ring"),
    events: {},
  },
  "tangent-checkbox": {
    component: Checkbox as ComponentType<Record<string, unknown>>,
    mapProps: passthrough("tangent-checkbox"),
    events: { change: { prop: "onCheckedChange", extract: readCheckedValue } },
  },
};
