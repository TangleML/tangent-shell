/**
 * Message component: a live progress chip for a Tangle execution.
 *
 * The agent emits a `tangent-ui:pipeline-progress` block carrying
 * `{ "executionId": "<id>" }`; the host parses it and delivers it via
 * `host.getProps()`. We then poll the real Tangle executions-state endpoint
 * through the allowlisted `host.fetch` bridge and render a progress bar.
 *
 * The header shows the pipeline's real title (resolved live from the Tangle API
 * via the execution id) and acts as a link: pressing it asks the host to open
 * the run in a new tab through the `openUrl` UI command.
 *
 * Props can arrive late/partial while the agent message streams, and the network
 * call can fail transiently, so the component degrades to a quiet loading state
 * and keeps the last known status rather than throwing.
 */
import {
  InlineStack,
  BlockStack,
  Button,
  Card,
  CardContent,
  CardHeader,
  host,
  Icon,
  Progress,
  StatusBar,
  Text,
} from "@tangent/ui-extensions-sdk";
import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 4000;

function tangleApi(path: string) {
  return { target: "tangle" as const, path };
}

/** Candidate keys for the pipeline's human title across API shapes. */
const TITLE_KEYS = ["pipeline_name", "display_name", "name", "title"];

/** Per-status counts, e.g. `{ SUCCEEDED: 3, RUNNING: 1 }`. */
type StatusStats = Record<string, number>;

interface ExecutionState {
  total: number;
  ended: number;
  done: boolean;
  /** Flattened per-status counts for the segmented bar. */
  stats: StatusStats;
}

interface PipelineMeta {
  title: string | null;
  path: string | null;
}

interface TangleStateResponse {
  child_execution_status_summary?: {
    total_executions?: number;
    ended_executions?: number;
    has_ended?: boolean;
  };
  child_execution_status_stats?: Record<
    string,
    Record<string, number> | null | undefined
  > | null;
}

/** Flatten the nested per-child status stats into a single status->count map. */
function flattenStatusStats(
  childStats: TangleStateResponse["child_execution_status_stats"],
): StatusStats {
  if (!childStats) return {};
  const result: StatusStats = {};
  for (const stats of Object.values(childStats)) {
    if (!stats) continue;
    for (const [status, count] of Object.entries(stats)) {
      if (typeof count === "number" && count > 0) {
        result[status] = (result[status] ?? 0) + count;
      }
    }
  }
  return result;
}

function toExecutionState(json: unknown): ExecutionState | null {
  const response = json as TangleStateResponse | null;
  const summary = response?.child_execution_status_summary;
  if (!summary) return null;
  return {
    total: summary.total_executions ?? 0,
    ended: summary.ended_executions ?? 0,
    done: summary.has_ended ?? false,
    stats: flattenStatusStats(response?.child_execution_status_stats),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** First non-empty string found among the candidate keys, else null. */
function pickString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const found = asString(record[key]);
    if (found) return found;
  }
  return null;
}

