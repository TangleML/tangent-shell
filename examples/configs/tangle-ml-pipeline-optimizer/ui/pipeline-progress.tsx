/**
 * Message component: a live progress chip for a Tangle execution.
 *
 * The agent emits a `tangent-ui:pipeline-progress` block carrying
 * `{ "executionId": "<id>" }`; the host parses it and delivers it via
 * `host.getProps()`. We then poll the real Oasis executions-state endpoint
 * through the allowlisted `host.fetch` bridge and render a progress bar.
 *
 * Props can arrive late/partial while the agent message streams, and the network
 * call can fail transiently, so the component degrades to a quiet loading state
 * and keeps the last known status rather than throwing.
 */
import { BlockStack, Card, host, Progress, Text } from "@tangent/bundle-ui";
import { useEffect, useState } from "react";

const OASIS_BASE = "https://oasis.shopify.io/api/executions";
const POLL_INTERVAL_MS = 4000;

interface ExecutionState {
  total: number;
  ended: number;
  done: boolean;
}

interface OasisStateResponse {
  child_execution_status_summary?: {
    total_executions?: number;
    ended_executions?: number;
    has_ended?: boolean;
  };
}

function toExecutionState(json: unknown): ExecutionState | null {
  const summary = (json as OasisStateResponse | null)
    ?.child_execution_status_summary;
  if (!summary) return null;
  return {
    total: summary.total_executions ?? 0,
    ended: summary.ended_executions ?? 0,
    done: summary.has_ended ?? false,
  };
}

export default function PipelineProgress() {
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [state, setState] = useState<ExecutionState | null>(null);

  useEffect(() => {
    host.getProps().then((props) => {
      if (props && typeof props.executionId === "string") {
        setExecutionId(props.executionId);
      }
    });
  }, []);

  useEffect(() => {
    if (!executionId) return undefined;
    let active = true;

    const tick = async () => {
      try {
        const res = await host.fetch(
          `${OASIS_BASE}/${encodeURIComponent(executionId)}/state`,
        );
        if (active && res.ok) {
          const next = toExecutionState(res.json);
          if (next) setState(next);
        }
      } catch {
        // Tolerate transient failures; keep the last known status.
      }
    };

    tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
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
    state && state.total > 0 ? state.ended / state.total : state?.done ? 1 : 0;
  const label = !state
    ? "Loading execution status…"
    : state.done
      ? `Complete — ${state.ended}/${state.total} executions`
      : `Running — ${state.ended}/${state.total} executions`;

  return (
    <Card density="compact">
      <BlockStack gap="1">
        <Progress value={progress} tone={state?.done ? "success" : "info"} />
        <Text size="xs" tone="subdued">
          {label}
        </Text>
      </BlockStack>
    </Card>
  );
}
