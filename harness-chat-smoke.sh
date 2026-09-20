#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TIMESTAMP=$(date "+%Y%m%d-%H%M%S")
REPORT_DIR=${AIBIZ_REPORT_DIR:-"$ROOT_DIR/.artifacts/harness-chat-smoke/$TIMESTAMP"}
SUMMARY_FILE="$REPORT_DIR/summary.txt"
CHECKS_FILE="$REPORT_DIR/checks.jsonl"
LOG_DIR="$REPORT_DIR/logs"

BASE_URL=${AIBIZ_BASE_URL:-"http://127.0.0.1:32003/api/ibizplm__plmweb"}
BASE_URL=${BASE_URL%/}
CHAT_ENTITY=${AIBIZ_CHAT_ENTITY:-ideas}
CHAT_PATH_PREFIX=${AIBIZ_CHAT_PATH_PREFIX:-}
CHAT_TAG=${AIBIZ_CHAT_TAG:-TextAgent_Writing}
AIBIZ_LOGINNAME=${AIBIZ_LOGINNAME:-aibizhi}
AIBIZ_PASSWORD=${AIBIZ_PASSWORD:-123456}
AIBIZ_SYSTEM_ID=${AIBIZ_SYSTEM_ID:-ibizplm}
AIBIZ_ORG_ID=${AIBIZ_ORG_ID:-000000}
AIBIZ_REQUEST_TIMEOUT=${AIBIZ_REQUEST_TIMEOUT:-30}
AIBIZ_CHAT_SSE_TIMEOUT=${AIBIZ_CHAT_SSE_TIMEOUT:-20}
AIBIZ_MESSAGE_SETTLE_SECONDS=${AIBIZ_MESSAGE_SETTLE_SECONDS:-1}

CHAT_BASE_PATH="$BASE_URL${CHAT_PATH_PREFIX%/}/$CHAT_ENTITY"
CHAT_SSE_URL="$CHAT_BASE_PATH/ssechatcompletion?srfactag=AIChat"
CHAT_HISTORY_URL="$CHAT_BASE_PATH/ssechatcompletion/histories?srfactag=AIChat"
CHAT_CANCEL_URL="$CHAT_BASE_PATH/ssechatcompletion/cancel?srfactag=AIChat"

FACTORY_FILE="$ROOT_DIR/plm/model/PSMODULES/ai/PSSYSAIFACTORIES/iBizPLMIntelligence.json"
CHAT_ENTITY_FILE="$ROOT_DIR/plm/model/PSSYSAPPS/plmweb/PSAPPDATAENTITIES/idea.json"

FAILED=0
CHECK_COUNT=0
PASS_COUNT=0
SKIP_COUNT=0
AUTH_HEADER=
HAS_CURL=0
HAS_JQ=0
TEMP_FILE=
TEMP_FILES=()
LAST_RESPONSE_FILE=
LAST_HEADER_FILE=
LAST_ERROR_FILE=
LAST_HTTP_CODE=

AGENT_COUNT=
MODEL_COUNT=
TOOL_COUNT=
MESSAGE_COUNT_BEFORE=
MESSAGE_COUNT_AFTER=
SSE_STATE_SEQUENCE=
SSE_EVENT_COUNT=0
SSE_FINAL_STATE=
SSE_HAS_ASYNC_ACTION_ID=false
CHAT_EXECUTION_READY=0
CHAT_EXECUTION_SUCCEEDED=0
CHAT_SESSION_ID=

mkdir -p "$LOG_DIR"
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
  TEMP_FILE=$(mktemp "${TMPDIR:-/tmp}/aibiz-harness-chat.XXXXXX")
  TEMP_FILES+=("$TEMP_FILE")
}

