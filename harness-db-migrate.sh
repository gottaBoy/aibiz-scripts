#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION_FILE="$ROOT_DIR/plm/deploy/compose/migrations/001_ai_harness.sql"

MYSQL_CONTAINER="${AIBIZ_MYSQL_CONTAINER:-mysql}"
MYSQL_DATABASE="${AIBIZ_MYSQL_DATABASE:-plm}"
MYSQL_USER="${AIBIZ_MYSQL_USER:-plm}"
MYSQL_PASSWORD="${AIBIZ_MYSQL_PASSWORD:-plm@2024}"

if [ ! -f "$MIGRATION_FILE" ]; then
  printf 'migration file not found: %s\n' "$MIGRATION_FILE" >&2
  exit 1
fi

if ! docker inspect "$MYSQL_CONTAINER" >/dev/null 2>&1; then
  printf 'mysql container not found: %s\n' "$MYSQL_CONTAINER" >&2
  exit 1
fi

docker exec -i "$MYSQL_CONTAINER" \
  mysql --batch --default-character-set=utf8mb4 \
  --user="$MYSQL_USER" --password="$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
  <"$MIGRATION_FILE"

printf 'Harness database migration applied: %s\n' "$MIGRATION_FILE"
