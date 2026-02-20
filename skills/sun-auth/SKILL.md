---
name: sun-auth
description: Capture authentication from any webapp using browser automation. Opens browser, you log in, tokens saved. Use when setting up credentials for MCP servers.
---

# Sun Auth - One-Shot Authentication Capture

Capture authentication tokens from any webapp in under 60 seconds.

## Usage

Say: "capture auth for {service} at {login-url}"

Examples:
- "capture auth for servicenow at https://qvcprod.service-now.com"
- "capture auth for notion at https://notion.so/login"
- "capture auth for jira at https://mycompany.atlassian.net"

## What Happens

1. **Browser opens** (Playwright Firefox)
2. **You log in** (handle CAPTCHA, 2FA, SSO - whatever)
3. **Say "done"** when logged in
4. **Tokens captured** from localStorage, sessionStorage, cookies, network
5. **Browser closes**
6. **Credentials saved** to `~/.thesun/credentials/<service>.env`

## How to Execute

Use the thesun MCP tool in INTERACTIVE mode:

```
thesun({ target: "{service}", siteUrl: "{login-url}" })
```

Or manually with Playwright:

### Step 1: Open Browser
Launch Playwright Firefox and navigate to the login URL.

### Step 2: User Logs In
Tell user to complete login including any CAPTCHA, 2FA, or SSO.
**WAIT for user to say "done".**

### Step 3: Capture Everything
After login confirmed, extract:
- localStorage (access tokens, session data)
- sessionStorage
- Cookies (session, auth, token cookies)
- Network requests (Authorization headers)

### Step 4: Save Credentials

```bash
mkdir -p ~/.thesun/credentials
```

Write to `~/.thesun/credentials/<service>.env`:
```bash
# Auto-captured by sun-auth on <timestamp>
<SERVICE>_BASE_URL=<base-url>
<SERVICE>_ACCESS_TOKEN=<token>
<SERVICE>_REFRESH_TOKEN=<if-found>
<SERVICE>_SESSION_COOKIE=<session-cookies>
<SERVICE>_AUTH_TYPE=<Bearer|Cookie|ApiKey>
<SERVICE>_CAPTURED_AT=<timestamp>
```

### Step 5: Configure MCP

Add credentials to MCP config in `~/.copilot/mcp-config.json`:

```json
{
  "<service>": {
    "command": "node",
    "args": ["/Users/timothy.schwarz/Scripts/mcp-servers/<service>-mcp/dist/index.js"],
    "env": {
      "<SERVICE>_ACCESS_TOKEN": "<captured-token>"
    }
  }
}
```

## Refresh When Expired

Just run again - takes 30 seconds:
```
capture auth for <service> at <login-url>
```
