#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$ROOT_DIR/plm/deploy/compose/docker-compose-dev.yml"
ENV_FILE="$ROOT_DIR/plm/deploy/compose/.dev"
TIMESTAMP=$(date "+%Y%m%d-%H%M%S")
REPORT_DIR=${AIBIZ_REPORT_DIR:-"$ROOT_DIR/.artifacts/harness-baseline/$TIMESTAMP"}
SUMMARY_FILE="$REPORT_DIR/summary.txt"
FAILED=0
AIBIZ_LOGINNAME=${AIBIZ_LOGINNAME:-aibizhi}
AIBIZ_PASSWORD=${AIBIZ_PASSWORD:-123456}

mkdir -p "$REPORT_DIR/logs"

record() {
  printf '%s\n' "$*" | tee -a "$SUMMARY_FILE"
}

run_capture() {
  local name=$1
  shift
  "$@" >"$REPORT_DIR/$name" 2>&1
}

check_port() {
  local label=$1
  local port=$2

  if nc -z -w 2 127.0.0.1 "$port" >/dev/null 2>&1; then
    record "PASS port $port ($label)"
  else
    record "FAIL port $port ($label)"
    FAILED=1
  fi
}

check_http() {
  local label=$1
  local url=$2
  local code

  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || true)
  case "$code" in
    2??|3??|401|403)
      record "PASS http $code ($label) $url"
      ;;
    *)
      record "FAIL http ${code:-000} ($label) $url"
      FAILED=1
      ;;
  esac
}

