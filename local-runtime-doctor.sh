#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
COMPOSE_DIR="$ROOT_DIR/plm/deploy/compose"
SUB2API_DIR=${AIBIZ_SUB2API_DIR:-/home/my/workspace/ainfra/sub2api-deploy}
FAILED=0

pass() { printf 'PASS %s\n' "$*"; }
fail() { printf 'FAIL %s\n' "$*"; FAILED=1; }
info() { printf 'INFO %s\n' "$*"; }

if docker info >/dev/null 2>&1; then
  pass "Docker daemon reachable"
else
  fail "Docker daemon unreachable"
  exit 1
fi

check_container() {
  local name=$1
  local expected_image=$2
  local expected_health=${3:-running}
  local state image health
  if ! state=$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null); then
    fail "container $name missing"
    return
  fi
  image=$(docker inspect --format '{{.Config.Image}}' "$name")
  if [ "$state" != running ]; then
    fail "container $name state=$state"
  else
    pass "container $name running"
  fi
  if [ "$image" != "$expected_image" ]; then
    fail "container $name image=$image expected=$expected_image"
  else
    pass "container $name image"
  fi
  if [ "$expected_health" != none ]; then
    health=$(docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name")
    if [ "$health" != "$expected_health" ]; then
      fail "container $name health=$health expected=$expected_health"
    else
      pass "container $name health=$health"
    fi
  fi
}

check_restart_policy() {
  local name=$1 expected=$2
  local actual
  if ! actual=$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$name" 2>/dev/null); then
    fail "container $name restart policy unavailable"
    return
  fi
  if [ "$actual" = "$expected" ]; then
    pass "container $name restart=$actual"
  else
    fail "container $name restart=${actual:-missing} expected=$expected"
  fi
}

check_port() {
  local port=$1 label=$2
  if nc -z -w 2 127.0.0.1 "$port" >/dev/null 2>&1; then
    pass "port $port $label"
  else
    fail "port $port $label"
  fi
}

check_http() {
  local port=$1 label=$2 path=$3
  shift 3
  local allowed_codes=("$@")
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
    "http://127.0.0.1:${port}${path}" 2>/dev/null || true)
  local expected=${allowed_codes[0]}
  for allowed in "${allowed_codes[@]}"; do
    if [ "$code" = "$allowed" ]; then
      pass "http $port $label code=$code"
      return
    fi
  done
  fail "http $port $label code=${code:-000} expected=$expected"
}

label_value() {
  local container=$1 key=$2
  docker inspect --format "{{index .Config.Labels \"$key\"}}" "$container" 2>/dev/null
}

check_manual_container() {
  local name=$1 expected_image=$2
  if [ -z "$(label_value "$name" com.docker.compose.project)" ] ||
     [ "$(label_value "$name" com.docker.compose.project)" = "<no value>" ]; then
    pass "container $name is intentionally manual (docker start only)"
  else
    fail "container $name unexpectedly became Compose-managed"
  fi
  check_container "$name" "$expected_image" none
}

check_compose_config() {
  local container=$1 expected=$2
  local actual
  actual=$(label_value "$container" com.docker.compose.project.config_files)
  if [ "$actual" = "$expected" ]; then
    pass "$container Compose config matches current lane"
  else
    fail "$container Compose config differs; inspect labels before restarting"
    info "actual: $actual"
  fi
}

# Existing manual containers. Never recreate these with a broad Compose up.
check_manual_container mysql \
  'swr.ap-southeast-1.myhuaweicloud.com/find1024/mysql:5.7.41.ibiz-arm64'
check_manual_container ibizlab-uaa-api \
  'aibiz/uaa:source-built-local-cache-fix2-jdk8-20261008'

check_container nacos 'aibiz/nacos-server:v2.0.3-jre17' none
check_container emqx 'emqx/emqx:5.8.0' none
check_container ibiz-ebsx-allinone \
  'aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-key-refresh-20261008' healthy
check_container ibiz-ebsx-gateway \
  'aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-key-refresh-20261008' none
check_container plmservice 'aibiz/plmservice:local-key-refresh-20261008' healthy
check_container plmweb 'aibiz/plmweb:local' healthy
check_restart_policy ibiz-ebsx-allinone unless-stopped
check_restart_policy plmservice unless-stopped
check_restart_policy plmweb unless-stopped
check_container modelingservice 'aibiz/modelingservice-arm64:source-built' healthy
check_container modeling-plugins 'aibiz/modeling-plugins:local' healthy
check_container modelingweb 'aibiz/modelingweb:local' healthy
check_container task 'aibiz/task7:source-built-2798cec3' healthy
check_container compose-modelingweb-candidate-central-1 \
  'aibiz/modelingweb:local' healthy
