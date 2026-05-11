#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8787}"

echo "Checking ${BASE_URL%/}/api/health"
curl -fsS "${BASE_URL%/}/api/health"
echo
