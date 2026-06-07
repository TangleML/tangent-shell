---
name: ui-primitives
description: Layered Tangle UI design system in src/shared/ui. Base primitives (BlockStack, InlineStack, Text, Heading, Paragraph, Button, Icon, Textarea, Spinner, Link), Layer-3 semantic patterns (Surface, Section, Card, ListRow, ScrollRegion, Truncating, HoverReveal, IconButton, EmptyState, Pill, StickyHeader, Toolbar, Divider, Page, CenteredScreen), and the Box escape hatch. Use when writing JSX, styling, layout, or typography.
---

# UI Primitives

The single rule for feature code:

> **Do not pass `className` to a Tangle UI primitive.** Use a semantic prop or a Layer-3 pattern.

This is enforced by the `tangle-ui/no-classname-on-primitives` ESLint rule, which runs as
`error` on `src/features/**` and `src/routes/**`. The `className` prop still exists on most
primitives as a deprecated migration escape hatch — do not use it in new code.

`cn()` (from `@/shared/lib/utils`) and raw Tailwind classes are allowed **only** inside local
primitives (raw HTML elements), never on a Tangle primitive.

See [DESIGN_SYSTEM.md](../../../src/shared/ui/DESIGN_SYSTEM.md) for the full reference.

## The four layers

Code is expected to live in the upper layers. Reaching for a lower one is a smell.

- **Layer 4 — feature/domain** (`src/features/*`, `src/routes/*`): components that encode app
  behavior specific to a screen.
- **Layer 3 — semantic patterns** (`@/shared/ui/patterns/*`, plus `Card` at `@/shared/ui/card`):
  use when an intent is named (a panel, a scroll region, a row, ...).
- **Layer 2 — base primitives** (`@/shared/ui/{layout,typography,button,icon,textarea,spinner,link}`):
  raw layout, text, or interactive controls.
- **Layer 1 — `Box`** (`@/shared/ui/box`): token-only styled container. Escape hatch when nothing
  higher fits. Has no `className` and no flex helpers (use `BlockStack`/`InlineStack` for layout).

### Escalation ladder

1. Is the visual intent named by a base primitive? Use it (`<Text tone="subdued">`, `<BlockStack gap="2">`).
2. Does a Layer-3 primitive name the combination you need? Use it (`<ListRow hoverable>`, `<ScrollRegion>`).
3. Is this domain-specific? Add a Layer-4 component under `src/features/*` or `src/routes/*`.
4. Still no fit and bespoke styling needed? Write a colocated local primitive (raw HTML, marked).
5. Reaching for `Box` repeatedly with the same shape? That is a missing Layer-3 primitive.

## Layer 2 — base primitives

### Layout — `@/shared/ui/layout`

`BlockStack` (vertical, `flex-col`) and `InlineStack` (horizontal, `flex-row`). Use these instead
of `<div className="flex ...">`.

- `gap`: one of `"0"`, `"0.5"`, `"1"`, `"1.5"`, `"2"`, `"3"`, `"4"`, `"5"`, `"6"`, `"8"`
- `align`: main-axis (BlockStack: cross-axis items) — `start`/`center`/`end`/`stretch`/`space-*`
- `inlineAlign` (BlockStack) / `blockAlign` (InlineStack): the other axis
- `wrap` (InlineStack only): `wrap` / `nowrap`
- `fill`: fill the container and center content
- `grow`: take remaining main-axis space and host a scroll region (`flex-1 min-h-0 min-w-0`)
- `as`: semantic element — `div` (default), `span`, `li`, `ol`, `ul`

### Typography — `@/shared/ui/typography`

Use `Heading` for headings, `Paragraph` for paragraph text, and `Text` for inline text — never raw
`<h*>`/`<p>`/`<span>` with Tailwind classes.

- `<Heading level={1..6}>` renders `<h1-h6>` with `role="heading"` + `aria-level`. Defaults: level 1
  is `size="md"` + `weight="semibold"`; levels 2-6 are `size="sm"` (level 2 stays `semibold`).
