#!/usr/bin/env bash
# Runs ON the EC2 box, from the repo root, against code already checked out at the commit
# to deploy. Used both by .github/workflows/deploy.yml (over SSH) and for manual redeploys:
#   ssh you@host 'cd /opt/zaraplays && git pull && bash scripts/deploy.sh'
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${DOMAIN:-zaraplays.com}"
COMPOSE="docker compose -f docker-compose.prod.yml"

# First run only: nginx can't start without a certificate, so issue one with certbot's own
# web server on port 80 (nginx stopped briefly). The certbot service renews it afterwards.
mkdir -p certbot/conf certbot/www
if [ ! -f "certbot/conf/live/$DOMAIN/fullchain.pem" ]; then
  $COMPOSE stop nginx || true
  docker run --rm -p 80:80 -v "$PWD/certbot/conf:/etc/letsencrypt" certbot/certbot certonly \
    --standalone --non-interactive --agree-tos --register-unsafely-without-email \
    -d "$DOMAIN" -d "www.$DOMAIN" \
    || { echo "Certificate request failed: check $DOMAIN DNS points here and ports 80/443 are open in the security group." >&2; exit 1; }
fi

$COMPOSE build
$COMPOSE up -d
$COMPOSE exec -T api npx prisma migrate deploy
docker image prune -f
