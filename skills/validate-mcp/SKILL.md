---
name: validate-mcp
description: Validate an MCP server and return a quality score (0-100) WITHOUT modifying it. Use for auditing, pre-deployment checks, or quality comparison.
---

# Validate MCP Skill

Read-only validation of an MCP server with comprehensive quality report.

## When to Use

- "Validate the {tool} MCP"
- "What's the quality score for this MCP?"
- "Audit the {tool} MCP"

## Validation Checks (run in parallel)

1. package.json exists and is valid (10 pts)
2. Entry point exists (10 pts)
3. README.md exists (10 pts)
4. .env.example exists (10 pts)
5. Build passes (15 pts)
6. Tests pass (15 pts)
7. Git initialized (10 pts)
8. Git remote configured (10 pts)
9. Graceful startup without credentials (10 pts)

**Total: 100 points**

## Grade Scale

| Score | Grade | Status |
|-------|-------|--------|
| 90-100 | A | Production ready |
| 80-89 | B | Good, minor issues |
| 70-79 | C | Acceptable, needs improvement |
| 60-69 | D | Significant issues |
| 0-59 | F | Major problems |

## How to Run

Navigate to the MCP directory and run checks:

```bash
cd /Users/timothy.schwarz/Scripts/mcp-servers/{tool}-mcp
npm run build && npm test
# Start MCP briefly to test graceful startup, then stop by PID
node -e "require('./dist/index.js')" &
MCP_PID=$?; sleep 2; echo "Stopping PID $MCP_PID"
```

Or use the thesun tool in fix mode with dry-run approach - validate first, then decide whether to fix.
