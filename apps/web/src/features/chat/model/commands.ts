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

/** Commands whose name starts with the query, then those that contain it. */
export function filterCommands(
  commands: readonly ChatCommand[],
  query: string,
): ChatCommand[] {
  const q = query.toLowerCase();
  return [
    ...commands.filter(({ name }) => name.startsWith(q)),
    ...commands.filter(({ name }) => !name.startsWith(q) && name.includes(q)),
  ];
}

export function commandRun(command: ChatCommand, args: string): ChatCommandRun {
  return args ? { name: command.name, args } : { name: command.name };
}
