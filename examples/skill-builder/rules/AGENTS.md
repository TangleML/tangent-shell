# Workspace rules: skill builder

These rules apply to every agent in this session.

## Skill quality

- Every `SKILL.md` follows the authoring standard: `name` is
  lowercase-hyphenated and matches its directory; `description` is third-person
  and states both WHAT the skill does and WHEN to use it.
- Keep skill bodies concise (under 500 lines) and use progressive disclosure for
  long reference material, linked one level deep.
- Never fabricate APIs, commands, file paths, or library behavior. If a detail
  is unknown, verify it or state the gap.

## Bundle integrity

- Bundles conform to the Tangent Configuration Bundle spec: `schemaVersion: 1`,
  a slug `id`, and a `prompts/prime.md`.
- Every path in `tangent.yaml` is bundle-relative and safe (no `..`, no absolute
  paths) and resolves to a real file.

## Output and artifacts

- Assemble each bundle under its own source folder, then package it to `<id>.zip`
  with the `package_bundle` tool (or the bash `zip` fallback).
- Report the output zip path and the packaged file list. Save shareable
  artifacts under predictable, relative paths.
