---
name: sun-demo
description: Reverse-engineer any web platform into a working MCP server in under 3 minutes. Fully autonomous.
---

# sun-demo — Reverse-engineer anything into an MCP

Turn ANY web platform into a working MCP server. We log in like a browser, intercept real API traffic, and wrap those endpoints as MCP tools. No API keys needed.

## The Approach
We are NOT using official API keys or tokens. We log into the platform via SSO like a real user, capture cookies + session tokens + bearer tokens + the actual API paths the browser uses. Then we build MCP tools that replay those same calls. This is reverse-engineered browser-proxied API access.

## What this does
You get a name, a URL, and auth hints. Output: a registered MCP server at `~/Scripts/mcp-servers/{name}-mcp/`.

---

## STEP 0 — Classifier (10 seconds, MANDATORY)

⚠️ **YOU MUST EXECUTE THIS STEP.** Do NOT skip it. Do NOT guess the pipeline from the platform name. Launch the classifier agent and WAIT for its response before proceeding.

Launch a Haiku `task` agent (blocking, NOT background):

**Classifier prompt:**
> Given target URL `{targetUrl}` and platform name `{name}`:
> 1. Web search `"{name}" REST API documentation authentication`
> 2. Determine: Does this platform expose a REST API at a PUBLISHED, DIRECT path (e.g., `https://host/api/now/table/`, `https://api.github.com/repos/`)? Or does it serve its API through a BROWSER-PROXIED shell where the real paths differ from docs (e.g., Dynatrace uses `/platform/classic/environment-api/v2/` in-browser but docs say `/api/v2/`)?
>
> Respond with EXACTLY one word: `DIRECT` or `PROXIED`
>
> Hints:
> - If the API docs show the same hostname as the web UI and paths start with `/api/` → likely DIRECT
> - If the platform has a "managed" or "SaaS" UI and you see references to "environment API" vs "platform API" or "classic" paths → likely PROXIED
> - ServiceNow, Jira, GitHub, Confluence, PagerDuty → DIRECT
> - Dynatrace, Datadog, New Relic, Splunk Cloud → PROXIED

Read the agent result. Set `pipeline = "DIRECT"` or `pipeline = "PROXIED"`. Then proceed to the matching pipeline below.

---

## PIPELINE A: DIRECT API (ServiceNow, Jira, GitHub, etc.)

Published API paths work as-is. Auth = cookies + CSRF token. No path reconciliation needed. FAST.

### Phase 0+1 — Everything fires at once (0:00)
Your FIRST response sends ALL of these simultaneously:
- `bash`: `mkdir -p ~/Scripts/mcp-servers/{name}-mcp/src && security find-generic-password -l "{email-label}" -w > /dev/null`
- `create`: `package.json` — deps: `@modelcontextprotocol/sdk`, `playwright`, `node-fetch`; devDeps: `typescript`, `@types/node`
- `create`: `tsconfig.json` — `strict: false, outDir: "dist", esModuleInterop: true, skipLibCheck: true`
- `bash`: `cd ~/Scripts/mcp-servers/{name}-mcp && npm install --quiet`
- `task` (general-purpose, background): **Auth agent** → writes `src/auth.ts` (Direct pipeline)
- `task` (general-purpose, background): **Tools agent** → writes `src/index.ts`
- `task` (general-purpose, background): Register agent → adds to `~/.claude/user-mcps.json`

**ONE batch. Never split across rounds.**

### Auth Agent — Direct Pipeline
Writes `src/auth.ts`.

**Exports**: `getAuthHeaders(): Promise<Record<string, string>>`

Architecture:
1. Disk cache at `{projectDir}/.cookie-cache.json`, 8hr TTL
2. Credentials from macOS Keychain: `security find-generic-password -l "{label}" -w` (always `-l` for label)
3. Headless Playwright Firefox: `headless: true`, `ignoreHTTPSErrors: true`, pref `security.default_personal_cert: Select Automatically`
4. Screenshot on failure to `{projectDir}/auth-failure.png`

**Login flow — USE THIS EXACT CODE (copy-paste, do NOT improvise):**

⚠️ **CRITICAL PLAYWRIGHT RULES** — violating ANY of these will break auth:
1. **NEVER pass an ElementHandle to `page.evaluate()`** — Playwright cannot serialize handles across contexts
2. **NEVER build CSS selectors from element IDs** — React IDs like `:r0:` contain colons that break `querySelector()`
3. **ALWAYS pass the ORIGINAL selector string** that matched, and re-query inside `page.evaluate()`