cleanup() {
  local file
  for file in "${TEMP_FILES[@]}"; do
    rm -f "$file"
  done
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
      (if (.error? != null) then ("error=" + ((.error | text))) else empty end),
      (if (.path? != null) then ("path=" + ((.path | text))) else empty end)
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

response_bytes() {
  local response_file=$1
  wc -c <"$response_file" | tr -d ' '
}

response_shape() {
  local response_file=$1
  local bytes
  bytes=$(response_bytes "$response_file")

  if [ "$bytes" -eq 0 ]; then
    printf 'bytes=0 json_valid=false shape=empty_body'
    return
  fi

  if ! jq -e . "$response_file" >/dev/null 2>&1; then
    printf 'bytes=%s json_valid=false shape=invalid_json' "$bytes"
    return
  fi

  printf 'bytes=%s ' "$bytes"
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

response_record_count() {
  local response_file=$1
  local count

  count=$(jq -r '
    if type == "array" then length
    elif type == "object" and (.data | type) == "array" then (.data | length)
    elif type == "object" and (.items | type) == "array" then (.items | length)
    elif type == "object" and (.rows | type) == "array" then (.rows | length)
    else -1
    end
  ' "$response_file" 2>/dev/null || true)
  printf '%s' "${count:--1}"
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
  local response_file header_file error_file payload_file
  local code
  local -a curl_args

  LAST_RESPONSE_FILE=
  LAST_HEADER_FILE=
  LAST_ERROR_FILE=
  LAST_HTTP_CODE=

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

  LAST_RESPONSE_FILE=$response_file
  LAST_HEADER_FILE=$header_file
  LAST_ERROR_FILE=$error_file
  LAST_HTTP_CODE=${code:-000}
}

sse_request() {
  local url=$1
  local payload=$2
  local response_file header_file error_file payload_file
  local code
  local -a curl_args

  LAST_RESPONSE_FILE=
  LAST_HEADER_FILE=
  LAST_ERROR_FILE=
  LAST_HTTP_CODE=

  make_temp
  response_file=$TEMP_FILE
  make_temp
  header_file=$TEMP_FILE
  make_temp
  error_file=$TEMP_FILE
  make_temp
  payload_file=$TEMP_FILE
  printf '%s' "$payload" >"$payload_file"

  curl_args=(
    -sS
    -N
    -D "$header_file"
    -o "$response_file"
    -w '%{http_code}'
    --connect-timeout 3
    --max-time "$AIBIZ_CHAT_SSE_TIMEOUT"
    -H "srfsystemid: $AIBIZ_SYSTEM_ID"
    -H "srforgid: $AIBIZ_ORG_ID"
    -H 'Accept: text/event-stream'
    -H 'Content-Type: application/json'
    --data-binary "@$payload_file"
  )

  if [ -n "$AUTH_HEADER" ]; then
    curl_args+=(-H "$AUTH_HEADER")
  fi

  code=$(curl -X POST "${curl_args[@]}" "$url" \
    2>"$error_file" || true)

  LAST_RESPONSE_FILE=$response_file
  LAST_HEADER_FILE=$header_file
  LAST_ERROR_FILE=$error_file
  LAST_HTTP_CODE=${code:-000}
}

login() {
  local payload response token
  payload=$(jq -cn \
    --arg loginname "$AIBIZ_LOGINNAME" \
    --arg password "$AIBIZ_PASSWORD" \
    '{loginname: $loginname, password: $password}')

  request POST "$BASE_URL/v7/login" "$payload"
  response=$LAST_RESPONSE_FILE
  if ! [[ "$LAST_HTTP_CODE" =~ ^2[0-9][0-9]$ ]]; then
    record_check FAIL "POST /v7/login" \
      "http=${LAST_HTTP_CODE:-000} error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return
  fi

  if token=$(jq -er \
    '(.token // .access_token // .data.token // .data.access_token) | strings | select(length > 0)' \
    "$response" 2>/dev/null); then
    AUTH_HEADER="Authorization: Bearer $token"
    record_check PASS "POST /v7/login" "http=$LAST_HTTP_CODE token_present=true"
  else
    record_check FAIL "POST /v7/login" "http=$LAST_HTTP_CODE token_present=false"
  fi
}

check_static_contract() {
  local factory_agent chat_mode

  if [ ! -f "$FACTORY_FILE" ]; then
    record_check FAIL "static:ai_factory" "missing_file=$(basename "$FACTORY_FILE")"
  elif factory_agent=$(jq -r \
    'any(.getAllPSSysAIChatAgents[]?; .codeName == "DynamicAgent")' \
    "$FACTORY_FILE" 2>/dev/null) && [ "$factory_agent" = "true" ]; then
    record_check PASS "static:ai_factory" "dynamic_agent=present"
  else
    record_check FAIL "static:ai_factory" "dynamic_agent=missing"
  fi

  if [ ! -f "$CHAT_ENTITY_FILE" ]; then
    record_check FAIL "static:chat_entity" "missing_file=$(basename "$CHAT_ENTITY_FILE")"
  elif chat_mode=$(jq -r \
    --arg chat_tag "$CHAT_TAG" \
    'any(.getAllPSAppDEACModes[]?;
      .codeName == "AIChat" and
      .aCType == "CHATCOMPLETION" and
      .aCTag == $chat_tag)' \
    "$CHAT_ENTITY_FILE" 2>/dev/null) && [ "$chat_mode" = "true" ]; then
    record_check PASS "static:chat_entity" \
      "entity=$CHAT_ENTITY mode=AIChat type=CHATCOMPLETION tag=$CHAT_TAG"
  else
    record_check FAIL "static:chat_entity" \
      "entity=$CHAT_ENTITY mode=AIChat type_or_tag_mismatch"
  fi
}

check_dataset() {
  local label=$1
  local endpoint=$2
  local payload=$3
  local shape total count

  request POST "$BASE_URL/$endpoint" "$payload"
  if ! [[ "$LAST_HTTP_CODE" =~ ^2[0-9][0-9]$ ]]; then
    record_check FAIL "POST /$endpoint" \
      "http=${LAST_HTTP_CODE:-000} error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return
  fi

  if ! jq -e . "$LAST_RESPONSE_FILE" >/dev/null 2>&1; then
    record_check FAIL "POST /$endpoint" \
      "http=$LAST_HTTP_CODE json_valid=false bytes=$(response_bytes "$LAST_RESPONSE_FILE")"
    return
  fi

  shape=$(response_shape "$LAST_RESPONSE_FILE")
  total=$(header_value "$LAST_HEADER_FILE" "x-total")
  count=$(response_record_count "$LAST_RESPONSE_FILE")
  if [ -n "$total" ] && [[ "$total" =~ ^[0-9]+$ ]]; then
    count=$total
  fi

  case "$label" in
    agent) AGENT_COUNT=$count ;;
    model) MODEL_COUNT=$count ;;
    tool) TOOL_COUNT=$count ;;
  esac

  record_check PASS "POST /$endpoint" \
    "http=$LAST_HTTP_CODE records=$count x_total=${total:-unknown} shape=$shape"
}