check_container compose-modelingweb-candidate-modeldesign-1 \
  'aibiz/modelingweb:local' healthy
check_container harness-ui 'node:22-alpine' healthy
check_container sub2api 'weishaw/sub2api:latest' healthy

check_compose_config ibiz-ebsx-allinone \
  "$COMPOSE_DIR/docker-compose-dev.yml,$COMPOSE_DIR/docker-compose-plm-local.yml,$COMPOSE_DIR/docker-compose-modeling-native-candidate.yml"
check_compose_config plmservice \
  "$COMPOSE_DIR/docker-compose-dev.yml,$COMPOSE_DIR/docker-compose-plm-local.yml,$COMPOSE_DIR/docker-compose-modeling-native-candidate.yml"
check_compose_config plmweb \
  "$COMPOSE_DIR/docker-compose-dev.yml,$COMPOSE_DIR/docker-compose-plm-local.yml,$COMPOSE_DIR/docker-compose-modeling-native-candidate.yml"
check_compose_config compose-modelingweb-candidate-central-1 \
  "$COMPOSE_DIR/docker-compose-dev.yml,$COMPOSE_DIR/docker-compose-plm-local.yml,$COMPOSE_DIR/docker-compose-modeling-native-candidate.yml,$COMPOSE_DIR/docker-compose-modeling-native-service-candidate.yml,$COMPOSE_DIR/docker-compose-modeling-native-ai-code-runtime.yml,$COMPOSE_DIR/docker-compose-modeling-native-platform-local.yml"
check_compose_config compose-modelingweb-candidate-modeldesign-1 \
  "$COMPOSE_DIR/docker-compose-dev.yml,$COMPOSE_DIR/docker-compose-plm-local.yml,$COMPOSE_DIR/docker-compose-modeling-native-candidate.yml,$COMPOSE_DIR/docker-compose-modeling-native-service-candidate.yml,$COMPOSE_DIR/docker-compose-modeling-native-ai-code-runtime.yml,$COMPOSE_DIR/docker-compose-modeling-native-platform-local.yml"

for expected_image in \
  'aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-key-refresh-20261008' \
  'aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-key-refresh-20261008' \
  'aibiz/uaa:source-built-local-cache-fix2-jdk8-20261008' \
  'aibiz/plmservice:local-key-refresh-20261008' \
  'aibiz/modelingservice-arm64:source-built' \
  'aibiz/modeling-plugins:local' \
  'aibiz/modelingweb:local' \
  'aibiz/plmweb:local' \
  'aibiz/task7:source-built-2798cec3'; do
  if docker image inspect "$expected_image" >/dev/null 2>&1; then
    pass "local image $expected_image"
  else
    fail "local image missing $expected_image"
  fi
done

check_port 3306 MySQL
check_port 8848 Nacos
check_port 8083 EMQX
check_http 30000 allinone / 200 401 404
check_http 30086 gateway / 200 404
check_http 32666 UAA / 200 404
check_http 30250 PLM-web /ibizplm-plmweb/ 200
check_http 30251 PLM-service / 200 401 404
check_http 32002 modeling-service / 200 401 404
check_http 32003 modeling-web /modeldesign/ 200
check_http 32008 native-central /central/ 200
check_http 32009 native-modeldesign /modeldesign/ 200
check_http 30088 task / 200 404
check_http 19323 harness-ui / 200 404
check_http 8080 sub2api / 200 404

for container in compose-modelingweb-candidate-central-1 \
  compose-modelingweb-candidate-modeldesign-1; do
  value=$(docker inspect --format \
    '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null |
    awk -F= '$1 == "NATIVE_PLATFORM_HOST" {print $2}')
  if [ "$value" = ibiz-ebsx-allinone ]; then
    pass "$container routes to formal source-local allinone"
  else
    fail "$container NATIVE_PLATFORM_HOST=${value:-missing} expected=ibiz-ebsx-allinone"
  fi
done

if [ -f "$COMPOSE_DIR/source-local.env" ] &&
   rg -q '^IBIZ_ALLINONE_IMAGE=aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-key-refresh-20261008$' \
     "$COMPOSE_DIR/source-local.env"; then
  pass "source-local.env pins current formal images"
else
  fail "source-local.env does not pin current formal images"
fi

if [ -d "$SUB2API_DIR" ] && [ -f "$SUB2API_DIR/docker-compose.yml" ]; then
  pass "sub2api project found at $SUB2API_DIR"
else
  fail "sub2api project not found at $SUB2API_DIR"
fi

if [ "$FAILED" -eq 0 ]; then
  info "runtime doctor passed"
else
  info "runtime doctor failed"
fi
exit "$FAILED"
