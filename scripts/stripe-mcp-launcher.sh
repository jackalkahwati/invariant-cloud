#!/usr/bin/env bash
# Loads Invariant .env (and optional ProposalForge .env) then runs the Stripe MCP server.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node \
  --env-file-if-exists="$ROOT/.env" \
  --env-file-if-exists=/Users/jackal-kahwati/ProposalForge/.env \
  /Users/jackal-kahwati/ProposalForge/mcp/stripe-server.mjs
