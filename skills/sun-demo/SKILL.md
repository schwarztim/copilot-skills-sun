---
name: sun-demo
description: Reverse-engineer any web platform into a working MCP server in under 3 minutes. Fully autonomous.
---

# sun-demo — Reverse-engineer anything into an MCP

Turn ANY web platform into a working MCP server. Log in via browser, crawl the site with Playwright, intercept every API call, build an endpoint map, and generate MCP tools from observed traffic. Works with any auth method — API keys, OAuth, SSO, or nothing at all.

## The Approach

thesun uses **Playwright as an API observatory**. Instead of reading docs (which may be wrong, incomplete, or nonexistent), we:

1. **Authenticate** — SSO, OAuth, API key, or manual login — whatever the platform needs
2. **Crawl** — Navigate the site like a real user. Click through pages, open modals, trigger actions.
3. **Intercept** — `page.on('request')` and `page.on('response')` capture every XHR/fetch call with full request/response bodies.
4. **Map** — Build a structured endpoint catalog: method, path, query params, request body schema, response shape, status codes.
5. **Generate** — Turn each discovered endpoint into an MCP tool with typed parameters the AI can call.

This is **Optic-style API discovery** — we learn what the API *actually does* by watching real traffic, not by reading what someone says it does.

## What this does

Input: a name, a URL, and optional auth hints.
Output: a registered MCP server at `~/Scripts/mcp-servers/{name}-mcp/` with tools for every discovered API endpoint.

---

## STEP 0 — Classifier (10 seconds, MANDATORY)

Launch a Haiku `task` agent (blocking, NOT background):

**Classifier prompt:**
> Given target URL `{targetUrl}` and platform name `{name}`:
> 1. Web search `"{name}" REST API documentation authentication`
> 2. Determine the platform type:
>    - `DIRECT` — Published REST API, paths work as-is (ServiceNow, Jira, GitHub, Confluence)
>    - `PROXIED` — Browser proxies API through different paths than docs (Dynatrace, Datadog, Splunk)
>    - `UNDOCUMENTED` — No public API docs. Must reverse-engineer entirely from browser traffic.
>
> Respond with EXACTLY one word: `DIRECT` | `PROXIED` | `UNDOCUMENTED`

---

## THE CRAWL+INTERCEPT ENGINE

This is the core of sun-demo. **All pipelines use this.** Playwright logs in, then crawls the site while intercepting every API call the browser makes.

### Setting Up the Interceptor

Before ANY navigation, register request/response listeners:

```typescript
interface CapturedEndpoint {
  method: string;
  path: string;
  queryParams: string[];
  requestBody?: object;
  requestHeaders: Record<string, string>;
  responseStatus: number;
  responseBody?: any;
  responseHeaders: Record<string, string>;
  contentType: string;
  timestamp: number;
}

const captured: Map<string, CapturedEndpoint[]> = new Map(); // keyed by "METHOD /path"

page.on('request', req => {
  const url = req.url();
  if (!url.includes(TARGET_HOST)) return;
  if (!['fetch', 'xhr'].includes(req.resourceType())) return;

  const u = new URL(url);
  const path = u.pathname;
  const method = req.method();
  const key = `${method} ${path}`;

  // Skip static assets, analytics, telemetry
  if (path.match(/\.(js|css|png|jpg|svg|woff|ico)$/)) return;
  if (path.includes('/analytics') || path.includes('/telemetry')) return;

  const entry: Partial<CapturedEndpoint> = {
    method,
    path,
    queryParams: [...u.searchParams.keys()],
    requestHeaders: req.headers(),
    timestamp: Date.now(),
  };

  // Capture request body for mutations
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    try { entry.requestBody = JSON.parse(req.postData() || '{}'); } catch {}
  }

  if (!captured.has(key)) captured.set(key, []);
  captured.get(key)!.push(entry as CapturedEndpoint);
});

page.on('response', async resp => {
  const url = resp.url();
  if (!url.includes(TARGET_HOST)) return;

  const u = new URL(url);
  const path = u.pathname;
  const method = resp.request().method();
  const key = `${method} ${path}`;
  const entries = captured.get(key);
  if (!entries?.length) return;

  const entry = entries[entries.length - 1];
  entry.responseStatus = resp.status();
  entry.responseHeaders = resp.headers();
  entry.contentType = resp.headers()['content-type'] || '';

  // Capture JSON response bodies for schema inference
  if (entry.contentType.includes('json')) {
    try { entry.responseBody = await resp.json(); } catch {}
  }
});
```

