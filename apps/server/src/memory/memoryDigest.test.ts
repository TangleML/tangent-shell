import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type DigestOptions,
  fetchEntries,
  INLINE_MAX_CHARS,
  parseEntries,
  renderDigest,
  SESSION_INLINE_MAX_CHARS,
  titledEntry,
  TOC_MAX_ENTRIES,
} from "./memoryDigest.ts";

const OPTIONS: DigestOptions = {
  fetchHint: 'Fetch with `kb_read { entry: "<id>" }`.',
  order: "newest",
  overflowHint: "search with `kb_search`",
};

function stamp(day: string): string {
  return `<!-- 2026-01-${day} 10:00:00 [abcd1234] -->`;
}

test("stamped stores split at each stamp, with untitled lead paragraphs", () => {
  const content = [
    "# Knowledge",
    "",
    "intro paragraph",
    stamp("01"),
    "### Use v2",
    "Call the v2 API.",
    "",
    "#decision #api",
    stamp("02"),
    "- **Prefer** batch jobs",
  ].join("\n");

  const entries = parseEntries(content, "stamped");
  assert.deepEqual(
    entries.map(({ title, date, tags, lines }) => ({
      title,
      date,
      tags,
      lines,
    })),
    [
      { title: "Knowledge", date: undefined, tags: [], lines: [1, 1] },
      { title: "intro paragraph", date: undefined, tags: [], lines: [3, 3] },
      {
        title: "Use v2",
        date: "2026-01-01",
        tags: ["#decision", "#api"],
        lines: [4, 8],
      },
      {
        title: "Prefer batch jobs",
        date: "2026-01-02",
        tags: [],
        lines: [9, 10],
      },
    ],
  );
});

test("a free-form note splits at headings, else at paragraphs", () => {
  const note = "lead line\n\n## Setup\n\nrun pnpm\n\n## Release\nship it\n";
  assert.deepEqual(
    parseEntries(note, "headings").map(({ title, lines }) => ({
      title,
      lines,
    })),
    [
      { title: "lead line", lines: [1, 1] },
      { title: "Setup", lines: [3, 5] },
      { title: "Release", lines: [7, 8] },
    ],
  );
  assert.deepEqual(
    parseEntries("one\n\ntwo\nmore", "headings").map((entry) => entry.title),
    ["one", "two"],
  );
});

test("an entry's id survives edits to other entries", () => {
  const before = parseEntries("## A\nalpha\n\n## B\nbeta", "headings");
  const after = parseEntries(
    "## New\nfirst\n\n## B\nbeta\n\n## A\nalpha",
    "headings",
  );
  const ids = (entries: typeof before) =>
    Object.fromEntries(entries.map((entry) => [entry.title, entry.id]));

  assert.equal(ids(after).A, ids(before).A);
  assert.equal(ids(after).B, ids(before).B);
  assert.match(ids(before).A, /^[0-9a-f]{6}$/);
});

test("untitled entries fall back to their first line, capped", () => {
  const long = `**${"word ".repeat(30)}**`;
  const [entry] = parseEntries(`${stamp("03")}\n${long}`, "stamped");
  assert.ok(entry.title.length <= 80);
  assert.ok(entry.title.endsWith("…"));
  assert.doesNotMatch(entry.title, /\*\*/);
});

test("a small store is inlined; a large one becomes a contents list", () => {
  const small = renderDigest("## A\nalpha", "headings", OPTIONS);
  assert.equal(small.text, "## A\nalpha");
  assert.deepEqual(small.stats, { entries: 1, chars: 10, mode: "inline" });

  assert.deepEqual(renderDigest("  \n", "headings", OPTIONS).stats, {
    entries: 0,
    chars: 0,
    mode: "empty",
  });

  const big = renderDigest(
    `## Old\n${"x".repeat(INLINE_MAX_CHARS)}\n\n## New\nfresh`,
    "headings",
    OPTIONS,
  );
  assert.equal(big.stats.mode, "contents");
  assert.doesNotMatch(big.text, /xxxx/);
  assert.match(big.text, /^2 entries, \d+\.\d KB\. Fetch with/);
  assert.match(
    big.text,
    /Contents \(newest first\):\n\n- `\w{6}` New\n- `\w{6}` Old/,
  );
});