```typescript
const EMAIL_SELECTORS = [
  'input[name="loginfmt"]', 'input[type="email"]', 'input[name="email"]',
  'input[name="username"]', 'input[name="user"]', 'input[name="login"]',
  'input#username', 'input#email',
];
const PW_SELECTORS = ['input[name="passwd"]', 'input[type="password"]', 'input[name="password"]'];
const CONSENT_SELECTORS = [
  '#idSIButton9', '#idBtn_Back', '#acceptButton',
  'button:has-text("Yes")', 'button:has-text("Accept")', 'button:has-text("Continue")',
  'button:has-text("Stay signed in")', 'button:has-text("Approve")',
];

// ⚠️ NEVER use 'networkidle' — SPA apps (Dynatrace, Datadog) never stop loading
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

for (let i = 0; i < 20; i++) {
  const onTarget = page.url().includes(TARGET_HOST);
  const hasLogin = await page.$$('input[type="email"]:visible, input[type="password"]:visible, input[name="loginfmt"]:visible, input[name="passwd"]:visible');
  if (onTarget && hasLogin.length === 0) break;

  // Email
  let filledEmail = false;
  for (const sel of EMAIL_SELECTORS) {
    const el = await page.$(sel).catch(() => null);
    if (!el) continue;
    const visible = await el.isVisible().catch(() => false);
    const val = await el.inputValue().catch(() => '');
    if (visible && !val) {
      // ✅ CORRECT: pass selector STRING, re-query inside evaluate
      await page.evaluate(({ s, v }: { s: string; v: string }) => {
        const input = document.querySelector(s) as HTMLInputElement;
        if (input) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); }
      }, { s: sel, v: email });
      const btn = await page.$('input[type="submit"]:visible, button[type="submit"]:visible, #idSIButton9:visible');
      if (btn) await btn.click().catch(() => {});
      await page.waitForNavigation({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);
      filledEmail = true;
      break;
    }
  }
  if (filledEmail) continue;

  // Password — SAME pattern: pass sel string, not element handle
  let filledPw = false;
  for (const sel of PW_SELECTORS) {
    const el = await page.$(sel).catch(() => null);
    if (!el) continue;
    const visible = await el.isVisible().catch(() => false);
    const val = await el.inputValue().catch(() => '');
    if (visible && !val) {
      await page.evaluate(({ s, v }: { s: string; v: string }) => {
        const input = document.querySelector(s) as HTMLInputElement;
        if (input) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); }
      }, { s: sel, v: password });
      const btn = await page.$('input[type="submit"]:visible, button[type="submit"]:visible, #idSIButton9:visible');
      if (btn) await btn.click().catch(() => {});
      await page.waitForNavigation({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);
      filledPw = true;
      break;
    }
  }
  if (filledPw) continue;

  // Consent / MFA buttons
  let clickedConsent = false;
  for (const sel of CONSENT_SELECTORS) {
    const btn = await page.$(sel).catch(() => null);
    if (btn && await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(3000);
      clickedConsent = true;
      break;
    }
  }
  if (!clickedConsent) await page.waitForTimeout(5000);
}
```

**Post-login:** Navigate to targetUrl again: `waitUntil: 'domcontentloaded'` (NEVER `networkidle`). Wait 5s for JS.

**Collect auth artifacts:**
```typescript
const allCookies = await context.cookies();
const cookieHeader = allCookies.map(c => `${c.name}=${c.value}`).join('; ');

// Page-embedded tokens (g_ck, csrf, etc.) — this evaluate has NO element handles, just globals
const tokens: Record<string, string> = await page.evaluate(() => {
  const t: Record<string, string> = {};
  for (const key of Object.keys(window)) {
    const val = (window as any)[key];
    if (typeof val === 'string' && val.length > 10 && val.length < 500 &&
        (key.toLowerCase().includes('token') || key.toLowerCase().includes('csrf') ||
         key === 'g_ck' || key === '_csrf'))
      t[key] = val;
  }
  return t;
});

const csrfHeaders: Record<string, string> = {};
if (tokens.g_ck) csrfHeaders['X-UserToken'] = tokens.g_ck;
// ... other CSRF tokens

// Final headers = cookies + CSRF. NO bearer needed for Direct pipeline.
const finalHeaders = { Cookie: cookieHeader, ...csrfHeaders, Accept: 'application/json' };
```

Cache and return `finalHeaders` from `getAuthHeaders()`. That's it. Simple.

