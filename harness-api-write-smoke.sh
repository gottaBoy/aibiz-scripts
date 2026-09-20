#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TIMESTAMP=$(date "+%Y%m%d-%H%M%S")
REPORT_DIR=${AIBIZ_REPORT_DIR:-"$ROOT_DIR/.artifacts/harness-api-write-smoke/$TIMESTAMP"}
SUMMARY_FILE="$REPORT_DIR/summary.txt"
CHECKS_FILE="$REPORT_DIR/checks.jsonl"

BASE_URL=${AIBIZ_BASE_URL:-"http://127.0.0.1:32003/api/ibizplm__plmweb"}
BASE_URL=${BASE_URL%/}
AIBIZ_LOGINNAME=${AIBIZ_LOGINNAME:-aibizhi}
AIBIZ_PASSWORD=${AIBIZ_PASSWORD:-123456}
AIBIZ_USER_ID=${AIBIZ_USER_ID:-"$AIBIZ_LOGINNAME"}
AIBIZ_REQUEST_TIMEOUT=${AIBIZ_REQUEST_TIMEOUT:-30}
AIBIZ_WRITE_SMOKE_CONFIRM=${AIBIZ_WRITE_SMOKE_CONFIRM:-}
AIBIZ_HARNESS_STRICT_IDEMPOTENCY=${AIBIZ_HARNESS_STRICT_IDEMPOTENCY:-no}
AIBIZ_SYSTEM_ID=${AIBIZ_SYSTEM_ID:-ibizplm}
AIBIZ_ORG_ID=${AIBIZ_ORG_ID:-000000}

FAILED=0
CHECK_COUNT=0
PASS_COUNT=0
SKIP_COUNT=0
TEMP_FILE=
TEMP_FILES=()
AUTH_HEADER=
HAS_CURL=0
HAS_JQ=0
CLEANUP_DONE=0

CONTEXT_ID=
SESSION_ID=
NESTED_SESSION_ID=
CONVERSATION_ID=
MESSAGE_ID=
RUN_ID=
RUN_DUPLICATE_ID=
STEP_ID=
STEP_DUPLICATE_ID=
EVENT_ID=
EVENT_SECOND_ID=
EVENT_DUPLICATE_ID=
CONTEXT_CREATED=0
SESSION_CREATED=0
NESTED_SESSION_CREATED=0
NESTED_SESSION_STANDARD_DELETED=0
CONVERSATION_CREATED=0
MESSAGE_CREATED=0
RUN_CREATED=0
RUN_DUPLICATE_CREATED=0
STEP_CREATED=0
STEP_DUPLICATE_CREATED=0
EVENT_CREATED=0
EVENT_SECOND_CREATED=0
EVENT_DUPLICATE_CREATED=0
CONVERSATION_BUSINESS_DELETED=0
CONVERSATION_STANDARD_DELETED=0

LAST_HTTP_CODE=
LAST_RESPONSE_FILE=
LAST_HEADER_FILE=
LAST_ERROR_FILE=
CREATED_ID=
DUPLICATE_CREATED_ID=

SMOKE_SUFFIX=$(date "+%Y%m%d%H%M%S")_$$
SMOKE_NAME="harness-smoke-$SMOKE_SUFFIX"
SMOKE_CODE_NAME="harness_smoke_$SMOKE_SUFFIX"

mkdir -p "$REPORT_DIR"
: >"$SUMMARY_FILE"
: >"$CHECKS_FILE"

record() {
  printf '%s\n' "$*" | tee -a "$SUMMARY_FILE"
}

record_check() {
  local status=$1
  local check=$2
  local detail=$3

  CHECK_COUNT=$((CHECK_COUNT + 1))
  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
    *) FAILED=1 ;;
  esac

  printf '%s %s %s\n' "$status" "$check" "$detail" | tee -a "$SUMMARY_FILE"
  if [ "$HAS_JQ" -eq 1 ]; then
    jq -cn --arg status "$status" --arg check "$check" --arg detail "$detail" \
      '{status: $status, check: $check, detail: $detail}' >>"$CHECKS_FILE"
  fi
}

make_temp() {
  TEMP_FILE=$(mktemp "${TMPDIR:-/tmp}/aibiz-harness-write.XXXXXX")
  TEMP_FILES+=("$TEMP_FILE")
}

cleanup_temp_files() {
  local file
  for file in "${TEMP_FILES[@]}"; do
    rm -f "$file"
  done
}

