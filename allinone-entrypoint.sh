#!/bin/sh
set -eu
set -f

log() {
  printf '%s\n' "[allinone-start] $*" >&2
}

fail() {
  log "$*"
  exit 1
}

positive_integer() {
  case "$2" in
    ''|*[!0-9]*) fail "$1 must be a positive integer" ;;
  esac
  [ "$2" -gt 0 ] 2>/dev/null || fail "$1 must be a positive integer"
}

prepare_liquibase_driver() {
  [ "${ALLINONE_PREPARE_LIQUIBASE_DRIVER:-false}" = "true" ] || return 0
  command -v unzip >/dev/null 2>&1 || fail "required command is missing: unzip"

  java_path=$(command -v java)
  resolved_java_path=$(readlink -f "$java_path" 2>/dev/null || printf '%s' "$java_path")
  case "$resolved_java_path" in
    */jre/bin/java) jre_dir=${resolved_java_path%/bin/java} ;;
    */bin/java) jre_dir=${resolved_java_path%/bin/java} ;;
    *) log "unable to identify JRE extension directory; skipping Liquibase driver preparation"; return 0 ;;
  esac

  ext_dir="$jre_dir/lib/ext"
  [ -d "$ext_dir" ] || {
    log "JRE has no extension directory; skipping Liquibase driver preparation"
    return 0
  }

  driver_entry=$(unzip -l "$jar" 2>/dev/null |
    awk '{ name=$NF; if (index(name, "BOOT-INF/lib/mysql-connector-java-") == 1 &&
      substr(name, length(name) - 3) == ".jar") { print name; exit } }')
  [ -n "$driver_entry" ] || {
    log "no MySQL Connector/J nested in $jar; skipping Liquibase driver preparation"
    return 0
  }

  driver_target="$ext_dir/mysql-connector-java.jar"
  if [ ! -s "$driver_target" ]; then
    driver_tmp="$driver_target.$$"
    unzip -p "$jar" "$driver_entry" > "$driver_tmp" ||
      fail "failed to extract Liquibase JDBC driver from $jar"
    mv "$driver_tmp" "$driver_target"
    log "prepared Liquibase JDBC driver from $driver_entry"
  fi
}

valid_port() {
  positive_integer "$1" "$2"
  [ "$2" -le 65535 ] 2>/dev/null || fail "$1 must be at most 65535"
}

probe_tcp() {
  if command -v nc >/dev/null 2>&1; then
    # nc already bounds the connect attempt; this also works with BusyBox
    # timeout, whose CLI differs from GNU coreutils.
    nc -z -w 2 "$1" "$2" >/dev/null 2>&1
    return
  fi
  if command -v bash >/dev/null 2>&1; then
    # BusyBox uses "timeout -t SECONDS", while GNU timeout uses a positional
    # duration. Detect the dialect only for the fallback path.
    if timeout 1 true >/dev/null 2>&1; then
      timeout 3 bash -c 'exec 3<>"/dev/tcp/$1/$2"' -- "$1" "$2" >/dev/null 2>&1
    else
      timeout -t 3 bash -c 'exec 3<>"/dev/tcp/$1/$2"' -- "$1" "$2" >/dev/null 2>&1
    fi
    return
  fi
  return 1
}

server_port=${SERVER_PORT:-30000}
valid_port SERVER_PORT "$server_port"
for tool in bash timeout; do
  command -v "$tool" >/dev/null 2>&1 || fail "required command is missing: $tool"
done

if [ "${1:-}" = "--healthcheck" ]; then
  [ "$#" -eq 1 ] || fail "--healthcheck does not accept dependency arguments"
  if probe_tcp 127.0.0.1 "$server_port"; then
    exit 0
  fi
  fail "no listener at 127.0.0.1:$server_port"
fi

dependency_timeout=${ALLINONE_DEPENDENCY_TIMEOUT:-120}
startup_timeout=${ALLINONE_STARTUP_TIMEOUT:-300}
probe_interval=${ALLINONE_PROBE_INTERVAL:-2}
shutdown_timeout=${ALLINONE_SHUTDOWN_TIMEOUT:-20}
failure_threshold=${ALLINONE_FAILURE_THRESHOLD:-3}
positive_integer ALLINONE_DEPENDENCY_TIMEOUT "$dependency_timeout"
positive_integer ALLINONE_STARTUP_TIMEOUT "$startup_timeout"
positive_integer ALLINONE_PROBE_INTERVAL "$probe_interval"
positive_integer ALLINONE_SHUTDOWN_TIMEOUT "$shutdown_timeout"
positive_integer ALLINONE_FAILURE_THRESHOLD "$failure_threshold"
for tool in java date sleep; do
  command -v "$tool" >/dev/null 2>&1 || fail "required command is missing: $tool"
