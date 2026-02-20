---
name: generate-mcp
description: Generate a production-ready MCP server for any tool/API. Use when user wants to interact with an API/tool that has no existing MCP server, or wants to automate a workflow with an external tool.
---

# Generate MCP Skill

This skill generates complete, production-ready MCP servers autonomously using the thesun MCP tool.

## IMPORTANT: Ask User First

When you detect the user wants to interact with a tool/API that has no existing MCP:

**DO NOT** immediately generate. Instead say:

> "There's no MCP server for {tool}. Would you like me to create one using thesun?
> This will autonomously research the API, generate a TypeScript MCP server, run tests,
> and register it globally so you can use it in any future conversation."

Wait for user confirmation before proceeding.

## When to SUGGEST This Skill

Proactively suggest this skill when:
- User mentions a tool/service that has no MCP (check available tools first)
- User asks "can Copilot connect to X?" where X has no MCP
- User wants to automate something with an external API
- User asks about integrating with a service

## Invocation

Use the thesun MCP tool:

```
thesun({ target: "toolname" })
```

Examples:
- `thesun({ target: "tesla" })` — Creates Tesla Fleet API MCP
- `thesun({ target: "stripe" })` — Creates Stripe payments MCP
- `thesun({ target: "toolname", fix: "/path/to/mcp" })` — Fix existing MCP

## What Gets Generated

```
{tool}-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── tools/                # Tool implementations
│   ├── auth/                 # Authentication
│   ├── utils/                # Utilities (retry, logging, etc.)
│   └── types/                # TypeScript types
├── tests/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── AGENTS.md
```

## Configuration Abstraction

All configuration via environment variables. NO hardcoded company URLs, API keys, or secrets.

## Quality Gates

The generated MCP must pass:
- ✅ All tests passing
- ✅ 70%+ code coverage
- ✅ No critical security issues
- ✅ No hardcoded secrets
- ✅ Startup time <1s
- ✅ Complete documentation

## After Generation

The MCP is output to `~/Scripts/mcp-servers/{tool}-mcp/`. To register it with Copilot CLI, add to `~/.copilot/mcp-config.json`:

```json
{
  "{tool}": {
    "command": "node",
    "args": ["/Users/timothy.schwarz/Scripts/mcp-servers/{tool}-mcp/dist/index.js"]
  }
}
```

Then restart Copilot CLI and verify with `/mcp show`.