### Tools Agent — Direct Pipeline
- Web searches for `"{platform}" REST API documentation`
- Builds tools using PUBLISHED API paths as `BASE_URL` (they work directly)
- Imports `getAuthHeaders` from `./auth.js`, spreads headers into every fetch
- SDK imports: `Server` from `@modelcontextprotocol/sdk/server/index.js`, `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`, `CallToolRequestSchema` + `ListToolsRequestSchema` from `@modelcontextprotocol/sdk/types.js`
- Types: `Record<string, string>` for headers, `any` for API responses. Zero custom interfaces.
- **CRITICAL: MCP server MUST start instantly.** `getAuthHeaders()` is called LAZILY inside each tool handler, NOT at top level. The server registers tools and connects to stdio BEFORE any auth happens. This prevents startup timeout when Copilot CLI initializes the MCP.

### Phase 2 — Compile + Smoke Test (Direct)
1. `npx tsc` — ONE build. Fix once if needed.
2. Smoke test: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js`
3. If tools returned → pick one and test with a real API call.
4. If auth fails → check screenshot, fix auth, retry ONCE.
5. **VERIFY REGISTRATION**: Read `~/.claude/user-mcps.json`, confirm `{name}` key exists under `mcpServers` with correct `command` and `args` pointing to `dist/index.js`. If missing or wrong, fix it NOW.

**No path reconciliation needed** — published paths = real paths.

---

## PIPELINE B: PROXIED API (Dynatrace, Datadog, etc.)

Published API paths DON'T work directly — the browser proxies them through different paths. Auth = cookies + XSRF header + Origin/Referer. Bearer tokens from SSO often POISON requests. Path discovery is CRITICAL.

### Phase 0+1 — Everything fires at once (0:00)
Same scaffold as Direct, but auth agent gets different instructions:
- `bash`: `mkdir -p ~/Scripts/mcp-servers/{name}-mcp/src && security find-generic-password -l "{email-label}" -w > /dev/null`
- `create`: `package.json` — deps: `@modelcontextprotocol/sdk`, `playwright`, `node-fetch`; devDeps: `typescript`, `@types/node`
- `create`: `tsconfig.json` — `strict: false, outDir: "dist", esModuleInterop: true, skipLibCheck: true`
- `bash`: `cd ~/Scripts/mcp-servers/{name}-mcp && npm install --quiet`
- `task` (general-purpose, background): **Auth+Discovery agent** → writes `src/auth.ts` AND `src/api-config.json` (Proxied pipeline)
- `task` (general-purpose, background): **Tools agent** → writes `src/index.ts` (uses published API docs — will be reconciled in Phase 2)
- `task` (general-purpose, background): Register agent → adds to `~/.claude/user-mcps.json`

**ONE batch. Never split across rounds.**

### Auth+Discovery Agent — Proxied Pipeline
Writes TWO files: `src/auth.ts` + `src/api-config.json`

**Exports**: `getAuthHeaders(): Promise<Record<string, string>>`

Architecture: Same cache + keychain + Playwright as Direct.

#### Step 1: Network Interception (BEFORE navigating)
Set up listeners to capture bearer tokens, API paths, AND their response status codes:
```
capturedBearer = null
apiPaths = new Map()  // path → HTTP status code

page.on('request', req => {
  const url = req.url()
  const auth = req.headers()['authorization'] || ''
  if (auth.startsWith('Bearer ') && auth.length > 20)
    capturedBearer = auth

  if (url.includes(targetHost) && (req.resourceType() === 'fetch' || req.resourceType() === 'xhr')) {
    const path = new URL(url).pathname
    if (path.includes('/api/') || path.includes('/rest/') || path.includes('/v1/') || path.includes('/v2/') || path.includes('/platform/'))
      apiPaths.set(path, 0)
  }
})

page.on('response', async resp => {
  const url = resp.url()
  if (url.includes(targetHost)) {
    const path = new URL(url).pathname
    if (apiPaths.has(path)) apiPaths.set(path, resp.status())
  }
  if (url.includes('/token') || url.includes('/oauth')) {
    try { const b = await resp.json(); if (b.access_token) capturedBearer = 'Bearer ' + b.access_token } catch {}
  }
})
```

#### Step 2: SSO Login
**Use the EXACT same login code from the Direct Pipeline above.** Copy it verbatim — same selectors, same `page.evaluate({ s, v })` pattern, same consent buttons. The only difference is that network interception from Step 1 will be capturing API paths in the background.

⚠️ **Reminder**: NEVER pass ElementHandles to `page.evaluate()`. NEVER build selectors from element IDs. Use the ORIGINAL selector string.

#### Step 3: Post-Login Session Initialization
```
// ⚠️ NEVER use 'networkidle' — SPA apps never stop loading
await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(5000)  // 5s — let SPA hydrate and fire API requests for interception
```

#### Step 4: Collect Auth Artifacts + XSRF
```typescript
const allCookies = await context.cookies();
const cookieHeader = allCookies.map(c => `${c.name}=${c.value}`).join('; ');

