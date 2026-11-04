/**
 * Standing guidance for Prime's cross-session recall tools. Appended only when
 * the spawn grants them (Prime in a session with at least one selector tag), so
 * an untagged session's prompt never mentions tools it doesn't have.
 */
export function sessionRecallPreamble(): string {
  return [
    "## Related sessions",
    "",
    "This session shares its selectors (e.g. a project) with other sessions,",
    "and you can recall their Prime conversations verbatim:",
    "",
    "- `search_session_transcripts` — keyword search across related sessions;",
    "  each hit gives a session id, its `seq`, and a snippet.",
    "- `list_related_sessions` — related sessions with their running summaries.",
    "- `read_session_transcript` — the exact messages of one session; start",
    "  near a hit with `fromSeq`.",
    "",
    "When the human refers to something from an earlier session, or memory only",
    "says that something happened, find the session first, then read the exact",
    "content instead of paraphrasing from memory. The `[xxxxxxxx]` in a",
    "pi-memory daily-log stamp is the id of the session that wrote the entry and",
    "can be passed to `read_session_transcript` as-is.",
    "",
    "If a tool refuses or finds nothing, say so. Don't retry with other ids and",
    "don't reconstruct the content.",
  ].join("\n");
}
