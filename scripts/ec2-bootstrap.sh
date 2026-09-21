#!/usr/bin/env bash
# One-time setup for a fresh EC2 instance (Ubuntu or Amazon Linux 2023). Run once, by hand
# or over SSH; after this, deploys happen via `git push` (see .github/workflows/deploy.yml)
# or by re-running scripts/deploy.sh on the box.
set -euo pipefail

REPO_URL="https://github.com/vikasdevapp/zaraplay.git"
APP_DIR="/opt/zaraplays"

echo "==> Installing Docker + Compose plugin"
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg git
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y docker git
  sudo systemctl enable --now docker
  DOCKER_CONFIG=${DOCKER_CONFIG:-$HOME/.docker}
  mkdir -p "$DOCKER_CONFIG/cli-plugins"
  curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
    -o "$DOCKER_CONFIG/cli-plugins/docker-compose"
  chmod +x "$DOCKER_CONFIG/cli-plugins/docker-compose"
else
  echo "Unrecognized distro — install Docker + the Compose plugin manually, then re-run from here." >&2
  exit 1
fi

sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker

echo "==> Cloning the repo to $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER":"$USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> Next steps (manual):"
echo "  1. cp $APP_DIR/server/.env.production.example $APP_DIR/server/.env"
echo "     then edit it: set POSTGRES_PASSWORD and JWT_SECRET to real random values"
echo "     (openssl rand -hex 32), and CORS_ORIGIN to this box's URL(s)."
echo "  2. cd $APP_DIR && newgrp docker   # picks up the docker group without re-login"
echo "  3. docker compose -f docker-compose.prod.yml build"
echo "  4. docker compose -f docker-compose.prod.yml up -d"
echo "  5. docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy"
echo "  6. docker compose -f docker-compose.prod.yml exec api node dist/seed.js"
echo "     (the production image only ships compiled dist/, not src/, so this runs the"
echo "     compiled seed script directly instead of 'npm run seed' which needs tsx+src/)"
