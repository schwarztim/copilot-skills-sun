---
name: update-mcps
description: Search the web to improve and update MCP servers. Finds new API features, security vulnerabilities, and best practices. Use for maintenance and keeping MCPs current.
---

# Update MCPs Skill

Automatically search the web to find improvements for MCP servers and apply updates.

## When to Use

- "Update my MCPs with latest features"
- "Check for MCP security updates"
- "Are there any new features for the {tool} API?"
- "Keep my MCPs up to date"

## Performance Analysis (Critical)

Look for these anti-patterns:

| Anti-Pattern | Fix |
|--------------|-----|
| Shell spawning (curl/bash) | Use native HTTP client (axios) |
| No connection pooling | Reuse connections with keep-alive |
| No auth caching | Cache tokens, refresh when expired |
| No response caching | Cache with TTL for stable data |
| Sequential calls | Batch with Promise.all() |
| No retry logic | Add exponential backoff |

**Real Example**: Akamai MCP went from 8 minutes to 30 seconds with these fixes.

## Discovery Sources

| Source | What to Look For |
|--------|------------------|
| API Changelogs | New endpoints, deprecations, breaking changes |
| GitHub | Popular MCP repos, new implementations |
| Security Advisories | CVEs, dependency vulnerabilities |
| npm/PyPI | Updated SDK versions |

## How to Run

Use the thesun-mcp-updater agent (available via `/agent`) or:

```bash
# For each MCP in ~/Scripts/mcp-servers/
cd ~/Scripts/mcp-servers/{tool}-mcp
npm audit
npm outdated
npm run build && npm test
```

## Update Priority

- 🔴 **Critical**: Security vulns, auth bypasses, perf anti-patterns
- 🟠 **High**: New API features, deprecated endpoint replacements
- 🟡 **Medium**: New minor endpoints, docs improvements
- 🟢 **Low**: Cosmetic, optional features

## After Updates

1. Rebuild: `npm run build`
2. Test: `npm test`
3. Verify startup: `node dist/index.js` (should not crash)
4. Update CHANGELOG.md
5. Restart Copilot CLI to reload
