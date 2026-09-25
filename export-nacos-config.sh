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

Exports all configs in a Nacos group to the local config directory.
Existing files with the same dataId are overwritten.

Options:
  -h, --help Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
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

page_no=1
page_size=100
config_rows=()
while :; do
  list_response=$(curl -fsS -G "$base_url/v1/cs/configs" \
    --data-urlencode "search=accurate" \
    --data-urlencode "dataId=" \
    --data-urlencode "group=$NACOS_GROUP" \
    --data-urlencode "pageNo=$page_no" \
    --data-urlencode "pageSize=$page_size" \
    --data-urlencode "accessToken=$access_token")
  if ! page_info=$(printf '%s' "$list_response" | node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const data = JSON.parse(input);
      const items = data.pageItems || [];
      console.log(items.map(item => [item.dataId, item.type || "text", item.md5 || ""].join("\t")).join("\n"));
      console.log("TOTAL\t" + (data.totalCount ?? items.length));
    });
  '); then
    echo "Unable to parse Nacos config list response" >&2
    exit 1
  fi

  while IFS=$'\t' read -r data_id config_type md5; do
    [ "$data_id" = "TOTAL" ] && continue
    [ -n "$data_id" ] && config_rows+=("$data_id|$config_type|$md5")
  done < <(printf '%s\n' "$page_info")

  total=$(printf '%s\n' "$page_info" | sed -n 's/^TOTAL\t//p')
  offset=$((page_size * (page_no - 1)))
  [ "$offset" -ge "$total" ] && break
  page_no=$((page_no + 1))
done

if [ "${#config_rows[@]}" -eq 0 ]; then
  echo "No configs found in group $NACOS_GROUP" >&2
  exit 1
fi

mkdir -p "$CONFIG_DIR"
manifest="$CONFIG_DIR/manifest.tsv"
printf 'group_id\tdata_id\ttype\n' > "$manifest"

for config_row in "${config_rows[@]}"; do
  data_id=${config_row%%|*}
  config_type=$(printf '%s' "$config_row" | cut -d'|' -f2)
  md5=$(printf '%s' "$config_row" | cut -d'|' -f3)
  response=$(curl -fsS -G "$base_url/v1/cs/configs" \
    --data-urlencode "show=all" \
    --data-urlencode "dataId=$data_id" \
    --data-urlencode "group=$NACOS_GROUP" \
    --data-urlencode "accessToken=$access_token")

  if ! content=$(printf '%s' "$response" | node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => process.stdout.write(JSON.parse(input).content || ""));
  '); then
    echo "Unable to parse config $data_id" >&2
    exit 1
  fi

  case "$config_type" in
    json) extension=json ;;
    yaml|yml) extension=yaml ;;
    properties) extension=properties ;;
    text|'') extension=txt ;;
    *) extension=txt ;;
  esac
  if [[ "$data_id" == *.* && "$data_id.$extension" != "$data_id" && -f "$CONFIG_DIR/$data_id" ]]; then
    extension=""
  fi
  output="$CONFIG_DIR/$data_id.$extension"
  if [ -n "$extension" ]; then
    printf '%s' "$content" > "$output"
  else
    printf '%s' "$content" > "$CONFIG_DIR/$data_id"
  fi
  printf '%s\t%s\t%s\n' "$NACOS_GROUP" "$data_id" "$config_type" >> "$manifest"
  if [ -n "$extension" ]; then
    printf 'Exported %s.%s\n' "$data_id" "$extension"
  else
    printf 'Exported %s\n' "$data_id"
  fi
done

printf 'Exported %s configs to %s\n' "${#config_rows[@]}" "$CONFIG_DIR"
