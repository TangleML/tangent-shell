---
name: typescript-refactoring
description: Perform TypeScript refactoring operations using compiler-aware tooling — rename symbols, move/rename files, extract functions/constants/variables, find references, and organize imports. Use when moving files, renaming symbols or files, extracting code, cleaning up imports, or performing any structural refactoring in TypeScript/JavaScript files. Always prefer these tools over manual edits (sed/grep/mv) for refactoring.
---

# TypeScript Refactoring

Use the `mcp-refactor-typescript` MCP server (`CallMcpTool`) for all structural refactoring. These tools are compiler-aware — they update imports, re-exports, JSDoc references, and dynamic imports automatically. **Never use `mv`, `sed`, `grep`, or manual edits for renaming/moving files or symbols.**

ALWAYS use ABSOLUTE path to files when using `mcp-refactor-typescript` MCP server.

## Tools Overview

| Tool              | Operations                                                                                                | Use for                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `file_operations` | `rename_file`, `move_file`, `batch_move_files`                                                            | Renaming/moving TS/JS files                          |
| `refactoring`     | `rename`, `extract_function`, `extract_constant`, `extract_variable`, `infer_return_type`, `move_to_file` | Symbol renames, code extraction, move symbol to file |
| `code_quality`    | `organize_imports`, `fix_all`, `remove_unused`                                                            | Import cleanup, auto-fixes                           |
| `workspace`       | `find_references`, `refactor_module`, `cleanup_codebase`, `restart_tsserver`                              | Impact analysis, module moves                        |

## Required Workflow

1. **Before refactoring**: Use `find_references` to understand impact
2. **Perform the refactoring**: Use the appropriate tool (never manual edits)
3. **After refactoring**: Run `organize_imports` or `fix_all` on affected files

## Operations Reference

### Rename a File

Renames a file and updates all imports across the codebase.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "file_operations",
  "arguments": {
    "operation": "rename_file",
    "sourcePath": "src/service.ts",
    "name": "api-service.ts"
  }
}
```

### Move a File

Moves a file to a new directory and updates all import paths.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "file_operations",
  "arguments": {
    "operation": "move_file",
    "sourcePath": "src/old/service.ts",
    "destinationPath": "src/new/service.ts"
  }
}
```

### Move Multiple Files

Moves multiple files to a target folder atomically.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "file_operations",
  "arguments": {
    "operation": "batch_move_files",
    "files": ["src/util1.ts", "src/util2.ts"],
    "targetFolder": "src/utils"
  }
}
```

### Rename a Symbol

Renames a variable, function, class, type, or any symbol across the entire project. Updates all references, imports, exports, and JSDoc.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "refactoring",
  "arguments": {
    "operation": "rename",
    "filePath": "src/math.ts",
    "line": 5,
    "text": "calculateSum",
    "name": "computeSum"
  }
}
```

Required params: `filePath`, `line` (1-based), `text` (the symbol text at that line), `name` (new name).

### Extract Function

Extracts a code selection into a new function. Auto-detects parameters, return type, closures, and mutations.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "refactoring",
  "arguments": {
    "operation": "extract_function",
    "filePath": "src/handler.ts",
    "line": 10,
    "text": "const result = x + y;",
    "name": "addNumbers"
  }
}
```

`text` must be the exact code to extract (can span multiple lines). `name` is the new function name.

### Extract Constant

Extracts a value (magic number, string, expression) into a named constant at the optimal scope.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "refactoring",
  "arguments": {
    "operation": "extract_constant",
    "filePath": "src/math.ts",
    "line": 3,
    "text": "3.14159",
    "name": "PI"
  }
}
```

### Extract Variable

Extracts a complex expression into a local variable.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "refactoring",
  "arguments": {
    "operation": "extract_variable",
    "filePath": "src/utils.ts",
    "line": 7,
    "text": "items.filter(i => i.active).map(i => i.name)",
    "name": "activeNames"
  }
}
```

### Infer Return Type

Adds a compiler-inferred return type annotation to a function.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "refactoring",
  "arguments": {
    "operation": "infer_return_type",
    "filePath": "src/api.ts",
    "line": 12,
    "text": "getData"
  }
}
```

### Move Symbol to File

Moves a top-level symbol (function, class, type, interface, const) to a new or existing file. Automatically updates all import references across the project. Creates the destination file (and directories) if needed.

