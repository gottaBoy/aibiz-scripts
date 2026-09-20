#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BASE_PROVIDER_JAR="${AIBIZ_BASE_PROVIDER_JAR:-$ROOT_DIR/ibiz-service-hub/ibiz-service-runner/ibizservicerunner-provider.jar}"
HARNESS_CLASSES_DIR="${AIBIZ_HARNESS_CLASSES_DIR:-$ROOT_DIR/ibiz-service-hub/ibiz-service-runner/ibizservicerunner-core/target/classes}"
OUTPUT_JAR="${AIBIZ_HARNESS_PROVIDER_JAR:-$ROOT_DIR/runtime/harness/ibizservicerunner-provider.jar}"
HARNESS_PACKAGE="cn/ibizlab/runner/servicerunner/harness"
HARNESS_CLASS_DIR="$HARNESS_CLASSES_DIR/$HARNESS_PACKAGE"
RUNTIME_CLASS="cn/ibizlab/runner/servicerunner/runtime/SystemRuntimeBase.class"
RUNTIME_CLASS_FILE="$HARNESS_CLASSES_DIR/$RUNTIME_CLASS"
# The build runs on JDK 17, but Spring Boot 2.4's ASM requires Java 11 output.
# Java 11 class files use major version 55.
EXPECTED_CLASS_MAJOR="${AIBIZ_EXPECTED_CLASS_MAJOR:-55}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

command -v jar >/dev/null 2>&1 || fail "jar command is unavailable"
command -v javap >/dev/null 2>&1 || fail "javap command is unavailable"
command -v zipinfo >/dev/null 2>&1 || fail "zipinfo command is unavailable"

[ -f "$BASE_PROVIDER_JAR" ] ||
  fail "base provider JAR not found: $BASE_PROVIDER_JAR"
[ -d "$HARNESS_CLASS_DIR" ] ||
  fail "compiled Harness classes not found: $HARNESS_CLASS_DIR"
[ -f "$RUNTIME_CLASS_FILE" ] ||
  fail "compiled Runner runtime class not found: $RUNTIME_CLASS_FILE"

class_count=$(find "$HARNESS_CLASS_DIR" -type f -name '*.class' | wc -l | tr -d ' ')
[ "$class_count" -gt 0 ] ||
  fail "no compiled Harness classes found: $HARNESS_CLASS_DIR"

while IFS= read -r class_file; do
  major_version=$(javap -verbose "$class_file" 2>/dev/null |
    awk '/major version:/ { print $3; exit }')
  [ "$major_version" = "$EXPECTED_CLASS_MAJOR" ] ||
    fail "Harness class has unexpected bytecode: $class_file (major=${major_version:-unknown}, expected=$EXPECTED_CLASS_MAJOR)"
done < <(find "$HARNESS_CLASS_DIR" -type f -name '*.class' | sort)

runtime_major_version=$(javap -verbose "$RUNTIME_CLASS_FILE" 2>/dev/null |
  awk '/major version:/ { print $3; exit }')
[ "$runtime_major_version" = "$EXPECTED_CLASS_MAJOR" ] ||
  fail "Runner runtime class is not expected bytecode: $RUNTIME_CLASS_FILE (major=${runtime_major_version:-unknown}, expected=$EXPECTED_CLASS_MAJOR)"

mkdir -p "$(dirname "$OUTPUT_JAR")"
temporary_jar="${OUTPUT_JAR}.tmp.$$"
staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/aibiz-harness-overlay.XXXXXX")
cleanup() {
  rm -f "$temporary_jar"
  rm -rf "$staging_dir"
}
trap cleanup EXIT

cp -p "$BASE_PROVIDER_JAR" "$temporary_jar"
mkdir -p "$staging_dir/BOOT-INF/classes/cn/ibizlab/runner/servicerunner"
cp -R "$HARNESS_CLASS_DIR" \
  "$staging_dir/BOOT-INF/classes/cn/ibizlab/runner/servicerunner/"
mkdir -p "$staging_dir/BOOT-INF/classes/$(dirname "$RUNTIME_CLASS")"
cp "$RUNTIME_CLASS_FILE" "$staging_dir/BOOT-INF/classes/$RUNTIME_CLASS"
jar uf "$temporary_jar" -C "$staging_dir" "BOOT-INF/classes/$HARNESS_PACKAGE"
jar uf "$temporary_jar" -C "$staging_dir" "BOOT-INF/classes/$RUNTIME_CLASS"

expected_entries=$(find "$HARNESS_CLASS_DIR" -type f -name '*.class' |
  sed "s#^$HARNESS_CLASSES_DIR/##" |
  sed 's#^#BOOT-INF/classes/#' |
  sort)
actual_entries=$(zipinfo -1 "$temporary_jar" |
  grep -E "^BOOT-INF/classes/$HARNESS_PACKAGE/.*\.class$" |
  sort)

[ "$expected_entries" = "$actual_entries" ] ||
  fail "injected Harness class entries do not match source classes"

zipinfo -1 "$temporary_jar" |
  grep -Eq "^BOOT-INF/classes/$RUNTIME_CLASS$" ||
  fail "Runner runtime class was not injected: $RUNTIME_CLASS"

bash "$SCRIPT_DIR/check-liquibase-runtime.sh" "$temporary_jar"

mv "$temporary_jar" "$OUTPUT_JAR"
trap - EXIT

base_size=$(stat -f '%z' "$BASE_PROVIDER_JAR" 2>/dev/null || stat -c '%s' "$BASE_PROVIDER_JAR")
output_size=$(stat -f '%z' "$OUTPUT_JAR" 2>/dev/null || stat -c '%s' "$OUTPUT_JAR")
output_class_count=$(printf '%s\n' "$actual_entries" | wc -l | tr -d ' ')

printf 'Harness runtime overlay created\n'
printf 'base=%s\n' "$BASE_PROVIDER_JAR"
printf 'compiled_classes=%s\n' "$HARNESS_CLASSES_DIR"
printf 'output=%s\n' "$OUTPUT_JAR"
printf 'base_size=%s\n' "$base_size"
printf 'output_size=%s\n' "$output_size"
printf 'injected_class_count=%s\n' "$output_class_count"
printf 'injected_runtime_class=%s\n' "$RUNTIME_CLASS"
printf 'java_class_major=%s\n' "$EXPECTED_CLASS_MAJOR"
