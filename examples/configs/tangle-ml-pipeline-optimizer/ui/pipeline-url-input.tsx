/**
 * Message component: the proactive first card. The session is pre-seeded with a
 * Prime message containing a `tangent-ui:pipeline-url-input` block, so this card
 * is visible immediately on open.
 *
 * It holds no privileged access: the only outbound actions are
 * `host.sendPrompt(text)`, which posts a normal chat message to Prime exactly as
 * if the user had typed the pipeline URL, and `host.fetch`, an allowlist-proxied
 * GET against the Tangle pipeline-runs API used to populate the recent-runs
 * quick-pick. The Tangle response shape isn't vendored here, so parsing is
 * defensive and the section degrades quietly if a field is missing or renamed.
 */
import {
  BlockStack,
  Button,
  Card,
  CardContent,
  CardHeader,
  Heading,
  host,
  InlineStack,
  Pill,
  Spinner,
  Text,
  Textarea,
} from "@tangent/bundle-ui";
import { useEffect, useState } from "react";

/** Tangle API origin; only this host's pipeline-runs path is allowlisted. */
const TANGLE_BASE = "https://oasis.shopify.io";
const RECENT_RUN_LIMIT = 5;

interface RecentRun {
  id: string;
  name: string;
  createdAt: string | null;
  done: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** First string found among the candidate keys, else null. */
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

/** Pulls the runs array out of whichever envelope the API used. */
function extractRunArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!isRecord(json)) return [];
  for (const key of ["pipeline_runs", "runs", "data", "items", "results"]) {
    const value = json[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

const DONE_STATUSES = new Set([
  "succeeded",
  "success",
  "failed",
  "failure",
  "error",
  "cancelled",
  "canceled",
  "complete",
  "completed",
  "done",
]);

/**
 * Decides whether a run has finished. Prefers an explicit status string; falls
 * back to execution-stat booleans (`has_ended`) or an ended timestamp.
 */
function isRunDone(record: Record<string, unknown>): boolean {
  const status = pickString(record, ["status", "run_status", "state", "phase"]);
  if (status) return DONE_STATUSES.has(status.toLowerCase());

  const summary = isRecord(record.execution_stats)
    ? record.execution_stats
    : isRecord(record.child_execution_status_summary)
      ? record.child_execution_status_summary
      : null;
  if (summary && typeof summary.has_ended === "boolean") {
    return summary.has_ended;
  }

  return Boolean(
    pickString(record, ["ended_at", "finished_at", "completed_at"]),
  );
}

function parseRun(value: unknown): RecentRun | null {
  if (!isRecord(value)) return null;
  const id = pickString(value, ["id", "pipeline_run_id", "run_id"]);
  if (!id) return null;
  return {
    id,
    name: pickString(value, ["pipeline_name", "display_name", "name"]) ?? id,
    createdAt: pickString(value, [
      "created_at",
      "created",
      "submitted_at",
      "inserted_at",
    ]),
    done: isRunDone(value),
  };
}

/** Defensive parse: newest-first, capped to {@link RECENT_RUN_LIMIT}. */
function parseRecentRuns(json: unknown): RecentRun[] {
  const runs = extractRunArray(json)
    .map(parseRun)
    .filter((run): run is RecentRun => run !== null);

  runs.sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bTime - aTime;
  });

  return runs.slice(0, RECENT_RUN_LIMIT);
}

function formatDate(createdAt: string | null): string {
  if (!createdAt) return "Unknown date";
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? createdAt : parsed.toLocaleString();
}

function RecentRunItem({
  run,
  onAnalyze,
}: {
  run: RecentRun;
  onAnalyze: (url: string) => void;
}) {
  return (
    <InlineStack gap="2" blockAlign="start" align="space-between">
      <Button
        key={run.id}
        variant="outline"
        onPress={() => onAnalyze(`https://oasis.shopify.io/runs/${run.id}`)}
      >
        Analyze
      </Button>
      <InlineStack gap="1">
        <BlockStack gap="1">
          <Text size="sm" weight="medium">
            {run.name}
          </Text>
          <InlineStack gap="1">
            <Text size="xs" tone="subdued">
              {formatDate(run.createdAt)}
            </Text>
            <Pill tone={run.done ? "success" : "info"} size="sm">
              {run.done ? "Complete" : "In progress"}
            </Pill>
          </InlineStack>
        </BlockStack>
      </InlineStack>
    </InlineStack>
  );
}

export default function PipelineUrlInput() {
  const [url, setUrl] = useState("");
  const [sent, setSent] = useState(false);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await host.fetch(`${TANGLE_BASE}/api/pipeline_runs/`, {
          query: {
            include_execution_stats: true,
            include_pipeline_names: true,
          },
        });
        if (active && res.ok) {
          setRecentRuns(parseRecentRuns(res.json));
        }
      } catch {
        // Tolerate transient failures; the section just stays hidden.
      } finally {
        if (active) setLoadingRuns(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await host.sendPrompt(
      `Analyze this Tangle pipeline for optimization: ${trimmed}`,
    );
    setUrl(trimmed);
    setSent(true);
  };

  if (sent) {
    return (
      <Card>
        <CardContent>
          <BlockStack gap="3" inlineAlign="center">
            <Heading level="4">Analyzing {url}...</Heading>
          </BlockStack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <Heading level="4">Analyze a Tangle pipeline</Heading>
      </CardHeader>
      <CardContent>
        <BlockStack gap="3">
          {loadingRuns ? (
            <InlineStack gap="2" blockAlign="center">
              <Spinner size="sm" />
              <Text size="xs" tone="subdued">
                Loading recent runs…
              </Text>
            </InlineStack>
          ) : recentRuns.length > 0 ? (
            <BlockStack gap="2">
              <Text size="sm" weight="semibold">
                Recent runs
              </Text>
              <BlockStack gap="4">
                {recentRuns.map((run) => (
                  <RecentRunItem key={run.id} run={run} onAnalyze={submit} />
                ))}
              </BlockStack>
            </BlockStack>
          ) : null}

          <BlockStack gap="3" inlineAlign="center">
            <Text size="sm" tone="subdued">
              Paste a Tangle pipeline run URL to score its optimization
              potential.
            </Text>
            <Textarea
              value={url}
              placeholder="https://…/runs/…"
              onInput={(value: string) => setUrl(value)}
            />
            <Button
              variant="default"
              onPress={() => submit(url)}
              disabled={!url.trim()}
            >
              Analyze
            </Button>
          </BlockStack>
        </BlockStack>
      </CardContent>
    </Card>
  );
}
