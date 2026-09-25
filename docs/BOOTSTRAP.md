# Bootstrap The Development Workspace

This document and `bootstrap-workspace.sh` set up a complete source-development
workspace on a new machine.

## Prerequisites

- 4 CPU cores or more; 16 GB RAM is recommended.
- At least 80 GB of free disk space.
- Docker 24 or newer and Docker Compose v2.26.1 or newer.
- Node.js 20 or newer and pnpm 8.x (`corepack enable`).
- JDK 17 and Maven 3.9 for `modelingservice` source builds.
- SSH access to `git@github.com`.

## One-Command Bootstrap

If the scripts repository is already checked out:

```sh
cd /path/to/aibiz/scripts
./bootstrap-workspace.sh
```

On a completely empty machine, first clone the scripts repository with its
expected local directory name:

```sh
mkdir -p ~/workspace/aibiz
cd ~/workspace/aibiz
git clone git@github.com:gottaBoy/aibiz-scripts.git scripts
cd scripts
./bootstrap-workspace.sh
```

The script clones or updates the remaining repositories:

| GitHub repository | Required local directory |
|---|---|
| `plm` | `plm` |
| `plm-web` | `plm-web` |
| `plm-e2e` | `plm-e2e` |
| `aibiz-scripts` | `scripts` |
| `ibiz-app-hub` | `ibiz-app-hub` |
| `ibiz-service-hub` | `ibiz-service-hub` |
| `modeling-web` | `modelingweb` |
| `modeling-service` | `modelingservice` |
| `task-service` | `task7` |

Local directory names are important. Compose and verification scripts use
relative paths between sibling repositories.

The PLM repository uses branch `mydev` by default. Override it with:

```sh
AIBIZ_PLM_BRANCH=main ./bootstrap-workspace.sh
```

Dependency installation uses `https://registry.npmmirror.com` by default. This
overrides repository `.npmrc` files that point to the internal Nexus registry.
On a machine inside that network, use:

```sh
AIBIZ_NPM_REGISTRY=http://172.16.240.221:8081/repository/ibizsys/ \
  ./bootstrap-workspace.sh
```

## Bootstrap Behavior

By default, the bootstrap:

1. Clones or fast-forward updates all nine repositories.
2. Installs frontend dependencies.
3. Starts `plm/deploy/compose/docker-compose-dev.yml` with the `modeling` profile.
4. Waits for the core platform.
5. Runs the idempotent database migration.
6. Runs `harness-baseline.sh`.

Useful variants:

```sh
# Prepare code and dependencies without starting containers
./bootstrap-workspace.sh --no-start

# Clone or update code only
./bootstrap-workspace.sh --clone-only

# Start containers but skip migrations and baseline smoke
./bootstrap-workspace.sh --no-migration --no-baseline
```

For a non-default workspace root:

```sh
AIBIZ_WORKSPACE_ROOT=/path/to/aibiz ./bootstrap-workspace.sh
```

## Service URLs

| Service | URL |
|---|---|
| PLM source frontend | `http://127.0.0.1:4173/` |
| PLM container frontend | `http://127.0.0.1:30250/ibizplm-plmweb/` |
| Modeling frontend | `http://127.0.0.1:32003/modeldesign/` |
| Modeling API | `http://127.0.0.1:32002` |
| UAA | `http://127.0.0.1:32666` |
| Task | `http://127.0.0.1:30088` |

The local PLM test account is:

```text
demo_admin / 123456
```

## PLM Frontend Development

```sh
cd "$WORKSPACE_ROOT/plm-web"
pnpm dev --host 127.0.0.1 --port 4173
```

Business, modeling, JSON Schema and code-list requests go to the gateway, the
same front door the container uses; the gateway resolves them against the
registered services, so a source-built `plmservice` is picked up automatically.

| Route family | Default target | Override |
|---|---|---|
| `v7`, `uaa`, `configs`, `appdata` | `http://127.0.0.1:30000` | `AIBIZ_PLATFORM_API_TARGET` |
| everything else under `/api/ibizplm__plmweb` | `http://127.0.0.1:30086` | `AIBIZ_GATEWAY_API_TARGET` |

Build and preview the production bundle:

```sh
cd "$WORKSPACE_ROOT/plm-web"
pnpm build
pnpm preview --host 127.0.0.1 --port 4173
```

## PLM Backend Source Build

The bootstrap script builds the PLM backend from source and starts it with the
local compose overlay by default:

```sh
cd "$WORKSPACE_ROOT/scripts"
./bootstrap-workspace.sh
```

The resulting container is `aibiz/plmservice:local`. Disable the source build
only when a prebuilt backend image is required:

```sh
AIBIZ_USE_LOCAL_PLM_SOURCE=false ./bootstrap-workspace.sh
```

On arm64 hosts, bootstrap registers Docker amd64 emulation before starting
legacy amd64-only frontend and Task images. The registration is host-level
Docker configuration and may need to be repeated after a host reboot.

## Modeling Frontend Development

Start the stack first, then run:

```sh
cd "$WORKSPACE_ROOT/modelingweb/app"
pnpm dev:source
```

The entry point is `http://127.0.0.1:4173/`.

Build and deploy the local modeling bundle into the 32003 stack:

```sh
cd "$WORKSPACE_ROOT/modelingweb/app"
pnpm build

cd "$WORKSPACE_ROOT"
AIBIZ_USE_LOCAL_WEB_DIST=true scripts/restart-modeling-stack.sh
```

## Modeling Backend Source Build

The Maven source project is in `ibiz-service-hub`; `modelingservice` contains
the service source, SQL, runtime configuration, and build entry point:

```sh
cd "$WORKSPACE_ROOT/modelingservice"
./build-source.sh
```

The build requires JDK 17 and Maven running on JDK 17. Its provider JAR is
written to `ibiz-service-hub/ibiz-service-runner/ibizservicerunner-provider.jar`.

To replace the current `modelingservice` container:

```sh
cd "$WORKSPACE_ROOT/modelingservice"
./start-docker.sh
```

First confirm the Docker network created by Compose:

```sh
docker network ls | grep agent_network
```

`start-docker.sh` currently expects `compose_agent_network`. Adjust that value
if the new machine uses a different Compose project name.

## Task Source

The stack still runs the prebuilt Task image:

```text
task7:v124.2.opensource.25082603
```

`task7` is the source baseline for future Task development and custom image
builds. No source-built Task image exists yet.

## Verification

```sh
cd "$WORKSPACE_ROOT/scripts"
npm test

cd "$WORKSPACE_ROOT/plm-e2e"
pnpm test

cd "$WORKSPACE_ROOT/modelingweb/app"
pnpm verify:plugins
pnpm test:plugins:deployment
pnpm test:run
```

## Troubleshooting

If containers fail to become healthy:

```sh
docker ps -a
docker compose -f "$WORKSPACE_ROOT/plm/deploy/compose/docker-compose-dev.yml" \
  --env-file "$WORKSPACE_ROOT/plm/deploy/compose/.dev" ps
```

Inspect logs:

```sh
docker logs --tail 200 ibiz-ebsx-allinone
docker logs --tail 200 plmservice
docker logs --tail 200 modelingservice
docker logs --tail 200 modelingweb
docker logs --tail 200 task
```

If container names conflict with an older deployment:

```sh
"$WORKSPACE_ROOT/scripts/inspect-compose-conflicts.sh"
```

Do not run `docker compose down -v` unless data loss is acceptable; it deletes
the MySQL, Task, EMQX, and plugin data volumes.
