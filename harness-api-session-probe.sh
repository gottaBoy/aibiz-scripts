#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TIMESTAMP=$(date "+%Y%m%d-%H%M%S")
REPORT_DIR=${AIBIZ_REPORT_DIR:-"$ROOT_DIR/.artifacts/harness-api-session-probe/$TIMESTAMP"}
SUMMARY_FILE="$REPORT_DIR/summary.txt"
RESULTS_FILE="$REPORT_DIR/results.jsonl"

BASE_URL=${AIBIZ_BASE_URL:-"http://127.0.0.1:32003/api/ibizplm__plmweb"}
BASE_URL=${BASE_URL%/}
AIBIZ_LOGINNAME=${AIBIZ_LOGINNAME:-aibizhi}
AIBIZ_PASSWORD=${AIBIZ_PASSWORD:-123456}
AIBIZ_USER_ID=${AIBIZ_USER_ID:-"$AIBIZ_LOGINNAME"}
AIBIZ_REQUEST_TIMEOUT=${AIBIZ_REQUEST_TIMEOUT:-30}
AIBIZ_SYSTEM_ID=${AIBIZ_SYSTEM_ID:-ibizplm}
AIBIZ_ORG_ID=${AIBIZ_ORG_ID:-000000}
AIBIZ_PROBE_CONFIRM=${AIBIZ_PROBE_CONFIRM:-}

AUTH_HEADER=
CONTEXT_ID=
SESSION_ID=
CONTEXT_CREATED=0
SESSION_CREATED=0
CLEANUP_DONE=0
FAILED=0
TEMP_FILE=
TEMP_FILES=()

mkdir -p "$REPORT_DIR"
: >"$SUMMARY_FILE"
: >"$RESULTS_FILE"

record() {
  printf '%s\n' "$*" | tee -a "$SUMMARY_FILE"
}

id_summary() {
  local value=$1
  local digest

  if [ -z "$value" ]; then
    printf 'none'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    digest=$(printf '%s' "$value" | shasum -a 256 | awk '{print substr($1,1,10)}')
  elif command -v sha256sum >/dev/null 2>&1; then
    digest=$(printf '%s' "$value" | sha256sum | awk '{print substr($1,1,10)}')
  else
    digest=$(printf '%s' "$value" | cksum | awk '{print $1}')
  fi
  printf 'sha=%s' "$digest"
}

new_id() {
  local value

  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
    return
  fi

  if command -v openssl >/dev/null 2>&1; then
    value=$(openssl rand -hex 16 2>/dev/null || true)
    if [ -n "$value" ]; then
      printf '%s-%s-%s-%s-%s\n' \
        "${value:0:8}" "${value:8:4}" "${value:12:4}" \
        "${value:16:4}" "${value:20:12}"
      return
    fi
  fi

  printf '%s-%s-%s\n' "$(date '+%s')" "$$" "$RANDOM"
}

make_temp() {
  TEMP_FILE=$(mktemp "${TMPDIR:-/tmp}/aibiz-harness-session-probe.XXXXXX")
  TEMP_FILES+=("$TEMP_FILE")
}

cleanup_temp_files() {
  local file
  for file in "${TEMP_FILES[@]}"; do
    rm -f "$file"
  done
}

curl_error_summary() {
  local error_file=$1
  if [ -s "$error_file" ]; then
    tr '\n' ' ' <"$error_file" | tr -cd '[:print:]' | cut -c1-180
  else
    printf 'no curl diagnostic'
  fi
}

header_value() {
  local header_file=$1
  local wanted=$2
  awk -v wanted="$wanted" '
    BEGIN { wanted = tolower(wanted) }
    {
      key = $1
      sub(/:$/, "", key)
      if (tolower(key) == wanted) {
        value = $0
        sub(/^[^:]*:[[:space:]]*/, "", value)
        gsub(/\r/, "", value)
        print value
        exit
      }
    }
  ' "$header_file" 2>/dev/null
}

header_summary() {
  local header_file=$1
  local content_type content_length transfer_encoding x_total

  content_type=$(header_value "$header_file" "content-type")
  content_length=$(header_value "$header_file" "content-length")
  transfer_encoding=$(header_value "$header_file" "transfer-encoding")
  x_total=$(header_value "$header_file" "x-total")

  printf 'content_type=%s content_length=%s transfer_encoding=%s x_total=%s' \
    "${content_type:-missing}" \
    "${content_length:-missing}" \
    "${transfer_encoding:-missing}" \
    "${x_total:-missing}"
}

