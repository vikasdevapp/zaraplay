#!/usr/bin/env bash
# Runs ON the EC2 box, from the repo root, against code already checked out at the commit
# to deploy. Used both by .github/workflows/deploy.yml (over SSH) and for manual redeploys:
#   ssh you@host 'cd /opt/zaraplays && git pull && bash scripts/deploy.sh'
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy
docker image prune -f