done

jar=${ALLINONE_JAR:-/${JAR_FILENAME:-ibiz-ebsx-allinone-rt}.jar}
[ -r "$jar" ] || fail "application JAR is not readable: $jar"
prepare_liquibase_driver

java_pid=''
stop_java() {
  [ -n "$java_pid" ] || return 0
  if kill -0 "$java_pid" 2>/dev/null; then
    kill -TERM "$java_pid" 2>/dev/null || :
    stop_deadline=$(($(date +%s) + shutdown_timeout))
    while kill -0 "$java_pid" 2>/dev/null; do
      if [ "$(date +%s)" -ge "$stop_deadline" ]; then
        log "Java did not stop within ${shutdown_timeout}s; sending SIGKILL"
        kill -KILL "$java_pid" 2>/dev/null || :
        break
      fi
      sleep 1
    done
  fi
  wait "$java_pid" 2>/dev/null || :
  java_pid=''
}
trap 'stop_java' EXIT
trap 'trap "" INT TERM; log "received SIGTERM"; stop_java; exit 143' TERM
trap 'trap "" INT TERM; log "received SIGINT"; stop_java; exit 130' INT

if [ "$#" -eq 0 ]; then
  set -- \
    "${MYSQL_HOST:-mysql}:${MYSQL_PORT:-3306}" \
    "${NACOS_HOST:-nacos}:${NACOS_PORT:-8848}" \
    "${EMQX_HOST:-emqx}:${EMQX_PORT:-8083}"
fi
for endpoint in "$@"; do
  host=${endpoint%:*}
  port=${endpoint##*:}
  case "$host" in
    ''|-*|*:*|*[!A-Za-z0-9_.-]*) fail "invalid dependency host: $endpoint" ;;
  esac
  [ "$host" != "$endpoint" ] || fail "dependency must be host:port: $endpoint"
  valid_port "dependency port" "$port"
done
for endpoint in "$@"; do
  host=${endpoint%:*}
  port=${endpoint##*:}
  deadline=$(($(date +%s) + dependency_timeout))
  log "waiting for dependency $endpoint (limit ${dependency_timeout}s)"
  until probe_tcp "$host" "$port"; do
    [ "$(date +%s)" -lt "$deadline" ] || fail "dependency timed out: $endpoint; Java was not started"
    sleep "$probe_interval"
  done
done

# A listening Nacos socket is the portable readiness check available in the
# minimal JRE image. HTTP probing is opt-in because Nacos health paths differ
# between the supported image variants.
if [ "${ALLINONE_NACOS_HTTP_CHECK:-false}" = "true" ] &&
  command -v curl >/dev/null 2>&1; then
  nacos_health_url=${ALLINONE_NACOS_HEALTH_URL:-http://${NACOS_HOST:-nacos}:${NACOS_PORT:-8848}/nacos/actuator/health}
  deadline=$(($(date +%s) + dependency_timeout))
  log "waiting for Nacos health endpoint (limit ${dependency_timeout}s)"
  until curl --noproxy '*' --fail --silent --show-error --connect-timeout 2 --max-time 3 \
    "$nacos_health_url" >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$deadline" ] || fail "Nacos health endpoint timed out; Java was not started"
    sleep "$probe_interval"
  done
else
  log "using Nacos TCP readiness only"
fi

# Keep the pinned image's original Java 17 entrypoint semantics.
log "starting $jar; waiting for 127.0.0.1:$server_port (limit ${startup_timeout}s)"
# JAVA_OPTS is intentionally word-split; set -f prevents wildcard expansion.
java ${JAVA_OPTS:-} "-Duser.timezone=${TZ:-Asia/Shanghai}" \
  -Djava.security.egd=file:/dev/./urandom \
  -jar "$jar" "--server.port=$server_port" &
java_pid=$!

deadline=$(($(date +%s) + startup_timeout))
ready=false
failures=0
while kill -0 "$java_pid" 2>/dev/null; do
  if probe_tcp 127.0.0.1 "$server_port"; then
    if [ "$ready" = false ]; then
      log "listener ready at 127.0.0.1:$server_port"
      ready=true
    fi
    failures=0
  elif [ "$ready" = true ]; then
    failures=$((failures + 1))
    [ "$failures" -lt "$failure_threshold" ] ||
      fail "listener lost for $failures consecutive probes; terminating Java"
  else
    [ "$(date +%s)" -lt "$deadline" ] ||
      fail "startup timed out without a listener on $server_port; terminating Java"
  fi
  sleep "$probe_interval"
done

status=0
wait "$java_pid" || status=$?
java_pid=''
log "Java exited with status $status"
[ "$status" -ne 0 ] || status=1
exit "$status"
