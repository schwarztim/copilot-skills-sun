# Copilot CLI Skills: sun-auth & sun-demo

Two GitHub Copilot CLI skills for autonomous MCP server generation via browser-based authentication capture and reverse-engineering.

## Skills

### sun-auth
**Capture authentication from any webapp using browser automation.**

Opens a browser (Playwright Firefox), you log in (handle CAPTCHA, 2FA, SSO), and tokens are automatically captured and saved. Use when setting up credentials for MCP servers.

Usage: `capture auth for {service} at {login-url}`

### sun-demo
**Reverse-engineer any web platform into a working MCP server in under 3 minutes.**

Fully autonomous — classifies the target platform (DIRECT vs PROXIED API), logs in via SSO, captures real API traffic, and generates a complete MCP server with auth and tool handlers. No API keys needed.

## Installation

Copy the skill folders into your Copilot CLI skills directory:

```bash
cp -r sun-auth ~/.copilot/skills/
cp -r sun-demo ~/.copilot/skills/
```

## How It Works

1. **sun-auth** captures browser-based authentication (cookies, tokens, CSRF) from any web platform
2. **sun-demo** uses that auth pattern to reverse-engineer a platform's API and generate a complete MCP server

Both skills leverage Playwright for headless browser automation and support corporate SSO (Azure AD, Okta, etc.).

## License

MIT
