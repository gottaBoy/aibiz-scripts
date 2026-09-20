#!/bin/bash
set -eu
set -f

# Opt-in wrapper for task7:v124.2.opensource.25082603. Mount this file read-only;
# keep the image entrypoint, JVM settings and task_data mount unchanged.
# Requires Bash, GNU timeout, util-linux setsid, curl, ps, awk and a writable /tmp.
log() {
  printf '%s\n' "[task-start] $*" >&2
}

fail() {
  log "$*"
  exit 1
}

positive_integer() {
  case "$2" in
    ''|*[!0-9]*) fail "$1 must be a positive integer" ;;
  esac
  [[ "$2" =~ ^[1-9][0-9]{0,8}$ ]] || fail "$1 must be a positive integer (at most 9 digits)"
}

valid_port() {
  positive_integer "$1" "$2"
  [ "$2" -le 65535 ] || fail "$1 must be at most 65535"
}

probe_http() {
  local response code bytes
  response=$(curl --noproxy '*' --silent --output /dev/null --connect-timeout 2 \
    --max-time "$1" --write-out '%{http_code} %{size_download}' \
    "http://127.0.0.1:$server_port/SAPAAS/" 2>/dev/null) || return 1
  read -r code bytes <<< "$response"
  # Match the harness contract, including an application requiring authentication.
  case "$code" in
    2??) [[ "$bytes" =~ ^[0-9]+$ ]] && [ "$bytes" -gt 0 ] ;;
    3??|401|403) return 0 ;;
    *) return 1 ;;
  esac
}

probe_tcp() {
  timeout -k 1 "$3" bash -c 'exec 3<>"/dev/tcp/$1/$2"' -- "$1" "$2" >/dev/null 2>&1
}

remaining_budget() {
  local remaining=$(($1 - $(date +%s)))
  [ "$remaining" -gt 0 ] || return 1
  if [ "$remaining" -gt "$2" ]; then remaining=$2; fi
  printf '%s\n' "$remaining"
}

process_in_group() {
  local info group state
  # procps-ng 3.3.10 treats a comma after an empty header as header text.
  info=$(ps -o pgid= -o stat= -p "$1" 2>/dev/null) || return 1
  read -r group state <<< "$info"
  [ "$group" = "$legacy_pid" ] || return 1
  case "$state" in
    ''|Z*|X*) return 1 ;;
  esac
}

group_alive() {
  ps -e -o pgid= -o stat= | awk -v group="$legacy_pid" \
    '$1 == group && $2 !~ /^[ZX]/ { alive = 1 } END { exit !alive }'
}

legacy_pid=''
runtime_dir=''
stop_legacy() {
  if [ -n "$legacy_pid" ]; then
    # The original entrypoint starts Java in the background and tails its log.
    # A dedicated process group also covers tail and initialization subprocesses.
    kill -TERM -- "-$legacy_pid" 2>/dev/null || :
    kill -TERM "$legacy_pid" 2>/dev/null || :
    local stop_deadline=$(($(date +%s) + shutdown_timeout))
    while group_alive || kill -0 "$legacy_pid" 2>/dev/null; do
      if [ "$(date +%s)" -ge "$stop_deadline" ]; then
        log "shutdown timed out after ${shutdown_timeout}s; sending SIGKILL"
        kill -KILL -- "-$legacy_pid" 2>/dev/null || :
        kill -KILL "$legacy_pid" 2>/dev/null || :
        break
      fi
      sleep 1
    done
    wait "$legacy_pid" 2>/dev/null || :
    legacy_pid=''
  fi
  if [ -n "$runtime_dir" ]; then
    rm -rf -- "$runtime_dir"
    runtime_dir=''
  fi
}

server_port=${TASK_PORT:-8080}
http_timeout=${TASK_HTTP_TIMEOUT:-3}
valid_port TASK_PORT "$server_port"
positive_integer TASK_HTTP_TIMEOUT "$http_timeout"
command -v curl >/dev/null 2>&1 || fail "required command is missing: curl"

if [ "${1:-}" = "--healthcheck" ]; then
  [ "$#" -eq 1 ] || fail "--healthcheck does not accept dependency arguments"
  probe_http "$http_timeout" && exit 0
  fail "SAPAAS HTTP check failed on port $server_port"
fi

dependency_timeout=${TASK_DEPENDENCY_TIMEOUT:-120}
startup_timeout=${TASK_STARTUP_TIMEOUT:-300}
probe_interval=${TASK_PROBE_INTERVAL:-2}
shutdown_timeout=${TASK_SHUTDOWN_TIMEOUT:-20}
failure_threshold=${TASK_FAILURE_THRESHOLD:-3}
positive_integer TASK_DEPENDENCY_TIMEOUT "$dependency_timeout"
positive_integer TASK_STARTUP_TIMEOUT "$startup_timeout"
positive_integer TASK_PROBE_INTERVAL "$probe_interval"
positive_integer TASK_SHUTDOWN_TIMEOUT "$shutdown_timeout"
positive_integer TASK_FAILURE_THRESHOLD "$failure_threshold"
for tool in bash timeout setsid ps awk date sleep mktemp rm; do
  command -v "$tool" >/dev/null 2>&1 || fail "required command is missing: $tool"
