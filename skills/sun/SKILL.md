---
name: sun
description: Generate MCP servers autonomously with thesun. The primary interface for creating, fixing, and managing MCP servers. Say "use thesun for {tool}" to generate a complete MCP server.
---

# thesun - Autonomous MCP Server Generator

**The primary skill for interfacing with the thesun MCP tool.**

thesun generates complete, production-ready MCP servers for ANY API or webapp autonomously.

## Three Modes

### 1. CREATE MODE (default)
Generate a new MCP server from documented APIs.

```
thesun({ target: "tesla" })
thesun({ target: "stripe" })
thesun({ target: "crowdstrike" })
```

Batch generation:
```
thesun({ targets: ["tesla", "stripe", "jira"] })
```

### 2. FIX MODE
Fix an existing broken MCP.

```
thesun({ target: "atlassian", fix: "/Users/timothy.schwarz/Scripts/mcp-servers/atlassian-mcp" })
thesun({ target: "jira", fix: "." })
```

### 3. INTERACTIVE MODE
Reverse-engineer undocumented APIs via browser capture.

```
thesun({ target: "myapp", siteUrl: "https://app.example.com" })
thesun({ target: "intranet", siteUrl: "https://intranet.corp.com", loginUrl: "/sso/login" })
thesun({ target: "admin", siteUrl: "https://admin.tool.com", actions: ["list users", "create report"] })
```

## What It Does

1. **Researches** the API (web search, docs, OpenAPI specs)
2. **Creates or fixes** MCP server code (TypeScript)
3. **Captures tokens** from browser for sites without APIs
4. **Writes** comprehensive tests
5. **Runs** security scans
6. **Registers** in `~/.claude/user-mcps.json`

## Browser Auth Defaults (ALWAYS apply for INTERACTIVE/SSO mode)

When generating MCPs that use Playwright browser automation for SSO auth, **always** include these hardened defaults — do NOT require the user to specify them:

### Playwright Firefox Launch Config
```typescript
const browser = await firefox.launch({
  headless: true,
  firefoxUserPrefs: {
    // Auto-accept client certificate prompts (Azure AD, device login, mTLS)
    'security.default_personal_cert': 'Select Automatically',
    // Accept all enterprise/self-signed certs
    'security.enterprise_roots.enabled': true,
    // Disable cert error pages
    'security.certerrors.mitm.auto_enable_enterprise_roots': true,
    // Skip "not secure" warnings
    'security.insecure_field_warning.contextual.enabled': false,
    // Disable safe browsing lookups (avoid timeouts on corp networks)
    'browser.safebrowsing.enabled': false,
  },
});
```

### Context Options
```typescript
const context = await browser.newContext({
  ignoreHTTPSErrors: true,  // Trust all certs including self-signed/corp CA
  userAgent: 'Mozilla/5.0 ...', // Match real Firefox UA string
});
```

### Auth Flow Resilience
- **Headless-first** (60s timeout), **visible fallback** (5min timeout for MFA/CAPTCHA)
- Auto-accept certificate selection dialogs (no user interaction needed)
- Trust enterprise root CAs and self-signed certs
- Handle Azure AD, Okta, Ping, ADFS SSO flows
- Extract CSRF tokens via `window.g_ck || window.NOW?.g_ck`
- Save cookies in BOTH Playwright array format AND header string format for cross-MCP compat

### macOS Keychain Integration
When credentials are in macOS Keychain, use `keytar` (or `security` CLI fallback):
```typescript
// keytar approach
const email = await keytar.getPassword(service, 'email');
const password = await keytar.getPassword(service, 'password');

// CLI fallback if keytar unavailable
const email = execSync(`security find-generic-password -s "${service}" -a "email" -w`).toString().trim();
```

### Cookie Storage
- Store at `~/.{mcp-name}/cookies.json`
- Also check/read from sibling MCP cookie dirs as fallback
- Support both formats: Playwright array `[{name,value,domain}]` AND header string `"key=val; key2=val2"`
- Invalidate on 401/403, auto-refresh via headless re-auth

## Output Location

All MCPs are generated to: `~/Scripts/mcp-servers/{tool}-mcp/`

## Speed

Always use **parallel agents** for MCP generation when possible:
- Agent 1: Scaffold + auth module
- Agent 2: Tool implementations
- Agent 3: Build + test
- Agent 4: README + docs

## After Generation

The MCP needs to be added to `~/.claude/user-mcps.json`:

```json
{
  "mcpServers": {
    "{tool}": {
      "command": "node",
      "args": ["/Users/timothy.schwarz/Scripts/mcp-servers/{tool}-mcp/dist/index.js"]
    }
  }
}
```

Then restart Copilot CLI. Verify with `/mcp show`.

## Available Agents

Use `/agent` to access specialized thesun agents:
- **thesun-meta-planner** — Strategic planning for complex builds
- **thesun-mcp-builder** — Autonomous MCP generation
- **thesun-api-researcher** — API discovery and documentation
- **thesun-mcp-updater** — Keep MCPs current with latest features

## Related Skills

- `sun-auth` — Capture authentication from any webapp
- `generate-mcp` — Detailed generation instructions
- `fix-mcp` — Fix existing MCPs
- `validate-mcp` — Quality scoring
- `list-mcps` — View installed MCPs
- `build-status` — Monitor build progress
- `research-api` — Research APIs before building
- `update-mcps` — Keep MCPs updated
