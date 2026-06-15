# Authoring guide

This guide shows how to write a bundle UI component. Before you start, read
[`rules.md`](rules.md) — the constraints there are not optional.

A component is a `.tsx` file under your bundle's `ui/` directory, written with
remote-dom's React renderer. It imports the host bridge and renders **only**
elements from the [vocabulary](element-vocabulary.md). The server transpiles it on
upload (Phase 3); you ship plain `.tsx`.

## The two kinds

| Kind      | Trigger                                         | Gets props from                      | Typical use                      |
| --------- | ----------------------------------------------- | ------------------------------------ | -------------------------------- |
| `message` | The agent emits a `tangent-ui:<name>` token     | `host.getProps()` (the token's JSON) | Live status chip, result card    |
| `panel`   | Listed in the composer for the session's bundle | none (`getProps()` is empty)         | Input form, quick-action buttons |

Declare each one in `tangent.yaml`; see [`manifest.md`](manifest.md).

## Agent output convention (message components)

To render a `message` component, the agent emits a fenced code block whose info
string is `tangent-ui:<name>`, with a JSON object as the body:

````
```tangent-ui:pipeline-progress
{ "executionId": "019ea56d72cd5f4d75f6" }
```
````

- `<name>` must match a `kind: message` component's `name` in the manifest.
- The body is parsed as JSON and delivered to the component via
  `host.getProps()`.
- Tell Prime to emit this in your bundle's `prompts/prime.md` (e.g. "after
  launching a pipeline, emit a `tangent-ui:pipeline-progress` block with the
  execution id").

### Host rendering note (Phase 6)

The host markdown renderer
([`src/shared/lib/markdown/Markdown.tsx`](../../src/shared/lib/markdown/Markdown.tsx))
detects fenced blocks in its `code` handler. Today that handler matches the
language with `/language-(\w+)/`, which only accepts word characters and so
will **not** match `language-tangent-ui:pipeline-progress` (it contains a hyphen
and a colon). Phase 6 widens this detection to recognize the `tangent-ui:` prefix,
parse the JSON body, and mount a `BundleUiHost` instead of a `CodeBlock`. While
the JSON is still streaming and not yet valid, the host renders a quiet
placeholder rather than erroring.

## Worked example: a message component

`ui/pipeline-progress.tsx` — reads `{ pipelineId }`, polls the bridge, and
renders a progress chip:

```tsx
import { BlockStack, Card, host, Progress, Text } from "@tangent/bundle-ui";
import { useEffect, useState } from "react";

const OASIS_BASE = "https://oasis.shopify.io/api/executions";

export default function PipelineProgress() {
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    ended: number;
    done: boolean;
  } | null>(null);

  // Props can arrive late / partially while the agent message streams.
  useEffect(() => {
    host.getProps().then((p) => {
      if (typeof p.executionId === "string") setExecutionId(p.executionId);
    });
  }, []);

  useEffect(() => {
    if (!executionId) return;
    let active = true;
    const tick = async () => {
      try {
        // A real, allowlisted endpoint — the host proxy validates the URL.
        const res = await host.fetch(`${OASIS_BASE}/${executionId}/state`);
        if (active && res.ok) {
          const s = (res.json as { child_execution_status_summary?: unknown })
            ?.child_execution_status_summary as
            | {
                total_executions?: number;
                ended_executions?: number;
                has_ended?: boolean;
              }
            | undefined;
          if (s) {
            setSummary({
              total: s.total_executions ?? 0,
              ended: s.ended_executions ?? 0,
              done: s.has_ended ?? false,
            });
          }
        }
      } catch {
        // tolerate transient failures; keep last known status
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [executionId]);

  if (!executionId) {
    return (
      <Text size="xs" tone="subdued">
        Waiting for an execution id…
      </Text>
    );
  }

  const progress =
    summary && summary.total > 0 ? summary.ended / summary.total : 0;

  return (
    <Card density="compact">
      <BlockStack gap="1">
        <Progress value={progress} tone={summary?.done ? "success" : "info"} />
        <Text size="xs" tone="subdued">
          {summary
            ? `${summary.done ? "Complete" : "Running"} — ${summary.ended}/${summary.total}`
            : "loading…"}
        </Text>
      </BlockStack>
    </Card>
  );
}
```

## Worked example: a panel component

`ui/launch-experiment.tsx` — a form that composes and sends a prompt:

```tsx
import {
  BlockStack,
  Button,
  Heading,
  host,
  Textarea,
} from "@tangent/bundle-ui";
import { useState } from "react";

export default function LaunchExperiment() {
  const [goal, setGoal] = useState("");

  const submit = async () => {
    const text = goal.trim();
    if (!text) return;
    await host.sendPrompt(`Launch a Tangle experiment: ${text}`);
    setGoal("");
  };

  return (
    <BlockStack gap="2">
      <Heading level="4">New experiment</Heading>
      <Textarea
        value={goal}
        placeholder="Describe the experiment…"
        onInput={(value: string) => setGoal(value)}
      />
      <Button variant="default" onPress={submit} disabled={!goal.trim()}>
        Launch
      </Button>
    </BlockStack>
  );
}
```

> Import the bridge and the typed element wrappers from `@tangent/bundle-ui`. The
> wrappers normalize remote events into plain serializable callbacks: `onPress`
> (no payload) for `Button`, `onInput` (the new string) for `Textarea`. Props go
> in, serializable events come out, and all data/prompts flow through the bridge.

## Checklist before shipping

- [ ] Component renders only [vocabulary](element-vocabulary.md) elements.
- [ ] All props are JSON-serializable; the component tolerates missing/partial
      props.
- [ ] Data comes from `host.fetch` (allowlisted destinations); prompts go
      through `host.sendPrompt`.
- [ ] No direct/global `fetch`, DOM, timers-on-globals abuse, or host globals.
- [ ] The component is declared in `tangent.yaml` `ui.components` with the right
      `kind`.
- [ ] For `message` components, `prompts/prime.md` instructs the agent to emit
      the matching `tangent-ui:<name>` token.
