#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
# host: execute curl on the host. container: execute curl in another Docker
# container's network namespace while retaining host-side response validation.
AIBIZ_NETWORK_MODE=${AIBIZ_NETWORK_MODE:-host}
AIBIZ_NETWORK_CONTAINER=${AIBIZ_NETWORK_CONTAINER:-task}
TIMESTAMP=$(date "+%Y%m%d-%H%M%S")
REPORT_DIR=${AIBIZ_REPORT_DIR:-"$ROOT_DIR/.artifacts/harness-api-smoke/$TIMESTAMP"}
SUMMARY_FILE="$REPORT_DIR/summary.txt"
CHECKS_FILE="$REPORT_DIR/checks.jsonl"
LOG_DIR="$REPORT_DIR/logs"

BASE_URL=${AIBIZ_BASE_URL:-"http://127.0.0.1:32003/api/ibizplm__plmweb"}
BASE_URL=${BASE_URL%/}
MODELING_BASE_URL=${AIBIZ_MODELING_BASE_URL:-"http://127.0.0.1:32003/api/ibizmodeling__modeldesign"}
MODELING_BASE_URL=${MODELING_BASE_URL%/}
AIBIZ_LOGINNAME=${AIBIZ_LOGINNAME:-aibizhi}
AIBIZ_PASSWORD=${AIBIZ_PASSWORD:-123456}
AIBIZ_REQUEST_TIMEOUT=${AIBIZ_REQUEST_TIMEOUT:-30}
AIBIZ_DB_CHECK=${AIBIZ_DB_CHECK:-0}
AIBIZ_MYSQL_CONTAINER=${AIBIZ_MYSQL_CONTAINER:-mysql}
AIBIZ_MYSQL_DATABASE=${AIBIZ_MYSQL_DATABASE:-plm}
AIBIZ_MYSQL_USER=${AIBIZ_MYSQL_USER:-plm}
AIBIZ_MYSQL_PASSWORD=${AIBIZ_MYSQL_PASSWORD:-plm@2024}

FAILED=0
CHECK_COUNT=0
PASS_COUNT=0
SKIP_COUNT=0
TEMP_FILE=
TEMP_FILES=()
AUTH_HEADER=

case "$AIBIZ_NETWORK_MODE" in
  host)
    NETWORK_PREFIX=()
    ;;
  container)
    if ! command -v docker >/dev/null 2>&1; then
      printf 'AIBIZ_NETWORK_MODE=container requires docker\n' >&2
      exit 2
    fi
    if ! docker exec "$AIBIZ_NETWORK_CONTAINER" true >/dev/null 2>&1; then
      printf 'AIBIZ_NETWORK_CONTAINER unavailable: %s\n' \
        "$AIBIZ_NETWORK_CONTAINER" >&2
      exit 2
    fi
    if ! docker exec "$AIBIZ_NETWORK_CONTAINER" curl --version >/dev/null 2>&1; then
      printf 'curl unavailable in %s\n' "$AIBIZ_NETWORK_CONTAINER" >&2
      exit 2
    fi
    if ! docker exec "$AIBIZ_NETWORK_CONTAINER" sh -c \
      "mkdir -p /tmp/aibiz-harness-api && chmod 700 /tmp/aibiz-harness-api" \
      >/dev/null 2>&1; then
      printf 'Cannot prepare work directory in %s\n' \
        "$AIBIZ_NETWORK_CONTAINER" >&2
      exit 2
    fi
    NETWORK_PREFIX=(docker exec "$AIBIZ_NETWORK_CONTAINER")
    ;;
  *)
    printf 'Invalid AIBIZ_NETWORK_MODE: %s (expected host or container)\n' \
      "$AIBIZ_NETWORK_MODE" >&2
    exit 2
    ;;
esac

