import { Button } from "@tangent/ui-primitives/button";
import { ButtonGroup } from "@tangent/ui-primitives/button-group";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack } from "@tangent/ui-primitives/layout";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@tangent/ui-primitives/popover";
import { Heading, Paragraph, Text } from "@tangent/ui-primitives/typography";
import { useState } from "react";

import { useShellUrl } from "@/shared/config/usePublicConfig";
import { CopyText } from "@/shared/ui/patterns/copy-text";

/**
 * One coding agent you can attach from. `id` doubles as the ACP agent the skill
 * spawns (baked into the command as the third positional), so the sub-agent
 * matches its host — Claude joins Claude, Codex joins Codex, and so on.
 */
interface AttachTarget {
  id: string;
  label: string;
  /** The attach line in this host's own skill-invocation syntax. */
  command: (url: string, sessionId: string) => string;
}

const TARGETS: AttachTarget[] = [
  {
    id: "claude",
    label: "Claude",
    command: (url, session) => `/tangent-acp-attach ${url} ${session} claude`,
  },
  {
    id: "codex",
    label: "Codex",
    command: (url, session) => `$tangent-acp-attach ${url} ${session} codex`,
  },
  {
    id: "cursor",
    label: "Cursor",
    command: (url, session) => `/tangent-acp-attach ${url} ${session} cursor`,
  },
  {
    id: "pi",
    label: "Pi",
    command: (url, session) => `/skill:tangent-acp-attach ${url} ${session} pi`,
  },
];

interface AttachAgentPopoverProps {
  sessionId: string;
}

/**
 * Header action that renders the one-line attach command to paste into a running
 * coding agent so it joins this session as a sub-agent. The agent picker selects
 * the host: it shows that host's own skill-invocation syntax and spawns the
 * matching agent. The skill resolves its own authorization — self-minting a
 * session-scoped token and running the SSO login when the Shell is Okta-protected.
 */
export function AttachAgentPopover({ sessionId }: AttachAgentPopoverProps) {
  const [targetId, setTargetId] = useState(TARGETS[0].id);
  const target = TARGETS.find((t) => t.id === targetId) ?? TARGETS[0];
  const shellUrl = useShellUrl();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="link" size="xs">
          <Icon name="Laptop" />
          <Text>Attach a local agent</Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <BlockStack gap="3">
          <BlockStack gap="1">
            <Heading level={3} size="sm">
              Attach an agent
            </Heading>
            <Paragraph size="xs" tone="subdued">
              Pick the agent you are running, then paste this into it in the
              relevant repo. It joins as a sub-agent of the same kind and
              handles its own login — a fresh agent joins this session's roster.
            </Paragraph>
          </BlockStack>

          <ButtonGroup aria-label="Coding agent">
            {TARGETS.map((t) => (
              <Button
                key={t.id}
                size="xs"
                variant={t.id === targetId ? "secondary" : "ghost"}
                aria-pressed={t.id === targetId}
                onClick={() => setTargetId(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </ButtonGroup>

          <CopyText
            value={target.command(shellUrl, sessionId)}
            font="mono"
            size="xs"
            truncate
            alwaysShowButton
          />
        </BlockStack>
      </PopoverContent>
    </Popover>
  );
}
