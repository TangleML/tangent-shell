/**
 * Back-compat facade. The memory implementation moved to `../memory/` when it
 * grew from one hardcoded SimpleMD store into a pluggable {@link MemoryBackend}
 * tree. `MemoryManager` is the built-in SimpleMD backend (session + global); the
 * global-memory route, chat handlers, and host-resource writes keep importing it
 * from here unchanged.
 */
export {
  SimpleMdMemory as MemoryManager,
  type MemoryWriteResult,
  type PendingSuggestion,
} from "../memory/simpleMd.ts";
