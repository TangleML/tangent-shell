---
name: skill-authoring
description: Write an effective SKILL.md, including frontmatter, a discoverable description, and a concise body. Use when authoring a new skill, editing an existing one, or deciding how to structure skill content.
---

# Skill authoring

A skill is a `SKILL.md` file with YAML frontmatter and a markdown body that
teaches an agent how to perform a specific task. This skill is the standard for
writing one.

## 1. Frontmatter

Every `SKILL.md` requires:

```markdown
---
name: your-skill-name
description: What it does and when to use it.
---
```

- `name` — lowercase letters, numbers, and hyphens only; max 64 chars; matches
  the skill's directory name.
- `description` — non-empty, max 1024 chars. This is the single most important
  field: the agent reads it to decide when to apply the skill.

## 2. Write the description well

- Write in the **third person** ("Extracts text from PDFs", not "I can help
  you...").
- State both **WHAT** the skill does and **WHEN** to use it, with concrete
  trigger terms.
- Be specific, not vague.

Good: `Extract text and tables from PDF files, fill forms, merge documents. Use
when working with PDFs or when the user mentions PDFs, forms, or extraction.`

Bad: `Helps with documents.`

## 3. Keep the body concise

The context window is shared. Assume the agent is already smart and only add
what it does not already know. Challenge every paragraph: does it justify its
token cost?

- Keep `SKILL.md` under 500 lines.
- Use **progressive disclosure**: essentials in `SKILL.md`, detailed material in
  sibling files (`reference.md`, `examples.md`) linked one level deep.
- Prefer concrete examples and templates over prose.

## 4. Match freedom to fragility

- High freedom (text guidance) for tasks with many valid approaches.
- Medium freedom (templates/pseudocode) for a preferred pattern with variation.
- Low freedom (specific scripts/commands) for fragile, consistency-critical
  operations.

## 5. Avoid anti-patterns

- No Windows-style backslash paths; use `scripts/helper.py`.
- Don't list many interchangeable options; give one default with an escape
  hatch.
- No time-sensitive notes ("before August 2025"); use a deprecated-patterns
  section instead.
- Use consistent terminology throughout (pick one term and keep it).
- Avoid vague names like `helper` or `utils`; name by the task
  (`processing-pdfs`).

## Quality checklist

- [ ] `name` is lowercase-hyphenated and matches the directory.
- [ ] `description` is third-person and states WHAT and WHEN with trigger terms.
- [ ] Body is under 500 lines and free of filler.
- [ ] References are one level deep; examples are concrete.
- [ ] Terminology is consistent; no time-sensitive or fabricated content.
