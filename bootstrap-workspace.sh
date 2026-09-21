#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORKSPACE_ROOT=${AIBIZ_WORKSPACE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}
GITHUB_ORG=${AIBIZ_GITHUB_ORG:-gottaBoy}
PLM_BRANCH=${AIBIZ_PLM_BRANCH:-mydev}
NPM_REGISTRY=${AIBIZ_NPM_REGISTRY:-https://registry.npmmirror.com}
RUN_DEPENDENCIES=true
START_STACK=true
RUN_MIGRATION=true
RUN_BASELINE=true

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Bootstraps the complete aibiz development workspace beside this scripts checkout.

Options:
  --clone-only       Clone/update repositories only.
  --no-dependencies  Skip pnpm and npm dependency installation.
  --no-start         Skip Docker Compose startup.
  --no-migration     Skip idempotent database migrations.
  --no-baseline      Skip the baseline smoke check.
  -h, --help         Show this help.

Environment:
  AIBIZ_WORKSPACE_ROOT  Workspace root. Default: parent of this repository.
  AIBIZ_GITHUB_ORG      GitHub organization. Default: gottaBoy.
  AIBIZ_PLM_BRANCH      PLM branch. Default: mydev.
  AIBIZ_NPM_REGISTRY    npm registry. Default: https://registry.npmmirror.com.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --clone-only)
      RUN_DEPENDENCIES=false
      START_STACK=false
      RUN_MIGRATION=false
      RUN_BASELINE=false
      ;;
    --no-dependencies)
      RUN_DEPENDENCIES=false
      ;;
    --no-start)
      START_STACK=false
      RUN_MIGRATION=false
      RUN_BASELINE=false
      ;;
    --no-migration)
      RUN_MIGRATION=false
      ;;
    --no-baseline)
      RUN_BASELINE=false
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

log() {
  printf '[bootstrap] %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command is unavailable: $1" >&2
    exit 2
  }
}

validate_workspace() {
  if [ "$WORKSPACE_ROOT" = "/" ]; then
    echo "Invalid workspace root: $WORKSPACE_ROOT" >&2
    exit 2
  fi
}

clone_or_update() {
  local repository=$1
  local directory=$2
  local branch=${3:-}
  local target="$WORKSPACE_ROOT/$directory"

  if [ -d "$target/.git" ]; then
    log "Updating $directory"
    git -C "$target" fetch --prune origin
    git -C "$target" pull --ff-only
    return
  fi

  if [ -e "$target" ]; then
    echo "Path exists but is not a Git repository: $target" >&2
    exit 3
  fi

  log "Cloning $repository into $directory"
  if [ -n "$branch" ]; then
    git clone -b "$branch" "git@github.com:$GITHUB_ORG/$repository.git" "$target"
  else
    git clone "git@github.com:$GITHUB_ORG/$repository.git" "$target"
  fi
}

require_command git
validate_workspace
mkdir -p "$WORKSPACE_ROOT"

clone_or_update plm plm "$PLM_BRANCH"
clone_or_update plm-web plm-web
clone_or_update plm-e2e plm-e2e
clone_or_update aibiz-scripts scripts
clone_or_update ibiz-app-hub ibiz-app-hub
clone_or_update ibiz-service-hub ibiz-service-hub
clone_or_update modeling-web modelingweb
clone_or_update modeling-service modelingservice
clone_or_update task-service task7

if [ "$RUN_DEPENDENCIES" = true ]; then
  require_command node
  require_command pnpm

  for app_dir in \
    "$WORKSPACE_ROOT/plm-web" \
    "$WORKSPACE_ROOT/modelingweb/app" \
    "$WORKSPACE_ROOT/plm-e2e"
  do
    if [ -f "$app_dir/package.json" ]; then
      log "Installing dependencies in ${app_dir#$WORKSPACE_ROOT/}"
      (cd "$app_dir" && pnpm install --registry="$NPM_REGISTRY")
    fi
  done

  if [ -f "$SCRIPT_DIR/package.json" ]; then
    log "Installing dependencies in scripts"
    (cd "$SCRIPT_DIR" && npm install --registry="$NPM_REGISTRY")
  fi
fi

if [ "$START_STACK" = true ]; then
  require_command docker
  docker info >/dev/null 2>&1 || {
    echo "Docker daemon is unavailable or the current user cannot access it." >&2
    exit 4
  }

  compose_dir="$WORKSPACE_ROOT/plm/deploy/compose"
  [ -f "$compose_dir/docker-compose-dev.yml" ] || {
    echo "Compose file not found: $compose_dir/docker-compose-dev.yml" >&2
    exit 5
  }
  [ -f "$compose_dir/.dev" ] || {
    echo "Compose env file not found: $compose_dir/.dev" >&2
    exit 5
  }

  log "Starting modeling development stack"
  (
    cd "$compose_dir"
    docker compose -f docker-compose-dev.yml --env-file .dev --profile modeling up -d
  )

  log "Waiting for core services"
  "$SCRIPT_DIR/wait-for-platform.sh"
fi

if [ "$RUN_MIGRATION" = true ]; then
  migrate="$WORKSPACE_ROOT/plm/deploy/compose/migrate.sh"
  [ -x "$migrate" ] || {
    echo "Migration script not found or not executable: $migrate" >&2
    exit 6
  }
  log "Applying idempotent migrations"
  (cd "$WORKSPACE_ROOT/plm/deploy/compose" && ./migrate.sh)
fi

if [ "$RUN_BASELINE" = true ]; then
  log "Running baseline verification"
  "$SCRIPT_DIR/harness-baseline.sh"
fi

log "Workspace root: $WORKSPACE_ROOT"
log "PLM source frontend: cd $WORKSPACE_ROOT/plm-web && pnpm dev -- --host 127.0.0.1 --port 4173"
log "Modeling source frontend: cd $WORKSPACE_ROOT/modelingweb/app && pnpm dev:source"
log "PLM web: http://127.0.0.1:30250/ibizplm-plmweb/"
log "Modeling web: http://127.0.0.1:32003/modeldesign/"
