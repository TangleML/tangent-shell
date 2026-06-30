---
name: new-skill-bundle
description: Author one or more skills and package them into an installable Tangent Configuration Bundle zip, from scoping through a validated archive.
---

Build a skill bundle for the request the user provides. Work through these
steps, narrating progress briefly as you go.

1. **Scope.** Restate what the skill should do and list its concrete trigger
   scenarios (when an agent should apply it), its boundaries, and any required
   output formats or examples. Confirm with the user if the ask is ambiguous.

2. **Author.** Using the `skill-authoring` skill, write each `SKILL.md` under
   `skills/<name>/`. Give it a third-person description with WHAT and WHEN, a
   concise body, and concrete examples. Add sibling reference files only when
   the body would otherwise exceed ~500 lines.

3. **Assemble.** Using the `bundle-assembly` skill, create the source folder:
   `tangent.yaml` (required metadata + `prime.systemPrompt`), `prompts/prime.md`,
   and the conventional directories. Keep every path bundle-relative and safe.

4. **Review.** Hand each `SKILL.md` and its intended triggers to the
   `skill-reviewer` sub-agent. Apply the concrete fixes it returns.

5. **Validate and package.** Confirm `schemaVersion: 1`, a slug `id`, and that
   `prompts/prime.md` and every referenced path resolve. Then call the
   `package_bundle` tool with the source folder to emit `<id>.zip` (or fall back
   to bash `zip -r`).

Finish by reporting the output zip path, the packaged file list, and a one-line
summary of what the skill does and how to install the bundle.
