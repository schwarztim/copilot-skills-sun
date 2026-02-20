#!/usr/bin/env bash
# reauth.sh — Re-authenticate an MCP server via host-side browser SSO.
#
# Runs on macOS host, captures fresh cookies/tokens via Playwright,
# and optionally restarts the MCP container with fresh creds.
#
# Usage:
#   ./reauth.sh <service-name> [--restart]
#
# Examples:
#   ./reauth.sh servicenow              # capture only
#   ./reauth.sh dynatrace --restart     # capture + restart container
#
# Prerequisites:
#   - Node.js 18+
#   - Playwright: npx playwright install firefox

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SERVICE="${1:?Usage: reauth.sh <service-name> [--restart]}"
RESTART="${2:-}"

CREDS_DIR="$HOME/.${SERVICE}-mcp"
CREDS_FILE="$CREDS_DIR/cookies.json"

echo "🔄 Re-authenticating ${SERVICE}..."
node "$SCRIPT_DIR/host-auth.mjs" --headless

if [ ! -f "$CREDS_FILE" ]; then
  echo "❌ Auth capture failed — no cookies at $CREDS_FILE"
  exit 1
fi

echo "✅ Fresh credentials at $CREDS_FILE"

if [ "$RESTART" = "--restart" ]; then
  echo "🔄 Restarting ${SERVICE} container..."
  if command -v thv &>/dev/null; then
    thv stop "$SERVICE" 2>/dev/null || true
    thv start "$SERVICE"
  elif command -v docker &>/dev/null; then
    docker restart "${SERVICE}-mcp" 2>/dev/null || true
  fi
  echo "✅ Container restarted"
fi

echo ""
echo "📋 Next: mcpu-mux reconnect $SERVICE"
