#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/招聘助手/recruitment_bot/web_admin/docker-compose.prod.yml"
IMAGE_NAME="${IMAGE_NAME:-ghcr.io/m15701162024-afk/hrassistant/recruitment-web-admin}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
RECRUITMENT_PORT="${RECRUITMENT_PORT:-8787}"

export IMAGE_NAME IMAGE_TAG RECRUITMENT_PORT

echo "Deploying recruitment assistant image: ${IMAGE_NAME}:${IMAGE_TAG}"
docker compose -f "$COMPOSE_FILE" pull
docker compose -f "$COMPOSE_FILE" up -d

echo "Waiting for service health..."
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${RECRUITMENT_PORT}/api/health" >/dev/null; then
    echo "Deployment healthy."
    docker compose -f "$COMPOSE_FILE" ps
    exit 0
  fi
  echo "Health check attempt ${attempt}/30 failed; retrying..."
  sleep 5
done

echo "Deployment health check failed."
docker compose -f "$COMPOSE_FILE" logs --tail=120 recruitment-web-admin
exit 1