### Crawling the Site

After login, systematically navigate the platform to trigger API calls:

```typescript
// Phase 1: Let the landing page load — SPAs fire initial data fetches
await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000); // let SPA hydrate + fire background requests

// Phase 2: Click through major navigation items
const navLinks = await page.$$('nav a, [role="navigation"] a, .sidebar a, .menu a');
for (const link of navLinks.slice(0, 15)) { // cap at 15 to avoid infinite crawl
  try {
    const href = await link.getAttribute('href');
    if (!href || href === '#' || href.startsWith('javascript:')) continue;
    await link.click();
    await page.waitForTimeout(3000); // let API calls fire
  } catch { /* navigation may fail, that's fine */ }
}

// Phase 3: If user provided actions, execute them
// e.g., actions: ["list users", "create report"]
// The AI interprets these and clicks the appropriate UI elements

// Phase 4: Try common CRUD patterns — open detail views, trigger searches
const tables = await page.$$('table tbody tr, [role="row"]');
if (tables.length > 0) {
  await tables[0].click(); // open first item detail view
  await page.waitForTimeout(3000);
  await page.goBack();
  await page.waitForTimeout(2000);
}

// Try search if available
const searchInput = await page.$('input[type="search"], input[placeholder*="search" i]');
if (searchInput) {
  await searchInput.fill('test');
  await page.waitForTimeout(3000);
  await searchInput.fill('');
  await page.waitForTimeout(2000);
}
```

### Building the Endpoint Map

After crawling, analyze captured traffic to build a structured API map:

```typescript
interface DiscoveredAPI {
  method: string;
  path: string;
  pathTemplate: string;         // /api/users/{id} (IDs replaced with params)
  queryParams: string[];
  requestBodyShape?: object;    // { "name": "string", "email": "string" }
  responseBodyShape?: object;   // { "id": "string", "results": "array" }
  responseStatus: number;
  isListEndpoint: boolean;      // returns array of items
  isMutation: boolean;          // POST/PUT/PATCH/DELETE
  sampleCount: number;          // how many times this was called
  toolName: string;             // generated: list_users, get_user, create_user
}

function buildEndpointMap(captured: Map<string, CapturedEndpoint[]>): DiscoveredAPI[] {
  const apis: DiscoveredAPI[] = [];

  for (const [key, entries] of captured) {
    // Skip failed requests
    const successEntries = entries.filter(e => e.responseStatus >= 200 && e.responseStatus < 400);
    if (successEntries.length === 0) continue;

    const sample = successEntries[0];

    // Parameterize path: /api/users/abc123 → /api/users/{id}
    const pathTemplate = sample.path.replace(
      /\/[a-f0-9]{8,}|\/[0-9]+(?=\/|$)/gi,
      '/{id}'
    );

    // Infer response shape (keys + types, not values)
    const responseShape = sample.responseBody
      ? inferShape(sample.responseBody)
      : undefined;

    const requestShape = sample.requestBody
      ? inferShape(sample.requestBody)
      : undefined;

    // Deduplicate query params across all samples
    const allParams = [...new Set(entries.flatMap(e => e.queryParams))];

    // Generate tool name from method + path
    const toolName = generateToolName(sample.method, pathTemplate);

    apis.push({
      method: sample.method,
      path: sample.path,
      pathTemplate,
      queryParams: allParams,
      requestBodyShape: requestShape,
      responseBodyShape: responseShape,
      responseStatus: sample.responseStatus,
      isListEndpoint: Array.isArray(sample.responseBody?.results || sample.responseBody),
      isMutation: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(sample.method),
      sampleCount: successEntries.length,
      toolName,
    });
  }

  return apis;
}

// Infer the shape of a JSON object (keys + types, strip values)
function inferShape(obj: any): any {
  if (Array.isArray(obj)) return [obj.length > 0 ? inferShape(obj[0]) : 'unknown'];
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return typeof obj;
  const shape: any = {};
  for (const [k, v] of Object.entries(obj)) shape[k] = inferShape(v);
  return shape;
}

// Generate a descriptive tool name: GET /api/users/{id} → get_user
function generateToolName(method: string, pathTemplate: string): string {
  const segments = pathTemplate.split('/').filter(s => s && !s.startsWith('{') && !s.match(/^(api|v[0-9]|rest|now)$/i));
  const resource = segments[segments.length - 1] || 'resource';
  const prefix = { GET: 'get', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[method] || method.toLowerCase();
  // Singularize for detail endpoints, keep plural for list
  if (pathTemplate.endsWith('/{id}')) return `${prefix}_${resource.replace(/s$/, '')}`;
  if (method === 'GET') return `list_${resource}`;
  return `${prefix}_${resource}`;
}
```

