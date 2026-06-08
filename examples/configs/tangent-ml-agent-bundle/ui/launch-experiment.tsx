/**
 * Panel component: a small form that composes a prompt to launch a Tangle
 * experiment. Listed in the composer for sessions bound to this bundle.
 *
 * It holds no privileged access: the only outbound action is
 * `host.sendPrompt(text)`, which posts a normal chat message to Prime exactly as
 * if the user had typed it.
 */
import { BlockStack, Button, Heading, host, Textarea } from "@tangent/bundle-ui";
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
        placeholder="Describe the experiment to launch…"
        onInput={(value: string) => setGoal(value)}
      />
      <Button variant="default" onPress={submit} disabled={!goal.trim()}>
        Launch
      </Button>
    </BlockStack>
  );
}
