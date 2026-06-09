---
name: revealjs
description: Comprehensive Reveal.js reference for building HTML slide decks. Use whenever the user wants to create, revise, or extend a presentation, slide deck, or talk — especially from Markdown — including transitions, Auto-Animate, Mermaid diagrams, animatable SVG, video, backgrounds, fragments, code highlighting, speaker notes, math, themes, configuration, and PDF export.
---

# Reveal.js

This is your authoritative, self-contained reference for [Reveal.js](https://revealjs.com/).
Build decks from it directly; do not fetch docs at runtime. Pin a `5.x` release of
Reveal.js from jsDelivr.

## 1. CDN scaffold (copy-paste base)

A complete standalone deck. Save it as `artifacts/index.html`.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Deck</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reset.css" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css" />
    <link rel="stylesheet" id="theme" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/black.css" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/atom-one-dark.min.css" />
  </head>
  <body>
    <div class="reveal">
      <div class="slides">
        <section>Slide 1</section>
        <section>Slide 2</section>
      </div>
    </div>

    <script type="module">
      import Reveal from "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.esm.js";
      import Markdown from "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/markdown/markdown.esm.js";
      import Highlight from "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/highlight/highlight.esm.js";
      import Notes from "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/notes/notes.esm.js";
      import Math from "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/math/math.esm.js";
      import Zoom from "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/zoom/zoom.esm.js";

      const deck = new Reveal({
        hash: true,
        controls: true,
        progress: true,
        center: true,
        slideNumber: "c/t",
        transition: "slide",
        plugins: [Markdown, Highlight, Notes, Math, Zoom],
      });
      deck.initialize();
    </script>
  </body>
</html>
```

DOM contract: the deck root is `.reveal`, which contains exactly one `.slides`,
which contains top-level `<section>` elements — one per horizontal slide.

Notes:
- The ESM modules above are self-bootstrapping. If you prefer the classic global
  build, use `dist/reveal.js` + a `<script>` that calls `Reveal.initialize({...})`,
  and load plugins from their `plugin/<name>/<name>.js` UMD files; do not mix the
  two styles in one deck.
- Themes available under `dist/theme/`: `black`, `white`, `league`, `beige`, `sky`,
  `night`, `serif`, `simple`, `solarized`, `blood`, `moon`, `dracula`. Swap the
  `#theme` stylesheet `href` to change it.

## 2. Slide structure

- Each top-level `<section>` is a horizontal slide.
- Nest `<section>` inside a `<section>` to create **vertical** slides (a stack the
  viewer steps down into with the down arrow).
- Give a slide an `id` and link to it: `<a href="#/slide-id">`. With `hash: true`,
  the URL tracks the current slide.
- `data-visibility="hidden"` removes a slide from the deck; `data-visibility="uncounted"`
  keeps it reachable but out of the slide-number total.

```html
<section>
  <section id="intro">Top of a vertical stack</section>
  <section>Down one</section>
</section>
```

## 3. Markdown-driven slides (primary content path)

The Markdown plugin lets the user's `.md` drive the slides. Two ways:

Inline template (preferred for a single self-contained file — embed the uploaded
Markdown here):

```html
<section data-markdown data-separator="^\n---\n" data-separator-vertical="^\n--\n" data-separator-notes="^Note:">
  <textarea data-template>
## First slide

Body text.

---

## Second slide

- bullet
- bullet

Note: speaker note for slide two.
  </textarea>
</section>
```

External file:

```html
<section data-markdown="slides.md"
         data-separator="^\r?\n---\r?\n"
         data-separator-vertical="^\r?\n--\r?\n"
         data-separator-notes="^Note:"></section>
```

- `data-separator` splits horizontal slides; `data-separator-vertical` splits a
  slide into a vertical stack; `data-separator-notes` marks the speaker-notes prefix.
- Per-element attributes: put `<!-- .element: class="fragment" -->` on the line
  after the element.
- Per-slide attributes: `<!-- .slide: data-background="#1a1a2e" data-transition="zoom" -->`.
- When the user uploads Markdown, embed its content directly in the `<textarea>` so
  the deck stays a single portable artifact. Keep their headings; choose separators
  that match their structure (most decks split on `---`).

## 4. Transitions

Global, in `initialize`:

```js
new Reveal({ transition: "slide", transitionSpeed: "default", backgroundTransition: "fade" });
```

- `transition`: `none` | `fade` | `slide` | `convex` | `concave` | `zoom`.
- `transitionSpeed`: `default` | `fast` | `slow`.

Per-slide overrides on a `<section>`:

```html
<section data-transition="zoom">…</section>
<section data-transition="fade-in slide-out">…</section>     <!-- split: different in/out -->
<section data-background-transition="convex">…</section>
```

Use transitions deliberately: a calm default (`slide`/`fade`) for the deck, with the
occasional `zoom`/`convex` for emphasis. Pair `data-background-transition` with
background changes (section 6).

## 5. Auto-Animate (smooth morphs between slides)

Put `data-auto-animate` on two or more **consecutive** sections. Reveal matches
elements between them and animates the differences (position, size, color, opacity,
text). Matching is automatic by content, but explicit `data-id` is the reliable way
to pair elements — essential for SVG and for elements whose text changes.

```html
<section data-auto-animate>
  <h2>Pipeline</h2>
  <div data-id="box" style="width:120px;height:80px;background:#3b82f6;border-radius:8px"></div>
</section>
<section data-auto-animate>
  <h2>Pipeline (scaled out)</h2>
  <div data-id="box" style="width:260px;height:140px;background:#22c55e;border-radius:24px"></div>
</section>
```

Tuning attributes (on the section or per element):
- `data-auto-animate-easing="cubic-bezier(...)"`, `data-auto-animate-duration="0.8"`,
  `data-auto-animate-delay="0.2"`.
- `data-auto-animate-unmatched="false"` to stop unmatched elements from fading in.
- `data-auto-animate-restart` / distinct `data-auto-animate-id` to break two adjacent
  animations into separate sequences.

Auto-Animate works on text, lists (animate items in/out), and code blocks (animate
edits and line-highlight changes — see section 7).

## 6. Backgrounds

Set on a `<section>`:

- `data-background-color="#1a1a2e"`
- `data-background-image="url"` with `data-background-size` (`cover`/`contain`/`100px`),
  `data-background-position`, `data-background-repeat="repeat"`.
- `data-background-gradient="linear-gradient(...)"`.
- `data-background-video="a.mp4,a.webm"` with `data-background-video-loop` and
  `data-background-video-muted` (see section 9).
- `data-background-iframe="https://…"` with `data-background-interactive` to allow
  interaction. Note: in the embedded Page sandbox, iframe backgrounds to external
  sites may be blocked — prefer self-contained content.

## 7. Fragments (step-by-step reveals)

Add `class="fragment"` to reveal an element on the next step.

```html
<p class="fragment">Appears first</p>
<p class="fragment fade-up">Slides up</p>
<p class="fragment highlight-red">Turns red on reveal</p>
<p class="fragment" data-fragment-index="1">Shares step 1</p>
```

Variants: `fade-in`, `fade-out`, `fade-up/down/left/right`, `fade-in-then-out`,
`fade-in-then-semi-out`, `grow`, `shrink`, `strike`, `highlight-red/green/blue`,
`highlight-current-red/green/blue`, `semi-fade-out`. Use `data-fragment-index` to
control or share ordering.

## 8. Code with syntax highlighting

The Highlight plugin styles `<pre><code>`. `data-trim` strips surrounding
whitespace; `data-noescape` lets you keep raw HTML.

```html
<pre><code data-trim data-line-numbers="1-2|3|4-7" class="language-js">
function build(deck) {
  const slides = parse(deck);
  return render(slides);
}
</code></pre>
```

- `data-line-numbers` enables line numbers; a `|`-separated list (e.g. `"1-2|3"`)
  steps through highlighted line ranges as fragments.
- Inside a `data-auto-animate` pair, changing the code or the `data-line-numbers`
  animates between the two states — great for "before/after" edits.

## 9. Video on slides

Inline video (sized within the slide):

```html
<video controls width="800" data-autoplay>
  <source src="clip.mp4" type="video/mp4" />
  <source src="clip.webm" type="video/webm" />
</video>
```

- `data-autoplay` plays on slide entry; browsers require the video to be `muted` to
  autoplay with sound policies, so add `muted` for reliable autoplay.
- Use `data-src` instead of `src` for lazy loading large media.

Full-bleed background video:

```html
<section data-background-video="bg.mp4,bg.webm"
         data-background-video-loop
         data-background-video-muted>
  <h2>Title over video</h2>
</section>
```

Keep local video/image assets under `artifacts/` next to the deck (relative paths
resolve against the deck URL), or use a remote URL the user provides.

## 10. Mermaid diagrams

Mermaid is not a Reveal plugin; load it separately and render after Reveal is ready.
Put diagram source in a `<pre class="mermaid">` block, disable auto-start, then run
Mermaid on load and again whenever a slide changes (so diagrams on later slides size
correctly).

```html
<section>
  <pre class="mermaid">
    flowchart LR
      A[Ingest] --> B[Transform]
      B --> C[Serve]
  </pre>
</section>

<script type="module">
  import Reveal from "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.esm.js";
  import Markdown from "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/markdown/markdown.esm.js";
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });

  const deck = new Reveal({ plugins: [Markdown], transition: "slide" });
  await deck.initialize();

  async function renderMermaid() {
    await mermaid.run({ querySelector: ".reveal .slides .mermaid" });
  }
  await renderMermaid();
  deck.on("slidechanged", renderMermaid);
</script>
```

- `securityLevel: "loose"` is usually needed for full rendering; the deck runs in an
  opaque-origin sandbox, so keep diagram source inline (no remote includes).
- If a diagram overflows a slide, wrap it and cap height with CSS
  (`.mermaid svg { max-height: 70vh; }`), or use the `r-stretch` helper.
- Mermaid rewrites the `<pre>` to an `<svg>` on first run; guard re-runs by selecting
  only `.mermaid:not([data-processed])` if you call render repeatedly.

## 11. Animatable SVG diagrams (show a system evolving)

To emphasize how a system changes, draw it as **inline SVG** and let Auto-Animate
morph it between two slides. The technique:

1. Author the diagram as inline SVG (not an `<img>`), so individual shapes are
   animatable. If the user gave you a raster image or a Mermaid diagram, recreate the
   key shapes as inline SVG (rects, circles, paths, text).
2. Give every element that persists across the change a stable `data-id`, identical
   on both slides. Keep the SVG `viewBox` the same on both so coordinates line up.
3. Place two near-identical SVG slides under `data-auto-animate`. Move, resize, or
   recolor the shared `data-id` shapes on the second slide; add/remove a few to show
   what changed. Auto-Animate tweens the matched elements.

```html
<section data-auto-animate>
  <h3>v1</h3>
  <svg viewBox="0 0 400 200" width="640">
    <rect data-id="svc-a" x="40"  y="80" width="90" height="50" rx="8" fill="#3b82f6" />
    <rect data-id="db"    x="270" y="80" width="90" height="50" rx="8" fill="#64748b" />
    <line data-id="edge"  x1="130" y1="105" x2="270" y2="105" stroke="#94a3b8" stroke-width="3" />
  </svg>
</section>
<section data-auto-animate>
  <h3>v2 — cache added</h3>
  <svg viewBox="0 0 400 200" width="640">
    <rect data-id="svc-a" x="40"  y="40" width="90" height="50" rx="8" fill="#3b82f6" />
    <rect data-id="db"    x="270" y="40" width="90" height="50" rx="8" fill="#64748b" />
    <rect data-id="edge"  x="155" y="120" width="90" height="50" rx="8" fill="#22c55e" /><!-- becomes a cache node -->
    <text data-id="cache-label" x="200" y="150" fill="#fff" font-size="12" text-anchor="middle">cache</text>
  </svg>
</section>
```

Tips:
- Reuse `data-id` values only for elements that truly correspond; mismatched ids
  produce odd morphs.
- For continuous motion within a single slide (not slide-to-slide), use SVG SMIL
  (`<animate>`, `<animateTransform>`) or CSS `@keyframes` instead.
- Keep node coordinates consistent between the two diagrams so unchanged parts stay
  still and the eye follows only what moved.

## 12. Math

The Math plugin renders LaTeX (KaTeX or MathJax backend). Inline `\( … \)`, block
`\[ … \]`:

```js
new Reveal({ plugins: [Math.KaTeX] }); // or just Math for the default MathJax
```

```html
<section>\[ E = mc^2 \]</section>
```

## 13. Speaker notes

```html
<section>
  <h2>Slide</h2>
  <aside class="notes">Say this out loud. Hidden from the audience.</aside>
</section>
```

In Markdown, a line beginning with the `data-separator-notes` prefix (e.g. `Note:`)
becomes the note. With the Notes plugin loaded, press `S` to open the speaker view
(timer, next-slide preview, notes).

## 14. Configuration & API

Common `initialize` options:

```js
new Reveal({
  hash: true,            // sync URL to current slide
  controls: true,        // arrow controls
  progress: true,        // progress bar
  center: true,          // vertical centering
  slideNumber: "c/t",    // false | true | "c" | "c/t"
  width: 960, height: 700, margin: 0.04, // logical presentation size
  autoAnimate: true,     // global Auto-Animate default
  autoSlide: 0,          // ms per slide for auto-advance (0 = off)
  loop: false,
  rtl: false,
  transition: "slide",
});
```

API & events (after `await deck.initialize()`):
- Methods: `deck.slide(h, v)`, `deck.next()`, `deck.prev()`, `deck.getIndices()`,
  `deck.layout()`, `deck.toggleOverview()`.
- Events: `deck.on("ready", …)`, `"slidechanged"`, `"fragmentshown"`,
  `"fragmenthidden"`, `"resize"`. Use `slidechanged` to (re)render dynamic content
  like Mermaid or charts.
- Keyboard: arrows / Space navigate, `F` fullscreen, `S` speaker view, `O` or `Esc`
  overview, `B`/`.` pause, `Alt+click` zoom.

## 15. Themes, layout helpers & custom CSS

- Switch theme via the `#theme` stylesheet `href`. Override theme variables in a
  `<style>` block (e.g. `:root{ --r-main-font: …; --r-heading-color: … }`).
- Layout helpers: `class="r-fit-text"` auto-sizes text to fill the slide; `r-stretch`
  makes a single child fill remaining vertical space (great for big diagrams/video);
  `r-stack` overlays children (combine with fragments); `r-frame` adds a frame.

## 16. PDF export / print

Append `?print-pdf` to the deck URL and print to PDF from the browser (one slide per
page). Mention this to the user if they ask for a PDF; for an automated export you
can drive headless Chrome with the `?print-pdf` URL.

## 17. Accessibility & motion

- Respect reduced motion. Add to the deck so transitions/animations calm down:

```css
@media (prefers-reduced-motion: reduce) {
  .reveal .slides section { transition: none !important; }
}
```

- Keep readable contrast (lean on a theme), provide `alt`/`<title>` text for
  meaningful images and SVG, and don't rely on color alone to convey meaning.

## 18. Authoring recipe (uploaded Markdown → deck) + response pattern

1. Read the uploaded `.md`. Identify the title, sections, and any diagrams, code, or
   media references.
2. Start from the section 1 scaffold; pick a theme that fits the topic.
3. Put the user's content into a `data-markdown` block, splitting on their structure
   (usually `---`). Preserve their headings and lists.
4. Add transitions; add an Auto-Animate sequence where content evolves or needs
   emphasis; build diagrams with Mermaid or animatable SVG (section 10/11); embed
   video where referenced (section 9).
5. Add `prefers-reduced-motion` handling.
6. Save to `artifacts/index.html` and a named copy `artifacts/<slug>.html`. Verify the
   files exist.
7. Respond briefly: slide count, theme, the transitions/animations used, and any
   diagrams or video — then the direct link:

[Open deck](artifacts/<slug>.html)

Do not paste the full HTML into chat unless asked.