check_json_token_response() {
  local label=$1
  local code=$2
  local response_file=$3
  local token_present

  if ! [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
    record "FAIL http ${code:-000} ($label)"
    FAILED=1
    return
  fi

  if ! token_present=$(jq -e -r \
    '((.token // .access_token // .data.token // .data.access_token) | type == "string" and length > 0)' \
    "$response_file" 2>/dev/null); then
    token_present=false
  fi

  if [ "$token_present" = "true" ]; then
    record "PASS http $code ($label, token present)"
  else
    record "FAIL http $code ($label, token missing)"
    FAILED=1
  fi
}

check_allinone_login() {
  local response_file
  local payload
  local code

  if ! command -v jq >/dev/null 2>&1; then
    record "FAIL allinone login cannot validate JSON because jq is unavailable"
    FAILED=1
    return
  fi

  response_file=$(mktemp "${TMPDIR:-/tmp}/aibiz-harness-login.XXXXXX")
  payload=$(jq -cn --arg loginname "$AIBIZ_LOGINNAME" \
    --arg password "$AIBIZ_PASSWORD" \
    '{loginname: $loginname, password: $password}')
  code=$(curl -sS -o "$response_file" -w '%{http_code}' \
    --connect-timeout 3 --max-time 10 \
    -H 'Content-Type: application/json' \
    --data-raw "$payload" \
    http://127.0.0.1:30000/v7/login \
    2>"$REPORT_DIR/logs/allinone-login-curl.log" || true)
  check_json_token_response "allinone POST /v7/login" "${code:-000}" "$response_file"
  rm -f "$response_file"
}

check_allinone_oauth() {
  local response_file
  local payload
  local code

  if ! command -v jq >/dev/null 2>&1; then
    record "FAIL OAuth client credentials cannot validate JSON because jq is unavailable"
    FAILED=1
    return
  fi

  response_file=$(mktemp "${TMPDIR:-/tmp}/aibiz-harness-oauth.XXXXXX")
  payload=$(jq -cn --arg client_id "$AIBIZ_LOGINNAME" \
    --arg client_secret "$AIBIZ_PASSWORD" \
    '{grant_type: "client_credentials", client_id: $client_id, client_secret: $client_secret}')
  code=$(curl -sS -o "$response_file" -w '%{http_code}' \
    --connect-timeout 3 --max-time 10 \
    -H 'Content-Type: application/json' \
    --data-raw "$payload" \
    http://127.0.0.1:30000/uaa/oauth/token \
    2>"$REPORT_DIR/logs/allinone-oauth-curl.log" || true)
  check_json_token_response "allinone POST /uaa/oauth/token" "${code:-000}" "$response_file"
  rm -f "$response_file"
}

check_allinone_codelist() {
  local login_file
  local codelist_file
  local payload
  local token
  local login_code
  local codelist_code
  local login_exit=0
  local codelist_exit=0

  if ! command -v jq >/dev/null 2>&1; then
    record "FAIL SysOperator codelist cannot validate JSON because jq is unavailable"
    FAILED=1
    return
  fi

  login_file=$(mktemp "${TMPDIR:-/tmp}/aibiz-harness-codelist-login.XXXXXX")
  codelist_file=$(mktemp "${TMPDIR:-/tmp}/aibiz-harness-codelist.XXXXXX")
  payload=$(jq -cn --arg loginname "$AIBIZ_LOGINNAME" \
    --arg password "$AIBIZ_PASSWORD" \
    '{loginname: $loginname, password: $password}')
  login_code=$(curl -sS -o "$login_file" -w '%{http_code}' \
    --connect-timeout 3 --max-time 10 \
    -H 'Content-Type: application/json' \
    --data-raw "$payload" \
    http://127.0.0.1:30000/v7/login \
    2>"$REPORT_DIR/logs/allinone-codelist-login-curl.log") || login_exit=$?
  token=$(jq -r '(.token // .access_token // .data.token // .data.access_token // empty)' \
    "$login_file" 2>/dev/null || true)
  if [[ "$login_exit" -ne 0 || ! "$login_code" =~ ^2[0-9][0-9]$ || -z "$token" ]]; then
    record "FAIL SysOperator codelist prerequisite login HTTP ${login_code:-000} curl_exit=$login_exit"
    FAILED=1
    rm -f "$login_file" "$codelist_file"
    return
  fi

  codelist_code=$(curl -sS -o "$codelist_file" -w '%{http_code}' \
    --connect-timeout 3 --max-time 10 \
    -H 'Accept: application/json' \
    -H "Authorization: Bearer $token" \
    http://127.0.0.1:30000/dictionaries/codelist/SysOperator \
    2>"$REPORT_DIR/logs/allinone-codelist-curl.log") || codelist_exit=$?
  if [[ "$codelist_exit" -eq 0 && "$codelist_code" =~ ^2[0-9][0-9]$ ]] &&
    jq -e -f "$SCRIPT_DIR/check-sysoperator.jq" \
      "$codelist_file" >/dev/null 2>&1; then
    if jq -e '.items | type == "array"' "$codelist_file" >/dev/null 2>&1; then
      record "PASS allinone GET /dictionaries/codelist/SysOperator"
    else
      record "PASS allinone GET /dictionaries/codelist/SysOperator (empty code-list metadata)"
    fi
    record "INFO SysOperator response contract only; organization identity and employee data are not verified"
  else
    local shape
    shape=$(jq -c '
      if type == "object" then
        {json_type: type, keys: (keys | sort), items_type: (.items | type)}
      else
        {json_type: type}
      end
    ' "$codelist_file" 2>/dev/null || printf '%s' 'invalid_json')
    record "FAIL allinone GET /dictionaries/codelist/SysOperator HTTP ${codelist_code:-000} curl_exit=$codelist_exit shape=$shape"
    FAILED=1
  fi
  rm -f "$login_file" "$codelist_file"
}

check_container() {
  local container=$1
  local label=${2:-$container}
  local state
  local running
  local oom
  local health

  if ! docker inspect "$container" >/dev/null 2>&1; then
    record "FAIL container missing ($label: $container)"
    FAILED=1
    return 1
  fi

  state=$(docker inspect "$container" --format \
    'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restart={{.HostConfig.RestartPolicy.Name}}' \
    2>/dev/null || true)
  running=$(docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null || true)
  oom=$(docker inspect "$container" --format '{{.State.OOMKilled}}' 2>/dev/null || true)
  health=$(docker inspect "$container" --format \
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    2>/dev/null || true)

  if [ "$running" = "true" ] && [ "$oom" != "true" ] &&
    { [ "$health" = "none" ] || [ "$health" = "healthy" ]; }; then
    record "PASS container $label ($container) $state health=$health"
    return 0
  fi

  record "FAIL container $label ($container) $state health=$health"
  docker logs --tail 200 "$container" >"$REPORT_DIR/logs/$container.log" 2>&1 || true
  FAILED=1
  return 1
}

check_task_service() {
  local task_running=false
  local task_state
  local legacy_state

  if docker inspect task >/dev/null 2>&1; then
    task_state=$(docker inspect task --format \
      'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restart={{.HostConfig.RestartPolicy.Name}}' \
      2>/dev/null || true)
    if [ "$(docker inspect task --format '{{.State.Running}}' 2>/dev/null || true)" = "true" ]; then
      task_running=true
    fi
    check_container task "task Compose service"
  else
    record "FAIL container missing (task Compose service: task)"
    FAILED=1
    if docker inspect task7-sapaas >/dev/null 2>&1; then
      legacy_state=$(docker inspect task7-sapaas --format \
        'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restart={{.HostConfig.RestartPolicy.Name}}' \
        2>/dev/null || true)
      record "INFO legacy task7-sapaas detected but not counted as task ($legacy_state)"
      docker logs --tail 200 task7-sapaas >"$REPORT_DIR/logs/task7-sapaas.log" 2>&1 || true
    else
      record "INFO legacy task7-sapaas is also missing"
    fi
  fi

  if [ "$task_running" = "true" ]; then
    check_port task 30088
    check_http task http://127.0.0.1:30088/SAPAAS/
  else
    record "FAIL port 30088 (task Compose service is not running)"
    record "FAIL http 000 (task Compose service is not running) http://127.0.0.1:30088/SAPAAS/"
    FAILED=1
  fi
}

record "AIBiz Harness baseline"
record "timestamp=$(date '+%F %T %z')"
record "report_dir=$REPORT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  record "FAIL docker CLI is unavailable"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  record "FAIL Docker daemon is unavailable"
  exit 1
fi

run_capture docker-info.txt docker info
run_capture containers.txt docker ps -a --format \
  'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
run_capture resources.txt docker stats --no-stream --format \
  'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'

docker_info=$(docker info --format \
  'arch={{.Architecture}} cpus={{.NCPU}} memory={{.MemTotal}}' 2>/dev/null || true)
record "PASS Docker daemon $docker_info"

if [ -f "$COMPOSE_FILE" ] && [ -f "$ENV_FILE" ]; then
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
    --profile modeling config --quiet >"$REPORT_DIR/compose-config.txt" 2>&1; then
    record "PASS modeling Compose configuration"
  else
    record "FAIL modeling Compose configuration"
    FAILED=1
  fi
else
  record "FAIL Compose file or .dev file is missing"
  FAILED=1
fi

containers=(
  mysql
  nacos
  redis
  zoo1
  emqx
  ibiz-ebsx-allinone
  ibizlab-uaa-api
  ibiz-ebsx-gateway
  plmservice
  modelingweb
)

for container in "${containers[@]}"; do
  check_container "$container"
done

check_port mysql 3306
check_port nacos 8848
check_port redis 6379
check_port zookeeper 2181
check_port allinone 30000
check_port uaa 32666
check_port gateway 30086
check_port plmservice 30251
check_port modelingweb 32003
record "INFO modelingservice optional: jsonschema/IDEA served from mounted model bundle"

check_http nacos http://127.0.0.1:8848/nacos/
check_allinone_login
check_allinone_oauth
check_allinone_codelist
check_http modelingweb http://127.0.0.1:32003/modeldesign/
check_task_service

if [ "$FAILED" -eq 0 ]; then
  record "RESULT PASS"
else
  record "RESULT FAIL"
fi

exit "$FAILED"