test("a larger inlineMaxChars keeps a big store inline", () => {
  const seed = `### Rules\nNever deploy to production.\n${"detail ".repeat(600)}`;
  assert.ok(seed.length > INLINE_MAX_CHARS);
  assert.ok(seed.length < SESSION_INLINE_MAX_CHARS);

  const roomy = renderDigest(seed, "headings", {
    ...OPTIONS,
    inlineMaxChars: SESSION_INLINE_MAX_CHARS,
  });
  assert.equal(roomy.stats.mode, "inline");
  assert.match(roomy.text, /Never deploy to production\./);

  assert.equal(renderDigest(seed, "headings", OPTIONS).stats.mode, "contents");
});

test("tags with punctuation survive and reach the keyword index", () => {
  const entry = `${stamp("01")}\n### Deploy\nShip it.\n\n#node.js #ci/cd #deploy`;
  const [parsed] = parseEntries(entry, "stamped");
  assert.deepEqual(parsed.tags, ["#node.js", "#ci/cd", "#deploy"]);

  const big = `${entry}\n\n${stamp("02")}\n### Bulk\n${"x".repeat(INLINE_MAX_CHARS)}`;
  const { text } = renderDigest(big, "stamped", OPTIONS);
  assert.match(text, /#node\.js: `[0-9a-f]{6}`/);
});

test("the keyword index covers only the shown entries", () => {
  const visible = Array.from(
    { length: TOC_MAX_ENTRIES },
    (_, i) => `## Visible ${i}\n${"x".repeat(60)}\n\n#shown`,
  );
  const content = [`## Hidden\nold\n\n#hidden`, ...visible].join("\n\n");
  const { text } = renderDigest(content, "headings", OPTIONS);

  assert.match(text, /#shown:/);
  assert.doesNotMatch(text, /#hidden/);
});

test("the keyword index groups ids by tag, most used first", () => {
  const content = [
    `${stamp("01")}\n### One\na\n\n#api`,
    `${stamp("02")}\n### Two\nb\n\n#api #deploy`,
    `${stamp("03")}\n### Three\n${"c".repeat(INLINE_MAX_CHARS)}`,
  ].join("\n\n");
  const [one, two] = parseEntries(content, "stamped");
  const { text } = renderDigest(content, "stamped", OPTIONS);

  assert.match(text, /newest 2026-01-03/);
  assert.ok(
    text.includes(
      `Keywords:\n\n- #api: \`${two.id}\`, \`${one.id}\`\n- #deploy: \`${two.id}\``,
    ),
  );
});

test("a contents list past its cap keeps the newest entries", () => {
  const count = TOC_MAX_ENTRIES + 5;
  const content = Array.from(
    { length: count },
    (_, i) => `## Entry ${i}\n${"x".repeat(50)}`,
  ).join("\n\n");
  const { text } = renderDigest(content, "headings", OPTIONS);

  assert.match(text, new RegExp(`Entry ${count - 1}\\n`));
  assert.doesNotMatch(text, /Entry 4\n/);
  assert.match(text, /- … 5 more; search with `kb_search`/);
});

test("titledEntry writes a title line, the body, and a tag line", () => {
  assert.equal(
    titledEntry(" Use v2 ", " Call v2. ", ["#api", "build tools"]),
    "### Use v2\nCall v2.\n\n#api #build-tools",
  );
  assert.equal(titledEntry(undefined, "plain"), "plain");
});

test("fetchEntries returns the named entries and reports stale ids", () => {
  const source = {
    label: "MEMORY.md",
    content: "## A\nalpha\n\n## B\nbeta",
    format: "headings" as const,
    options: OPTIONS,
  };
  const [a, b] = parseEntries(source.content, "headings");

  const hit = fetchEntries([source], `\`${b.id}\`, zzzzzz`);
  assert.equal(hit.error, undefined);
  assert.equal(
    hit.text,
    `## MEMORY.md: \`${b.id}\`\n\n## B\nbeta\n\nNot found: \`zzzzzz\`.`,
  );

  const miss = fetchEntries([source], "zzzzzz");
  assert.equal(miss.error, true);
  assert.match(miss.text, /No entry `zzzzzz` found\. Current contents:/);
  assert.ok(miss.text.includes(`\`${a.id}\` A`));
});