// XSRF from cookies (critical for POST on proxied platforms)
const xsrfCookie = allCookies.find(c => c.name.includes('XSRF') || c.name.includes('csrf'));
const xsrfToken = xsrfCookie?.value || null;

// Page-embedded tokens — NO element handles, just window globals
const tokens: Record<string, string> = await page.evaluate(() => {
  const t: Record<string, string> = {};
  for (const key of Object.keys(window)) {
    const val = (window as any)[key];
    if (typeof val === 'string' && val.length > 10 && val.length < 500 &&
        (key.toLowerCase().includes('token') || key.toLowerCase().includes('csrf') ||
         key === 'g_ck' || key === '_csrf'))
      t[key] = val;
  }
  return t;
});

const csrfHeaders: Record<string, string> = {};
if (tokens.g_ck) csrfHeaders['X-UserToken'] = tokens.g_ck;
if (xsrfToken) csrfHeaders['X-XSRF-TOKEN'] = xsrfToken;

const origin = new URL(TARGET_URL).origin;
const originHeaders = { 'Origin': origin, 'Referer': TARGET_URL };
```

#### Step 5: Auth Strategy Testing (Proxied ONLY)
Bearer tokens from SSO often POISON requests on proxied platforms. Test what works:
```
// Pick test URL: ONLY use paths that returned 2xx/3xx from real browser traffic
successPaths = [...apiPaths.entries()].filter(([p, s]) => s >= 200 && s < 400)
testUrl = successPaths.length > 0
  ? targetUrl.origin + successPaths[0][0]
  : targetUrl

// Strategy 1: Cookies + CSRF + Origin/Referer (NO bearer) — try this FIRST
cookieHeaders = { Cookie: cookieHeader, ...csrfHeaders, ...originHeaders, Accept: 'application/json' }
resp1 = fetch(testUrl, { headers: cookieHeaders })

if (resp1.status < 400 || resp1.status === 404) {
  finalHeaders = cookieHeaders
  authStrategy = 'cookie' + (Object.keys(csrfHeaders).length ? '+csrf' : '-only')
}
else if (capturedBearer) {
  // Strategy 2: Cookie + Bearer
  withBearer = { ...cookieHeaders, Authorization: capturedBearer }
  resp2 = fetch(testUrl, { headers: withBearer })
  if (resp2.status < 400 || resp2.status === 404) {
    finalHeaders = withBearer; authStrategy = 'cookie+bearer'
  } else {
    // Strategy 3: Bearer only
    bearerOnly = { Authorization: capturedBearer, Accept: 'application/json' }
    resp3 = fetch(testUrl, { headers: bearerOnly })
    if (resp3.status < 400 || resp3.status === 404) {
      finalHeaders = bearerOnly; authStrategy = 'bearer-only'
    } else {
      finalHeaders = cookieHeaders; authStrategy = 'cookie-only-unverified'
    }
  }
} else {
  finalHeaders = cookieHeaders; authStrategy = 'cookie-only'
}
```

#### Step 6: Write api-config.json
```json
{
  "discoveredApiPaths": ["/platform/classic/environment-api/v2/settings"],
  "apiPathStatusCodes": {"/platform/classic/environment-api/v2/settings": 200},
  "authStrategy": "cookie+csrf",
  "hasBearer": false,
  "hasXsrf": true,
  "targetUrl": "https://..."
}
```

### Tools Agent — Proxied Pipeline
Same as Direct — uses published API docs for `BASE_URL`. Phase 2 reconciles.
**CRITICAL: Same lazy-auth rule.** MCP server starts instantly. `getAuthHeaders()` called inside each tool handler, NOT at top level.

### Phase 2 — Path Reconciliation + Compile + Test (Proxied)
**This is the critical step that makes proxied platforms work.**

1. Wait for both agents to complete.
2. Copy `src/api-config.json` to `dist/`.
3. **MANDATORY PATH FIX**: Read `api-config.json`. Compare `discoveredApiPaths` against `BASE_URL` in `src/index.ts`:
   - Find a discovered path containing the API version the tools agent used (e.g., path has `/v2/` and BASE_URL has `/api/v2`)
   - If the discovered path is LONGER/DIFFERENT (e.g., `/platform/classic/environment-api/v2` vs `/api/v2`), **update `BASE_URL` NOW**
   - Example: `const BASE_URL = "https://host/api/v2"` → `const BASE_URL = "https://host/platform/classic/environment-api/v2"`
4. `npx tsc` — compile.
5. Smoke test: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js`
6. Test one real API call. If 401/403 → check `authStrategy` in api-config.json. If `cookie-only-unverified` → auth couldn't verify, debug manually.
7. If CSRF 403 on POST → ensure `X-XSRF-TOKEN`, `Origin`, and `Referer` are in the headers.
8. **VERIFY REGISTRATION**: Read `~/.claude/user-mcps.json`, confirm `{name}` key exists under `mcpServers` with correct `command` and `args` pointing to `dist/index.js`. If missing or wrong, fix it NOW.

