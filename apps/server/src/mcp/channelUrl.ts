import { PUBLIC_URL } from "../config.ts";

/**
 * Whether a dial-able channel address can be issued at all. The gateway reaches
 * Tangent rather than the reverse, so an unset {@link PUBLIC_URL} means a
 * channel has no address to be handed out under.
 */
export function canIssueChannelUrl(): boolean {
  return Boolean(PUBLIC_URL);
}

/**
 * The address an external MCP client dials for a channel, or nothing when this
 * server has not been told its own public base. One shared composition, so every
 * issuer agrees on the address a peer is told to dial.
 */
export function channelUrl(channelId: string): string | undefined {
  if (!PUBLIC_URL) return undefined;
  return `${PUBLIC_URL}/api/mcp/${channelId}`;
}
