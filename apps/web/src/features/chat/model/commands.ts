import type { ChatCommandRun } from "@tangent/shared/contracts";

/**
 * A slash command the chat box offers. The page the chat is embedded in
 * supplies them: running one posts what it returns, as markdown, for everyone
 * in the chat, and the agent is sent it with the next message.
 */
export interface ChatCommand {
  name: string;
  description: string;
  /** What to type after the name, e.g. `<pipeline ids>`. */
  argumentHint?: string;
  run: (args: string) => Promise<string> | string;
}

/** The command a draft runs, when it starts with `/name`, and what follows. */
export function parseCommand(
  text: string,
  commands: readonly ChatCommand[],
): { command: ChatCommand; args: string } | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const command = commands.find((candidate) => candidate.name === name);
  return command ? { command, args: (match[2] ?? "").trim() } : null;
}

/**
 * Commands matching the query: the one it names exactly, so `/run` isn't
 * taken for `/runs`, then those starting with it, then those containing it.
 */
export function filterCommands(
  commands: readonly ChatCommand[],
  query: string,
): ChatCommand[] {
  const q = query.toLowerCase();
  const rank = ({ name }: ChatCommand) =>
    name === q ? 0 : name.startsWith(q) ? 1 : 2;
  return commands
    .filter(({ name }) => name.includes(q))
    .sort((a, b) => rank(a) - rank(b));
}

export function commandRun(command: ChatCommand, args: string): ChatCommandRun {
  return args ? { name: command.name, args } : { name: command.name };
}