**Move to auto-created file** (TypeScript picks the filename):

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "refactoring",
  "arguments": {
    "operation": "move_to_file",
    "filePath": "src/utils.ts",
    "line": 15,
    "text": "parseConfig"
  }
}
```

**Move to a specific target file:**

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "refactoring",
  "arguments": {
    "operation": "move_to_file",
    "filePath": "src/utils.ts",
    "line": 15,
    "text": "parseConfig",
    "destinationPath": "src/config/parser.ts"
  }
}
```

Required params: `filePath`, `line` (1-based), `text` (the symbol name at that line). Optional: `destinationPath` (omit to auto-create a new file).

### Find References

Type-aware reference search. Catches dynamic imports, re-exports, and JSDoc that grep misses. **Always run before renaming or refactoring to understand impact.**

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "workspace",
  "arguments": {
    "operation": "find_references",
    "filePath": "src/utils.ts",
    "line": 10,
    "text": "helper"
  }
}
```

### Refactor Module (Move + Cleanup)

Moves a file, updates imports, organizes imports in affected files, and fixes TS errors — all in one operation.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "workspace",
  "arguments": {
    "operation": "refactor_module",
    "sourcePath": "src/old/service.ts",
    "destinationPath": "src/new/service.ts"
  }
}
```

### Organize Imports

Sorts imports alphabetically and removes unused imports. Preserves side-effect imports.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "code_quality",
  "arguments": {
    "operation": "organize_imports",
    "filePath": "src/component.tsx"
  }
}
```

### Fix All

Applies all available TypeScript quick fixes (missing properties, type mismatches, missing imports, etc.).

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "code_quality",
  "arguments": {
    "operation": "fix_all",
    "filePath": "src/component.tsx"
  }
}
```

### Remove Unused

Aggressively removes all unused variables and imports. Never removes side-effect code.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "code_quality",
  "arguments": {
    "operation": "remove_unused",
    "filePath": "src/component.tsx"
  }
}
```

### Cleanup Codebase

Organizes imports across all files. With `deleteUnusedFiles: true`, also removes unused exports and files (**destructive — use `preview: true` first**).

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "workspace",
  "arguments": {
    "operation": "cleanup_codebase",
    "directory": "src",
    "deleteUnusedFiles": true,
    "entrypoints": ["src/main\\.tsx$"],
    "preview": true
  }
}
```

`entrypoints` is **required** when `deleteUnusedFiles` is `true`. Omit `deleteUnusedFiles` for safe import-only cleanup.

### Restart TS Server

Use after tsconfig changes, dependency updates, or stale type info.

```json
{
  "server": "user-mcp-refactor-typescript",
  "toolName": "workspace",
  "arguments": {
    "operation": "restart_tsserver"
  }
}
```

## Decision Guide

| Task                            | Tool              | Operation           |
| ------------------------------- | ----------------- | ------------------- |
| Rename a `.ts`/`.tsx` file      | `file_operations` | `rename_file`       |
| Move a file to another dir      | `file_operations` | `move_file`         |
| Move multiple files             | `file_operations` | `batch_move_files`  |
| Rename a variable/function/type | `refactoring`     | `rename`            |
| Pull code into a new function   | `refactoring`     | `extract_function`  |
| Name a magic value              | `refactoring`     | `extract_constant`  |
| Simplify a complex expression   | `refactoring`     | `extract_variable`  |
| Add return type to function     | `refactoring`     | `infer_return_type` |
| Move symbol to another file     | `refactoring`     | `move_to_file`      |
| See where a symbol is used      | `workspace`       | `find_references`   |
| Move file + full cleanup        | `workspace`       | `refactor_module`   |
| Sort/clean imports in a file    | `code_quality`    | `organize_imports`  |
| Auto-fix TS errors              | `code_quality`    | `fix_all`           |
| Remove dead code in a file      | `code_quality`    | `remove_unused`     |
| Clean entire codebase imports   | `workspace`       | `cleanup_codebase`  |

## Common Workflows

### Rename and clean up

1. `find_references` — assess impact
2. `rename` — perform the rename
3. `organize_imports` — clean affected files

### Extract symbol to its own file

1. `find_references` — understand what depends on the symbol
2. `move_to_file` — move the symbol (with or without a destination path)
3. `organize_imports` on affected files

### Reorganize files

1. `batch_move_files` or `refactor_module` — move files
2. `organize_imports` on affected files

### Pre-commit cleanup

1. `organize_imports` on changed files
2. `remove_unused` on changed files
3. `fix_all` if there are TS errors

## Safety Notes

- All operations support `"preview": true` to see changes before applying
- `cleanup_codebase` with `deleteUnusedFiles: true` is **destructive** — always preview first
- `find_references` is read-only and safe to run anytime
- `restart_tsserver` takes 5-10s; use only when types are stale
