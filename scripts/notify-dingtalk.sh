#!/usr/bin/env bash
set -euo pipefail

WEBHOOK="${DINGTALK_WEBHOOK:-}"
SECRET="${DINGTALK_SECRET:-}"
TITLE="${1:-招聘助手部署通知}"
TEXT="${2:-招聘助手流水线状态更新。}"

if [ -z "$WEBHOOK" ]; then
  echo "DINGTALK_WEBHOOK is not configured; skip notification."
  exit 0
fi

URL="$WEBHOOK"
if [ -n "$SECRET" ]; then
  TS="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  SIGN="$(TS="$TS" SECRET="$SECRET" python3 - <<'PY'
import base64
import hashlib
import hmac
import os
import urllib.parse

timestamp = os.environ["TS"]
secret = os.environ["SECRET"]
payload = f"{timestamp}\n{secret}".encode()
digest = hmac.new(secret.encode(), payload, hashlib.sha256).digest()
print(urllib.parse.quote_plus(base64.b64encode(digest).decode()))
PY
)"
  SEP="?"
  if [[ "$URL" == *"?"* ]]; then
    SEP="&"
  fi
  URL="${URL}${SEP}timestamp=${TS}&sign=${SIGN}"
fi

PAYLOAD="$(TITLE="$TITLE" TEXT="$TEXT" python3 - <<'PY'
import json
import os

print(json.dumps({
    "msgtype": "markdown",
    "markdown": {
        "title": os.environ["TITLE"],
        "text": os.environ["TEXT"],
    },
}, ensure_ascii=False))
PY
)"

curl -sS -X POST "$URL" \
  -H 'Content-Type: application/json;charset=utf-8' \
  -d "$PAYLOAD"
