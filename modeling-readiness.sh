#!/bin/sh

set -eu

url="${MODEL_READINESS_URL:-http://127.0.0.1:${SERVER_PORT:-30251}/ibizplm/serviceapi/psdelogics/fetchdefault}"
auth_url="${MODEL_READINESS_AUTH_URL:-http://ibizlab-uaa-api:32666/v7/login}"
payload='{"page":0,"size":1}'

fail() {
  printf 'PLM readiness: %s\n' "$1" >&2
  exit 1
}

if ! command -v curl >/dev/null 2>&1; then
  fail 'curl is unavailable'
fi

umask 077
response_file=$(mktemp)
trap 'rm -f "$response_file"' 0

token="${MODEL_READINESS_TOKEN:-}"
if [ -z "$token" ] &&
  [ -n "${MODEL_READINESS_LOGINNAME:-}" ] &&
  [ -n "${MODEL_READINESS_PASSWORD:-}" ]; then
  if code=$(curl -q -sS -o "$response_file" -w '%{http_code}' \
    --connect-timeout 2 \
    --max-time 5 \
    -H 'Content-Type: application/json' \
    --data-raw "{\"loginname\":\"${MODEL_READINESS_LOGINNAME}\",\"password\":\"${MODEL_READINESS_PASSWORD}\"}" \
    "$auth_url" 2>/dev/null); then
    case "$code" in
      2??) ;;
      *) fail "authentication returned HTTP ${code:-000}" ;;
    esac
  else
    fail "authentication transport failed (curl exit $?)"
  fi
  token=$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$response_file" |
    head -n 1)
  if [ -z "$token" ]; then
    token=$(sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$response_file" |
      head -n 1)
  fi
  if [ -z "$token" ]; then
    fail 'authentication response has no token'
  fi
fi

if [ -z "$token" ]; then
  fail 'no token or login credentials configured'
fi

if code=$(curl -q -sS -o "$response_file" -w '%{http_code}' \
  --connect-timeout 2 \
  --max-time 8 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $token" \
  --data-raw "$payload" \
  "$url" 2>/dev/null); then
  :
else
  fail "PLM API transport failed (curl exit $?)"
fi

case "$code" in
  2??)
    # Preserve the endpoint's array response contract, allowing whitespace.
    if awk '
      NF {
        if (!seen && $0 !~ /^[[:space:]]*\[/) exit 1
        seen = 1
        last = $0
      }
      END { if (!seen || last !~ /\][[:space:]]*$/) exit 1 }
    ' "$response_file"; then
      exit 0
    fi
    fail 'PLM API returned a non-array or incomplete response'
    ;;
  401|403)
    fail "PLM API rejected authentication/authorization (HTTP $code)"
    ;;
  *)
    fail "PLM API returned HTTP ${code:-000}"
    ;;
esac
