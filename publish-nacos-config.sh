#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORKSPACE_ROOT=${AIBIZ_WORKSPACE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}
CONFIG_DIR=${AIBIZ_NACOS_CONFIG_DIR:-$WORKSPACE_ROOT/plm/deploy/compose/nacos-configs}
NACOS_HOST=${AIBIZ_NACOS_HOST:-127.0.0.1}
NACOS_PORT=${AIBIZ_NACOS_PORT:-8848}
NACOS_USER=${AIBIZ_NACOS_USER:-nacos}
NACOS_PASSWORD=${AIBIZ_NACOS_PASSWORD:-nacos}
NACOS_GROUP=${AIBIZ_NACOS_GROUP:-ibiz_config_group}

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Publishes checked-in Nacos config seeds. Existing configs with the same dataId
are overwritten.

Options:
  --dry-run  Print configs without publishing.
  -h, --help Show this help.
EOF
}

DRY_RUN=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

base_url="http://$NACOS_HOST:$NACOS_PORT/nacos"
login_response=$(curl -fsS -X POST "$base_url/v1/auth/login" \
  --data-urlencode "username=$NACOS_USER" \
  --data-urlencode "password=$NACOS_PASSWORD")
access_token=$(printf '%s' "$login_response" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
if [ -z "$access_token" ]; then
  echo "Unable to obtain Nacos access token" >&2
  exit 1
fi

shopt -s nullglob
configs=("$CONFIG_DIR"/*.{json,yaml,yml,properties})
shopt -u nullglob
if [ "${#configs[@]}" -eq 0 ]; then
  echo "No config files found in $CONFIG_DIR" >&2
  exit 1
fi

for config in "${configs[@]}"; do
  data_id=$(basename "$config")
  case "$data_id" in
    manifest.tsv) continue ;;
  esac
  printf 'Publishing %s\n' "$data_id"
  if [ "$DRY_RUN" = true ]; then
    continue
  fi

  case "$data_id" in
    *.json) config_type=json ;;
    *.yaml|*.yml) config_type=yaml ;;
    *.properties) config_type=properties ;;
    *) echo "Unsupported config type: $config" >&2; exit 1 ;;
  esac

  response=$(curl -fsS -X POST "$base_url/v1/cs/configs" \
    --data-urlencode "dataId=$data_id" \
    --data-urlencode "group=$NACOS_GROUP" \
    --data-urlencode "type=$config_type" \
    --data-urlencode "content@${config}" \
    --data-urlencode "accessToken=$access_token")
  if [ "$response" != true ]; then
    echo "Nacos rejected $data_id: $response" >&2
    exit 1
  fi
done