done
ps -o pid= -p "$$" >/dev/null 2>&1 || fail "process inspection is unavailable"

legacy_entrypoint=${TASK_LEGACY_ENTRYPOINT:-/entrypoint-waitfor.sh}
[ -r "$legacy_entrypoint" ] || fail "legacy entrypoint is not readable"
if [ "$#" -eq 0 ]; then
  set -- "${DBSERVERIP:-mysql}:${DBSERVERPORT:-3306}"
fi
for endpoint in "$@"; do
  host=${endpoint%:*}
  port=${endpoint##*:}
  case "$host" in
    ''|-*|*:*|*[!A-Za-z0-9_.-]*) fail "invalid dependency host" ;;
  esac
  [ "$host" != "$endpoint" ] || fail "dependency must be host:port"
  valid_port "dependency port" "$port"
done

trap 'trap "" INT TERM; stop_legacy' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# One deadline covers all dependencies. Do not pass arguments to the old
# entrypoint: its /wait-for.sh -t 0 loop is unbounded.
deadline=$(($(date +%s) + dependency_timeout))
for endpoint in "$@"; do
  host=${endpoint%:*}
  port=${endpoint##*:}
  log "waiting for dependency $endpoint (total limit ${dependency_timeout}s)"
  while :; do
    budget=$(remaining_budget "$deadline" 3) ||
      fail "dependency timed out: $endpoint; legacy initialization was not started"
    if probe_tcp "$host" "$port" "$budget"; then break; fi
    budget=$(remaining_budget "$deadline" "$probe_interval") ||
      fail "dependency timed out: $endpoint; legacy initialization was not started"
    sleep "$budget"
  done
done

# Never reuse or remove an inherited PID file, particularly one on task_data.
# The pinned catalina.sh writes the real Java PID to CATALINA_PID.
runtime_dir=$(mktemp -d /tmp/task-start.XXXXXXXX)
export CATALINA_PID="$runtime_dir/catalina.pid"
deadline=$(($(date +%s) + startup_timeout))
log "starting legacy initialization; waiting for Tomcat PID and SAPAAS (limit ${startup_timeout}s)"
setsid bash "$legacy_entrypoint" &
legacy_pid=$!

java_pid=''
ready=false
failures=0
while :; do
  if ! kill -0 "$legacy_pid" 2>/dev/null; then
    status=0
    wait "$legacy_pid" || status=$?
    log "legacy entrypoint exited with status $status"
    [ "$status" -ne 0 ] || status=1
    exit "$status"
  fi

  if [ -s "$CATALINA_PID" ]; then
    candidate=''
    IFS= read -r candidate < "$CATALINA_PID" || :
    [[ "$candidate" =~ ^[1-9][0-9]{0,8}$ ]] && [ "$candidate" -gt 1 ] ||
      fail "invalid Tomcat PID file"
    [ -z "$java_pid" ] || [ "$java_pid" = "$candidate" ] ||
      fail "Tomcat PID changed unexpectedly"
    java_pid=$candidate
  fi
  if [ -n "$java_pid" ]; then
    process_in_group "$java_pid" ||
      fail "Tomcat PID is no longer running in the supervised group; stopping legacy tail"
  fi

  budget=$http_timeout
  if [ "$ready" = false ]; then
    budget=$(remaining_budget "$deadline" "$http_timeout") ||
      fail "startup timed out waiting for Tomcat PID and SAPAAS HTTP"
  fi
  if [ -n "$java_pid" ] && probe_http "$budget"; then
    # Java may exit during a successful HTTP probe.
    process_in_group "$java_pid" ||
      fail "Tomcat PID exited during SAPAAS HTTP check; stopping legacy tail"
    if [ "$ready" = false ]; then
      log "SAPAAS ready on port $server_port; Tomcat PID is supervised"
      ready=true
    fi
    failures=0
  elif [ "$ready" = true ]; then
    failures=$((failures + 1))
    [ "$failures" -lt "$failure_threshold" ] ||
      fail "SAPAAS HTTP lost for $failures consecutive probes"
  fi
  budget=$probe_interval
  if [ "$ready" = false ]; then
    budget=$(remaining_budget "$deadline" "$probe_interval") ||
      fail "startup timed out waiting for Tomcat PID and SAPAAS HTTP"
  fi
  sleep "$budget"
done
