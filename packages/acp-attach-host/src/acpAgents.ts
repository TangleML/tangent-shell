/** How to launch one coding agent in ACP (stdio) mode. */
export interface AcpAgentCommand {
  bin: string;
  args: string[];
}

/**
 * The ACP adapter command for each supported agent, by its short name. Mirrors
 * the public ACP registry: a native `--acp` flag where the agent ships one, an
 * adapter package otherwise. New agents are one entry here and nowhere else.
 */
const ACP_AGENTS: Record<string, AcpAgentCommand> = {
  claude: { bin: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp"] },
  codex: { bin: "npx", args: ["-y", "@agentclientprotocol/codex-acp"] },
  gemini: { bin: "gemini", args: ["--acp"] },
  pi: { bin: "npx", args: ["-y", "pi-acp"] },
  cursor: { bin: "cursor-agent", args: ["acp"] },
  qwen: { bin: "qwen", args: ["--acp"] },
  opencode: { bin: "npx", args: ["-y", "opencode-ai", "acp"] },
  goose: { bin: "goose", args: ["acp"] },
};

/** The agent names with a built-in ACP command. */
export function acpAgentNames(): string[] {
  return Object.keys(ACP_AGENTS);
}

/**
 * Resolves `name` to its ACP adapter command. An unknown name falls through as
 * a raw executable so a custom launcher still works, the way acpx treats an
 * unregistered name.
 */
export function resolveAcpAgent(name: string): AcpAgentCommand {
  const known = ACP_AGENTS[name];
  if (known) return known;
  return { bin: name, args: [] };
}
