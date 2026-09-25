#!/bin/sh
set -eu

PROBE_CONTAINER=${AIBIZ_NETWORK_CONTAINER:-ibiz-ebsx-allinone}
if ! docker exec "$PROBE_CONTAINER" true >/dev/null 2>&1; then
  echo "Network probe container is unavailable: $PROBE_CONTAINER" >&2
  exit 1
fi

wait_for_tcp() {
  host="$1"
  port="$2"
  label="$3"
  attempts=0

  while ! docker exec "$PROBE_CONTAINER" nc -z -w 2 "$host" "$port" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 150 ]; then
      echo "platform dependency timed out: ${label} (${host}:${port})" >&2
      exit 1
    fi
    echo "waiting for ${label} (${host}:${port})..."
    sleep 2
  done
}

wait_for_http() {
  url="$1"
  label="$2"
  attempts=0

  while ! docker exec "$PROBE_CONTAINER" wget -qO /dev/null --timeout=3 "$url" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 150 ]; then
      echo "platform dependency HTTP check timed out: ${label} (${url})" >&2
      exit 1
    fi
    echo "waiting for ${label} (${url})..."
    sleep 2
  done
}

wait_for_tcp "${NACOS_HOST:-nacos}" "${NACOS_PORT:-8848}" "Nacos"
wait_for_http \
  "http://${NACOS_HOST:-nacos}:${NACOS_PORT:-8848}/nacos/actuator/health" \
  "Nacos API"
wait_for_tcp "${MYSQL_HOST:-mysql}" "${MYSQL_PORT:-3306}" "MySQL"
wait_for_tcp "${REDIS_HOST:-redis}" "${REDIS_PORT:-6379}" "Redis"
wait_for_tcp "${ZOOKEEPER_HOST:-zoo1}" "${ZOOKEEPER_PORT:-2181}" "ZooKeeper"
wait_for_tcp "${EMQX_HOST:-emqx}" "${EMQX_PORT:-8083}" "EMQX"
wait_for_tcp "ibiz-ebsx-allinone" "30000" "all-in-one service"
wait_for_tcp "ibizlab-uaa-api" "32666" "UAA service"