chat_payload() {
  local session_id=$1
  jq -cn \
    --arg sessionid "$session_id" \
    --arg agent "$CHAT_TAG" \
    '{
      messages: [
        {role: "user", content: "Harness chat smoke probe"}
      ],
      sessionid: $sessionid,
      srfaiagent: $agent,
      mode: "",
      srfscope: "",
      knowledgebases: "",
      mcpservers: "",
      srfextparams: {}
    }'
}

check_chat_request_contract() {
  local payload

  payload=$(chat_payload "harness-contract-probe")
  if jq -e '
    type == "object" and
    (.messages | type) == "array" and
    (.sessionid | type) == "string" and
    (.srfaiagent | type) == "string" and
    (.knowledgebases | type) == "string" and
    (.mcpservers | type) == "string" and
    (.srfextparams | type) == "object"
  ' <<<"$payload" >/dev/null 2>&1; then
    record_check PASS "chat:request_contract" \
      "query=srfactag=AIChat body_fields=messages,sessionid,srfaiagent,mode,srfscope,knowledgebases,mcpservers,srfextparams"
  else
    record_check FAIL "chat:request_contract" "payload_shape=invalid"
  fi
}

parse_sse() {
  local response_file=$1
  local data_file

  make_temp
  data_file=$TEMP_FILE
  awk '/^data:/{sub(/^data:[[:space:]]*/, ""); print}' "$response_file" >"$data_file"
  SSE_EVENT_COUNT=$(awk 'NF {count++} END {print count+0}' "$data_file")

  if [ "$SSE_EVENT_COUNT" -eq 0 ]; then
    SSE_STATE_SEQUENCE=
    SSE_FINAL_STATE=
    SSE_HAS_ASYNC_ACTION_ID=false
    return
  fi

  SSE_STATE_SEQUENCE=$(jq -Rsrc '
    split("\n")
    | map(select(length > 0) | try fromjson catch {})
    | map((.actionstate // .state // .status // "unknown") | tostring)
    | join(",")
  ' "$data_file" 2>/dev/null || true)
  SSE_FINAL_STATE=$(printf '%s' "$SSE_STATE_SEQUENCE" | awk -F, '{print $NF}')
  SSE_HAS_ASYNC_ACTION_ID=$(jq -Rsc '
    split("\n")
    | map(select(length > 0) | try fromjson catch {})
    | any(.[]; has("asyncacitonid") or has("asyncactionid"))
  ' "$data_file" 2>/dev/null || printf 'false')
}

check_chat_history() {
  local payload shape
  payload=$(chat_payload "harness-history-probe")

  request POST "$CHAT_HISTORY_URL" "$payload"
  if ! [[ "$LAST_HTTP_CODE" =~ ^2[0-9][0-9]$ ]]; then
    record_check FAIL "POST /$CHAT_ENTITY/ssechatcompletion/histories" \
      "http=${LAST_HTTP_CODE:-000} error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return
  fi

  if ! jq -e . "$LAST_RESPONSE_FILE" >/dev/null 2>&1; then
    record_check FAIL "POST /$CHAT_ENTITY/ssechatcompletion/histories" \
      "http=$LAST_HTTP_CODE json_valid=false bytes=$(response_bytes "$LAST_RESPONSE_FILE")"
    return
  fi

  shape=$(response_shape "$LAST_RESPONSE_FILE")
  record_check PASS "POST /$CHAT_ENTITY/ssechatcompletion/histories" \
    "http=$LAST_HTTP_CODE shape=$shape"
}

query_message_count() {
  local session_id=$1
  local payload count total

  payload=$(jq -cn \
    --arg sessionid "$session_id" \
    '{page: 0, size: 100, n_session_id_eq: $sessionid}')
  request POST "$BASE_URL/ai_agent_messages/fetch_default" "$payload"

  if ! [[ "$LAST_HTTP_CODE" =~ ^2[0-9][0-9]$ ]] ||
    ! jq -e . "$LAST_RESPONSE_FILE" >/dev/null 2>&1; then
    printf '%s' "-1"
    return
  fi

  total=$(header_value "$LAST_HEADER_FILE" "x-total")
  count=$(response_record_count "$LAST_RESPONSE_FILE")
  if [ -n "$total" ] && [[ "$total" =~ ^[0-9]+$ ]]; then
    count=$total
  fi
  printf '%s' "$count"
}

wait_for_message_settle() {
  case "$AIBIZ_MESSAGE_SETTLE_SECONDS" in
    ''|0) ;;
    *[!0-9]*) ;;
    *) sleep "$AIBIZ_MESSAGE_SETTLE_SECONDS" ;;
  esac
}

check_chat_sse() {
  local payload

  CHAT_SESSION_ID="harness-chat-$(date '+%Y%m%d%H%M%S')-$$"
  payload=$(chat_payload "$CHAT_SESSION_ID")

  if [ "${AGENT_COUNT:-0}" -gt 0 ] && [ "${MODEL_COUNT:-0}" -gt 0 ]; then
    CHAT_EXECUTION_READY=1
    MESSAGE_COUNT_BEFORE=$(query_message_count "$CHAT_SESSION_ID")
  else
    CHAT_EXECUTION_READY=0
  fi

  sse_request "$CHAT_SSE_URL" "$payload"
  parse_sse "$LAST_RESPONSE_FILE"

  if ! [[ "$LAST_HTTP_CODE" =~ ^2[0-9][0-9]$ ]]; then
    record_check FAIL "POST /$CHAT_ENTITY/ssechatcompletion" \
      "http=${LAST_HTTP_CODE:-000} sse_events=$SSE_EVENT_COUNT error=$(response_error_summary "$LAST_RESPONSE_FILE") curl_error=$(curl_error_summary "$LAST_ERROR_FILE")"
    return
  fi

  if [ "$SSE_EVENT_COUNT" -eq 0 ]; then
    record_check FAIL "POST /$CHAT_ENTITY/ssechatcompletion" \
      "http=$LAST_HTTP_CODE sse_events=0 stream_shape=empty"
    return
  fi

  record_check PASS "POST /$CHAT_ENTITY/ssechatcompletion" \
    "http=$LAST_HTTP_CODE sse_events=$SSE_EVENT_COUNT states=${SSE_STATE_SEQUENCE:-unknown} final=${SSE_FINAL_STATE:-unknown}"

  if [ "$SSE_HAS_ASYNC_ACTION_ID" = "true" ]; then
    record_check PASS "chat:sse_action_id" \
      "field=asyncacitonid compatibility=present"
  else
    record_check FAIL "chat:sse_action_id" \
      "field=asyncacitonid compatibility=missing"
  fi

  if [ "$CHAT_EXECUTION_READY" -eq 1 ]; then
    if [ "$SSE_FINAL_STATE" = "30" ]; then
      CHAT_EXECUTION_SUCCEEDED=1
      record_check PASS "chat:completion" \
        "agent_records=$AGENT_COUNT model_records=$MODEL_COUNT terminal_state=30"
    else
      record_check FAIL "chat:completion" \
        "agent_records=$AGENT_COUNT model_records=$MODEL_COUNT terminal_state=${SSE_FINAL_STATE:-unknown}"
    fi
  else
    record_check SKIP "chat:completion" \
      "agent_records=${AGENT_COUNT:-unknown} model_records=${MODEL_COUNT:-unknown} reason=agent_or_model_not_configured"
  fi
}

check_message_persistence() {
  local before after

  if [ "$CHAT_EXECUTION_SUCCEEDED" -ne 1 ]; then
    record_check SKIP "chat:message_persistence" \
      "reason=successful_chat_completion_not_available"
    return
  fi

  wait_for_message_settle
  after=$(query_message_count "$CHAT_SESSION_ID")
  MESSAGE_COUNT_AFTER=$after
  before=${MESSAGE_COUNT_BEFORE:--1}

  if [ "$before" -ge 0 ] && [ "$after" -gt "$before" ]; then
    record_check PASS "chat:message_persistence" \
      "session=temporary count_before=$before count_after=$after"
  elif [ "$after" -ge 1 ]; then
    record_check PASS "chat:message_persistence" \
      "session=temporary count_after=$after filter=n_session_id_eq"
  else
    record_check FAIL "chat:message_persistence" \
      "session=temporary count_before=$before count_after=$after"
  fi
}

check_chat_cancel() {
  local payload
  payload='{"asyncacitonid":"harness-cancel-probe"}'

  request POST "$CHAT_CANCEL_URL" "$payload"
  if [[ "$LAST_HTTP_CODE" =~ ^2[0-9][0-9]$ ]]; then
    record_check PASS "POST /$CHAT_ENTITY/ssechatcompletion/cancel" \
      "http=$LAST_HTTP_CODE field=asyncacitonid"
  else
    record_check FAIL "POST /$CHAT_ENTITY/ssechatcompletion/cancel" \
      "http=${LAST_HTTP_CODE:-000} expected=2xx error=$(response_error_summary "$LAST_RESPONSE_FILE")"
  fi
}

record "AIBiz Harness Chat smoke"
record "timestamp=$(date '+%F %T %z')"
record "report_dir=$REPORT_DIR"
record "base_url=$BASE_URL"
record "chat_route=$CHAT_BASE_PATH"
record "chat_tag=$CHAT_TAG"
record "database_check=api_only"

check_dependencies
check_static_contract
check_chat_request_contract

if [ "$HAS_CURL" -eq 1 ] && [ "$HAS_JQ" -eq 1 ]; then
  login
else
  record_check SKIP "POST /v7/login" "dependency_missing"
fi

if [ -n "$AUTH_HEADER" ]; then
  check_dataset agent "ai_agents/fetch_default" '{"page":0,"size":20}'
  check_dataset model "ai_models/fetch_default" '{"page":0,"size":20}'
  check_dataset tool "ai_tools/fetch_default" '{"page":0,"size":20}'
  check_chat_history
  check_chat_sse
  check_message_persistence
  check_chat_cancel
else
  for check in \
    "POST /ai_agents/fetch_default" \
    "POST /ai_models/fetch_default" \
    "POST /ai_tools/fetch_default" \
    "POST /$CHAT_ENTITY/ssechatcompletion/histories" \
    "POST /$CHAT_ENTITY/ssechatcompletion" \
    "chat:sse_action_id" \
    "chat:completion" \
    "chat:message_persistence" \
    "POST /$CHAT_ENTITY/ssechatcompletion/cancel"; do
    record_check SKIP "$check" "login_failed"
  done
fi

record "config_counts agent=${AGENT_COUNT:-unknown} model=${MODEL_COUNT:-unknown} tool=${TOOL_COUNT:-unknown}"
record "checks=$CHECK_COUNT pass=$PASS_COUNT skip=$SKIP_COUNT"
if [ "$FAILED" -eq 0 ] && [ "$SKIP_COUNT" -gt 0 ]; then
  record "RESULT PASS WITH SKIP"
elif [ "$FAILED" -eq 0 ]; then
  record "RESULT PASS"
else
  record "RESULT FAIL"
fi

exit "$FAILED"
