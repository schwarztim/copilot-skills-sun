# thesun-skills

Skills, scripts, and guides that teach AI assistants how to use **thesun** — an autonomous MCP server generation platform. thesun takes any API, webapp, or service and produces a complete, production-ready [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server.

This repo is the **instruction set**. The thesun MCP tool itself lives separately — these skills tell the AI *when* to invoke it, *how* to handle each auth scenario, and *what to do* when things break.

## What thesun does

```
Any platform ──→ thesun ──→ Working MCP server
```

| Input | Auth method | Discovery method | Example |
|-------|-------------|-----------------|---------|
| Public API with docs | API key | OpenAPI spec + web research | Stripe, Twilio, SendGrid |
| Public API with OAuth | OAuth 2.0 / PKCE | Docs + browser crawl | GitHub, Google, Spotify |
| Corporate SaaS (SSO) | Browser cookie capture | **Crawl+intercept** | ServiceNow, Jira, Confluence |
| Corporate SaaS (proxied) | Cookie + CSRF + path discovery | **Crawl+intercept** (critical) | Dynatrace, Datadog, Splunk |
| Undocumented webapp | SSO / manual login | **Crawl+intercept** (only source) | Internal tools, admin panels |
| No auth needed | None | Docs or crawl | Public datasets, status pages |

thesun auto-detects which pipeline to use. The AI just calls `thesun({ target: "whatever" })`.

### The crawl+intercept engine (Optic-style discovery)

The core innovation: instead of trusting API docs (which are often wrong, incomplete, or nonexistent), thesun uses **Playwright as an API observatory**.

```
Login → Crawl site → page.on('request'/'response') intercepts every XHR/fetch
  → Build endpoint map (method, path, params, request/response schemas)
  → Turn each endpoint into a callable MCP tool
```

This is how it works for undocumented platforms, proxied APIs, and corporate SaaS behind SSO. For well-documented APIs (Stripe, GitHub), thesun still uses the crawl to **verify** that published docs match reality.

## Skills overview

These skills are loaded into the AI assistant's context. Each one handles a different phase of the MCP lifecycle:

```
skills/
├── sun/              Orchestrator — the primary interface to thesun
├── generate-mcp/     Proactive suggestion — detects when an MCP is needed
├── sun-demo/         Reverse-engineering pipeline for browser-based APIs
├── sun-auth/         Browser-based auth capture (SSO, OAuth, MFA)
├── sso-reauth-fix/   Diagnose + fix expired auth in running MCPs
├── fix-mcp/          Fix broken MCPs (build errors, test failures)
├── validate-mcp/     Read-only quality audit (score 0-100)
├── research-api/     API discovery without code generation
└── update-mcps/      Web research → apply updates to existing MCPs

scripts/
├── host-auth.mjs     Host-side SSO cookie capture (Playwright template)
└── reauth.sh         One-command reauth wrapper
```

### How the skills connect

```
User says "connect to Dynatrace"
        │
        ▼
┌─ generate-mcp ─────────────────────────────┐
│  Detects no MCP exists for Dynatrace.       │
│  Asks: "Want me to create one with thesun?" │
└─────────────┬───────────────────────────────┘
              ▼
┌─ sun (orchestrator) ────────────────────────┐
│  thesun({ target: "dynatrace" })            │
│                                             │
│  Auto-detects auth: SSO + proxied API       │
│  Invokes sun-demo pipeline (PROXIED)        │
│  ├─ sun-auth captures browser session       │
│  ├─ Discovers real API paths from traffic   │
│  ├─ Generates TypeScript MCP                │
│  ├─ Validates against live API              │
│  └─ Registers in user-mcps.json            │
└─────────────┬───────────────────────────────┘
              ▼
        MCP is live ✅

        ... 8 hours later, tokens expire ...

┌─ sso-reauth-fix ───────────────────────────┐
│  Diagnoses: SPA token expired               │
│  Runs scripts/host-auth.mjs on host         │
│  Fresh cookies → volume mount → container   │
│  MCP retries → 200 ✅                       │
└─────────────────────────────────────────────┘
```

## Installation

```bash
# Copy skills into Copilot CLI
cp -r skills/* ~/.copilot/skills/

# Copy scripts somewhere accessible
cp -r scripts/ ~/Scripts/thesun-scripts/
```

The skills are markdown files that get loaded into the AI's context automatically. No build step, no dependencies (except Playwright for the host-auth script).

## Auth pipelines in detail

### Pipeline A: API Key / Token

The simplest path. thesun finds the API docs, generates an MCP, and stores the key.

```
thesun({ target: "stripe" })
  → Web research finds Stripe API docs + OpenAPI spec
  → Detects: Bearer token auth
  → Generates MCP with token from env var
  → Validates tools against live API
  → Done
```

### Pipeline B: OAuth 2.0 / PKCE

For platforms with proper OAuth flows (GitHub, Google, etc.):

```
thesun({ target: "github", authMethod: "oauth" })
  → Discovers OAuth endpoints from docs
  → Opens browser for OAuth consent flow
  → Captures access + refresh tokens
  → Generates MCP with auto-refresh logic
  → Tokens stored in ~/.thesun/credentials/
```

### Pipeline C: Corporate SSO (Direct API)

For SaaS platforms where published API paths work as-is (ServiceNow, Jira, Confluence):

```
thesun({ target: "servicenow", siteUrl: "https://corp.service-now.com" })
  → Classifier: DIRECT (published API paths work)
  → Headless Firefox SSO login (device certs for Conditional Access)
  → Captures cookies + CSRF token (e.g., g_ck)
  → Generates MCP using published REST API paths
  → No path reconciliation needed
```

### Pipeline D: Corporate SSO (Proxied API)

For SaaS platforms where the browser proxies API calls through different paths (Dynatrace, Datadog, Splunk):

```
thesun({ target: "dynatrace", siteUrl: "https://corp.dynatrace.com" })
  → Classifier: PROXIED (browser paths ≠ published paths)
  → SSO login + network interception (captures real API paths)
  → Discovers: /platform/classic/environment-api/v2/ (not /api/v2/)
  → Tests auth strategies: cookie-only vs cookie+bearer vs bearer-only
  → Generates MCP with reconciled paths
  → Path fix is MANDATORY before compile
```

### Pipeline E: Undocumented / Crawl-Only

For platforms with NO public API docs — internal tools, admin panels, legacy webapps:

```
thesun({ target: "internal-tool", siteUrl: "https://admin.internal.corp" })
  → Classifier: UNDOCUMENTED
  → SSO login via Playwright
  → Aggressive crawl: clicks nav items, opens modals, triggers searches
  → page.on('request'/'response') captures every XHR/fetch call
  → Builds api-map.json: method, path, params, request/response schemas
  → Generates MCP tools from the map (one tool per endpoint)
  → Each tool has typed params inferred from observed traffic
  → Validates tools against live API
  → Done — AI can now call those endpoints as tools
```

This is the full Optic-style pipeline. No docs needed. The traffic IS the spec.

## SSO reauth: the full loop

The hardest problem with browser-auth MCPs is **re-authentication**. Tokens expire, but containers can't do SSO because they lack device certificates for Conditional Access.

### The solution

```
MCP gets 401
  → Reauth interceptor fires
  → Runs host-auth.mjs on macOS host (has device certs)
  → Playwright headless Firefox → SSO completes automatically
  → Fresh cookies written to ~/.<service>-mcp/cookies.json
  → Container reads via volume mount
  → Retries request → 200 ✅
```

### Quick reauth

```bash
./scripts/reauth.sh servicenow              # capture only
./scripts/reauth.sh dynatrace --restart     # capture + restart container
```

### How the MCP should read fresh creds

The reauth interceptor in every generated MCP must:

1. **Hash-compare** old vs new creds — don't reload stale creds in a loop
2. **Enforce 60s cooldown** between reauth attempts
3. **Prefer file-based creds** over env vars — files are updatable at runtime
4. **Return false** if creds unchanged — breaks infinite retry loops

```typescript
async onUnauthorized(): Promise<boolean> {
  if (Date.now() - this.lastAttempt < 60_000) return false;
  this.lastAttempt = Date.now();

  const fresh = JSON.parse(readFileSync(COOKIE_FILE, "utf-8"));
  const hash = createHash("sha256").update(fresh.headers.Cookie).digest("hex");
  if (hash === this.lastHash) return false;  // stale — don't loop

  this.lastHash = hash;
  this.headers = fresh.headers;
  return true;  // retry with fresh creds
}
```

### Auth failure cheat sheet

| Symptom | Cause | Fix |
|---------|-------|-----|
| Infinite 401 loop | Reloading same stale creds | Hash comparison + cooldown |
| `AADSTS700084` | SPA refresh token expired (24h hard limit) | Run host-auth.mjs |
| 401 after container restart | Env vars are static | Switch to file-based creds + volume mount |
| CSRF 403 on POST | Missing CSRF token | Set `CSRF_GLOBAL_VAR` in host-auth config |
| Conditional Access block | Container lacks device cert | Auth on host, share via file |
| Sub-5-min cookie expiry | Cookies too short-lived | Browser proxy pattern (see sso-reauth-fix) |

## Customizing host-auth.mjs

Edit the configuration block at the top of `scripts/host-auth.mjs`:

| Constant | Purpose | Example |
|----------|---------|---------|
| `SERVICE_NAME` | Env var prefix + config dir | `"servicenow"` |
| `SESSION_INFO_ENDPOINT` | API that returns CSRF token | `"/api/now/ui/user/session_info"` |
| `VERIFY_ENDPOINT` | Test that auth works | `"/api/now/table/sys_user?sysparm_limit=1"` |
| `CSRF_GLOBAL_VAR` | Window global with CSRF | `"g_ck"` |
| `CSRF_HEADER_NAME` | Header for CSRF token | `"X-UserToken"` |
| `KEYCHAIN_EMAIL_LABEL` | macOS Keychain label | `"sso-email"` |
| `KEYCHAIN_PASSWORD_LABEL` | macOS Keychain label | `"sso-password"` |

## thesun tool reference

```
thesun({
  target:          "stripe",                    // required — platform name
  targets:         ["stripe", "twilio"],         // batch mode
  fix:             "/path/to/broken-mcp",        // fix mode
  siteUrl:         "https://app.example.com",    // browser-based discovery
  loginUrl:        "/sso/login",                 // custom login path
  apiDocsUrl:      "https://docs.example.com",   // explicit docs URL
  authMethod:      "auto|sso|api_key|oauth|har|none",
  actions:         ["list users", "create report"], // guide browser actions
  spec:            "/path/to/openapi.json",      // local spec file
  output:          "/custom/output/path",        // override output dir
  parallel:        true,                         // parallel agents (default)
  skipApiKeySearch: false,                       // skip keychain search
})
```

## Output

All generated MCPs land in `~/Scripts/mcp-servers/{target}-mcp/` and are auto-registered in the AI assistant's MCP config.

## License

MIT
