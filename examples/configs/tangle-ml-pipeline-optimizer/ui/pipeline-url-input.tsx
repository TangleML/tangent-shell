/**
 * Message component: the proactive first card. The session is pre-seeded with a
 * Prime message containing a `tangent-ui:pipeline-url-input` block, so this card
 * is visible immediately on open.
 *
 * It holds no privileged access: the only outbound action is
 * `host.sendPrompt(text)`, which posts a normal chat message to Prime exactly as
 * if the user had typed the pipeline URL.
 */
import {
  BlockStack,
  Button,
  Card,
  Heading,
  host,
  Text,
  Textarea,
} from "@tangent/bundle-ui";
import { useState } from "react";

export default function PipelineUrlInput() {
  const [url, setUrl] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const text = url.trim();
    if (!text) return;
    await host.sendPrompt(
      `Analyze this Tangle pipeline for optimization: ${text}`,
    );
    setSent(true);
  };

  if (sent) {
    return (
      <Card>
        <BlockStack gap="3" inlineAlign="center">
          <Heading level="4">Analyzing {url}...</Heading>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="3" inlineAlign="center">
        <Heading level="4">Analyze a Tangle pipeline</Heading>
        <Text size="sm" tone="subdued">
          Paste a Tangle pipeline run URL to score its optimization potential.
        </Text>
        <Textarea
          value={url}
          placeholder="https://…/runs/…"
          onInput={(value: string) => setUrl(value)}
        />
        <Button variant="default" onPress={submit} disabled={!url.trim()}>
          Analyze
        </Button>
      </BlockStack>
    </Card>
  );
}
