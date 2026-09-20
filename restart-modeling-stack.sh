#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "${AIBIZ_WORKSPACE_ROOT:-$SCRIPT_DIR/..}" && pwd)
DEV_COMPOSE_FILE="$ROOT_DIR/plm/deploy/compose/docker-compose-dev.yml"
PLATFORM_COMPOSE_FILE="$ROOT_DIR/docker-compose-platform.yml"
LOCAL_WEB_OVERLAY="$ROOT_DIR/plm/deploy/compose/docker-compose-modeling-local.yml"
ENV_FILE="$ROOT_DIR/plm/deploy/compose/.dev"

cd "$ROOT_DIR"

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable or the current user cannot access it." >&2
  exit 2
fi

DEV_COMPOSE_ARGS=(-f "$DEV_COMPOSE_FILE")
PROJECT_ARGS=()
if [[ "${AIBIZ_USE_LOCAL_WEB_DIST:-false}" == "true" ]]; then
  [[ -f "$ROOT_DIR/modelingweb/app/dist/index.html" ]] || {
    echo "Local modelingweb dist is missing; run 'cd modelingweb/app && pnpm build' first." >&2
    exit 3
  }
  DEV_COMPOSE_ARGS+=(-f "$LOCAL_WEB_OVERLAY")
fi

existing_project=$(docker inspect \
  --format '{{index .Config.Labels "com.docker.compose.project"}}' \
  ibiz-ebsx-allinone 2>/dev/null || true)
existing_service=$(docker inspect \
  --format '{{index .Config.Labels "com.docker.compose.service"}}' \
  ibiz-ebsx-allinone 2>/dev/null || true)
existing_configs=$(docker inspect \
  --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' \
  ibiz-ebsx-allinone 2>/dev/null || true)
dev_project=$(docker inspect \
  --format '{{index .Config.Labels "com.docker.compose.project"}}' \
  modelingweb 2>/dev/null || true)
if [[ -z "$dev_project" || "$dev_project" == "<no value>" ]]; then
  dev_project=$(docker inspect \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' \
    modeling-plugins 2>/dev/null || true)
fi
[[ -n "$dev_project" && "$dev_project" != "<no value>" ]] || dev_project=compose
if [[ ! "$dev_project" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "Invalid modeling Compose project label: $dev_project" >&2
  exit 4
fi

ALLINONE_COMPOSE_ARGS=(-f "$DEV_COMPOSE_FILE")
if [[ -n "$existing_project" && "$existing_project" != "<no value>" ]]; then
  if [[ "$existing_service" != "ibiz-ebsx-allinone" ]]; then
    echo "Existing ibiz-ebsx-allinone has an unexpected Compose service label: $existing_service" >&2
    exit 4
  fi
  if [[ ! "$existing_project" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo "Existing ibiz-ebsx-allinone has an invalid Compose project label: $existing_project" >&2
    exit 4
  fi
  if [[ "$existing_configs" == *"docker-compose-platform.yml"* ]]; then
    ALLINONE_COMPOSE_ARGS=(-f "$PLATFORM_COMPOSE_FILE")
  elif [[ "$existing_configs" == *"docker-compose-dev.yml"* ]]; then
    ALLINONE_COMPOSE_ARGS=(-f "$DEV_COMPOSE_FILE")
  else
    cat >&2 <<EOF
Existing ibiz-ebsx-allinone belongs to another Compose configuration.
  project: $existing_project
  service: $existing_service
  config:  $existing_configs
No container was changed. Inspect the stack first:
  docker inspect ibiz-ebsx-allinone --format '{{json .Config.Labels}}'
If the old container is intentionally being replaced, stop and rename it
without deleting its volumes, then rerun this script.
EOF
    exit 4
  fi
  PROJECT_ARGS=(--project-name "$existing_project")
elif [[ -n "$existing_service" && "$existing_service" != "<no value>" ]]; then
  echo "Existing ibiz-ebsx-allinone has no usable Compose project label; no container was changed." >&2
  exit 4
fi

PLATFORM_COMPOSE=(docker compose ${PROJECT_ARGS[@]+"${PROJECT_ARGS[@]}"} "${ALLINONE_COMPOSE_ARGS[@]}")
DEV_COMPOSE=(docker compose --project-name "$dev_project" ${DEV_COMPOSE_ARGS[@]+"${DEV_COMPOSE_ARGS[@]}"} --env-file "$ENV_FILE" --profile modeling)

# Keep existing PLM and platform containers untouched. The allinone wrapper,
# task service, plugin sidecar, and Nginx configuration are the only services
# changed here. Compose preserves task_data and modeling_plugins_data volumes.
"${DEV_COMPOSE[@]}" up -d --no-deps emqx
"${PLATFORM_COMPOSE[@]}" up -d --no-deps --force-recreate \
  --wait --wait-timeout 360 ibiz-ebsx-allinone
"${DEV_COMPOSE[@]}" up -d --no-deps --build --force-recreate \
  --wait --wait-timeout 120 modeling-plugins
"${DEV_COMPOSE[@]}" up -d --no-deps --force-recreate modelingweb
"${DEV_COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 480 task

exec bash "$ROOT_DIR/scripts/harness-baseline.sh"
