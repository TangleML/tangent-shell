---
name: accessibility
description: Accessibility patterns and requirements for this project. Use when creating interactive components, forms, dialogs, or any user-facing UI.
---

# Accessibility Patterns

Several base primitives in `@/shared/ui` are built on **Radix UI** (`radix-ui` /
`@radix-ui/react-*` — e.g. tooltip, collapsible, dropdown-menu, popover, separator), which provides
strong built-in focus management and keyboard handling. Follow these patterns to maintain that
standard. Prefer the design-system primitives (see `ui-primitives`) over hand-rolled markup — they
bake in the a11y affordances.

## Labels for icon-only controls

Any interactive element without visible text needs an accessible name.

- Use the **`IconButton`** pattern for square icon-only buttons — it **requires** an `aria-label`.
- For a plain `Button` with only an `Icon` child, pass `aria-label` explicitly.

```tsx
import { IconButton } from "@/shared/ui/patterns/icon-button";

<IconButton icon="Trash2" aria-label="Delete bundle" onClick={onDelete} />;
```

## Keyboard navigation

Required keyboard support for custom interactive elements:

- **Enter / Space**: activate buttons and toggles
- **Escape**: close popovers/menus, cancel editing, deselect
- **Tab**: move focus between interactive elements

Radix-backed primitives (dropdown-menu, popover, tooltip, tabs, collapsible) handle focus trapping
and arrow-key navigation for you — don't reimplement it. For your own non-button clickable elements,
add `role="button"`, `tabIndex={0}`, and a keydown handler:

```tsx
<div
  role="button"
  tabIndex={0}
  aria-label={`Folder: ${name}`}
  onClick={toggle}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }}
/>
```

For a multi-line editor built on `Textarea`, handle Enter/Escape in `onKeyDown` (e.g. Enter to
submit, Shift+Enter for newline, Escape to cancel).

## Screen reader support

Use the `sr-only` utility for visually hidden but screen-reader-accessible text on **raw HTML
elements** (this is allowed — the no-`className` rule only applies to Tangle primitives):

```tsx
<button aria-label="Close">
  <Icon name="X" />
  <span className="sr-only">Close</span>
</button>
```

## Semantic HTML and ARIA

Use proper semantic elements and roles:

```tsx
<nav aria-label="breadcrumb">
<span aria-current="page">{label}</span>
<div role="alert">{errorMessage}</div>
```

Layout primitives forward ARIA props — `BlockStack`/`InlineStack` accept ARIA attributes, and
`Text`/`Heading`/`Paragraph` accept `role` and ARIA props — so you can keep semantics without
dropping to raw HTML.

## Focus styling

Don't remove focus indicators. Base interactive primitives (`Button`, `IconButton`, Radix
components) already render a visible `focus-visible` ring. If you build a local primitive on a raw
element, keep a visible focus indicator — never `outline-none` without a replacement ring.

## Forms

This repo has **no dedicated `Input`/`Label`/`Select`/`Dialog` primitives** today — text entry uses
`Textarea`, and choices use `checkbox` / `tabs` / `dropdown-menu`. When you build form controls:

- Associate a label with its control (`htmlFor` / `id`, or wrap the control in a `<label>`).
- Mark invalid fields with `aria-invalid` and link help/error text via `aria-describedby`.
- Keep error text in the DOM near the field (there is no toast system to announce it).
