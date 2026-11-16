#!/usr/bin/env bash
# One-time setup of the local test stack. Safe to re-run.
# Needs: Node 22.18+, Docker (or your own PostgreSQL 16 + PostGIS 3.4 with the same databases).
set -euo pipefail
cd "$(dirname "$0")/.."

node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<18)) { console.error("Node 22.18 or newer is required, found "+process.versions.node); process.exit(1) }'

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example (test settings: sandbox SMS code, local file storage)."
fi

if command -v docker >/dev/null 2>&1; then
  docker compose up -d --wait db
else
  echo "Docker not found: using the PostgreSQL in DATABASE_URL from .env."
fi

npm ci
# Applies new migrations; loads demo data only into an empty database. Existing test data is kept.
npm run db:init
echo
echo "Setup complete. Start the API with:   npm run dev"
echo "Serve the web app to phones with:     npm run serve:web"
echo "Find the address phones should use:   npm run lan:ip"
