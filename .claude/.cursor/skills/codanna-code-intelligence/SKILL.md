---
name: codanna-code-intelligence
description: Use Codanna MCP as the primary code intelligence tool for exploring, searching, and analyzing this codebase. Use INSTEAD of grep/ripgrep/find for symbol lookups, understanding code relationships, tracing callers/callees, impact analysis, and semantic code search. Applies to every task that involves reading, navigating, or understanding code.
---

# Codanna Code Intelligence

Codanna is the **primary tool** for code analysis in this project. Prefer Codanna MCP over grep, ripgrep, SemanticSearch, and file-system searches for all code understanding tasks.

## When to Use Codanna vs Other Tools

| Task                                                                  | Use Codanna                       | Use Other Tool |
| --------------------------------------------------------------------- | --------------------------------- | -------------- |
| Find a function/class/type by name                                    | `find_symbol` or `search_symbols` | -              |
| Understand what a function does                                       | `semantic_search_with_context`    | -              |
| Find code by concept/meaning                                          | `semantic_search_with_context`    | -              |
| Trace who calls a function                                            | `find_callers`                    | -              |
| See what a function calls                                             | `get_calls`                       | -              |
| Assess change impact / refactor safety                                | `analyze_impact`                  | -              |
| Find project documentation                                            | `search_documents`                | -              |
| Exact string/regex match (error messages, config values, CSS classes) | -                                 | Grep           |
| Read a known file path                                                | -                                 | Read           |
| Find files by glob pattern                                            | -                                 | Glob           |
| Check index health                                                    | `get_index_info`                  | -              |

## Tool Tier Reference

### Tier 1 — Start here (richest context)

**`semantic_search_with_context`** — Natural language search with full relationship graph.

```
CallMcpTool server:user-codanna toolName:semantic_search_with_context
  arguments: { "query": "pipeline validation before run", "limit": 3 }
```

Returns: symbol + docs + callers + callees + type usage + impact graph. Best for orienting on unfamiliar code.

**`analyze_impact`** — Full dependency graph of a symbol.

```
CallMcpTool server:user-codanna toolName:analyze_impact
  arguments: { "symbol_name": "WindowStore", "max_depth": 3 }
```

Returns: everything that depends on the symbol (calls, type usage, JSX composition). Use before refactoring.

### Tier 2 — Drill down

**`find_symbol`** — Exact name lookup. Returns file path, line range, signature, visibility.

```
CallMcpTool server:user-codanna toolName:find_symbol
  arguments: { "name": "useFlowStore" }
```

**`search_symbols`** — Fuzzy text search across symbol names. Supports `kind` filter.

```
CallMcpTool server:user-codanna toolName:search_symbols
  arguments: { "query": "FlowCanvas", "kind": "Function", "limit": 5 }
```

**`get_calls`** / **`find_callers`** — Trace call relationships in one direction.

```
CallMcpTool server:user-codanna toolName:find_callers
  arguments: { "function_name": "createPipeline" }
```

Use `symbol_id` (returned by other tools) for unambiguous lookup when names are common.

### Tier 3 — Browse / verify

**`semantic_search_docs`** — Lightweight semantic search (no relationship context).

**`search_documents`** — Search indexed markdown/text documentation.

**`get_index_info`** — Check what's indexed (symbol counts, languages).

## Common Workflows

### "Where is X implemented?"

1. `find_symbol` with the exact name
2. Read the file at the returned path/line range

### "How does feature X work?"

1. `semantic_search_with_context` with a natural language description
2. Chain `get_calls` on the top result's `symbol_id` to trace the flow
3. Read relevant files to confirm details

### "What breaks if I change X?"

1. `analyze_impact` on the symbol (use `max_depth: 4` for thorough analysis)
2. Review the dependency graph: direct callers, type consumers, JSX renderers
3. Read affected files to plan the change

### "Who uses this hook/component?"

1. `find_callers` with the function name
2. If ambiguous (common name), first `find_symbol` to get the `symbol_id`, then `find_callers` with `symbol_id`

### "Find code related to a concept"

1. `semantic_search_with_context` with descriptive query (e.g., "undo redo history management")
2. Refine with `search_symbols` if you need to narrow by kind or module

## Query Writing Tips

- Be specific: "pipeline node validation before execution" not "validation"
- Use domain terms: "task annotation schema" not "data format"
- Add context: "React Flow edge connection rules" not "edges"
- Filter by language when needed: `lang: "typescript"`

## Rules

1. **Always try Codanna first** for any code exploration, navigation, or understanding task
2. **Fall back to Grep** only for literal string matching (error messages, config keys, CSS classes, URLs)
3. **Chain tools** using `symbol_id` from results to avoid ambiguity in follow-up queries
4. **Confirm with Read** — Codanna results are pointers; always read the actual file to verify details before making changes
5. **Use `lang: "typescript"`** filter in this project since it's a TypeScript codebase
