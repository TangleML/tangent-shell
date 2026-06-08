/**
 * Dev-only harness for the bundle-UI sandbox runtime (Phase 5).
 *
 * Mounts a {@link BundleUiHost} against a compiled fixture component served from
 * `public/bundle-ui-harness/sample.js` and proves the end-to-end loop without
 * touching real chat: the component renders through the vocabulary, polls the
 * stubbed `host.fetch` egress, and pushes prompts back via `host.sendPrompt`
 * (captured below). It is wired into the router only when `env.isDev`.
 */

import { useState } from "react";

import { BundleUiHost } from "@/features/bundle-ui/BundleUiHost";
import { Box } from "@/shared/ui/box";
import { Button } from "@/shared/ui/button";
import { BlockStack } from "@/shared/ui/layout";
import { Page } from "@/shared/ui/patterns/page";
import { Section } from "@/shared/ui/patterns/section";
import { Heading, Paragraph, Text } from "@/shared/ui/typography";

const SAMPLE_MODULE_URL = "/bundle-ui-harness/sample.js";

export function BundleUiHarnessPage() {
  const [prompts, setPrompts] = useState<string[]>([]);
  const [crashToken, setCrashToken] = useState(0);
  const [showCrash, setShowCrash] = useState(false);
  // A sample Oasis execution id; the component polls the real allowlisted
  // endpoint and degrades to a loading state when the host is unreachable.
  const [executionId] = useState("019ea56d72cd5f4d75f6");

  return (
    <Page>
      <BlockStack gap="5">
        <BlockStack gap="1">
          <Heading level={2}>Bundle UI harness</Heading>
          <Paragraph tone="subdued">
            Renders a sandboxed component in a Web Worker via remote-dom. The
            progress bar polls the real allowlisted egress endpoint (Oasis
            execution state); the button sends a prompt through the host bridge.
          </Paragraph>
        </BlockStack>

        <Section title="Message component">
          <Box maxInlineSize="sm">
            <BundleUiHost
              moduleUrl={SAMPLE_MODULE_URL}
              kind="message"
              props={{ executionId }}
              onSendPrompt={(text) => setPrompts((prev) => [...prev, text])}
            />
          </Box>
        </Section>

        <Section title="Captured prompts">
          {prompts.length === 0 ? (
            <Text size="xs" tone="subdued">
              No prompts captured yet. Press the button above.
            </Text>
          ) : (
            <BlockStack gap="1">
              {prompts.map((text, index) => (
                <Text key={index} size="xs">
                  {text}
                </Text>
              ))}
            </BlockStack>
          )}
        </Section>

        <Section
          title="Crash isolation"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowCrash(true);
                setCrashToken((value) => value + 1);
              }}
            >
              Load broken component
            </Button>
          }
        >
          <Paragraph tone="subdued">
            Loads a non-existent module URL; the host should show a quiet
            placeholder instead of breaking the page.
          </Paragraph>
          {showCrash ? (
            <Box maxInlineSize="sm">
              <BundleUiHost
                key={crashToken}
                moduleUrl="/bundle-ui-harness/does-not-exist.js"
                kind="message"
              />
            </Box>
          ) : null}
        </Section>
      </BlockStack>
    </Page>
  );
}
