// @ts-nocheck
/**
 * Sample custom tool extension shipped with the research-assistant bundle.
 *
 * Like the server's orchestrator extension, this file is authored against Pi's
 * extension runtime (it imports modules Pi resolves when loading extensions,
 * e.g. `typebox`), not against this repo's `node_modules`. It is excluded from
 * the repo type-check (`@ts-nocheck`) and is never imported by the server — it
 * is only passed as a `--extension` path to the per-session Pi subprocess,
 * which loads it with jiti.
 *
 * It registers a single `format_citation` tool that renders a consistent
 * author-date citation and reference line from the fields the agent provides.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "format_citation",
    label: "Format Citation",
    description:
      "Render a consistent author-date citation and full reference line from " +
      "the parts of a source. Use this whenever you cite a source so the " +
      "session's references stay uniform.",
    promptSnippet: "Format a source into an author-date citation + reference",
    parameters: Type.Object({
      title: Type.String({ description: "Title of the work." }),
      author: Type.Optional(
        Type.String({ description: "Author or publisher. Defaults to 'Anon'." }),
      ),
      year: Type.Optional(
        Type.String({ description: "Publication year, if known." }),
      ),
      url: Type.Optional(Type.String({ description: "Source URL, if any." })),
    }),
    async execute(_toolCallId, params) {
      const author = (params.author ?? "Anon").trim();
      const year = (params.year ?? "n.d.").trim();
      const inline = `(${author} ${year})`;

      const parts = [`${author}.`, `(${year}).`, `${params.title}.`];
      if (params.url) parts.push(params.url);
      const reference = parts.join(" ");

      return textResult(`inline: ${inline}\nreference: ${reference}`);
    },
  });
}