cleanup() {
  local code

  if [ "$CLEANUP_DONE" -eq 1 ]; then
    return
  fi
  CLEANUP_DONE=1

  if [ -z "$AUTH_HEADER" ]; then
    cleanup_temp_files
    return
  fi

  if [ "$EVENT_CREATED" -eq 1 ] ||
    [ "$EVENT_SECOND_CREATED" -eq 1 ] ||
    [ "$EVENT_DUPLICATE_CREATED" -eq 1 ]; then
    record_check SKIP "cleanup run events" \
      "append_only=true retained=true delete_not_attempted=true run=$(id_summary "$RUN_ID")"
  fi

  if [ "$STEP_DUPLICATE_CREATED" -eq 1 ] && [ -n "$STEP_DUPLICATE_ID" ]; then
    delete_resource "cleanup duplicate run step" \
      "$BASE_URL/ai_run_steps/$STEP_DUPLICATE_ID" || true
  fi

  if [ "$STEP_CREATED" -eq 1 ] && [ -n "$STEP_ID" ]; then
    delete_resource "cleanup run step" "$BASE_URL/ai_run_steps/$STEP_ID" || true
  fi

  if [ "$RUN_DUPLICATE_CREATED" -eq 1 ] && [ -n "$RUN_DUPLICATE_ID" ]; then
    delete_resource "cleanup duplicate run" "$BASE_URL/ai_runs/$RUN_DUPLICATE_ID" || true
  fi

  if [ "$RUN_CREATED" -eq 1 ] && [ -n "$RUN_ID" ]; then
    delete_resource "cleanup run" "$BASE_URL/ai_runs/$RUN_ID" || true
  fi

  if [ "$MESSAGE_CREATED" -eq 1 ] && [ -n "$MESSAGE_ID" ]; then
    delete_resource "cleanup message" "$BASE_URL/ai_agent_messages/$MESSAGE_ID" || true
  fi

  if [ "$CONVERSATION_CREATED" -eq 1 ] &&
    [ "$CONVERSATION_STANDARD_DELETED" -eq 0 ] &&
    [ -n "$CONVERSATION_ID" ]; then
    delete_resource "cleanup conversation" \
      "$BASE_URL/ai_agent_conversations/$CONVERSATION_ID" || true
  fi

  if [ "$SESSION_CREATED" -eq 1 ] && [ -n "$SESSION_ID" ]; then
    delete_resource "cleanup session" "$BASE_URL/ai_agent_sessions/$SESSION_ID" || true
  fi

  if [ "$NESTED_SESSION_CREATED" -eq 1 ] &&
    [ "$NESTED_SESSION_STANDARD_DELETED" -eq 0 ] &&
    [ -n "$NESTED_SESSION_ID" ] &&
    [ -n "$CONTEXT_ID" ]; then
    delete_resource "cleanup nested session" \
      "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions/$NESTED_SESSION_ID" || true
  fi

  if [ "$CONTEXT_CREATED" -eq 1 ] && [ -n "$CONTEXT_ID" ]; then
    delete_resource "cleanup context" "$BASE_URL/ai_agent_contexts/$CONTEXT_ID" || true
  fi

  if [ "$MESSAGE_CREATED" -eq 1 ] && [ -n "$MESSAGE_ID" ]; then
    verify_absent "cleanup verify message" \
      "$BASE_URL/ai_agent_messages/$MESSAGE_ID" || true
  fi

  if [ "$CONVERSATION_CREATED" -eq 1 ] && [ -n "$CONVERSATION_ID" ]; then
    verify_absent "cleanup verify conversation" \
      "$BASE_URL/ai_agent_conversations/$CONVERSATION_ID" || true
  fi

  if [ "$SESSION_CREATED" -eq 1 ] && [ -n "$SESSION_ID" ]; then
    verify_session_dataset_absent \
      "cleanup verify session via fetch_default" \
      "$BASE_URL/ai_agent_sessions/fetch_default" \
      "$SESSION_ID" "$CONTEXT_ID" || true
    verify_session_dataset_absent \
      "cleanup verify child session via fetch_default" \
      "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions/fetch_default" \
      "$SESSION_ID" "$CONTEXT_ID" || true
  fi

  if [ "$CONTEXT_CREATED" -eq 1 ] && [ -n "$CONTEXT_ID" ]; then
    verify_absent "cleanup verify context" \
      "$BASE_URL/ai_agent_contexts/$CONTEXT_ID" || true
  fi

  if [ "$STEP_CREATED" -eq 1 ] && [ -n "$STEP_ID" ]; then
    verify_absent "cleanup verify run step" \
      "$BASE_URL/ai_run_steps/$STEP_ID" || true
  fi

  if [ "$STEP_DUPLICATE_CREATED" -eq 1 ] && [ -n "$STEP_DUPLICATE_ID" ]; then
    verify_absent "cleanup verify duplicate run step" \
      "$BASE_URL/ai_run_steps/$STEP_DUPLICATE_ID" || true
  fi

  if [ "$RUN_CREATED" -eq 1 ] && [ -n "$RUN_ID" ]; then
    verify_absent "cleanup verify run" "$BASE_URL/ai_runs/$RUN_ID" || true
  fi

  if [ "$RUN_DUPLICATE_CREATED" -eq 1 ] && [ -n "$RUN_DUPLICATE_ID" ]; then
    verify_absent "cleanup verify duplicate run" \
      "$BASE_URL/ai_runs/$RUN_DUPLICATE_ID" || true
  fi

  code=$?
  cleanup_temp_files
  return "$code"
}
trap cleanup EXIT

curl_error_summary() {
  local error_file=$1
  if [ -s "$error_file" ]; then
    tr '\n' ' ' <"$error_file" | tr -cd '[:print:]' | cut -c1-180
  else
    printf 'no curl diagnostic'
  fi
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

  summary=$(printf '%s' "$summary" |
    sed -E \
      -e 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<id>/g' \
      -e 's/harness[-_][A-Za-z0-9_-]*/<temp>/g' |
    tr '\n' ' ' | tr -cd '[:print:]' | cut -c1-260)
  printf '%s' "$summary"
}

