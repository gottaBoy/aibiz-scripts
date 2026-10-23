#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
SUB2API_DIR=${AIBIZ_SUB2API_DIR:-/home/my/workspace/ainfra/sub2api-deploy}

start_container() {
  local name=$1
  local state
  state=$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)
  if [ "$state" = running ]; then
    printf 'SKIP %s already running\n' "$name"
  else
    docker start "$name"
    printf 'START %s\n' "$name"
  fi
}

ensure_network_alias() {
  local name=$1
  local network=$2
  local alias=$3
  local connected
  connected=$(docker network inspect "$network" \
    --format '{{range $id, $container := .Containers}}{{if eq $container.Name "'"$name"'"}}true{{end}}{{end}}' \
    2>/dev/null || true)
  if [ "$connected" != true ]; then
    docker network connect --alias "$alias" "$network" "$name"
    printf 'CONNECT %s to %s as %s\n' "$name" "$network" "$alias"
  fi
}

wait_health() {
  local name=$1
  local timeout=${2:-300}
  printf 'WAIT %s healthy (timeout=%ss)\n' "$name" "$timeout"
  for ((i=0; i<=timeout; i+=5)); do
    if [ "$(docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" \
      2>/dev/null)" = healthy ]; then
      return 0
    fi
    sleep 5
  done
  echo "ERROR $name did not become healthy" >&2
  return 1
}

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable" >&2
  exit 2
fi

# Existing containers are started only. No Compose recreation is performed here.
start_container mysql
start_container redis
start_container nacos
ensure_network_alias redis compose_agent_network redis
start_container emqx
start_container ibiz-ebsx-allinone
wait_health ibiz-ebsx-allinone 360
start_container ibizlab-uaa-api
sleep 5
start_container ibiz-ebsx-gateway
start_container plmservice
wait_health plmservice 180
start_container plmweb
start_container modelingservice
wait_health modelingservice 240
start_container modeling-plugins
start_container modelingweb
start_container task
start_container compose-modelingweb-candidate-central-1
start_container compose-modelingweb-candidate-modeldesign-1
start_container harness-ui

if [ -f "$SUB2API_DIR/docker-compose.yml" ]; then
  (cd "$SUB2API_DIR" && docker compose up -d)
fi

wait_health compose-modelingweb-candidate-central-1 60
wait_health compose-modelingweb-candidate-modeldesign-1 60
wait_health harness-ui 60
wait_health sub2api 60

exec "$SCRIPT_DIR/local-runtime-doctor.sh"