### Writing the Endpoint Map to Disk

Save as `src/api-map.json` for the tools agent to consume:

```typescript
const apiMap = buildEndpointMap(captured);
writeFileSync(
  join(projectDir, 'src/api-map.json'),
  JSON.stringify({ discoveredAt: Date.now(), endpoints: apiMap }, null, 2)
);
```

---

## PIPELINE A: DIRECT API (ServiceNow, Jira, GitHub, etc.)

Published API paths work as-is. Auth = cookies + CSRF token. No path reconciliation needed.

### Phase 0+1 — Everything fires at once (0:00)

Fire ALL of these simultaneously:
- `bash`: `mkdir -p ~/Scripts/mcp-servers/{name}-mcp/src`
- `create`: `package.json` — deps: `@modelcontextprotocol/sdk`, `playwright`, `node-fetch`; devDeps: `typescript`, `@types/node`
- `create`: `tsconfig.json` — `strict: false, outDir: "dist", esModuleInterop: true, skipLibCheck: true`
- `bash`: `cd ~/Scripts/mcp-servers/{name}-mcp && npm install --quiet`
- `task` (general-purpose, background): **Auth+Crawl agent** → writes `src/auth.ts` + `src/api-map.json`
- `task` (general-purpose, background): **Tools agent** → writes `src/index.ts` (reads api-map.json)
- `task` (general-purpose, background): Register agent → adds to `~/.claude/user-mcps.json`

**ONE batch. Never split across rounds.**

### Auth+Crawl Agent — Direct Pipeline

Writes TWO files: `src/auth.ts` + `src/api-map.json`

**Exports**: `getAuthHeaders(): Promise<Record<string, string>>`

Architecture:
1. Disk cache at `{projectDir}/.cookie-cache.json`, 8hr TTL
2. Credentials from macOS Keychain: `security find-generic-password -l "{label}" -w`
3. Headless Playwright Firefox with corp-friendly prefs
4. **Set up interceptor BEFORE navigating** (the crawl+intercept engine above)
5. SSO login using the standard login loop (see below)
6. Post-login: crawl the site to discover API endpoints
7. Also web-search for published API docs to supplement discovered endpoints
8. Write `src/api-map.json` with all discovered endpoints
9. Write `src/auth.ts` with cookie/CSRF-based `getAuthHeaders()`

**SSO Login Flow — USE THIS EXACT CODE (copy-paste, do NOT improvise):**

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

// NEVER use 'networkidle' — SPA apps never stop loading
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

