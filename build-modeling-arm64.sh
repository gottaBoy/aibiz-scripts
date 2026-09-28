#!/usr/bin/env bash

set -euo pipefail

MODELING_IMAGE=${AIBIZ_MODELING_IMAGE:-aibiz/modelingservice-arm64:source-built}
RUNTIME_IMAGE=${AIBIZ_MODELING_RUNTIME_IMAGE:-eclipse-temurin:17-jdk}
PROVIDER_JAR=${AIBIZ_MODELING_PROVIDER_JAR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/ibiz-service-hub/ibiz-service-runner/ibizservicerunner-provider.jar}
MODELINGSERVICE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../modelingservice" && pwd)
SOURCE_BUILD=${AIBIZ_MODELING_SOURCE_BUILD:-true}

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Builds an arm64 Modeling image from the local Modeling source project and a
generic Java runtime image.

Options:
  --force    Rebuild even if the target image already exists.
  -h, --help Show this help.
Environment:
  AIBIZ_MODELING_IMAGE          Target image tag.
  AIBIZ_MODELING_RUNTIME_IMAGE  Generic Java runtime image (default:
                                eclipse-temurin:17-jdk).
  AIBIZ_MODELING_PROVIDER_JAR   Local provider JAR override.
  AIBIZ_MODELING_SOURCE_BUILD   Run modelingservice/build-source.sh first
                                (default: true).
EOF
}

verify_arm64_image() {
  local image="$1"
  local architecture
  architecture=$(docker image inspect "$image" --format '{{.Architecture}} {{.Os}}')
  if [ "$architecture" != "arm64 linux" ]; then
    printf 'Unexpected image architecture: %s (expected: arm64 linux)\n' \
      "$architecture" >&2
    exit 1
  fi
}

FORCE=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force) FORCE=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ "$FORCE" != true ] && docker image inspect "$MODELING_IMAGE" >/dev/null 2>&1; then
  verify_arm64_image "$MODELING_IMAGE"
  printf 'Modeling arm64 image already exists: %s\n' "$MODELING_IMAGE"
  exit 0
fi

if ! docker image inspect "$RUNTIME_IMAGE" >/dev/null 2>&1; then
  printf 'Local Modeling runtime image not found: %s\n' "$RUNTIME_IMAGE" >&2
  printf 'Load a local arm64 JDK17 image or set AIBIZ_MODELING_RUNTIME_IMAGE.\n' >&2
  exit 1
fi
runtime_architecture=$(docker image inspect "$RUNTIME_IMAGE" --format '{{.Architecture}} {{.Os}}')
if [ "$runtime_architecture" != "arm64 linux" ]; then
  printf 'Unexpected runtime image architecture: %s (expected: arm64 linux)\n' \
    "$runtime_architecture" >&2
  exit 1
fi

case "$SOURCE_BUILD" in
  true)
    "$MODELINGSERVICE_DIR/build-source.sh"
    ;;
  false)
    ;;
  *)
    printf 'AIBIZ_MODELING_SOURCE_BUILD must be true or false; got: %s\n' "$SOURCE_BUILD" >&2
    exit 2
    ;;
esac

if [ ! -s "$PROVIDER_JAR" ]; then
  printf 'Local provider JAR not found or empty: %s\n' "$PROVIDER_JAR" >&2
  printf 'Run modelingservice/build-source.sh or leave AIBIZ_MODELING_SOURCE_BUILD=true.\n' >&2
  exit 1
fi

stage=$(mktemp -d /tmp/modeling-arm64.XXXXXX)
trap 'rm -rf "$stage"' EXIT

cp "$PROVIDER_JAR" "$stage/ibizservicerunner-provider.jar"
cp "$MODELINGSERVICE_DIR/Dockerfile" "$stage/Dockerfile"
mkdir -p "$stage/docker"
cp "$MODELINGSERVICE_DIR/docker/entrypoint-waitfor.sh" "$stage/docker/entrypoint-waitfor.sh"
cp "$MODELINGSERVICE_DIR/docker/wait-for.sh" "$stage/docker/wait-for.sh"

docker build \
  --pull=false \
  --platform linux/arm64 \
  --build-arg "RUNTIME_IMAGE=$RUNTIME_IMAGE" \
  -t "$MODELING_IMAGE" \
  "$stage"
verify_arm64_image "$MODELING_IMAGE"
printf 'Built modeling arm64 image: %s\n' "$MODELING_IMAGE"
