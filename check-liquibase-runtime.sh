#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
provider=${1:?Usage: check-liquibase-runtime.sh PROVIDER_JAR [CHANGELOG_XML ...]}
shift
java=${JAVA_HOME:+$JAVA_HOME/bin/}java
temporary=$(mktemp -d "${TMPDIR:-/tmp}/liquibase-runtime.XXXXXX")
trap 'rm -rf "$temporary"' EXIT

entries=$(unzip -Z1 "$provider")
core=$(printf '%s\n' "$entries" | grep '^BOOT-INF/lib/liquibase-core-.*\.jar$')
if [ "$core" != 'BOOT-INF/lib/liquibase-core-4.8.0.jar' ]; then
  printf 'FAIL provider must contain exactly liquibase-core-4.8.0.jar, matching ibiz-plugin-liquibase\n' >&2
  exit 1
fi
unzip -q -j "$provider" \
  'BOOT-INF/lib/liquibase-core-*.jar' \
  'BOOT-INF/lib/commons-lang3-*.jar' \
  'BOOT-INF/lib/snakeyaml-*.jar' \
  'BOOT-INF/lib/opencsv-*.jar' -d "$temporary"
"$java" --class-path "$temporary/*" "$root/scripts/java/LiquibaseOfflineCheck.java" "$@"
