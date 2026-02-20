---
name: fix-mcp
description: Fix, repair, or improve an existing MCP server. Use when an MCP has build errors, test failures, or is not starting correctly.
---

# Fix MCP Skill

Fix, repair, or improve an existing MCP server using thesun's FIX mode.

## When to Use

- "Fix the {tool} MCP"
- "The {tool} MCP has build errors"
- "Improve the {tool} MCP"
- "Update the {tool} MCP to fix issues"

## Invocation

Use the thesun MCP tool with `fix` parameter:

```
thesun({ target: "{tool}", fix: "{path/to/mcp}" })
```

Examples:
- `thesun({ target: "elastic", fix: "/Users/timothy.schwarz/Scripts/mcp-servers/elastic-mcp" })`
- `thesun({ target: "crowdstrike", fix: "~/Scripts/mcp-servers/crowdstrike-mcp" })`

## What Gets Validated

| Check | Description |
|-------|-------------|
| package.json | Valid npm package with required fields |
| Entry point | src/index.ts exists and exports correctly |
| Build | `npm run build` passes without errors |
| Tests | `npm test` passes (if tests exist) |
| README.md | Documentation exists |
| .env.example | Configuration template exists |
| Git repository | Initialized with remote |
| Graceful startup | Starts without credentials |

## How It Works

1. **Validates** the existing MCP (score 0-100)
2. **Identifies** missing items and issues
3. **Fixes** problems autonomously
4. **Iterates** until all requirements met (up to 3 attempts)

## Output

Returns score (0-100), issues found, fixes applied, and remaining issues.