for (let i = 0; i < 20; i++) {
  const onTarget = page.url().includes(TARGET_HOST);
  const hasLogin = await page.$$('input[type="email"]:visible, input[type="password"]:visible, input[name="loginfmt"]:visible, input[name="passwd"]:visible');
  if (onTarget && hasLogin.length === 0) break;

  // Email — pass selector STRING to evaluate, NEVER an ElementHandle
  let filledEmail = false;
  for (const sel of EMAIL_SELECTORS) {
    const el = await page.$(sel).catch(() => null);
    if (!el) continue;
    const visible = await el.isVisible().catch(() => false);
    const val = await el.inputValue().catch(() => '');
    if (visible && !val) {
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

  // Password — SAME pattern
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

**Post-login:** Crawl the site using the crawl+intercept engine (above). Then collect auth artifacts:

```typescript
const allCookies = await context.cookies();
const cookieHeader = allCookies.map(c => `${c.name}=${c.value}`).join('; ');

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

const finalHeaders = { Cookie: cookieHeader, ...csrfHeaders, Accept: 'application/json' };
```

### Tools Agent — Direct Pipeline
- **Reads `src/api-map.json`** to get discovered endpoints
- Also web searches for `"{platform}" REST API documentation` to supplement
- For each endpoint in the map, generates an MCP tool with:
  - Typed input parameters (from queryParams + requestBodyShape)
  - Fetch call using the discovered path
  - Response parsing based on observed responseBodyShape
- Imports `getAuthHeaders` from `./auth.js`, spreads headers into every fetch
- **CRITICAL: MCP server MUST start instantly.** `getAuthHeaders()` is lazy (called inside tool handlers, NOT at top level)

### Phase 2 — Compile + Smoke Test
1. `npx tsc` — ONE build. Fix once if needed.
2. Smoke test: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js`
3. If tools returned → pick one and test with a real API call.
4. **VERIFY REGISTRATION**: Read `~/.claude/user-mcps.json`, confirm entry exists.

---

## PIPELINE B: PROXIED API (Dynatrace, Datadog, etc.)

Published API paths DON'T work directly — the browser proxies them through different paths. The crawl+intercept engine is CRITICAL here because it discovers the REAL paths.

Same as Pipeline A except:
- The Auth+Crawl agent also writes `src/api-config.json` with discovered vs published path mapping
- Auth strategy testing: cookies-only vs cookie+bearer vs bearer-only
- **MANDATORY PATH FIX** in Phase 2: compare `api-map.json` paths against any published BASE_URL and update

---

## PIPELINE C: UNDOCUMENTED (Internal tools, admin panels)

No docs exist. The crawl+intercept engine is the ONLY source of truth.

Same as Pipeline A except:
- **No web search phase** — there are no docs to find
- The crawl phase is MORE aggressive: click more links, try more actions
- Tool names are inferred entirely from URL paths and response shapes
- The AI should describe what each tool does based on the observed response data
- May need user to guide crawling: "click on the Users tab", "open Settings"

---

## Mandatory Playwright Rules

These rules exist because **multiple builds have failed** from these exact mistakes.

### 1. NEVER pass ElementHandle to `page.evaluate()`
```typescript
// BROKEN — ElementHandle cannot be serialized into page context
await page.evaluate((el, val) => { el.value = val; }, elementHandle, 'text');

// CORRECT — pass the selector STRING, re-query inside evaluate
await page.evaluate(({ s, v }: { s: string; v: string }) => {
  const input = document.querySelector(s) as HTMLInputElement;
  if (input) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); }
}, { s: 'input[name="loginfmt"]', v: 'user@example.com' });
```

### 2. NEVER build CSS selectors from element IDs
React generates IDs like `:r0:` that contain colons — invalid in CSS selectors. Always use the ORIGINAL selector from the arrays above.

### 3. NEVER use `waitUntil: 'networkidle'`
SPA apps have persistent WebSocket connections that NEVER stop. Always use `domcontentloaded` + explicit timeout.

### 4. MCP Server MUST start instantly
Auth (10-30s for SSO) must be LAZY — called on first tool invocation, not at startup.

```typescript
// BROKEN — blocks startup, causes timeout
const headers = await getAuthHeaders();
const server = new Server(...);

// CORRECT — server starts immediately, auth is lazy
const server = new Server(...);
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const headers = await getAuthHeaders(); // lazy, cached after first call
  // ... handle tool
});
```

## Shared Rules (All Pipelines)
- Agents ONLY create files. No compiling, no installing, no testing.
- Headless only — zero visible browser windows
- Never print credentials, tokens, or cookies
- Max 2 fix attempts per error
- Two source files minimum: `src/auth.ts`, `src/index.ts`
- `src/api-map.json` is the endpoint catalog generated by the crawl
- General-purpose agents only, never explore agents
- Skip npm install if `node_modules` exists, skip playwright install if firefox is cached