---

## Shared Rules (Both Pipelines)
- Agents ONLY create files. No compiling, no installing, no testing.
- Every agent prompt includes: project path, target URL, file path to create, **and which pipeline (DIRECT or PROXIED)**.
- Headless only — zero visible browser windows
- Never print credentials, tokens, or cookies
- Max 2 fix attempts per error — if same error twice, pivot completely
- After rebuild: kill stale processes → `ps aux | grep "{name}-mcp" | grep -v grep` → kill by PID
- Two source files (+ one config for Proxied): `src/auth.ts`, `src/index.ts`, `src/api-config.json`
- General-purpose agents only, never explore agents
- Skip npm install if `node_modules` exists, skip playwright install if firefox is cached

## ⚠️ MANDATORY Playwright Rules (Include in EVERY auth agent prompt)

These rules exist because **multiple builds have failed** from these exact mistakes. **Copy this section into the auth agent prompt verbatim.**

### 1. NEVER pass ElementHandle to `page.evaluate()`
```typescript
// ❌ BROKEN — ElementHandle cannot be serialized into page context
await page.evaluate((el, val) => { el.value = val; }, elementHandle, 'text');

// ❌ BROKEN — same problem, different syntax
await page.evaluate(([el, v]) => { el.value = v; }, [elementHandle, 'text']);

// ✅ CORRECT — pass the selector STRING, re-query inside evaluate
await page.evaluate(({ s, v }: { s: string; v: string }) => {
  const input = document.querySelector(s) as HTMLInputElement;
  if (input) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); }
}, { s: 'input[name="loginfmt"]', v: 'user@example.com' });
```

### 2. NEVER build CSS selectors from element IDs or attributes
React, Angular, and other frameworks generate IDs like `:r0:`, `mat-input-0`, or `__next-id-1` that contain characters invalid in CSS `#id` selectors.
```typescript
// ❌ BROKEN — if element ID is `:r0:`, this becomes `input#:r0:` which is invalid CSS
const sel = `${tag}#${element.id}`;
document.querySelector(sel); // throws SyntaxError

// ✅ CORRECT — always use the ORIGINAL selector that found the element
// Store `sel` from your EMAIL_SELECTORS/PW_SELECTORS arrays and pass that
```

### 3. Read input values with `el.inputValue()`, not evaluate
```typescript
// ❌ FRAGILE
const val = await el.evaluate(e => (e as HTMLInputElement).value);

// ✅ CORRECT
const val = await el.inputValue().catch(() => '');
```

### 4. Visibility checks
```typescript
// ✅ CORRECT
const visible = await el.isVisible().catch(() => false);

// ❌ DON'T use page.evaluate for visibility
```

### 5. Waits
```typescript
// ✅ CORRECT
await page.waitForTimeout(2000);

// ❌ NEVER use setTimeout in Playwright
```

### 6. NEVER use `waitUntil: 'networkidle'`
SPA applications (Dynatrace, Datadog, New Relic, etc.) have persistent WebSocket connections and background polling that NEVER stop. `networkidle` will ALWAYS timeout on these platforms.
```typescript
// ❌ WILL TIMEOUT on any SPA
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

// ✅ CORRECT — use domcontentloaded + explicit wait
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);  // let JS hydrate
```

### 7. MCP Server MUST start instantly
The MCP server must complete the JSON-RPC handshake in <2 seconds. Auth (which takes 10-30s for SSO) must be LAZY — called on first tool invocation, not at startup.
```typescript
// ❌ BROKEN — blocks MCP startup, causes Copilot CLI timeout
const headers = await getAuthHeaders();  // top-level await
const server = new Server(...);

// ✅ CORRECT — server starts immediately, auth is lazy
const server = new Server(...);
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const headers = await getAuthHeaders();  // lazy, cached after first call
  // ... handle tool
});
```