id_summary() {
  local value=$1
  local digest

  if [ -z "$value" ]; then
    printf 'none'
    return
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    digest=$(printf '%s' "$value" | sha256sum | awk '{print substr($1,1,10)}')
  elif command -v shasum >/dev/null 2>&1; then
    digest=$(printf '%s' "$value" | LC_ALL=C shasum -a 256 | awk '{print substr($1,1,10)}')
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

check_dependencies() {
  if command -v curl >/dev/null 2>&1; then
    HAS_CURL=1
    record_check PASS "dependency:curl" "available"
  else
    record_check FAIL "dependency:curl" "unavailable"
  fi

  if command -v jq >/dev/null 2>&1; then
    HAS_JQ=1
    record_check PASS "dependency:jq" "available"
  else
    record_check FAIL "dependency:jq" "unavailable"
  fi
}

request() {
  local method=$1
  local url=$2
  local payload=${3:-}
  local payload_file
  local -a curl_args

  LAST_RESPONSE_FILE=
  LAST_HEADER_FILE=
  LAST_ERROR_FILE=
  LAST_HTTP_CODE=

  make_temp
  LAST_RESPONSE_FILE=$TEMP_FILE
  make_temp
  LAST_HEADER_FILE=$TEMP_FILE
  make_temp
  LAST_ERROR_FILE=$TEMP_FILE

  curl_args=(
    -sS
    -D "$LAST_HEADER_FILE"
    -o "$LAST_RESPONSE_FILE"
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

  LAST_HTTP_CODE=$(curl -X "$method" "${curl_args[@]}" "$url" \
    2>"$LAST_ERROR_FILE" || true)
}

is_2xx() {
  [[ "${LAST_HTTP_CODE:-}" =~ ^2[0-9][0-9]$ ]]
}

valid_json() {
  jq -e . "$LAST_RESPONSE_FILE" >/dev/null 2>&1
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

response_transport_summary() {
  local body_bytes content_type content_length x_total

  body_bytes=$(wc -c <"$LAST_RESPONSE_FILE" | tr -d ' ')
  content_type=$(header_value "$LAST_HEADER_FILE" "content-type")
  content_length=$(header_value "$LAST_HEADER_FILE" "content-length")
  x_total=$(header_value "$LAST_HEADER_FILE" "x-total")

  printf 'body_bytes=%s content_type=%s content_length=%s x_total=%s empty_body=%s' \
    "$body_bytes" \
    "${content_type:-missing}" \
    "${content_length:-missing}" \
    "${x_total:-missing}" \
    "$([ "$body_bytes" -eq 0 ] && printf true || printf false)"
}

response_body_bytes() {
  wc -c <"$LAST_RESPONSE_FILE" | tr -d ' '
}

extract_id() {
  jq -er '
    def object_id:
      (.id
       // (if (.data | type) == "object" then .data.id else null end)
       // (if (.data | type) == "object"
           and (.data.data | type) == "object"
           then .data.data.id
           else null
           end));
    if type == "object" then object_id
    elif type == "array" and length > 0 and (.[0] | type) == "object"
      then .[0].id
    else null
    end
    | strings
    | select(length > 0)
  ' "$LAST_RESPONSE_FILE" 2>/dev/null
}

create_resource() {
  local label=$1
  local method=$2
  local url=$3
  local payload=$4
  local candidate_id=$5

  CREATED_ID=
  request "$method" "$url" "$payload"

  if ! is_2xx; then
    if valid_json && CREATED_ID=$(extract_id); then
      record_check FAIL "$method $label" \
        "http=${LAST_HTTP_CODE:-000} response_id=$(id_summary "$CREATED_ID") api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    else
      record_check FAIL "$method $label" \
        "http=${LAST_HTTP_CODE:-000} id=$(id_summary "$candidate_id") api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    fi
    return 1
  fi

  if ! valid_json; then
    record_check FAIL "$method $label" \
      "http=$LAST_HTTP_CODE json_valid=false id=$(id_summary "$candidate_id")"
    return 1
  fi

  if ! CREATED_ID=$(extract_id); then
    record_check FAIL "$method $label" \
      "http=$LAST_HTTP_CODE json_valid=true id=missing"
    return 1
  fi

  record_check PASS "$method $label" \
    "http=$LAST_HTTP_CODE json_valid=true id=$(id_summary "$CREATED_ID")"
  return 0
}

get_resource() {
  local label=$1
  local url=$2
  local expected_id=$3
  local actual_id

  request GET "$url"

  if ! is_2xx; then
    record_check FAIL "GET $label" \
      "http=${LAST_HTTP_CODE:-000} id=$(id_summary "$expected_id") api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return 1
  fi

  if ! valid_json; then
    record_check FAIL "GET $label" \
      "http=$LAST_HTTP_CODE json_valid=false id=$(id_summary "$expected_id")"
    return 1
  fi

  if ! actual_id=$(extract_id); then
    record_check FAIL "GET $label" \
      "http=$LAST_HTTP_CODE json_valid=true id=missing expected=$(id_summary "$expected_id")"
    return 1
  fi

  if [ "$actual_id" != "$expected_id" ]; then
    record_check FAIL "GET $label" \
      "http=$LAST_HTTP_CODE id_mismatch expected=$(id_summary "$expected_id") actual=$(id_summary "$actual_id")"
    return 1
  fi

  record_check PASS "GET $label" \
    "http=$LAST_HTTP_CODE json_valid=true id=$(id_summary "$actual_id")"
  return 0
}

check_idempotent_duplicate() {
  local label=$1
  local url=$2
  local payload=$3
  local expected_id=$4
  local actual_id

  DUPLICATE_CREATED_ID=
  request POST "$url" "$payload"

  if is_2xx && valid_json && actual_id=$(extract_id); then
    if [ "$actual_id" = "$expected_id" ]; then
      record_check PASS "POST $label" \
        "http=$LAST_HTTP_CODE id=$(id_summary "$actual_id") same_record=true"
      return 0
    fi

    DUPLICATE_CREATED_ID=$actual_id
    if [ "$AIBIZ_HARNESS_STRICT_IDEMPOTENCY" = "yes" ]; then
      record_check FAIL "POST $label" \
        "http=$LAST_HTTP_CODE expected=$(id_summary "$expected_id") actual=$(id_summary "$actual_id") same_record=false"
      return 1
    fi

    record_check SKIP "POST $label" \
      "http=$LAST_HTTP_CODE expected=$(id_summary "$expected_id") actual=$(id_summary "$actual_id") same_record=false service_layer_pending=true"
    return 0
  fi

  if [ "$AIBIZ_HARNESS_STRICT_IDEMPOTENCY" = "yes" ]; then
    record_check FAIL "POST $label" \
      "http=${LAST_HTTP_CODE:-000} expected=$(id_summary "$expected_id") same_record=false api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return 1
  fi

  record_check SKIP "POST $label" \
    "http=${LAST_HTTP_CODE:-000} expected=$(id_summary "$expected_id") same_record=unverified service_layer_pending=true api_error=$(response_error_summary "$LAST_RESPONSE_FILE")"
  return 0
}

fetch_run_events() {
  local label=$1
  local run_id=$2
  local payload
  local record_count
  local run_match
  local sequence_summary
  local canonical_count
  local expected_sequence_summary
  local extra_count
  local sequence_contract_ok

  payload=$(jq -cn --arg run_id "$run_id" \
    '{page: 0, size: 50, n_run_id_eq: $run_id, sort: "sequence,asc"}')
  request POST "$BASE_URL/ai_run_events/fetch_default" "$payload"

  if ! is_2xx; then
    record_check FAIL "POST $label" \
      "http=${LAST_HTTP_CODE:-000} run=$(id_summary "$run_id") api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return 1
  fi

  if ! valid_json; then
    record_check FAIL "POST $label" \
      "http=$LAST_HTTP_CODE json_valid=false run=$(id_summary "$run_id")"
    return 1
  fi

  record_count=$(jq -r '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    records | length
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)
  run_match=$(jq -r --arg run_id "$run_id" '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    [records[]? | select((.run_id // "") == $run_id)] | length
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)
  sequence_summary=$(jq -r '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    records | map(.sequence | tonumber) as $sequences
    | ($sequences | sort) as $sorted
    | {
        sorted: ($sequences == $sorted),
        unique: (($sorted | unique | length) == ($sorted | length)),
        starts_at_one: (($sorted | length) > 0 and $sorted[0] == 1),
        continuous: ($sorted == [range(1; ($sorted | length) + 1)]),
        values: ($sequences | map(tostring) | join(","))
      }
    | @json
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)
  canonical_count=$(jq -r \
    --arg first_id "$EVENT_ID" \
    --arg second_id "$EVENT_SECOND_ID" '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    [records[]?
      | select((.id // "") == $first_id or (.id // "") == $second_id)]
    | length
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)
  expected_sequence_summary=$(jq -r \
    --arg first_id "$EVENT_ID" \
    --arg second_id "$EVENT_SECOND_ID" \
    --arg first_type "step.started" \
    --arg second_type "step.completed" '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    [records[]?
      | select((.id // "") == $first_id or (.id // "") == $second_id)
      | {
          id: .id,
          sequence: (.sequence | tonumber),
          event_type: (.event_type // "")
        }]
    | sort_by(.sequence)
    | {
        values: (map(.sequence) | map(tostring) | join(",")),
        count: (length == 2),
        distinct_ids: ((map(.id) | unique | length) == 2),
        increasing: (length == 2 and .[0].sequence < .[1].sequence),
        event_types: (map(.event_type) | join(",")),
        expected_event_types: (
          length == 2
          and .[0].event_type == $first_type
          and .[1].event_type == $second_type
        )
      }
    | @json
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)
  extra_count=$(jq -r \
    --arg first_id "$EVENT_ID" \
    --arg second_id "$EVENT_SECOND_ID" \
    --arg duplicate_id "$EVENT_DUPLICATE_ID" '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    [records[]?
      | select((.id // "") != $first_id
        and (.id // "") != $second_id
        and (.id // "") != $duplicate_id
        and (.event_type // "") != "run.created"
        and (.event_type // "") != "step.created")]
    | length
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)
  extra_count=$((extra_count + 0))
  sequence_contract_ok=$(
    if [ "$(printf '%s' "$sequence_summary" | jq -r '.sorted // false')" = "true" ] &&
      [ "$(printf '%s' "$sequence_summary" | jq -r '.unique // false')" = "true" ] &&
      [ "$(printf '%s' "$sequence_summary" | jq -r '.starts_at_one // false')" = "true" ] &&
      [ "$(printf '%s' "$sequence_summary" | jq -r '.continuous // false')" = "true" ]; then
      printf true
    else
      printf false
    fi
  )

  if [ "${canonical_count:-0}" -ne 2 ] ||
    [ "${extra_count:-0}" -ne 0 ] ||
    [ "$(printf '%s' "$expected_sequence_summary" | jq -r '.count // false')" != "true" ] ||
    [ "$(printf '%s' "$expected_sequence_summary" | jq -r '.distinct_ids // false')" != "true" ] ||
    [ "$(printf '%s' "$expected_sequence_summary" | jq -r '.increasing // false')" != "true" ] ||
    [ "$(printf '%s' "$expected_sequence_summary" | jq -r '.expected_event_types // false')" != "true" ] ||
    [ "${run_match:-0}" -lt 2 ] ||
    [ "${run_match:-0}" -ne "${record_count:-0}" ]; then
    record_check FAIL "POST $label" \
      "http=$LAST_HTTP_CODE records=${record_count:-unknown} run_match=${run_match:-unknown} canonical=${canonical_count:-unknown} extra=${extra_count:-unknown} expected_sequence=${expected_sequence_summary:-unknown} sequence=${sequence_summary:-unknown} run=$(id_summary "$run_id")"
    return 1
  fi

  if [ "$sequence_contract_ok" != "true" ]; then
    record_check FAIL "POST $label" \
      "http=$LAST_HTTP_CODE records=$record_count run_match=$run_match canonical=$canonical_count extra=$extra_count expected_sequence=$expected_sequence_summary sequence=$sequence_summary run=$(id_summary "$run_id")"
    return 1
  fi

  record_check PASS "POST $label" \
    "http=$LAST_HTTP_CODE records=$record_count run_match=$run_match canonical=$canonical_count automatic=$((record_count - canonical_count)) sequence=$sequence_summary run=$(id_summary "$run_id")"
  return 0
}

get_runtime_session() {
  local label=$1
  local url=$2
  local expected_id=$3
  local actual_id

  request GET "$url"

  if ! is_2xx; then
    record_check FAIL "GET $label" \
      "http=${LAST_HTTP_CODE:-000} session=$(id_summary "$expected_id") api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return 1
  fi

  if [ "$(response_body_bytes)" -eq 0 ]; then
    record_check SKIP "GET $label" \
      "http=$LAST_HTTP_CODE $(response_transport_summary) session_storage=none query_not_applicable=true session=$(id_summary "$expected_id")"
    return 0
  fi

  if ! valid_json; then
    record_check FAIL "GET $label" \
      "http=$LAST_HTTP_CODE json_valid=false session=$(id_summary "$expected_id")"
    return 1
  fi

  if ! actual_id=$(extract_id); then
    record_check FAIL "GET $label" \
      "http=$LAST_HTTP_CODE json_valid=true id=missing session=$(id_summary "$expected_id")"
    return 1
  fi

  if [ "$actual_id" != "$expected_id" ]; then
    record_check FAIL "GET $label" \
      "http=$LAST_HTTP_CODE id_mismatch expected=$(id_summary "$expected_id") actual=$(id_summary "$actual_id")"
    return 1
  fi

  record_check PASS "GET $label" \
    "http=$LAST_HTTP_CODE json_valid=true id=$(id_summary "$actual_id") session_storage=runtime"
  return 0
}

fetch_session_dataset() {
  local label=$1
  local url=$2
  local session_id=$3
  local context_id=$4
  local payload
  local record_count
  local session_match
  local context_match
  local actual_context

  payload=$(jq -cn \
    --arg session_id "$session_id" \
    --arg context_id "$context_id" \
    '{
      page: 0,
      size: 20,
      n_id_eq: $session_id,
      n_context_id_eq: $context_id
    }')
  request POST "$url" "$payload"

  if ! is_2xx; then
    record_check FAIL "POST $label" \
      "http=${LAST_HTTP_CODE:-000} session=$(id_summary "$session_id") context=$(id_summary "$context_id") api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return 1
  fi

  if [ "$(response_body_bytes)" -eq 0 ]; then
    record_check SKIP "POST $label" \
      "http=$LAST_HTTP_CODE $(response_transport_summary) session_storage=none query_not_applicable=true session=$(id_summary "$session_id") context=$(id_summary "$context_id")"
    return 0
  fi

  if ! valid_json; then
    record_check FAIL "POST $label" \
      "http=$LAST_HTTP_CODE json_valid=false $(response_transport_summary) session=$(id_summary "$session_id") context=$(id_summary "$context_id")"
    return 1
  fi

  record_count=$(jq -r '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    records | length
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)
  session_match=$(jq -r --arg session_id "$session_id" '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    [records[]? | select((.id // "") == $session_id)] | length
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)
  context_match=$(jq -r \
    --arg session_id "$session_id" \
    --arg context_id "$context_id" '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    [
      records[]?
      | select((.id // "") == $session_id)
      | select((.context_id // "") == $context_id)
    ] | length
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)
  actual_context=$(jq -r --arg session_id "$session_id" '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    records[]? | select((.id // "") == $session_id) | .context_id // empty
  ' "$LAST_RESPONSE_FILE" 2>/dev/null | head -1 || true)

  if [ "${session_match:-0}" -lt 1 ]; then
    record_check FAIL "POST $label" \
      "http=$LAST_HTTP_CODE records=${record_count:-unknown} session=$(id_summary "$session_id") context=$(id_summary "$context_id") id_match=false"
    return 1
  fi

  if [ "${context_match:-0}" -lt 1 ]; then
    record_check FAIL "POST $label" \
      "http=$LAST_HTTP_CODE records=${record_count:-unknown} session=$(id_summary "$session_id") expected_context=$(id_summary "$context_id") actual_context=$(id_summary "$actual_context") context_match=false"
    return 1
  fi

  record_check PASS "POST $label" \
    "http=$LAST_HTTP_CODE records=${record_count:-unknown} session=$(id_summary "$session_id") context=$(id_summary "$context_id") id_match=true context_match=true"
  return 0
}

verify_session_dataset_absent() {
  local label=$1
  local url=$2
  local session_id=$3
  local context_id=$4
  local payload
  local record_count

  payload=$(jq -cn \
    --arg session_id "$session_id" \
    --arg context_id "$context_id" \
    '{
      page: 0,
      size: 20,
      n_id_eq: $session_id,
      n_context_id_eq: $context_id
    }')
  request POST "$url" "$payload"

  if [ "${LAST_HTTP_CODE:-000}" = "500" ] &&
    valid_json &&
    jq -e '(.code? == 3) and ((.message? | type) == "string")' \
      "$LAST_RESPONSE_FILE" >/dev/null 2>&1; then
    record_check PASS "POST $label" \
      "http=500 api_code=3 absent=true session=$(id_summary "$session_id") context=$(id_summary "$context_id")"
    return 0
  fi

  if is_2xx && [ "$(response_body_bytes)" -eq 0 ]; then
    record_check SKIP "POST $label" \
      "http=$LAST_HTTP_CODE $(response_transport_summary) session_storage=none absent_check_not_applicable=true session=$(id_summary "$session_id") context=$(id_summary "$context_id")"
    return 0
  fi

  if ! is_2xx; then
    record_check FAIL "POST $label" \
      "http=${LAST_HTTP_CODE:-000} session=$(id_summary "$session_id") context=$(id_summary "$context_id") api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return 1
  fi

  if ! valid_json; then
    record_check FAIL "POST $label" \
      "http=$LAST_HTTP_CODE json_valid=false $(response_transport_summary) absent=unknown session=$(id_summary "$session_id") context=$(id_summary "$context_id")"
    return 1
  fi

  record_count=$(jq -r '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      elif type == "object" and (.data | type) == "object" then (.data | records)
      else []
      end;
    records | length
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)

  if [ "${record_count:-unknown}" != "0" ]; then
    record_check FAIL "POST $label" \
      "http=$LAST_HTTP_CODE records=${record_count:-unknown} absent=false session=$(id_summary "$session_id") context=$(id_summary "$context_id")"
    return 1
  fi

  record_check PASS "POST $label" \
    "http=$LAST_HTTP_CODE records=0 absent=true session=$(id_summary "$session_id") context=$(id_summary "$context_id")"
  return 0
}

fetch_messages_for_conversation() {
  local label=$1
  local conversation_id=$2
  local payload
  local found

  payload=$(jq -cn --arg conversation_id "$conversation_id" \
    '{page: 0, size: 20, n_conversation_id_eq: $conversation_id}')
  request POST "$BASE_URL/ai_agent_messages/fetch_all" "$payload"

  if ! is_2xx; then
    record_check FAIL "POST $label" \
      "http=${LAST_HTTP_CODE:-000} conversation=$(id_summary "$conversation_id") api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return 1
  fi

  if ! valid_json; then
    record_check FAIL "POST $label" \
      "http=$LAST_HTTP_CODE json_valid=false conversation=$(id_summary "$conversation_id")"
    return 1
  fi

  found=$(jq -r --arg message_id "$MESSAGE_ID" '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      else []
      end;
    [records[]? | select((.id // "") == $message_id)] | length
  ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)

  if [ "$found" -lt 1 ]; then
    record_check FAIL "POST $label" \
      "http=$LAST_HTTP_CODE message=$(id_summary "$MESSAGE_ID") conversation=$(id_summary "$conversation_id") match=false"
    return 1
  fi

  record_check PASS "POST $label" \
    "http=$LAST_HTTP_CODE message=$(id_summary "$MESSAGE_ID") conversation=$(id_summary "$conversation_id") match=true"
  return 0
}

business_delete_conversation() {
  local payload
  local result_ok
  local status

  payload=$(jq -cn \
    --arg id "$CONVERSATION_ID" \
    --arg title "$SMOKE_NAME" \
    --arg session_id "$SESSION_ID" \
    --arg context_id "$CONTEXT_ID" \
    '{
      id: $id,
      name: $title,
      title: $title,
      type: "temp",
      status: "active",
      session_id: $session_id,
      ai_agent_context_id: $context_id
    }')
  request POST "$BASE_URL/ai_agent_conversations/$CONVERSATION_ID/delete" "$payload"

  if ! is_2xx; then
    record_check FAIL "POST /ai_agent_conversations/{id}/delete" \
      "http=${LAST_HTTP_CODE:-000} id=$(id_summary "$CONVERSATION_ID") api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return 1
  fi

  if [ "$(response_body_bytes)" -eq 0 ]; then
    record_check PASS "POST /ai_agent_conversations/{id}/delete" \
      "http=$LAST_HTTP_CODE $(response_transport_summary) result_success=true return_contract=empty_simple"
  else
    if ! valid_json; then
      record_check FAIL "POST /ai_agent_conversations/{id}/delete" \
        "http=$LAST_HTTP_CODE json_valid=false id=$(id_summary "$CONVERSATION_ID")"
      return 1
    fi

    result_ok=$(jq -r '
      if type == "boolean" then (. == true)
      elif type == "number" then true
      elif type == "string" then
        ((ascii_downcase == "true") or (. == "1") or (. == "0") or (ascii_downcase == "success"))
      elif type == "object" and (.success? != null) then
        ((.success == true) or (.success == 1) or (.success == "true"))
      elif type == "object" and (.data | type) == "object" and (.data.success? != null) then
        ((.data.success == true) or (.data.success == 1) or (.data.success == "true"))
      else false
      end
    ' "$LAST_RESPONSE_FILE" 2>/dev/null || true)

    if [ "$result_ok" != "true" ]; then
      record_check FAIL "POST /ai_agent_conversations/{id}/delete" \
        "http=$LAST_HTTP_CODE json_valid=true id=$(id_summary "$CONVERSATION_ID") result_success=false"
      return 1
    fi

    record_check PASS "POST /ai_agent_conversations/{id}/delete" \
      "http=$LAST_HTTP_CODE json_valid=true id=$(id_summary "$CONVERSATION_ID") result_success=true"
  fi

  request GET "$BASE_URL/ai_agent_conversations/$CONVERSATION_ID"
  if ! is_2xx; then
    record_check FAIL "GET conversation after business delete" \
      "http=${LAST_HTTP_CODE:-000} id=$(id_summary "$CONVERSATION_ID") api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return 1
  fi

  if ! valid_json; then
    record_check FAIL "GET conversation after business delete" \
      "http=$LAST_HTTP_CODE json_valid=false id=$(id_summary "$CONVERSATION_ID")"
    return 1
  fi

  status=$(jq -r '.status // empty' "$LAST_RESPONSE_FILE" 2>/dev/null || true)
  case "$status" in
    ended|archived)
      record_check PASS "GET conversation after business delete" \
        "http=$LAST_HTTP_CODE id=$(id_summary "$CONVERSATION_ID") status=$status"
      CONVERSATION_BUSINESS_DELETED=1
      ;;
    *)
      record_check FAIL "GET conversation after business delete" \
        "http=$LAST_HTTP_CODE id=$(id_summary "$CONVERSATION_ID") status=${status:-missing}"
      return 1
      ;;
  esac
}

delete_resource() {
  local label=$1
  local url=$2

  request DELETE "$url"
  if ! is_2xx; then
    record_check FAIL "DELETE $label" \
      "http=${LAST_HTTP_CODE:-000} api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return 1
  fi

  record_check PASS "DELETE $label" "http=$LAST_HTTP_CODE"
  return 0
}

repeat_delete_resource() {
  local label=$1
  local url=$2

  request DELETE "$url"
  if is_2xx; then
    record_check PASS "DELETE $label" \
      "http=$LAST_HTTP_CODE $(response_transport_summary) repeat_delete=true"
    return 0
  fi

  if [ "${LAST_HTTP_CODE:-000}" = "404" ]; then
    record_check PASS "DELETE $label" "http=404 already_absent=true repeat_delete=true"
    return 0
  fi

  if [ "${LAST_HTTP_CODE:-000}" = "500" ] &&
    valid_json &&
    jq -e '(.code? == 3) and ((.message? | type) == "string")' \
      "$LAST_RESPONSE_FILE" >/dev/null 2>&1; then
    record_check PASS "DELETE $label" \
      "http=500 api_code=3 already_absent=true repeat_delete=true"
    return 0
  fi

  record_check FAIL "DELETE $label" \
    "http=${LAST_HTTP_CODE:-000} repeat_delete=false api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
  return 1
}

verify_absent() {
  local label=$1
  local url=$2

  request GET "$url"
  case "${LAST_HTTP_CODE:-000}" in
    404)
      record_check PASS "GET $label" "http=404 absent=true"
      return 0
      ;;
    500)
      if valid_json && jq -e '(.code? == 3) and ((.message? | type) == "string")' \
        "$LAST_RESPONSE_FILE" >/dev/null 2>&1; then
        record_check PASS "GET $label" "http=500 api_code=3 absent=true"
        return 0
      fi
      ;;
    2??)
      record_check FAIL "GET $label" "http=$LAST_HTTP_CODE absent=false"
      return 1
      ;;
    *)
      record_check FAIL "GET $label" \
        "http=${LAST_HTTP_CODE:-000} api_error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
      return 1
      ;;
  esac
}

finish() {
  cleanup
  record "checks=$CHECK_COUNT pass=$PASS_COUNT skip=$SKIP_COUNT"
  if [ "$FAILED" -eq 0 ]; then
    record "RESULT PASS"
  else
    record "RESULT FAIL"
  fi
  exit "$FAILED"
}

record "AIBiz Harness API write smoke"
record "timestamp=$(date '+%F %T %z')"
record "report_dir=$REPORT_DIR"
record "base_url=$BASE_URL"
record "write_confirmation=$([ "$AIBIZ_WRITE_SMOKE_CONFIRM" = yes ] && printf enabled || printf disabled)"

check_dependencies

if [ "$AIBIZ_WRITE_SMOKE_CONFIRM" != "yes" ]; then
  record_check SKIP "write-smoke" \
    "disabled;set AIBIZ_WRITE_SMOKE_CONFIRM=yes to enable temporary writes"
  finish
fi

if [ "$HAS_CURL" -ne 1 ] || [ "$HAS_JQ" -ne 1 ]; then
  record_check SKIP "write-smoke" "dependency_check_failed"
  finish
fi

login_payload=$(jq -cn --arg loginname "$AIBIZ_LOGINNAME" --arg password "$AIBIZ_PASSWORD" \
  '{loginname: $loginname, password: $password}')
request POST "$BASE_URL/v7/login" "$login_payload"

if ! is_2xx; then
  record_check FAIL "POST /v7/login" \
    "http=${LAST_HTTP_CODE:-000} error=$(curl_error_summary "$LAST_ERROR_FILE")"
  finish
fi

if ! valid_json; then
  record_check FAIL "POST /v7/login" \
    "http=$LAST_HTTP_CODE json_valid=false"
  finish
fi

if token=$(jq -er \
  '(.token // .access_token // .data.token // .data.access_token) | strings | select(length > 0)' \
  "$LAST_RESPONSE_FILE" 2>/dev/null); then
  AUTH_HEADER="Authorization: Bearer $token"
  record_check PASS "POST /v7/login" "http=$LAST_HTTP_CODE token_present=true"
else
  record_check FAIL "POST /v7/login" "http=$LAST_HTTP_CODE token_present=false"
  finish
fi

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
    description: "temporary Harness API write smoke context",
    is_default: 0,
    active: 1,
    flow_mode: "DE",
    enable_tools: 0,
    stream: 1
  }')

if create_resource "/ai_agent_contexts" POST "$BASE_URL/ai_agent_contexts" \
  "$context_payload" "$context_candidate"; then
  CONTEXT_ID=$CREATED_ID
  CONTEXT_CREATED=1
else
  if [ -n "$CREATED_ID" ]; then
    CONTEXT_ID=$CREATED_ID
    CONTEXT_CREATED=1
  fi
  finish
fi

if ! get_resource "/ai_agent_contexts/{id}" \
  "$BASE_URL/ai_agent_contexts/$CONTEXT_ID" "$CONTEXT_ID"; then
  finish
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

if create_resource "/ai_agent_sessions" POST "$BASE_URL/ai_agent_sessions" \
  "$session_payload" "$session_candidate"; then
  SESSION_ID=$CREATED_ID
  SESSION_CREATED=1
else
  if [ -n "$CREATED_ID" ]; then
    SESSION_ID=$CREATED_ID
    SESSION_CREATED=1
  fi
  finish
fi

if ! fetch_session_dataset \
  "/ai_agent_sessions/fetch_default" \
  "$BASE_URL/ai_agent_sessions/fetch_default" \
  "$SESSION_ID" "$CONTEXT_ID"; then
  finish
fi

if ! fetch_session_dataset \
  "/ai_agent_contexts/{context_id}/ai_agent_sessions/fetch_default" \
  "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions/fetch_default" \
  "$SESSION_ID" "$CONTEXT_ID"; then
  finish
fi

nested_session_candidate=$(new_id)
NESTED_SESSION_ID=$nested_session_candidate
nested_session_payload=$(jq -cn \
  --arg id "$nested_session_candidate" \
  --arg name "$SMOKE_NAME-nested" \
  --arg context_id "$CONTEXT_ID" \
  --arg context_code_name "$SMOKE_CODE_NAME" \
  '{
    id: $id,
    name: $name,
    context_id: $context_id,
    context_code_name: $context_code_name
  }')

if create_resource "/ai_agent_contexts/{context_id}/ai_agent_sessions" \
  POST "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions" \
  "$nested_session_payload" "$nested_session_candidate"; then
  NESTED_SESSION_ID=$CREATED_ID
  NESTED_SESSION_CREATED=1
else
  if [ -n "$CREATED_ID" ]; then
    NESTED_SESSION_ID=$CREATED_ID
    NESTED_SESSION_CREATED=1
  fi
  finish
fi

if ! get_runtime_session \
  "/ai_agent_contexts/{context_id}/ai_agent_sessions/{id}" \
  "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions/$NESTED_SESSION_ID" \
  "$NESTED_SESSION_ID"; then
  finish
fi

if ! delete_resource "nested session" \
  "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions/$NESTED_SESSION_ID"; then
  finish
fi
NESTED_SESSION_STANDARD_DELETED=1

if ! get_runtime_session \
  "nested session after delete" \
  "$BASE_URL/ai_agent_contexts/$CONTEXT_ID/ai_agent_sessions/$NESTED_SESSION_ID" \
  "$NESTED_SESSION_ID"; then
  finish
fi

conversation_candidate=$(new_id)
CONVERSATION_ID=$conversation_candidate
conversation_payload=$(jq -cn \
  --arg id "$conversation_candidate" \
  --arg title "$SMOKE_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg context_id "$CONTEXT_ID" \
  --arg user_id "$AIBIZ_USER_ID" \
  '{
    id: $id,
    name: $title,
    title: $title,
    type: "temp",
    status: "active",
    is_top: 0,
    sequence: 1,
    session_id: $session_id,
    user_id: $user_id,
    ai_agent_context_id: $context_id
  }')

if create_resource "/ai_agent_conversations" POST "$BASE_URL/ai_agent_conversations" \
  "$conversation_payload" "$conversation_candidate"; then
  CONVERSATION_ID=$CREATED_ID
  CONVERSATION_CREATED=1
else
  if [ -n "$CREATED_ID" ]; then
    CONVERSATION_ID=$CREATED_ID
    CONVERSATION_CREATED=1
  fi
  finish
fi

if ! get_resource "/ai_agent_conversations/{id}" \
  "$BASE_URL/ai_agent_conversations/$CONVERSATION_ID" "$CONVERSATION_ID"; then
  finish
fi

run_candidate=$(new_id)
RUN_ID=$run_candidate
run_idempotency_key="$SMOKE_CODE_NAME:run:create"
trace_id="$SMOKE_CODE_NAME:trace"
run_payload=$(jq -cn \
  --arg id "$run_candidate" \
  --arg name "$SMOKE_NAME" \
  --arg status "queued" \
  --arg run_type "chat" \
  --arg tenant_id "$AIBIZ_ORG_ID" \
  --arg user_id "$AIBIZ_USER_ID" \
  --arg agent_id "$SMOKE_CODE_NAME-agent" \
  --arg model_id "$SMOKE_CODE_NAME-model" \
  --arg context_id "$CONTEXT_ID" \
  --arg conversation_id "$CONVERSATION_ID" \
  --arg session_id "$SESSION_ID" \
  --arg idempotency_key "$run_idempotency_key" \
  --arg trace_id "$trace_id" \
  '{
    id: $id,
    name: $name,
    status: $status,
    run_type: $run_type,
    tenant_id: $tenant_id,
    user_id: $user_id,
    agent_id: $agent_id,
    model_id: $model_id,
    context_id: $context_id,
    conversation_id: $conversation_id,
    session_id: $session_id,
    idempotency_key: $idempotency_key,
    trace_id: $trace_id,
    request_json: ({
      message_count: 1,
      content_type: "text",
      source: "api-write-smoke"
    } | tojson),
    budget_json: ({
      max_steps: 20,
      max_tool_calls: 8,
      max_total_tokens: 12000
    } | tojson),
    last_event_sequence: 0
  }')

if create_resource "/ai_runs" POST "$BASE_URL/ai_runs" \
  "$run_payload" "$run_candidate"; then
  RUN_ID=$CREATED_ID
  RUN_CREATED=1
else
  if [ -n "$CREATED_ID" ]; then
    RUN_ID=$CREATED_ID
    RUN_CREATED=1
  fi
  finish
fi

if ! get_resource "/ai_runs/{id}" \
  "$BASE_URL/ai_runs/$RUN_ID" "$RUN_ID"; then
  finish
fi

run_duplicate_payload=$(jq -c --arg id "$(new_id)" '.id = $id' <<<"$run_payload")
if check_idempotent_duplicate \
  "/ai_runs duplicate idempotency" \
  "$BASE_URL/ai_runs" \
  "$run_duplicate_payload" \
  "$RUN_ID"; then
  if [ -n "$DUPLICATE_CREATED_ID" ]; then
    RUN_DUPLICATE_ID=$DUPLICATE_CREATED_ID
    RUN_DUPLICATE_CREATED=1
  fi
else
  if [ -n "$DUPLICATE_CREATED_ID" ]; then
    RUN_DUPLICATE_ID=$DUPLICATE_CREATED_ID
    RUN_DUPLICATE_CREATED=1
  fi
  finish
fi

step_candidate=$(new_id)
STEP_ID=$step_candidate
step_idempotency_key="$SMOKE_CODE_NAME:step:1:create"
step_payload=$(jq -cn \
  --arg id "$step_candidate" \
  --arg name "$SMOKE_NAME-step-1" \
  --arg run_id "$RUN_ID" \
  --arg step_kind "emit" \
  --arg status "queued" \
  --arg idempotency_key "$step_idempotency_key" \
  '{
    id: $id,
    name: $name,
    run_id: $run_id,
    sequence: 1,
    attempt: 0,
    step_kind: $step_kind,
    status: $status,
    input_json: ({
      source: "api-write-smoke",
      message_count: 1
    } | tojson),
    idempotency_key: $idempotency_key,
    retry_count: 0,
    last_event_sequence: 0
  }')

if create_resource "/ai_run_steps" POST "$BASE_URL/ai_run_steps" \
  "$step_payload" "$step_candidate"; then
  STEP_ID=$CREATED_ID
  STEP_CREATED=1
else
  if [ -n "$CREATED_ID" ]; then
    STEP_ID=$CREATED_ID
    STEP_CREATED=1
  fi
  finish
fi

if ! get_resource "/ai_run_steps/{id}" \
  "$BASE_URL/ai_run_steps/$STEP_ID" "$STEP_ID"; then
  finish
fi

step_duplicate_payload=$(jq -c --arg id "$(new_id)" '.id = $id' <<<"$step_payload")
if check_idempotent_duplicate \
  "/ai_run_steps duplicate idempotency" \
  "$BASE_URL/ai_run_steps" \
  "$step_duplicate_payload" \
  "$STEP_ID"; then
  if [ -n "$DUPLICATE_CREATED_ID" ]; then
    STEP_DUPLICATE_ID=$DUPLICATE_CREATED_ID
    STEP_DUPLICATE_CREATED=1
  fi
else
  if [ -n "$DUPLICATE_CREATED_ID" ]; then
    STEP_DUPLICATE_ID=$DUPLICATE_CREATED_ID
    STEP_DUPLICATE_CREATED=1
  fi
  finish
fi

event_occurred_at=$(date -u "+%Y-%m-%d %H:%M:%S")
event_candidate=$(new_id)
EVENT_ID=$event_candidate
event_idempotency_key="$RUN_ID:step:$STEP_ID:manual-started"
event_payload=$(jq -cn \
  --arg id "$event_candidate" \
  --arg name "$SMOKE_NAME-event-1" \
  --arg run_id "$RUN_ID" \
  --arg step_id "$STEP_ID" \
  --arg event_type "step.started" \
  --arg idempotency_key "$event_idempotency_key" \
  --arg actor_type "system" \
  --arg actor_id "$AIBIZ_USER_ID" \
  --arg trace_id "$trace_id" \
  --arg occurred_at "$event_occurred_at" \
  '{
    id: $id,
    name: $name,
    run_id: $run_id,
    step_id: $step_id,
    sequence: 1,
    event_type: $event_type,
    aggregate_version: 1,
    idempotency_key: $idempotency_key,
    actor_type: $actor_type,
    actor_id: $actor_id,
    trace_id: $trace_id,
    occurred_at: $occurred_at,
    payload_json: ({
      schema_version: 1,
      event_type: $event_type,
      run_id: $run_id,
      step_id: $step_id,
      sequence: 1,
      aggregate_version: 1,
      idempotency_key: $idempotency_key,
      trace_id: $trace_id,
      occurred_at: $occurred_at,
      actor: {
        type: $actor_type,
        id: $actor_id
      },
      payload: {
        step_kind: "emit",
        status: "running"
      }
    } | tojson)
  }')

if create_resource "/ai_run_events" POST "$BASE_URL/ai_run_events" \
  "$event_payload" "$event_candidate"; then
  EVENT_ID=$CREATED_ID
  EVENT_CREATED=1
else
  if [ -n "$CREATED_ID" ]; then
    EVENT_ID=$CREATED_ID
    EVENT_CREATED=1
  fi
  finish
fi

if ! get_resource "/ai_run_events/{id}" \
  "$BASE_URL/ai_run_events/$EVENT_ID" "$EVENT_ID"; then
  finish
fi

event_second_candidate=$(new_id)
EVENT_SECOND_ID=$event_second_candidate
event_second_idempotency_key="$RUN_ID:step:$STEP_ID:manual-completed"
event_second_payload=$(jq -cn \
  --arg id "$event_second_candidate" \
  --arg name "$SMOKE_NAME-event-2" \
  --arg run_id "$RUN_ID" \
  --arg step_id "$STEP_ID" \
  --arg event_type "step.completed" \
  --arg idempotency_key "$event_second_idempotency_key" \
  --arg actor_type "system" \
  --arg actor_id "$AIBIZ_USER_ID" \
  --arg trace_id "$trace_id" \
  --arg occurred_at "$event_occurred_at" \
  '{
    id: $id,
    name: $name,
    run_id: $run_id,
    step_id: $step_id,
    sequence: 2,
    event_type: $event_type,
    aggregate_version: 2,
    idempotency_key: $idempotency_key,
    actor_type: $actor_type,
    actor_id: $actor_id,
    trace_id: $trace_id,
    occurred_at: $occurred_at,
    payload_json: ({
      schema_version: 1,
      event_type: $event_type,
      run_id: $run_id,
      step_id: $step_id,
      sequence: 2,
      aggregate_version: 2,
      idempotency_key: $idempotency_key,
      trace_id: $trace_id,
      occurred_at: $occurred_at,
      actor: {
        type: $actor_type,
        id: $actor_id
      },
      payload: {
        step_kind: "emit",
        status: "completed"
      }
    } | tojson)
  }')

if create_resource "/ai_run_events second" POST "$BASE_URL/ai_run_events" \
  "$event_second_payload" "$event_second_candidate"; then
  EVENT_SECOND_ID=$CREATED_ID
  EVENT_SECOND_CREATED=1
else
  if [ -n "$CREATED_ID" ]; then
    EVENT_SECOND_ID=$CREATED_ID
    EVENT_SECOND_CREATED=1
  fi
  finish
fi

if ! get_resource "/ai_run_events/{id} second" \
  "$BASE_URL/ai_run_events/$EVENT_SECOND_ID" "$EVENT_SECOND_ID"; then
  finish
fi

event_duplicate_payload=$(jq -c --arg id "$(new_id)" '.id = $id' <<<"$event_payload")
if check_idempotent_duplicate \
  "/ai_run_events duplicate idempotency" \
  "$BASE_URL/ai_run_events" \
  "$event_duplicate_payload" \
  "$EVENT_ID"; then
  if [ -n "$DUPLICATE_CREATED_ID" ]; then
    EVENT_DUPLICATE_ID=$DUPLICATE_CREATED_ID
    EVENT_DUPLICATE_CREATED=1
  fi
else
  if [ -n "$DUPLICATE_CREATED_ID" ]; then
    EVENT_DUPLICATE_ID=$DUPLICATE_CREATED_ID
    EVENT_DUPLICATE_CREATED=1
  fi
  finish
fi

if ! fetch_run_events "/ai_run_events/fetch_default by run" "$RUN_ID"; then
  finish
fi

message_candidate=$(new_id)
MESSAGE_ID=$message_candidate
message_payload=$(jq -cn \
  --arg id "$message_candidate" \
  --arg conversation_id "$CONVERSATION_ID" \
  --arg conversation_title "$SMOKE_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg user_id "$AIBIZ_USER_ID" \
  '{
    id: $id,
    content: "temporary Harness API write smoke message",
    content_type: "text",
    sender_type: "user",
    status: "sent",
    sequence: 1,
    conversation_id: $conversation_id,
    conversation_title: $conversation_title,
    session_id: $session_id,
    user_id: $user_id
  }')

if create_resource "/ai_agent_messages" POST "$BASE_URL/ai_agent_messages" \
  "$message_payload" "$message_candidate"; then
  MESSAGE_ID=$CREATED_ID
  MESSAGE_CREATED=1
else
  if [ -n "$CREATED_ID" ]; then
    MESSAGE_ID=$CREATED_ID
    MESSAGE_CREATED=1
  fi
  finish
fi

if ! get_resource "/ai_agent_messages/{id}" \
  "$BASE_URL/ai_agent_messages/$MESSAGE_ID" "$MESSAGE_ID"; then
  finish
fi

if ! fetch_messages_for_conversation \
  "/ai_agent_messages/fetch_all" "$CONVERSATION_ID"; then
  finish
fi

if ! business_delete_conversation; then
  finish
fi

if delete_resource "conversation" \
  "$BASE_URL/ai_agent_conversations/$CONVERSATION_ID"; then
  CONVERSATION_STANDARD_DELETED=1
else
  finish
fi

if ! repeat_delete_resource "conversation repeat" \
  "$BASE_URL/ai_agent_conversations/$CONVERSATION_ID"; then
  finish
fi

finish
