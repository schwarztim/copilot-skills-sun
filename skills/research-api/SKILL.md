---
name: research-api
description: Research and discover all APIs for a tool WITHOUT generating code. Use for exploration and planning before committing to full MCP generation.
---

# Research API Skill

Research and catalog all APIs for a tool before building an MCP.

## When to Use

- "What APIs does {tool} have?"
- "Research {tool} before we build an MCP"
- "Find all the endpoints for {tool}"
- "Is there already an MCP for {tool}?"

## How to Research

Use the thesun-api-researcher agent (available via `/agent`) or manually:

1. Search for official API documentation
2. Find OpenAPI/Swagger specifications  
3. Check authentication requirements
4. Catalog all endpoints with parameters
5. Find existing MCP implementations
6. Identify gaps in existing implementations

## Output

Produces a discovery-report.md containing:
- Total endpoint count
- Authentication methods
- Rate limits
- Complete endpoint reference
- Existing MCP analysis
- Gap identification
- Implementation recommendations

## Use Cases

- **Planning**: Research first, then decide if MCP generation is needed
- **Gap Analysis**: Find what's missing in existing implementations
- **Documentation**: Create API reference documentation
- **Comparison**: Compare multiple tools' APIs before choosing
