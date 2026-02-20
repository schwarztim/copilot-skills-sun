---
name: sso-reauth-fix
description: Diagnose and fix broken SSO/OAuth re-authentication in MCP servers. Use when an MCP is stuck in a reauth loop, has expired tokens, or can't re-authenticate against corporate SSO (Conditional Access, SPA token expiry, stale cookies).
---

# SSO Reauth Fix — MCP Authentication Recovery

Diagnose and fix broken SSO/OAuth re-authentication for any MCP server running in Copilot CLI.

## When to Use

- "The {tool} MCP can't authenticate"
- "The {tool} MCP is stuck in a reauth loop"
- "{tool} MCP tokens expired"
- "{tool} MCP keeps getting 401s"
- "Fix reauth for {tool}"

## Diagnosis Procedure

### Step 1: Identify the MCP and its auth mechanism

```bash
# Check server status
mcpu-mux servers {tool}

# Check container logs for auth errors
thv logs {tool} 2>&1 | grep -E "^\[" | grep -i "auth\|token\|401\|403\|reauth\|expire\|refresh\|loop" | tail -20

# Get container config (env vars, volumes, transport)
thv export {tool} /dev/stdout 2>&1 | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('volumes:', d.get('volumes'))
print('write mounts:', d.get('permission_profile',{}).get('write'))
print('env_vars:', list(d.get('env_vars',{}).keys()))
"
```

### Step 2: Classify the auth type and failure mode

| Auth Type | Indicators | Common Failure |
|-----------|-----------|----------------|
| **SPA OAuth (refresh token)** | `AADSTS700084`, `invalid_grant`, 24h expiry | Hard token lifetime, can't extend |
| **Session cookies** | `401`/`403` loop, "Reloaded credentials" spam | Stale cookies reloaded endlessly |
| **API token** | `401 Unauthorized` | Token revoked or expired |
| **Certificate/mTLS** | `DeviceAuthTls`, Conditional Access | Container lacks device certs |

### Step 3: Identify root cause patterns

**Infinite reauth loop** (most common):
- Auth interceptor catches 401 → calls reauth() → reloads SAME stale creds → returns true → retries → 401 again
- Fix: Add change detection (hash comparison) + cooldown timer + return false if creds unchanged

**SPA refresh token expiry** (Azure AD):
- `AADSTS700084: The refresh token was issued to a single page app (SPA), and therefore has a fixed, limited lifetime of 1.00:00:00`
- Fix: Run host-side auth script (host has device certs for Conditional Access)

