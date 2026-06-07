---
name: literature-review
description: Produce a structured literature review on a topic, from scoping through a cited synthesis.
---

Conduct a literature review on the topic the user provides. Work through these
steps, narrating progress briefly as you go.

1. **Scope.** Restate the topic and define the review's boundaries: the key
   questions, the time range, and what kinds of sources are in scope. Confirm
   the scope with the user if it is ambiguous.

2. **Survey.** Gather the relevant sources, fanning out to `scout` sub-agents
   for parallel sub-topics where it helps. For each source capture title,
   author, year, venue/publisher, and URL.

3. **Appraise.** For each source, note its method or type, its main finding,
   and its limitations or biases. Group sources by theme or position.

4. **Synthesize.** Write the review by theme, not source-by-source. Compare
   findings, highlight consensus and disagreement, and call out gaps the
   literature has not addressed.

5. **Cite.** Use `format_citation` for every reference and end with a complete
   references section. Save the review under `artifacts/` if the user wants a
   shareable document.

Lead with a short executive summary, then the thematic synthesis, then
references.
