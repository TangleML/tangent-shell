---
name: reproduce-research
description: Reproduce a research paper / white paper / arXiv result as a Tangle pipeline. Use when the user asks to "reproduce", "replicate", or "implement" a paper, benchmark, or arXiv link as an experiment.
allowed-tools: [Bash, Read, Write, Glob, Grep, Agent, dispatch]
---

# Reproduce Research

This skill is the **intent trigger** for reproducing a published result as a
real, multi-step Tangle pipeline. The orchestration itself lives in the
`reproduce-research` workflow; this file just routes Prime to it.

## When to use

Trigger this skill when the user asks to **reproduce**, **replicate**, or
**implement** any of:

- A paper or white paper ("reproduce the RaBitQ paper", "replicate Table 3").
- An arXiv link or DOI ("turn https://arxiv.org/abs/... into a Tangle run").
- A benchmark or published result ("reproduce SIFT1M Recall@k vs QPS").

For lightweight "what does this paper say?" questions, just answer. This skill is
for building and submitting the reproduction as a Tangle experiment.

## What to do

**You (Prime) are the coordinator** — read and follow the orchestration recipe at
[`.tangent/workflows/reproduce-research.md`](../../workflows/reproduce-research.md)
and run it yourself. Do NOT hand the whole flow to a single worker that "does
everything"; orchestration is your job.

The recipe stands up three scoped agents in order. First the `safety-monitor` (a
5-minute watchdog, a hard gate before anything else) — created via a single
`create_trigger` (`target: subagent`, inline `subagent.template: safety-monitor`)
that auto-provisions the trigger-owned watcher; do NOT `spawn_subagent` for it.
Then `spawn_subagent` the `designer` (turns the paper into an approved multi-step
DAG + design image + builder brief) and the `builder` (implements and submits the
pipeline via the Tangle CLI). It also covers the autonomous-retry policy, failure
triage, and final artifact collection.

## References

These templates are filled in by the `designer` agent and consumed by the
`builder`:

- [`references/design-doc-template.md`](references/design-doc-template.md)
- [`references/builder-brief-template.md`](references/builder-brief-template.md)
