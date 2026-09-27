#!/usr/bin/env bash
# Runs ON the EC2 box, from the repo root, against code already checked out at the commit
# to deploy. Used both by .github/workflows/deploy.yml (over SSH) and for manual redeploys:
#   ssh you@host 'cd /opt/zaraplays && git pull && bash scripts/deploy.sh'
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${DOMAIN:-zaraplays.com}"
# Every host the one certificate must cover (nginx/default.conf serves all of them).
HOSTS=("$DOMAIN" "www.$DOMAIN" "backend.$DOMAIN")
COMPOSE="docker compose -f docker-compose.prod.yml"
CERT="certbot/conf/live/$DOMAIN/fullchain.pem"

HOST_ARGS=()
for h in "${HOSTS[@]}"; do HOST_ARGS+=(-d "$h"); done

mkdir -p certbot/conf certbot/www
if [ ! -f "$CERT" ]; then
  # First run: nginx can't start without a certificate, so issue one with certbot's own web
  # server on port 80 (nginx stopped briefly). The certbot service renews it afterwards.
  $COMPOSE stop nginx || true
  docker run --rm -p 80:80 -v "$PWD/certbot/conf:/etc/letsencrypt" certbot/certbot certonly \
    --standalone --non-interactive --agree-tos --register-unsafely-without-email \
    --cert-name "$DOMAIN" "${HOST_ARGS[@]}" \
    || { echo "Certificate request failed: check DNS for ${HOSTS[*]} points here and ports 80/443 are open in the security group." >&2; exit 1; }
else
  # A host was added since the certificate was issued: expand it in place. nginx keeps
  # running and answers the challenge from certbot/www, so the site stays up.
  missing=()
  for h in "${HOSTS[@]}"; do
    openssl x509 -in "$CERT" -noout -text | grep -q "DNS:$h\b" || missing+=("$h")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "Adding ${missing[*]} to the certificate…"
    $COMPOSE up -d nginx
    docker run --rm -v "$PWD/certbot/conf:/etc/letsencrypt" -v "$PWD/certbot/www:/var/www/certbot" certbot/certbot certonly \
      --webroot -w /var/www/certbot --non-interactive --agree-tos --register-unsafely-without-email \
      --cert-name "$DOMAIN" --expand "${HOST_ARGS[@]}" \
      || { echo "Certificate expansion failed: check DNS for ${missing[*]} points here." >&2; exit 1; }
  fi
fi

$COMPOSE build
$COMPOSE up -d
$COMPOSE exec -T api npx prisma migrate deploy
# nginx/default.conf is mounted, not built in: reload so config and certificate changes apply.
$COMPOSE exec -T nginx nginx -s reload
docker image prune -f