**No volume mount** (container can't read fresh creds):
- Host updates creds file but container only has baked-in env var from startup
- Fix: Add `-v` volume mount for credentials directory

## Fix Patterns

### Pattern A: Fix Infinite Reauth Loop

The auth module needs three things:
1. **Change detection** — hash the current creds, only accept "refreshed" creds if hash differs
2. **Cooldown** — minimum 60s between reauth attempts
3. **File-first loading** — prefer volume-mounted file (updatable) over env var (static)

```typescript
// Key fields to add to auth manager class:
private lastReauthAttempt = 0;
private lastCredsHash = "";

// In the response interceptor, add cooldown check:
if (now - this.lastReauthAttempt > 60_000) { ... }

// In reauth(), compare hashes before accepting:
const newHash = this.hashCreds(freshCreds);
if (newHash !== this.lastCredsHash) {
  // Actually fresh — use them
} else {
  // Same creds — return false, don't retry
}
```

### Pattern B: Host-Side Token Refresh (Conditional Access)

When the container can't authenticate because it lacks device certificates:

1. Create a `scripts/refresh-session.mjs` that runs on the macOS host
2. It loads existing cookies/tokens into a headless Playwright browser
3. Navigates to the service (host has device certs → passes Conditional Access)
4. Captures refreshed cookies/tokens and writes to a shared credentials file
5. The container reads the fresh creds via volume mount

```bash
# reauth.sh pattern:
node "$SCRIPT_DIR/scripts/refresh-session.mjs"
CREDS_B64=$(base64 -i "$CREDS_FILE" | tr -d '\n')
thv stop {tool} && thv rm {tool}
thv run {image} --name {tool} \
  -v "$CREDS_DIR:/root/.thesun/credentials" \
  --env "CREDS_B64=$CREDS_B64" \
  --env "CREDS_FILE=/root/.thesun/credentials/{tool}.capture.json"
```

### Pattern C: SPA OAuth Token Refresh (Azure AD)

For MS365-style MCP servers with SPA tokens (24h hard limit):

1. Use `host-auth.mjs` script that runs on host with device certs
2. Captures Graph/Outlook/Teams tokens via browser SSO
3. Saves to `~/.ms365-mcp/tokens.json` (volume-mounted into container)
4. Container reads fresh tokens on next request

```bash
# Run on host:
MS365_CREDENTIALS='...' TOTP_SECRET='...' node scripts/host-auth.mjs --headless
# Restart container to pick up tokens:
thv stop ms365 && thv start ms365
```

## Post-Fix Verification

```bash
# Rebuild and redeploy
cd ~/Scripts/mcp-servers/{tool}-mcp
npm run build
docker build -t localhost:5555/{tool}-mcp:latest .
docker push localhost:5555/{tool}-mcp:latest

# Restart with volume mount
thv stop {tool} && thv rm {tool}
# (use reauth.sh or manual thv run with -v flag)

# Verify
mcpu-mux reconnect {tool}
mcpu-mux call {tool} {any_read_tool}

# Confirm no reauth spam
thv logs {tool} 2>&1 | grep -E "^\[" | tail -10
```

## Known MCP Auth Configurations

| MCP | Auth Type | Creds Location | Host Script |
|-----|-----------|---------------|-------------|
| ms365 | SPA OAuth + browser session | `~/.ms365-mcp/tokens.json` | `scripts/host-auth.mjs` |
| dynatrace | Session cookies | `~/.thesun/credentials/dynatrace.capture.json` | `scripts/refresh-session.mjs` |
| crowdstrike | Browser proxy (SSO+CSRF) | Proxy on `localhost:3456` | `scripts/session-keepalive.mjs` |
| servicenow | Basic auth (thv secrets) | thv secret store | N/A (doesn't expire) |
| akamai | EdgeGrid credentials | env var | N/A |

### Pattern D: Browser Proxy (Short-Lived Session Cookies)

When session cookies expire within minutes (e.g., CrowdStrike Falcon's 5-min `id` cookie):

1. **Cannot export cookies** — they expire before the container can use them
2. **Create `scripts/session-keepalive.mjs`** — a persistent Playwright browser that:
   - Authenticates via SSO on startup
   - Runs an HTTP proxy server on a local port (e.g., 3456)
   - Proxies API calls through `page.evaluate(fetch(...))` in the browser
   - The browser manages cookie lifecycle automatically
   - Runs keepalive every 2 min to maintain session
3. **MCP container uses `CROWDSTRIKE_PROXY_URL=http://host.containers.internal:3456`** env var
4. The `CrowdStrikeProxyClient` in the MCP sends requests to the proxy instead of directly to the API

**CRITICAL: Do NOT use `nohup` with Playwright** — it kills the browser subprocess. Use `node ... &; disown` instead.

**CRITICAL: CrowdStrike Falcon's `/api2/auth/csrf` endpoint INVALIDATES the session.** Capture CSRF from the SPA's own API requests via request interception, never call the CSRF endpoint directly.

**CRITICAL: Use Firefox for CrowdStrike SSO** — it has `security.default_personal_cert: "Select Automatically"` for device cert selection during Conditional Access. Chromium doesn't handle CrowdStrike's login form correctly in headless mode.

## Key Principles

1. **Never reload the same stale creds and call it success** — always hash-compare
2. **Prefer file-based creds over env vars** — files can be updated at runtime via volume mounts
3. **Host runs the browser, container reads the result** — Conditional Access requires device certs
4. **Cooldown prevents loops** — minimum 60s between reauth attempts
5. **Fail loudly** — if reauth can't get fresh creds, return false and log what to do
6. **For sub-5-min cookie lifetimes, use a browser proxy** — exporting cookies won't work
