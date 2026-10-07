#!/usr/bin/env bash
# Runs ON the EC2 box, from the repo root, against code already checked out at the commit
# to deploy. Used both by .github/workflows/deploy.yml (over SSH) and for manual redeploys:
#   ssh you@host 'cd /opt/zaraplays && git pull && bash scripts/deploy.sh'
set -euo pipefail
cd "$(dirname "$0")/.."

# Only one deploy at a time: auto-deploy (GitHub Actions) and a manual run racing each other
# causes container-name conflicts. A second concurrent deploy waits briefly, then bails out.
exec 9>/tmp/zaraplays-deploy.lock
if ! flock -w 300 9; then
  echo "Another deploy is already running — skipping this one." >&2
  exit 0
fi

DOMAIN="${DOMAIN:-zaraplays.com}"
# Every host the one certificate must cover (nginx/default.conf serves all of them).
HOSTS=("$DOMAIN" "www.$DOMAIN" "backend.$DOMAIN")
COMPOSE="docker compose -f docker-compose.prod.yml"
CERT="certbot/conf/live/$DOMAIN/fullchain.pem"

HOST_ARGS=()
for h in "${HOSTS[@]}"; do HOST_ARGS+=(-d "$h"); done

mkdir -p certbot/conf certbot/www

# Is the nginx service already running? If so we must never stop it to request a certificate —
# that takes the whole site down (and the standalone cert step then fails on the busy port 80).
nginx_running() { $COMPOSE ps --status running --services 2>/dev/null | grep -qx nginx; }

if [ ! -f "$CERT" ] && ! nginx_running; then
  # Genuine first run: no certificate and no nginx yet. Issue one with certbot's own web server
  # on port 80 (nothing else is using it yet). The certbot service renews it afterwards.
  docker run --rm -p 80:80 -v "$PWD/certbot/conf:/etc/letsencrypt" certbot/certbot certonly \
    --standalone --non-interactive --agree-tos --register-unsafely-without-email \
    --cert-name "$DOMAIN" "${HOST_ARGS[@]}" \
    || { echo "Certificate request failed: check DNS for ${HOSTS[*]} points here and ports 80/443 are open in the security group." >&2; exit 1; }
elif [ ! -f "$CERT" ]; then
  # Cert file not found but nginx is already serving (cert may live elsewhere, or a transient
  # check). Do NOT stop nginx — keep the site up and let the certbot service renew via webroot.
  echo "No $CERT found, but nginx is already running — skipping standalone issuance to keep the site up." >&2
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
