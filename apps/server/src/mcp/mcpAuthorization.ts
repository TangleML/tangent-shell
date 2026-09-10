/**
 * The Bearer value a channel's credential should be checked against, picking
 * between two headers. `Authorization: Bearer` is the primary path; when it is
 * absent or non-Bearer (a gateway fronting `/api/mcp` may spend `Authorization`
 * on its own `Basic` auth), the MCP secret rides `Mcp-Authorization` instead.
 */
export function mcpAuthorization(
  getHeader: (name: string) => string | undefined,
): string | undefined {
  const primary = getHeader("authorization");
  if (isBearer(primary)) return primary;
  const alias = getHeader("mcp-authorization");
  return isBearer(alias) ? alias : undefined;
}

function isBearer(header: string | undefined): boolean {
  return /^Bearer\s+.+$/i.test((header ?? "").trim());
}
