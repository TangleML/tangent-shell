/**
 * Message component: the optimization-scenario card. A sandbox port of the
 * sister project's `TangentScenario`.
 *
 * The agent emits a `tangent-ui:tangent-scenario` block carrying the scenario
 * JSON (`{ score, rationale, summary, ideas[] }`); the host parses it and
 * delivers it via `host.getProps()`. The user selects ideas and clicks
 * "Run scenario", which sends a structured prompt back to Prime via
 * `host.sendPrompt` — the only sandbox channel. Prime resolves the baseline
 * run id from its own context and spawns the optimizer sub-agent.
 *
 * Props can arrive late/partial while the agent message streams, so the
 * component degrades to a quiet loading state rather than throwing.
 */
import {
  Badge,
  BlockStack,
  Button,
  Checkbox,
  host,
  InlineStack,
  ScoreRing,
  Text,
} from "@tangent/bundle-ui";
import { useEffect, useMemo, useState } from "react";

type Impact = "high" | "medium" | "low";

type IdeaType =
  | "feature_engineering"
  | "hyperparameter_optimization"
  | "input_data"
  | "model_architecture";

interface ScenarioIdea {
  title: string;
  ideaType: IdeaType;
  impact: Impact;
  evidence: string;
}

interface Scenario {
  score: number;
  rationale: string;
  summary: string;
  ideas: ScenarioIdea[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIdea(value: unknown): ScenarioIdea | null {
  if (!isRecord(value)) return null;
  const { title, ideaType, impact, evidence } = value;
  if (typeof title !== "string") return null;
  if (
    ideaType !== "feature_engineering" &&
    ideaType !== "hyperparameter_optimization" &&
    ideaType !== "input_data" &&
    ideaType !== "model_architecture"
  ) {
    return null;
  }
  if (impact !== "high" && impact !== "medium" && impact !== "low") return null;
  if (typeof evidence !== "string") return null;
  return { title, ideaType, impact, evidence };
}

function parseScenario(value: unknown): Scenario | null {
  if (!isRecord(value)) return null;
  const { score, rationale, summary, ideas } = value;
  if (typeof score !== "number") return null;
  if (typeof rationale !== "string") return null;
  if (typeof summary !== "string") return null;
  if (!Array.isArray(ideas)) return null;

  const parsedIdeas: ScenarioIdea[] = [];
  for (const idea of ideas) {
    const parsed = parseIdea(idea);
    if (parsed) parsedIdeas.push(parsed);
  }

  return { score, rationale, summary, ideas: parsedIdeas };
}

export default function TangentScenario() {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [sent, setSent] = useState(false);
  const [sentTitles, setSentTitles] = useState<string[]>([]);

  useEffect(() => {
    host.getProps().then((props) => {
      const parsed = parseScenario(props);
      if (parsed) {
        setScenario(parsed);
        setSelected(new Set(parsed.ideas.map((_idea, index) => index)));
      }
    });
    host.getState("sent").then((value) => {
      if (value === true) setSent(true);
    });
    host.getState("sentTitles").then((value) => {
      if (Array.isArray(value)) {
        setSentTitles(
          value.filter((title): title is string => typeof title === "string"),
        );
      }
    });
  }, []);

  const selectedTitles = useMemo(() => {
    if (!scenario) return [] as string[];
    return scenario.ideas
      .filter((_idea, index) => selected.has(index))
      .map((idea) => idea.title);
  }, [scenario, selected]);

  if (!scenario) {
    return (
      <Text size="xs" tone="subdued">
        Preparing optimization scenario…
      </Text>
    );
  }

  const toggleIdea = (index: number, isChecked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isChecked) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  };

  const runScenario = async () => {
    if (selectedTitles.length === 0) return;
    const list = selectedTitles.map((title) => `- ${title}`).join("\n");
    await host.sendPrompt(
      `Run optimization scenario with the following ideas:\n${list}`,
    );
    setSent(true);
    setSentTitles(selectedTitles);
    await host.setState("sent", true);
    await host.setState("sentTitles", selectedTitles);
  };

  if (sent) {
    return (
      <BlockStack gap="3">
        <InlineStack gap="2" blockAlign="center" align="space-between">
          <Text size="sm" weight="semibold">
            Optimization potential
          </Text>
          <ScoreRing score={scenario.score} size={32} />
        </InlineStack>

        <Text size="sm" tone="subdued">
          {scenario.rationale}
        </Text>

        {sentTitles.length > 0 && (
          <BlockStack gap="2">
            <Text size="sm" weight="semibold">
              Ideas
            </Text>
            {sentTitles.map((title, index) => (
              <Text key={`${title}-${index}`} size="sm">
                • {title}
              </Text>
            ))}
          </BlockStack>
        )}

        <InlineStack gap="2" blockAlign="center">
          <Badge variant="secondary">Scenario sent</Badge>
        </InlineStack>
      </BlockStack>
    );
  }

  return (
    <BlockStack gap="3">
      <InlineStack gap="2" blockAlign="center" align="space-between">
        <Text size="sm" weight="semibold">
          Optimization potential
        </Text>
        <ScoreRing score={scenario.score} size={32} />
      </InlineStack>

      <Text size="sm" tone="subdued">
        {scenario.rationale}
      </Text>

      {scenario.ideas.length > 0 && (
        <BlockStack gap="2">
          <Text size="sm" weight="semibold">
            Ideas
          </Text>
          {scenario.ideas.map((idea, index) => (
            <Checkbox
              key={`${idea.title}-${index}`}
              label={idea.title}
              checked={selected.has(index)}
              onCheckedChange={(isChecked: boolean) =>
                toggleIdea(index, isChecked)
              }
            />
          ))}
        </BlockStack>
      )}

      <Button
        variant="outline"
        onPress={runScenario}
        disabled={selectedTitles.length === 0}
      >
        Run scenario
      </Button>
    </BlockStack>
  );
}
