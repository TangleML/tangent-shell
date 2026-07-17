/**
 * Message component: a launcher card for the embedded Tangle pipeline editor.
 *
 * The agent emits a `tangent-ui:pipeline-editor` block (optionally carrying a
 * `{ "title": "..." }`); pressing the button asks the host to open a full-screen
 * in-app Pipeline Editor tab via the `openTab` UI command. That tab embeds the
 * Tangle editor and connects back as this session's CSOM executor, so Prime's
 * `csom_*` tools can build the pipeline live.
 *
 * The sandbox itself cannot render an iframe or open a socket, so this component
 * is purely the entry point — all the real work happens in the host tab.
 */
import {
  BlockStack,
  Button,
  Card,
  CardContent,
  CardHeader,
  host,
  Icon,
  InlineStack,
  Text,
} from "@tangent/ui-extensions-sdk";
import { useEffect, useState } from "react";

export default function PipelineEditor() {
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    host.getProps().then((props) => {
      if (props && typeof props.title === "string") setTitle(props.title);
    });
  }, []);

  const open = async () => {
    await host.execUICommand({
      type: "openTab",
      tab: "pipeline-editor",
      title: title ?? undefined,
    });
  };

  return (
    <Card density="compact">
      <CardHeader>
        <InlineStack gap="1" blockAlign="center" align="start">
          <Icon name="Workflow" />
          <Text size="sm">{title ?? "Pipeline Editor"}</Text>
        </InlineStack>
      </CardHeader>
      <CardContent>
        <BlockStack gap="2">
          <Text size="xs" tone="subdued">
            Open the editor to build this pipeline together in real time.
          </Text>
          <Button variant="secondary" size="sm" onPress={open}>
            <Icon name="SquareArrowOutUpRight" size="xs" />
            Open Pipeline Editor
          </Button>
        </BlockStack>
      </CardContent>
    </Card>
  );
}
