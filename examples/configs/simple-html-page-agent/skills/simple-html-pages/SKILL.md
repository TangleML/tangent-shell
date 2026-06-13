---
name: simple-html-pages
description: Builds simple standalone HTML page pieces with embedded CSS and playful animated SVG illustrations. Use when the user asks to create, revise, or extend an HTML page, landing page, invite, card, section, mockup, or visual web snippet.
---

# Simple HTML pages

Use this skill to turn a short page brief into a small, polished HTML file.

## Default assumptions

- The first user prompt in a fresh session is the page brief.
- Create `index.html` unless the user names another file.
- Produce a complete standalone document, not a fragment, unless the user asks for a snippet.
- Use embedded CSS and inline SVG; avoid external fonts, images, scripts, or CDNs by default.
- Favor simple structure over framework patterns.

## Build checklist

Every page should include:

- semantic HTML (`main`, `section`, headings, buttons/links as appropriate),
- responsive CSS with readable spacing and contrast,
- one clear focal area that matches the user's brief,
- at least one inline SVG illustration or decorative SVG accent,
- animation in the SVG or CSS (`@keyframes`, `animate`, `animateTransform`, or similar),
- accessible names for meaningful controls and non-decorative visuals.

## SVG animation guidance

Use small, fun motion that supports the concept:

- floating stars, bubbles, leaves, sparks, clouds, planets, pets, robots, or product icons,
- looping transforms such as bobbing, twinkling, rotating, pulsing, drawing strokes, or drifting,
- `prefers-reduced-motion` CSS to calm or disable nonessential motion.

Prefer inline SVG with CSS classes so the animation is easy to inspect and edit.

## Response pattern

The page is the artifact. Save it under `artifacts/` and verify it exists, then respond briefly with:

- a direct Markdown link to the artifact, e.g. `[Open artifact](artifacts/<descriptive-slug>.html)`,
- what was built,
- the animated SVG element(s),
- how to open it locally.

Pin the artifact automatically: call the `pin_artifact` tool with the same workspace-relative path and a short title (e.g. `pin_artifact(path: "artifacts/<descriptive-slug>.html", title: "<page title>")`) so it shows in the quick-access sidebar.

Do not paste the entire HTML in chat if the file was written successfully, unless the user asks for it. Never report the page as done without both the Markdown link and the `pin_artifact` call.