response_shape() {
  local response_file=$1
  local byte_count
  byte_count=$(wc -c <"$response_file" | tr -d ' ')

  if [ "$byte_count" -eq 0 ]; then
    printf 'bytes=0 json_valid=false shape=empty_body'
    return
  fi

  if ! jq -e . "$response_file" >/dev/null 2>&1; then
    printf 'bytes=%s json_valid=false shape=invalid_json' "$byte_count"
    return
  fi

  printf 'bytes=%s ' "$byte_count"
  jq -c '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    . as $root
    | ($root | records) as $records
    | {
        json_valid: true,
        json_type: ($root | type),
        top_level_keys: (
          if ($root | type) == "object" then ($root | keys | sort) else [] end
        ),
        record_count: ($records | length)
      }
  ' "$response_file" 2>/dev/null | tr '\n' ' '
}

endpoint_summary() {
  local url=$1
  local endpoint=${url#"$BASE_URL"}

  printf '%s' "$endpoint" |
    sed -E \
      -e 's#^/ai_agent_contexts/[0-9a-fA-F-]+/ai_agent_sessions/#/ai_agent_contexts/<context_id>/ai_agent_sessions/#' \
      -e 's#^/ai_agent_contexts/[0-9a-fA-F-]+$#/ai_agent_contexts/<id>#' \
      -e 's#^/ai_agent_sessions/[0-9a-fA-F-]+$#/ai_agent_sessions/<id>#' \
      -e 's#^/ai_agent_conversations/[0-9a-fA-F-]+$#/ai_agent_conversations/<id>#' \
      -e 's#^/ai_agent_messages/[0-9a-fA-F-]+$#/ai_agent_messages/<id>#'
}

response_digest() {
  local response_file=$1
  local digest

  if [ ! -s "$response_file" ]; then
    printf 'body_sha=none'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    digest=$(shasum -a 256 "$response_file" | awk '{print substr($1,1,12)}')
  elif command -v sha256sum >/dev/null 2>&1; then
    digest=$(sha256sum "$response_file" | awk '{print substr($1,1,12)}')
  else
    digest=$(cksum "$response_file" | awk '{print $1}')
  fi
  printf 'body_sha=%s' "$digest"
}

response_error_summary() {
  local response_file=$1
  local summary

  if ! jq -e . "$response_file" >/dev/null 2>&1; then
    printf 'no JSON error body'
    return
  fi

  summary=$(jq -r '
    def text:
      if type == "string" then .
      elif type == "number" or type == "boolean" then tostring
      elif type == "null" then empty
      else (tojson)
      end;
    [
      (if (.code? != null) then ("code=" + ((.code | text))) else empty end),
      (if (.message? != null) then ("message=" + ((.message | text))) else empty end),
      (if (.details? != null) then ("details=" + ((.details | text))) else empty end)
    ] | join(" ")
  ' "$response_file" 2>/dev/null || true)

  if [ -z "$summary" ]; then
    printf 'JSON error fields unavailable'
    return
  fi

  printf '%s' "$summary" |
    sed -E \
      -e 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<id>/g' \
      -e 's/harness[-_][A-Za-z0-9_-]*/<temp>/g' |
    tr '\n' ' ' | tr -cd '[:print:]' | cut -c1-260
}

request() {
  local method=$1
  local url=$2
  local payload=${3:-}
  local response_file header_file error_file payload_file code
  local -a curl_args

  make_temp
  response_file=$TEMP_FILE
  make_temp
  header_file=$TEMP_FILE
  make_temp
  error_file=$TEMP_FILE

  curl_args=(
    -sS
    -D "$header_file"
    -o "$response_file"
    -w '%{http_code}'
    --connect-timeout 3
    --max-time "$AIBIZ_REQUEST_TIMEOUT"
    -H "srfsystemid: $AIBIZ_SYSTEM_ID"
    -H "srforgid: $AIBIZ_ORG_ID"
    -H 'Accept: application/json'
  )

  if [ -n "$AUTH_HEADER" ]; then
    curl_args+=(-H "$AUTH_HEADER")
  fi

  case "$method" in
    POST|PUT|PATCH)
      make_temp
      payload_file=$TEMP_FILE
      printf '%s' "$payload" >"$payload_file"
      curl_args+=(-H 'Content-Type: application/json' --data-binary "@$payload_file")
      ;;
  esac

  code=$(curl -X "$method" "${curl_args[@]}" "$url" \
    2>"$error_file" || true)

  printf '%s\n' "$method $(endpoint_summary "$url")" \
    "http=$code $(header_summary "$header_file") $(response_shape "$response_file") $(response_digest "$response_file")" \
    >>"$RESULTS_FILE"

  if [ "$method" = "POST" ] && [[ "$url" == */fetch_default ]]; then
    record "PROBE method=$method endpoint=$(endpoint_summary "$url") http=$code $(header_summary "$header_file") $(response_shape "$response_file") $(response_digest "$response_file")"
  fi

  REQUEST_HTTP_CODE=$code
  REQUEST_RESPONSE_FILE=$response_file
  REQUEST_HEADER_FILE=$header_file
  REQUEST_ERROR_FILE=$error_file
}

create_resource() {
  local label=$1
  local url=$2
  local payload=$3
  local candidate_id=$4

  request POST "$url" "$payload"
  if ! [[ "${REQUEST_HTTP_CODE:-000}" =~ ^2[0-9][0-9]$ ]] ||
    ! jq -e . "$REQUEST_RESPONSE_FILE" >/dev/null 2>&1; then
    record "FAIL create=$label http=${REQUEST_HTTP_CODE:-000} candidate=$(id_summary "$candidate_id")"
    if [ -s "$REQUEST_ERROR_FILE" ]; then
      record "FAIL curl_error=$(curl_error_summary "$REQUEST_ERROR_FILE")"
    fi
    return 1
  fi

  CREATED_ID=$(jq -er '
    (.id
     // (if (.data | type) == "object" then .data.id else null end)
     // (if (.data | type) == "object"
         and (.data.data | type) == "object"
         then .data.data.id
         else null
         end))
    | strings
    | select(length > 0)
  ' "$REQUEST_RESPONSE_FILE" 2>/dev/null || true)

  if [ -z "$CREATED_ID" ]; then
    record "FAIL create=$label http=$REQUEST_HTTP_CODE response_id=missing"
    return 1
  fi

  record "PASS create=$label http=$REQUEST_HTTP_CODE id=$(id_summary "$CREATED_ID")"
  return 0
}

delete_resource() {
  local label=$1
  local url=$2

  request DELETE "$url"
  if [[ "${REQUEST_HTTP_CODE:-000}" =~ ^2[0-9][0-9]$ ]]; then
    record "PASS delete=$label http=$REQUEST_HTTP_CODE"
  else
    FAILED=1
    record "FAIL delete=$label http=${REQUEST_HTTP_CODE:-000} api_error=$(response_error_summary "$REQUEST_RESPONSE_FILE") curl_error=$(curl_error_summary "$REQUEST_ERROR_FILE")"
  fi
}

cleanup() {
  if [ "$CLEANUP_DONE" -eq 1 ]; then
    return
  fi
  CLEANUP_DONE=1

  if [ -n "$AUTH_HEADER" ]; then
    if [ "$SESSION_CREATED" -eq 1 ] && [ -n "$SESSION_ID" ]; then
      delete_resource "session" "$BASE_URL/ai_agent_sessions/$SESSION_ID"
    fi
    if [ "$CONTEXT_CREATED" -eq 1 ] && [ -n "$CONTEXT_ID" ]; then
      delete_resource "context" "$BASE_URL/ai_agent_contexts/$CONTEXT_ID"
    fi
  fi
  cleanup_temp_files
}
trap cleanup EXIT

record "AIBiz Harness API Session fetch probe"
record "timestamp=$(date '+%F %T %z')"
record "report_dir=$REPORT_DIR"
record "base_url=$BASE_URL"
record "probe_confirmation=$([ "$AIBIZ_PROBE_CONFIRM" = yes ] && printf enabled || printf disabled)"

if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  FAILED=1
  record "FAIL dependency curl and jq are required"
  exit "$FAILED"
fi

if [ "$AIBIZ_PROBE_CONFIRM" != "yes" ]; then
  record "SKIP set AIBIZ_PROBE_CONFIRM=yes to create temporary Context and Session"
  exit 0
fi

login_payload=$(jq -cn --arg loginname "$AIBIZ_LOGINNAME" --arg password "$AIBIZ_PASSWORD" \
  '{loginname: $loginname, password: $password}')
request POST "$BASE_URL/v7/login" "$login_payload"
if ! [[ "${REQUEST_HTTP_CODE:-000}" =~ ^2[0-9][0-9]$ ]] ||
  ! token=$(jq -er \
    '(.token // .access_token // .data.token // .data.access_token) | strings | select(length > 0)' \
    "$REQUEST_RESPONSE_FILE" 2>/dev/null); then
  FAILED=1
  record "FAIL login http=${REQUEST_HTTP_CODE:-000} token_present=false"
  exit "$FAILED"
fi
AUTH_HEADER="Authorization: Bearer $token"
record "PASS login http=$REQUEST_HTTP_CODE token_present=true"

SMOKE_SUFFIX=$(date "+%Y%m%d%H%M%S")_$$
SMOKE_NAME="harness-probe-$SMOKE_SUFFIX"
SMOKE_CODE_NAME="harness_probe_$SMOKE_SUFFIX"

context_candidate=$(new_id)
CONTEXT_ID=$context_candidate
context_payload=$(jq -cn \
  --arg id "$context_candidate" \
  --arg name "$SMOKE_NAME" \
  --arg code_name "$SMOKE_CODE_NAME" \
  '{
    id: $id,
    name: $name,
    code_name: $code_name,
    description: "temporary Harness API Session fetch probe context",
    is_default: 0,
    active: 1,
    enable_tools: 0,
    stream: 1
  }')

if create_resource "context" "$BASE_URL/ai_agent_contexts" \
  "$context_payload" "$context_candidate"; then
  CONTEXT_ID=$CREATED_ID
  CONTEXT_CREATED=1
else
  exit 1
fi

session_candidate=$(new_id)
SESSION_ID=$session_candidate
session_payload=$(jq -cn \
  --arg id "$session_candidate" \
  --arg name "$SMOKE_NAME" \
  --arg context_id "$CONTEXT_ID" \
  --arg context_code_name "$SMOKE_CODE_NAME" \
  '{
    id: $id,
    name: $name,
    context_id: $context_id,
    context_code_name: $context_code_name
  }')

if create_resource "session" "$BASE_URL/ai_agent_sessions" \
  "$session_payload" "$session_candidate"; then
  SESSION_ID=$CREATED_ID
  SESSION_CREATED=1
else
  exit 1
fi

payload_default=$(jq -cn \
  --arg session_id "$SESSION_ID" \
  --arg context_id "$CONTEXT_ID" \
  '{
    page: 0,
    size: 20,
    sort: null,
    n_context_id_eq: $context_id,
    n_id_eq: $session_id
  }')
payload_page_one=$(jq -cn \
  --arg session_id "$SESSION_ID" \
  --arg context_id "$CONTEXT_ID" \
  '{
    page: 1,
    size: 50,
    sort: null,
    n_context_id_eq: $context_id,
    n_id_eq: $session_id
  }')
payload_sort=$(jq -cn \
  --arg session_id "$SESSION_ID" \
  --arg context_id "$CONTEXT_ID" \
  '{
    page: 0,
    size: 20,
    sort: "id,asc",
    n_context_id_eq: $context_id,
    n_id_eq: $session_id
  }')
payload_session_only=$(jq -cn \
  --arg session_id "$SESSION_ID" \
  '{
    page: 0,
    size: 20,
    sort: null,
    n_id_eq: $session_id
  }')
payload_context_only=$(jq -cn \
  --arg context_id "$CONTEXT_ID" \
  '{
    page: 0,
    size: 20,
    sort: null,
    n_context_id_eq: $context_id
  }')
payload_empty=$(jq -cn '{
  page: 0,
  size: 20,
  sort: null
}')

request POST "$BASE_URL/ai_agent_contexts/fetch_default" "$payload_empty"
request POST "$BASE_URL/ai_agents/fetch_default" "$payload_empty"
request POST "$BASE_URL/ai_agent_conversations/fetch_default" "$payload_empty"
request POST "$BASE_URL/ai_agent_messages/fetch_default" "$payload_empty"

request POST "$BASE_URL/ai_agent_sessions/fetch_default" "$payload_default"
request POST "$BASE_URL/ai_agent_sessions/fetch_default" "$payload_page_one"
request POST "$BASE_URL/ai_agent_sessions/fetch_default" "$payload_sort"
request POST "$BASE_URL/ai_agent_sessions/fetch_default" "$payload_session_only"
request POST "$BASE_URL/ai_agent_sessions/fetch_default" "$payload_context_only"
request POST "$BASE_URL/ai_agent_sessions/fetch_default" "$payload_empty"

request POST "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions/fetch_default" \
  "$payload_default"
request POST "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions/fetch_default" \
  "$payload_page_one"
request POST "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions/fetch_default" \
  "$payload_session_only"
request POST "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions/fetch_default" \
  "$payload_context_only"

record "probe_ids context=$(id_summary "$CONTEXT_ID") session=$(id_summary "$SESSION_ID")"
record "results_file=$RESULTS_FILE"
exit "$FAILED"
