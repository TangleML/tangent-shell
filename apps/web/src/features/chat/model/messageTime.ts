/** Formats an ISO-8601 timestamp as a short local time, e.g. `07:35 PM`. */
export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