/** The nested record at `key`, or null when absent / not an object. */
function recordAt(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

/** Walks a nested key path and returns the string leaf, else null. */
function pickPath(json: unknown, path: string[]): string | null {
  let current: unknown = json;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return asString(current);
}

/** Pulls the pipeline run id from a details/run payload, defensively. */
function extractRunId(json: unknown): string | null {
  if (!isRecord(json)) return null;
  const direct = pickString(json, ["pipeline_run_id", "run_id"]);
  if (direct) return direct;
  const nested = recordAt(json, "pipeline_run") ?? recordAt(json, "run");
  return nested
    ? pickString(nested, ["id", "pipeline_run_id", "run_id"])
    : null;
}

/**
 * Pulls the pipeline title from a details/run payload. The execution `details`
 * response carries it at `task_spec.componentRef.spec.name`; other shapes (e.g.
 * the pipeline-runs endpoint) expose it via the flat {@link TITLE_KEYS}.
 */
function extractTitle(json: unknown): string | null {
  const fromSpec = pickPath(json, [
    "task_spec",
    "componentRef",
    "spec",
    "name",
  ]);
  if (fromSpec) return fromSpec;
  if (!isRecord(json)) return null;
  const direct = pickString(json, TITLE_KEYS);
  if (direct) return direct;
  const nested =
    recordAt(json, "pipeline_run") ??
    recordAt(json, "pipeline") ??
    recordAt(json, "run");
  return nested ? pickString(nested, TITLE_KEYS) : null;
}

/** Fetches the pipeline run title by id, or null on failure. */
async function loadRunTitle(runId: string): Promise<string | null> {
  try {
    const res = await host.fetch(
      tangleApi(`/api/pipeline_runs/${encodeURIComponent(runId)}`),
    );
    return res.ok ? extractTitle(res.json) : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the pipeline's title and run URL from an execution id. Reads the
 * execution details, falls back to the pipeline-runs endpoint for the title,
 * and leaves the URL null when no run id is present.
 */
async function loadPipelineMeta(
  executionId: string,
): Promise<PipelineMeta | null> {
  try {
    const res = await host.fetch(
      tangleApi(`/api/executions/${encodeURIComponent(executionId)}/details`),
    );
    if (!res.ok) return null;
    const runId = extractRunId(res.json);
    const path = runId ? `/runs/${encodeURIComponent(runId)}` : null;
    const title =
      extractTitle(res.json) ?? (runId ? await loadRunTitle(runId) : null);
    return { title, path };
  } catch {
    return null;
  }
}

export default function PipelineProgress() {
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [state, setState] = useState<ExecutionState | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [pipelinePath, setPipelinePath] = useState<string | null>(null);

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

    loadPipelineMeta(executionId).then((meta) => {
      if (!active || !meta) return;
      setTitle(meta.title);
      setPipelinePath(meta.path);
    });

    return () => {
      active = false;
    };
  }, [executionId]);

  useEffect(() => {
    if (!executionId) return undefined;
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };

    const tick = async () => {
      try {
        const res = await host.fetch(
          tangleApi(`/api/executions/${encodeURIComponent(executionId)}/state`),
        );
        if (!active || !res.ok) return;
        const next = toExecutionState(res.json);
        if (!next) return;
        setState(next);
        // The run reached a terminal state; no need to keep polling.
        if (next.done) stop();
      } catch {
        // Tolerate transient failures; keep the last known status.
      }
    };

    tick();
    timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      active = false;
      stop();
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
  const hasStats = state ? Object.keys(state.stats).length > 0 : false;
  const label = !state
    ? "Loading execution status…"
    : state.done
      ? `Complete — ${state.ended}/${state.total} executions`
      : `Running — ${state.ended}/${state.total} executions`;
  const displayTitle = title ?? "Pipeline";

  const openPipeline = async () => {
    if (!pipelinePath) return;
    await host.execUICommand({
      type: "openTargetUrl",
      target: "tangle",
      path: pipelinePath,
    });
  };

  return (
    <Card density="compact">
      <CardHeader>
        <InlineStack gap="1" blockAlign="center" align="start">
          <Icon name="GitBranch" />
          <Button
            variant="link"
            size="sm"
            onPress={openPipeline}
            disabled={!pipelinePath}
          >
            {displayTitle}
            <Icon name="ExternalLink" size="xs" />
          </Button>
        </InlineStack>
      </CardHeader>
      <CardContent>
        <BlockStack gap="1">
          {hasStats && state ? (
            <StatusBar segments={JSON.stringify(state.stats)} />
          ) : (
            <Progress
              value={progress}
              tone={state?.done ? "success" : "info"}
            />
          )}
          <Text size="xs" tone="subdued">
            {label}
          </Text>
        </BlockStack>
      </CardContent>
    </Card>
  );
}