cleanup() {
  local file
  if [ "$AIBIZ_NETWORK_MODE" = container ]; then
    for file in "${TEMP_FILES[@]}"; do
      case "$file" in
        /tmp/aibiz-harness-api/*)
          docker exec "$AIBIZ_NETWORK_CONTAINER" rm -f "$file" >/dev/null 2>&1 || true
          ;;
        *)
          rm -f "$file"
          ;;
      esac
    done
  else
    for file in "${TEMP_FILES[@]}"; do
      rm -f "$file"
    done
  fi
}
trap cleanup EXIT

make_temp() {
  if [ "$AIBIZ_NETWORK_MODE" = container ]; then
    TEMP_FILE="/tmp/aibiz-harness-api/harness.$$.$RANDOM.tmp"
    if ! docker exec "$AIBIZ_NETWORK_CONTAINER" sh -c ": > '$TEMP_FILE'" \
      >/dev/null 2>&1; then
      printf 'Cannot create temporary file in %s\n' \
        "$AIBIZ_NETWORK_CONTAINER" >&2
      exit 2
    fi
  else
    if ! TEMP_FILE=$(mktemp "${TMPDIR:-/tmp}/aibiz-harness-api.XXXXXX"); then
      printf 'Cannot create host temporary file\n' >&2
      exit 2
    fi
  fi
  TEMP_FILES+=("$TEMP_FILE")
}

make_host_temp() {
  if ! TEMP_FILE=$(mktemp "${TMPDIR:-/tmp}/aibiz-harness-api.XXXXXX"); then
    printf 'Cannot create host temporary file\n' >&2
    exit 2
  fi
  TEMP_FILES+=("$TEMP_FILE")
}

pull_temp() {
  local name=$1 remote local_file
  if [ "$AIBIZ_NETWORK_MODE" != container ]; then return 0; fi
  remote=${!name}
  if ! local_file=$(mktemp "${TMPDIR:-/tmp}/aibiz-harness-api.XXXXXX"); then
    printf 'Cannot create host response copy\n' >&2
    return 1
  fi
  if ! docker cp "$AIBIZ_NETWORK_CONTAINER:$remote" "$local_file" >/dev/null 2>&1; then
    printf 'Failed to copy %s from %s\n' "$remote" "$AIBIZ_NETWORK_CONTAINER" >&2
    return 1
  fi
  TEMP_FILES+=("$local_file")
  printf -v "$name" '%s' "$local_file"
}

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
  jq -cn --arg status "$status" --arg check "$check" --arg detail "$detail" \
    '{status: $status, check: $check, detail: $detail}' >>"$CHECKS_FILE"
}

check_dependencies() {
  local command
  for command in curl jq; do
    if command -v "$command" >/dev/null 2>&1; then
      record_check PASS "dependency:$command" "available"
    else
      record_check FAIL "dependency:$command" "unavailable"
    fi
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

response_shape() {
  local response_file=$1
  jq -c '
    def records:
      if type == "array" then .
      elif type == "object" and (.data | type) == "array" then .data
      elif type == "object" and (.items | type) == "array" then .items
      elif type == "object" and (.rows | type) == "array" then .rows
      else []
      end;
    . as $root
    | ($root | records) as $records
    | {
        json_type: ($root | type),
        top_level_keys: (if ($root | type) == "object" then ($root | keys | sort) else [] end),
        record_count: ($records | length),
        id_field: (
          if ($records | length) == 0 then "not_applicable"
          elif all($records[]; (type == "object" and has("id"))) then "present"
          else "missing"
          end
        )
      }
  ' "$response_file" 2>/dev/null
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

login() {
  local response_file header_file error_file code token payload

  make_temp
  response_file=$TEMP_FILE
  make_temp
  header_file=$TEMP_FILE
  make_host_temp
  error_file=$TEMP_FILE

  payload=$(jq -cn --arg loginname "$AIBIZ_LOGINNAME" --arg password "$AIBIZ_PASSWORD" \
    '{loginname: $loginname, password: $password}')

  code=$("${NETWORK_PREFIX[@]}" curl -sS -D "$header_file" -o "$response_file" \
    -w '%{http_code}' \
    --connect-timeout 3 --max-time "$AIBIZ_REQUEST_TIMEOUT" \
    -H 'Content-Type: application/json' \
    --data-binary "$payload" \
    "$BASE_URL/v7/login" 2>"$error_file" || true)
  pull_temp response_file || return
  pull_temp header_file || return

  if ! [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
    record_check FAIL "POST /v7/login" \
      "http=${code:-000} error=$(curl_error_summary "$error_file")"
    return
  fi

  if token=$(jq -er \
    '(.token // .access_token // .data.token // .data.access_token) | strings | select(length > 0)' \
    "$response_file" 2>/dev/null); then
    AUTH_HEADER="Authorization: Bearer $token"
    record_check PASS "POST /v7/login" "http=$code token_present=true"
  else
    record_check FAIL "POST /v7/login" "http=$code token_present=false"
  fi
}

check_json_endpoint() {
  local method=$1
  local label=$2
  local url=$3
  local payload=${4:-}
  local response_file header_file error_file code shape total
  local -a curl_args

  make_temp
  response_file=$TEMP_FILE
  make_temp
  header_file=$TEMP_FILE
  make_host_temp
  error_file=$TEMP_FILE

  curl_args=(
    -sS
    -D "$header_file"
    -o "$response_file"
    -w '%{http_code}'
    --connect-timeout 3
    --max-time "$AIBIZ_REQUEST_TIMEOUT"
  )

  if [ -n "$AUTH_HEADER" ]; then
    curl_args+=(-H "$AUTH_HEADER")
  fi

  if [ "$method" = "POST" ]; then
    curl_args+=(-H 'Content-Type: application/json' --data-binary "$payload")
  fi

  code=$("${NETWORK_PREFIX[@]}" curl "${curl_args[@]}" "$url" \
    2>"$error_file" || true)
  pull_temp response_file || return
  pull_temp header_file || return
  if ! [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
    record_check FAIL "$method $label" \
      "http=${code:-000} error=$(curl_error_summary "$error_file")"
    return
  fi

  if ! jq -e . "$response_file" >/dev/null 2>&1; then
    record_check FAIL "$method $label" "http=$code json_valid=false"
    return
  fi

  shape=$(response_shape "$response_file")
  total=$(header_value "$header_file" "x-total")
  record_check PASS "$method $label" \
    "http=$code x_total=${total:-unknown} shape=$shape"
}

check_schema_endpoint() {
  local response_file header_file error_file code properties_count required_count
  local -a curl_args

  make_temp
  response_file=$TEMP_FILE
  make_temp
  header_file=$TEMP_FILE
  make_host_temp
  error_file=$TEMP_FILE

  curl_args=(
    -sS
    -D "$header_file"
    -o "$response_file"
    -w '%{http_code}'
    --connect-timeout 3
    --max-time "$AIBIZ_REQUEST_TIMEOUT"
  )
  if [ -n "$AUTH_HEADER" ]; then
    curl_args+=(-H "$AUTH_HEADER")
  fi

  code=$("${NETWORK_PREFIX[@]}" curl "${curl_args[@]}" \
    "$MODELING_BASE_URL/jsonschema/IDEA" 2>"$error_file" || true)
  pull_temp response_file || return
  pull_temp header_file || return
  if ! [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
    record_check FAIL "GET /jsonschema/IDEA" \
      "http=${code:-000} error=$(curl_error_summary "$error_file")"
    return
  fi

  if ! jq -e 'type == "object" and (.properties | type) == "object"' \
    "$response_file" >/dev/null 2>&1; then
    record_check FAIL "GET /jsonschema/IDEA" "http=$code schema_shape=invalid"
    return
  fi

  properties_count=$(jq -r '.properties | length' "$response_file")
  required_count=$(jq -r '(.required // []) | length' "$response_file")
  record_check PASS "GET /jsonschema/IDEA" \
    "http=$code properties=$properties_count required=$required_count"
}

check_modeldesign_fetchdefault() {
  local response_file header_file error_file code shape total
  local remote_response_file remote_header_file remote_error_file
  local attempt=0
  local transient_statuses=
  local payload='{"n_psdeid_eq":"Base.common_flow","n_dynamodelflag_eq":"1","page":0,"size":20}'
  local -a curl_args

  if [ -z "$AUTH_HEADER" ]; then
    record_check SKIP "POST /psdelogics/fetchdefault" "login_failed"
    return
  fi

  make_temp
  remote_response_file=$TEMP_FILE
  make_temp
  remote_header_file=$TEMP_FILE
  make_host_temp
  remote_error_file=$TEMP_FILE

  curl_args=(
    -sS
    -D "$remote_header_file"
    -o "$remote_response_file"
    -w '%{http_code}'
    --connect-timeout 3
    --max-time "$AIBIZ_REQUEST_TIMEOUT"
    -H "$AUTH_HEADER"
    -H 'Content-Type: application/json'
    --data-binary "$payload"
  )

  while [ "$attempt" -lt 6 ]; do
    attempt=$((attempt + 1))
    if [ "$AIBIZ_NETWORK_MODE" = container ]; then
      docker exec "$AIBIZ_NETWORK_CONTAINER" sh -c \
        ": > '$remote_response_file'; : > '$remote_header_file'"
      : >"$remote_error_file"
    else
      : >"$remote_response_file"
      : >"$remote_header_file"
      : >"$remote_error_file"
    fi
    code=$("${NETWORK_PREFIX[@]}" curl "${curl_args[@]}" \
      "$MODELING_BASE_URL/psdelogics/fetchdefault" \
      2>"$remote_error_file" || true)
    response_file=$remote_response_file
    header_file=$remote_header_file
    error_file=$remote_error_file
    pull_temp response_file || return
    pull_temp header_file || return

    if [[ "$code" =~ ^2[0-9][0-9]$ ]] &&
      jq -e 'type == "array"' "$response_file" >/dev/null 2>&1; then
      shape=$(response_shape "$response_file")
      total=$(header_value "$header_file" "x-total")
      record_check PASS "POST /psdelogics/fetchdefault" \
        "http=$code attempts=$attempt transient=${transient_statuses:-none} x_total=${total:-unknown} shape=$shape"
      return
    fi

    if [[ "$code" =~ ^5[0-9][0-9]$ ]] && [ "$attempt" -lt 6 ]; then
      transient_statuses="${transient_statuses:+$transient_statuses,}$code"
      response_file=$remote_response_file
      header_file=$remote_header_file
      error_file=$remote_error_file
      sleep 2
      continue
    fi

    record_check FAIL "POST /psdelogics/fetchdefault" \
      "http=${code:-000} attempts=$attempt transient=${transient_statuses:-none} error=$(curl_error_summary "$error_file")"
    return
  done
}

check_model_file() {
  local file_name=$1
  local expected_code=$2
  local expected_tag=$3
  local expected_datasets=$4
  local expected_fields=$5
  local path="$ROOT_DIR/plm/model/PSSYSAPPS/plmweb/PSAPPDATAENTITIES/$file_name"
  local missing_datasets missing_fields metadata
  local -a datasets fields

  if [ ! -f "$path" ]; then
    record_check FAIL "model:$file_name" "missing_file"
    return
  fi

  if ! jq -e . "$path" >/dev/null 2>&1; then
    record_check FAIL "model:$file_name" "json_valid=false"
    return
  fi

  metadata=$(jq -c --arg code "$expected_code" --arg tag "$expected_tag" '
    {
      codeName: .codeName,
      api_code: .dEAPICodeName,
      api_tag: .dEAPITag,
      key_field: .getKeyPSAppDEField.codeName,
      fields: (.getAllPSAppDEFields | length),
      actions: (.getAllPSAppDEActions | length),
      datasets: (.getAllPSAppDEDataSets | length),
      identity_match: (.codeName == $code and .dEAPICodeName == $code and .dEAPITag == $tag and .getKeyPSAppDEField.codeName == "id")
    }
  ' "$path")

  if ! jq -e '.identity_match == true' <<<"$metadata" >/dev/null 2>&1; then
    record_check FAIL "model:$file_name" "metadata_identity=$metadata"
    return
  fi

  missing_datasets=$(jq -r --arg expected "$expected_datasets" '
    . as $root
    | ($expected | split(",")) as $wanted
    | [$wanted[] as $name
       | select(any($root.getAllPSAppDEDataSets[]?; .codeName == $name) | not)
       | $name
      ] | join(",")
  ' "$path" 2>/dev/null)

  missing_fields=$(jq -r --arg expected "$expected_fields" '
    . as $root
    | ($expected | split(",")) as $wanted
    | [$wanted[] as $name
       | select(any($root.getAllPSAppDEFields[]?; .name == $name) | not)
       | $name
      ] | join(",")
  ' "$path" 2>/dev/null)

  if [ -n "$missing_datasets" ] || [ -n "$missing_fields" ]; then
    record_check FAIL "model:$file_name" \
      "missing_datasets=${missing_datasets:-none} missing_fields=${missing_fields:-none}"
    return
  fi

  record_check PASS "model:$file_name" \
    "code=$expected_code tag=$expected_tag fields=$(jq -r '.fields' <<<"$metadata") actions=$(jq -r '.actions' <<<"$metadata") datasets=$(jq -r '.datasets' <<<"$metadata")"
}

check_database_tables() {
  local table_output missing
  local expected_tables=(
    ai_agent
    ai_model
    ai_tool
    ai_agent_conversation
    ai_agent_message
    ai_run
    ai_run_step
    ai_run_event
  )

  if ! command -v docker >/dev/null 2>&1; then
    record_check SKIP "database:$AIBIZ_MYSQL_DATABASE" "docker_unavailable"
    return
  fi

  if ! docker inspect "$AIBIZ_MYSQL_CONTAINER" >/dev/null 2>&1; then
    record_check SKIP "database:$AIBIZ_MYSQL_DATABASE" \
      "mysql_container_missing:$AIBIZ_MYSQL_CONTAINER"
    return
  fi

  table_output=$(docker exec "$AIBIZ_MYSQL_CONTAINER" \
    env MYSQL_PWD="$AIBIZ_MYSQL_PASSWORD" \
    mysql --batch --skip-column-names \
    -u"$AIBIZ_MYSQL_USER" "$AIBIZ_MYSQL_DATABASE" \
    -e 'SHOW TABLES' 2>"$LOG_DIR/mysql-check.log" || true)

  if [ -z "$table_output" ]; then
    record_check FAIL "database:$AIBIZ_MYSQL_DATABASE" \
      "table_query_failed;see_logs=mysql-check.log"
    return
  fi

  missing=
  for table in "${expected_tables[@]}"; do
    if ! printf '%s\n' "$table_output" | awk -v expected="$table" '$0 == expected { found=1 } END { exit(found ? 0 : 1) }'; then
      missing="${missing:+$missing,}$table"
    fi
  done

  if [ -n "$missing" ]; then
    record_check FAIL "database:$AIBIZ_MYSQL_DATABASE" "missing_tables=$missing"
  else
    record_check PASS "database:$AIBIZ_MYSQL_DATABASE" \
      "expected_tables_present=${#expected_tables[@]}"
  fi
}

record "AIBiz Harness API smoke"
record "timestamp=$(date '+%F %T %z')"
record "report_dir=$REPORT_DIR"
record "base_url=$BASE_URL"
record "modeling_base_url=$MODELING_BASE_URL"
record "database_check=$AIBIZ_DB_CHECK"

check_dependencies
login

if [ -n "$AUTH_HEADER" ]; then
  check_json_endpoint GET "/appdata" "$BASE_URL/appdata"
  check_json_endpoint POST "/ai_agents/fetch_default" \
    "$BASE_URL/ai_agents/fetch_default" '{"page":0,"size":20}'
  check_json_endpoint POST "/ai_agents/fetch_full_info" \
    "$BASE_URL/ai_agents/fetch_full_info" '{"page":0,"size":20}'
  check_json_endpoint POST "/ai_models/fetch_default" \
    "$BASE_URL/ai_models/fetch_default" '{"page":0,"size":20}'
  check_json_endpoint POST "/ai_tools/fetch_default" \
    "$BASE_URL/ai_tools/fetch_default" '{"page":0,"size":20}'
  check_json_endpoint POST "/ai_agent_conversations/fetch_default" \
    "$BASE_URL/ai_agent_conversations/fetch_default" '{"page":0,"size":20}'
  check_json_endpoint POST "/ai_agent_messages/fetch_default" \
    "$BASE_URL/ai_agent_messages/fetch_default" '{"page":0,"size":20}'
  check_schema_endpoint
  check_modeldesign_fetchdefault
else
  for endpoint in \
    "GET /appdata" \
    "POST /ai_agents/fetch_default" \
    "POST /ai_agents/fetch_full_info" \
    "POST /ai_models/fetch_default" \
    "POST /ai_tools/fetch_default" \
    "POST /ai_agent_conversations/fetch_default" \
    "POST /ai_agent_messages/fetch_default" \
    "GET /jsonschema/IDEA" \
    "POST /psdelogics/fetchdefault"; do
    record_check SKIP "$endpoint" "login_failed"
  done
fi

check_model_file ai_agent.json ai_agent AI_AGENT \
  "fetch_default,fetch_full_info" \
  "ID,NAME,AI_MODEL_ID,DEFAULT_SYSTEM_PROMPT,ENABLE_SEARCHING,MEMORY_MODE,TOOL_MAX_CALLS,ACTIVE,ENABLE_TOOLS"
check_model_file ai_model.json ai_model AI_MODEL \
  "fetch_default" \
  "ID,NAME,ACTIVE,PROVIDER,API_BASE_URL,AI_CREDENTIAL_ID"
check_model_file ai_tool.json ai_tool AI_TOOL \
  "fetch_default,fetch_extension_mcp_server" \
  "ID,NAME,ACTIVE,TOOL_TYPE,API_URL,INPUT_SCHEMA"
check_model_file ai_agent_conversation.json ai_agent_conversation AI_AGENT_CONVERSATION \
  "fetch_active,fetch_cur_user_active,fetch_default" \
  "ID,TITLE,STATUS,SESSION_ID,USER_ID,AI_AGENT_CONTEXT_ID"
check_model_file ai_agent_message.json ai_agent_message AI_AGENT_MESSAGE \
  "fetch_all,fetch_default" \
  "ID,CONTENT,CONTENT_TYPE,SENDER_TYPE,CONVERSATION_ID,SESSION_ID,SEQUENCE"
check_model_file ai_agent_session.json ai_agent_session AI_AGENT_SESSION \
  "fetch_default" \
  "ID,CONTEXT_ID,CONTEXT_CODE_NAME"

if [ "$AIBIZ_DB_CHECK" = "1" ]; then
  check_database_tables
else
  record_check SKIP "database:$AIBIZ_MYSQL_DATABASE" \
    "disabled;set AIBIZ_DB_CHECK=1 to enable"
fi

record "checks=$CHECK_COUNT pass=$PASS_COUNT skip=$SKIP_COUNT"
if [ "$FAILED" -eq 0 ]; then
  record "RESULT PASS"
else
  record "RESULT FAIL"
fi

exit "$FAILED"
