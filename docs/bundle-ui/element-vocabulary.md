# Element vocabulary

A bundle component renders only **remote elements** from the fixed vocabulary
below. Each remote element is a serializable message; the host maps it to a real
Tangle primitive in [`src/shared/ui`](../../src/shared/ui) and renders it. There
is no escape hatch: an element name outside this list does not render.

The vocabulary lives in **one shared module** (Phase 4) that defines both the
worker-side element names/attributes and the host-side element-to-primitive map,
so the two halves cannot drift.

## Allowlist anchor

The host primitives this vocabulary exposes are drawn from `TANGLE_UI_PRIMITIVES`
in [`eslint.config.js`](../../eslint.config.js) — the same canonical list the
linter enforces for first-party code. The vocabulary is a deliberately **small
subset** of that list (display + simple input primitives), not the full set: it
omits layout-shell and app-chrome primitives (`Page`, `Toolbar`, `StickyHeader`,
`ScrollRegion`, `CenteredScreen`, etc.) that don't make sense inside a sandboxed
chat fragment.

## Elements

| Remote element | Host primitive | Notable props (host) | Notes |
| --- | --- | --- | --- |
| `tangent-block-stack` | `BlockStack` | `gap`, `align`, `inlineAlign` | Vertical layout. |
| `tangent-inline-stack` | `InlineStack` | `gap`, `align`, `blockAlign`, `wrap` | Horizontal layout. |
| `tangent-text` | `Text` | `size`, `tone`, `weight` | Inline text. |
| `tangent-heading` | `Heading` | `level` (1-6), `size`, `weight`, `tone` | Section heading. |
| `tangent-button` | `Button` | `variant`, `size`, `tone`, `disabled`; emits `press` | Click maps to a `press` event. |
| `tangent-icon` | `Icon` | `name` (Lucide), `size`, `tone` | `name` validated against the icon set. |
| `tangent-textarea` | `Textarea` | `value`, `placeholder`, `disabled`; emits `input` | Controlled by the component via `input` events. |
| `tangent-spinner` | `Spinner` | `size` (number) | Loading indicator. |
| `tangent-card` | `Card` | `density` | Container surface. |
| `tangent-card-header` | `CardHeader` | `density`, `divider` | Card header region. |
| `tangent-card-title` | `CardTitle` | — | Card title text. |
| `tangent-card-description` | `CardDescription` | — | Card subtitle/description text. |
| `tangent-card-content` | `CardContent` | `density` | Card body region. |
| `tangent-card-footer` | `CardFooter` | `density` | Card footer region. |
| `tangent-badge` | `Badge` | `variant`, `size`, `position`, `shape` | Small label/status badge. |
| `tangent-pill` | `Pill` | `tone`, `size` | Small status chip. |
| `tangent-progress` | `Progress` (**new**, Phase 4) | `value` (0-1), `tone` | No progress primitive exists today; Phase 4 adds `tangent-progress` to `src/shared/ui` and includes it here. |
| `tangent-score-ring` | `ScoreRing` (**new**, Phase 4) | `score` (0-100), `size` (px) | Circular opportunity-score ring with the value centered. |
| `tangent-checkbox` | `Checkbox` (**new**, Phase 4) | `checked`, `label`; emits `change` | Boolean toggle row; `change` carries the new checked value. |

## Props and events

- **Props** are passed as serializable attributes. The host map translates each
  remote attribute to the matching primitive prop (the variant unions above
  come straight from each primitive's `cva` definition, e.g.
  [`button.tsx`](../../src/shared/ui/button.tsx),
  [`layout.tsx`](../../src/shared/ui/layout.tsx),
  [`pill.tsx`](../../src/shared/ui/patterns/pill.tsx)).
- **Events** replace DOM handlers. The browser owns the real DOM event; the host
  forwards a serializable event (e.g. `press` for `tangent-button`, `input` with
  the new value for `tangent-textarea`) back to the worker, where the
  component's handler runs. Handlers therefore receive plain data, never a live
  `Event` object.
- **Children** nest normally (a `tangent-card` containing a `tangent-block-stack`
  of `tangent-text`), as long as every node is from this vocabulary.

## Prop translation rules

- Unknown props are dropped (not forwarded to the DOM).
- `className` and other escape-hatch/style props are **not** part of the
  vocabulary — components cannot inject styles. Spacing and tone come only from
  the semantic props above.
- Enum props are validated against the primitive's variant set; an invalid value
  falls back to the primitive's default rather than erroring.

## Why a curated subset

Keeping the vocabulary small (a) guarantees every element resolves to a real,
themed primitive, (b) keeps the serialized payload tiny, and (c) gives authors a
stable contract that does not break when internal primitives are refactored.
Phase 4 ships unit tests asserting that **every** vocabulary element resolves to
a real primitive and that prop translation works.