- `<Paragraph>` is `Text` rendered as `<p>`.
- `<Text as="dt">`, `<Text as="dd">`, etc. for inline/semantic text.
- Shared props: `tone`, `size` (`xs`-`2xl`), `weight`, `font` (`default`/`mono`), `align`, `wrap`,
  `italic`, `leading`, `transform`, `decoration`, `truncate` (`boolean` or line count `N`).

### Buttons — `@/shared/ui/button`

`Button` props: `variant` (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`,
`toolbar`, `menubar`, ...), `size` (`default`, `xs`, `sm`, `lg`, `icon`, `min`, `inline-xs`),
`tone` (`default`/`critical`/`warning`/`success`), `align`, `fullWidth`, `truncate`, `asChild`.

### Icons — `@/shared/ui/icon`

`Icon` props: `name` (a Lucide icon name), `size` (`xs`-`2xl`, `fill`), `tone`, `rotate`, `spin`,
`pulse`.

### Other base primitives

- `Textarea` (`@/shared/ui/textarea`): `autoGrow` to grow with content up to a max height.
- `Spinner` (`@/shared/ui/spinner`): `size` (number).
- `Link` (`@/shared/ui/link`): `variant`, `size`, `external` (adds target/rel + external icon).

## Layer 3 — semantic patterns

Reach for these instead of stacking utility classes. Each names an intent:

- `Surface` — nesting-aware container with predefined treatment. `level` (1-3, auto-derived from
  context), `tone`, `hoverable`, `onClick`. Replaces `bg-* rounded-* border-* p-*` panels.
- `Section` — `Surface` with a built-in header. `title`, `actions`, `divider`, `level`, `tone`,
  `headingLevel`.
- `Card` + `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter` (`@/shared/ui/card`):
  `density`. Establishes Surface level 1.
- `ListRow` — list row composing `InlineStack` + the `group` class. `density`, `hoverable`,
  `selected`, `zebra`, `gap`, `onClick`. Replaces `<InlineStack className="group hover:bg-* px-* py-*">`.
- `ScrollRegion` — fills available flex space and scrolls. `axis` (`y`/`x`/`both`), `scrollbar`.
  Replaces `flex-1 min-h-0 overflow-y-auto`.
- `Truncating` — wraps a shrinkable flex cell (`min-w-0 flex-1`). `grow` (`fill`/`fit`). Put
  `truncate` on the inner `<Text>`.
- `HoverReveal` — reveal actions on hover/focus of an enclosing `ListRow`/`group`. `mode`
  (`on-hover`/`dim-until-hover`), `shrink`.
- `IconButton` — square icon-only button. `icon`, `size`, `variant`, `tone`, and a **required**
  `aria-label`. Replaces `<Button size="..." className="h-5 w-5 p-0"><Icon /></Button>`.
- `EmptyState` — centered placeholder. `icon`, `title`, `description`, `action`.
- `Pill` — small chip/tag. `size`, `tone`, `hoverable`, `muted`.
- `StickyHeader` — `sticky top-0` header inside a `ScrollRegion`. `background`, `divider`.
- `Toolbar` — horizontal action bar. `density`, `chrome`, `sticky`, `align`, `gap`.
- `Divider` — wrapper over `Separator`. `inset`, `orientation`, `decorative`.
- `Page` — centered, max-width page column. `height` (`auto`/`screen`), `padded`.
- `CenteredScreen` — full-viewport centered column (hero, not-found, error). `gap`.

For text styling use props on `Text`/`Paragraph`/`Heading`; for `Icon` use `tone`/`rotate`/`spin`/
`pulse`/`size`; for `Button` use `tone`/`fullWidth`/`align`/`truncate`/`variant`.

## Local primitives (the only place custom classNames are allowed)

When no primitive fits and you need bespoke styling, write a **local primitive**:

- It lives in its own file, colocated with the feature that uses it.
- It styles a **raw HTML element** (`div`, `span`, `textarea`, ...), never a Tangle primitive.
- It is marked with a `// local primitive` comment at the top.

The ESLint rule ignores raw HTML elements, so local primitives are naturally exempt. If you reach
for the same shape repeatedly, promote it to a shared Layer-3 pattern under `@/shared/ui/patterns/`.
