// Dev harness fixture: a compiled bundle-UI "message" component.
//
// This mirrors what the Phase-3 server compiler emits for an author's
// `ui/pipeline-progress.tsx`: plain ESM with *bare* imports (`react`,
// `@tangent/bundle-ui`) that the Phase-5 worker module loader resolves against
// the worker's own module copies. It exercises the full loop: getProps ->
// host.fetch polling a real allowlisted endpoint -> render via the vocabulary ->
// host.sendPrompt on press.
//
// Equivalent source:
//   import { useEffect, useState } from "react";
//   import { host, Card, BlockStack, Heading, Text, Progress, Button } from "@tangent/bundle-ui";
//   export default function PipelineProgress() { ... }

import { createElement as h, useEffect, useState } from "react";
import {
  BlockStack,
  Button,
  Card,
  Heading,
  host,
  Progress,
  Text,
} from "@tangent/bundle-ui";

export default function PipelineProgress() {
  const [executionId, setExecutionId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [sent, setSent] = useState(false);
  // Persisted across reloads via the host's per-instance key-value store.
  const [count, setCount] = useState(0);

  useEffect(() => {
    host.getProps().then((props) => {
      const id =
        props && typeof props.executionId === "string"
          ? props.executionId
          : "019ea56d72cd5f4d75f6";
      setExecutionId(id);
    });
    host.getState("count").then((value) => {
      if (typeof value === "number") setCount(value);
    });
  }, []);

  useEffect(() => {
    if (!executionId) return undefined;
    let active = true;
    const tick = async () => {
      try {
        const res = await host.fetch({
          target: "tangle",
          path: `/api/executions/${executionId}/state`,
        });
        if (active && res.ok) {
          const s =
            res.json && res.json.child_execution_status_summary
              ? res.json.child_execution_status_summary
              : null;
          if (s) {
            setSummary({
              total: s.total_executions || 0,
              ended: s.ended_executions || 0,
              done: Boolean(s.has_ended),
            });
          }
        }
      } catch {
        // Tolerate transient failures (incl. an unreachable host in dev); keep
        // the last known status.
      }
    };
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [executionId]);

  const onLaunch = () => {
    host.sendPrompt("Launch a Tangle experiment: harness demo");
    setSent(true);
  };

  const onBump = () => {
    const next = count + 1;
    setCount(next);
    host.setState("count", next);
  };

  const onCollapse = () => {
    host.execUICommand({ type: "collapse" });
  };

  const progress =
    summary && summary.total > 0 ? summary.ended / summary.total : 0;
  const label = summary
    ? `${summary.done ? "Complete" : "Running"} — ${summary.ended}/${summary.total}`
    : "loading...";

  return h(
    Card,
    { density: "compact" },
    h(
      BlockStack,
      { gap: "2" },
      h(Heading, { level: "4" }, "Pipeline progress (harness)"),
      h(Progress, {
        value: progress,
        tone: summary && summary.done ? "success" : "info",
      }),
      h(Text, { size: "xs", tone: "subdued" }, label),
      h(
        Button,
        { variant: "default", onPress: onLaunch, disabled: sent },
        sent ? "Prompt sent" : "Send test prompt",
      ),
      h(
        Button,
        { variant: "outline", onPress: onBump },
        `Persisted count: ${count}`,
      ),
      h(
        Button,
        { variant: "outline", onPress: onCollapse },
        "Collapse message",
      ),
    ),
  );
}
