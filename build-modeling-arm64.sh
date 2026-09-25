#!/usr/bin/env bash

set -euo pipefail

MODELING_IMAGE=${AIBIZ_MODELING_IMAGE:-aibiz/modelingservice-arm64:local}
SOURCE_IMAGE=${AIBIZ_MODELING_SOURCE_IMAGE:-swr.ap-southeast-1.myhuaweicloud.com/find1024/ibiz-service-runner:v8.1.0.570.33-modeling.250826}
BASE_IMAGE=${AIBIZ_MODELING_BASE_IMAGE:-swr.ap-southeast-1.myhuaweicloud.com/find1024/ibiz-service-runner:v8.1.0.577.77.plm.260322-arm64}

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Builds an arm64 Modeling image by copying the provider jar from the source image
into the arm64 base image.

Options:
  --force    Rebuild even if the target image already exists.
  -h, --help Show this help.
Environment:
  AIBIZ_MODELING_IMAGE          Target image tag.
  AIBIZ_MODELING_SOURCE_IMAGE   Image containing the Modeling provider jar.
  AIBIZ_MODELING_BASE_IMAGE     Arm64 base image.
EOF
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
  printf 'Modeling arm64 image already exists: %s\n' "$MODELING_IMAGE"
  exit 0
fi

if ! docker image inspect "$SOURCE_IMAGE" >/dev/null 2>&1; then
  docker pull "$SOURCE_IMAGE"
fi
if ! docker image inspect "$BASE_IMAGE" >/dev/null 2>&1; then
  docker pull --platform linux/arm64 "$BASE_IMAGE"
fi

stage=$(mktemp -d /tmp/modeling-arm64.XXXXXX)
trap 'rm -rf "$stage"' EXIT

container=$(docker create --platform linux/amd64 "$SOURCE_IMAGE")
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$stage"' EXIT
docker cp "$container:/ibizservicerunner-provider.jar" "$stage/ibizservicerunner-provider.jar"
docker rm "$container"
trap 'rm -rf "$stage"' EXIT

cat >"$stage/Dockerfile" <<EOF
FROM $BASE_IMAGE
COPY ibizservicerunner-provider.jar /ibizservicerunner-provider.jar
EOF

docker build --platform linux/arm64 -t "$MODELING_IMAGE" "$stage"
architecture=$(docker image inspect "$MODELING_IMAGE" --format '{{.Architecture}} {{.Os}}')
if [ "$architecture" != "arm64 linux" ]; then
  printf 'Unexpected image architecture: %s (expected: arm64 linux)\n' "$architecture" >&2
  exit 1
fi
printf 'Built modeling arm64 image: %s\n' "$MODELING_IMAGE"
