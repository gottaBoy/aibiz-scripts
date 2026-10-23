# 本地全链路启动与依赖记录（2026-10-09）

本文记录当前可用的正式本地源码运行链路。核心原则：只启动、不重建；MySQL 和 UAA 是手工容器，不能用大范围 `docker compose up` 接管。

## 当前入口

| 用途 | 地址 |
| --- | --- |
| PLM 桌面端 | `http://127.0.0.1:30250/ibizplm-plmweb/` |
| PLM 服务 | `http://127.0.0.1:30251` |
| Platform allinone | `http://127.0.0.1:30000` |
| Platform gateway | `http://127.0.0.1:30086` |
| UAA | `http://127.0.0.1:32666` |
| Modeling service | `http://127.0.0.1:32002` |
| Modeling web | `http://127.0.0.1:32003` |
| Native Central 候选端 | `http://127.0.0.1:32008/central/` |
| Native ModelDesign 候选端 | `http://127.0.0.1:32009/modeldesign/` |
| task | `http://127.0.0.1:30088` |
| harness UI | `http://127.0.0.1:19323` |
| sub2api | `http://127.0.0.1:8080` |

测试账号：`aibizhi / 123456`（接口管理员）、`demo_admin / 123456`、`preview_admin / 123456`。

## 当前镜像

| 容器 | 当前镜像 |
| --- | --- |
| `mysql` | `swr.ap-southeast-1.myhuaweicloud.com/find1024/mysql:5.7.41.ibiz-arm64` |
| `nacos` | `aibiz/nacos-server:v2.0.3-jre17` |
| `emqx` | `emqx/emqx:5.8.0` |
| `ibiz-ebsx-allinone` | `aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-key-refresh-20261008` |
| `ibizlab-uaa-api` | `aibiz/uaa:source-built-local-cache-fix2-jdk8-20261008` |
| `ibiz-ebsx-gateway` | `aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-key-refresh-20261008` |
| `plmservice` | `aibiz/plmservice:local-key-refresh-20261008` |
| `plmweb` | `aibiz/plmweb:local`，bind mount `plm-web/dist` |
| `modelingservice` | `aibiz/modelingservice-arm64:source-built` |
| `modeling-plugins` | `aibiz/modeling-plugins:local` |
| `modelingweb` | `aibiz/modelingweb:local` |
| Native 候选端 x2 | `aibiz/modelingweb:local` |
| `task` | `aibiz/task7:source-built-2798cec3` |
| `harness-ui` | `node:22-alpine` |
| `sub2api` | `weishaw/sub2api:latest` |

`sub2api` 是独立 Compose 项目：`/home/my/workspace/ainfra/sub2api-deploy`，使用自己的 Postgres 和 Redis，不使用 MySQL。

## 数据库

复用现有 MySQL 容器 `mysql`，端口 `3306`。

| 数据库 | 用户 | 使用方 |
| --- | --- | --- |
| `plm` | `plm` | `plmservice` |
| `a_lab01_3f9ebc219` | `a_lab01_3f9ebc219` | allinone、UAA、PLM runtime datasource |
| `ibizapi` | `ibizapi` | modelingservice、task |
| `nacos_conf` | `nacos` | Nacos |

`a_lab01_3f9ebc219` 是当前运行配置中的正式数据库名，不能改名或删除。不要重建 MySQL，不要删除数据库，不要用 Compose 重建 MySQL 覆盖现有卷。

## 启动顺序

1. Docker daemon
1. `docker start mysql`
1. `docker start nacos`
1. `docker start emqx`
1. `docker start ibiz-ebsx-allinone`，等待 healthy
1. `docker start ibizlab-uaa-api`，确认日志稳定
1. `docker start ibiz-ebsx-gateway`
1. `docker start plmservice`，等待 healthy
1. `docker start plmweb`
1. `docker start modelingservice`，等待 healthy
1. `docker start modeling-plugins`
1. `docker start modelingweb`
1. `docker start task`
1. `docker start compose-modelingweb-candidate-central-1`
1. `docker start compose-modelingweb-candidate-modeldesign-1`
1. `docker start harness-ui`
1. `sub2api` 独立启动：

```sh
cd /home/my/workspace/ainfra/sub2api-deploy
docker compose up -d
```

以上是“容器已存在时”的恢复顺序。不要使用宽泛的 `docker compose up -d` 替代它，因为当前 Compose 标签来自多次历史调用，直接合并启动可能重建错误容器。

## 依赖关系

- `nacos` 依赖 `mysql:nacos_conf`。
- `allinone` 等待 `mysql:3306`、`nacos:8848`、`emqx:8083`，使用 `a_lab01_3f9ebc219`。
- `ibizlab-uaa-api` 使用同一个 MySQL 库和 Nacos，当前为手工容器。
- `ibiz-ebsx-gateway` 依赖 UAA。
- `plmservice` 等待 gateway，主库 `plm`，runtime datasource `a_lab01_3f9ebc219`，并调用 allinone。
- `plmweb` 依赖 healthy `plmservice`。
- `modelingservice` 使用 `ibizapi`、Nacos、gateway。
- `modeling-plugins` 和 `modelingweb` 依赖 modeling 服务。
- `task` 使用 `ibizapi`。
- Native 候选端依赖 healthy `modelingservice`，当前 `NATIVE_PLATFORM_HOST=ibiz-ebsx-allinone`。
- `sub2api` 不依赖这条 MySQL/Nacos 链路。

## Compose lane

正式镜像覆盖文件：

```text
plm/deploy/compose/source-local.env
```

核心 PLM 容器（allinone、gateway、plmservice、plmweb、harness-ui）当前标签使用：

```text
docker-compose-dev.yml
docker-compose-plm-local.yml
docker-compose-modeling-native-candidate.yml
--env-file source-local.env
```

Native 候选端额外使用：

```text
docker-compose-modeling-native-service-candidate.yml
docker-compose-modeling-native-ai-code-runtime.yml
docker-compose-modeling-native-platform-local.yml
--env-file .dev
--env-file source-local.env
```

`docker compose ls` 显示的 10 个文件是历史调用的并集，不是当前重启命令。以容器标签和本文为准。

### Native 双 lane

默认 lane：

```text
NATIVE_MODELING_LANE=source
```

使用 `.dev + source-local.env`，连接 `ibiz-ebsx-allinone`，这是当前正式链路。

隔离验证 lane：

```text
NATIVE_MODELING_LANE=sourceBuiltIsolated
```

使用 `.dev + source-built-local.env`，额外加载 `docker-compose-modeling-native-isolated-platform.yml`，连接 `ibiz-ebsx-allinone-local`，端口是旧的 `30100/30186` lane。只有显式指定时才会使用。

## 日常巡检

```sh
cd /home/my/workspace/ainfra/aibiz
scripts/local-runtime-doctor.sh
```

该脚本只读，不启动、不停止、不重建容器。它会检查容器、镜像、健康状态、端口、手工容器状态、Compose 配置标签、Native 平台路由和 `source-local.env`。

回归基线：

```sh
cd /home/my/workspace/ainfra/aibiz
scripts/harness-baseline.sh
```

## 禁止事项

- 不要 `docker compose up mysql`。
- 不要 `docker compose up ibizlab-uaa-api`，当前手工 UAA 与 Compose 定义的 entrypoint 不一致。
- 不要删除或重建 MySQL 卷。
- 不要删除、改名或迁移 `a_lab01_3f9ebc219`。
- 不要拉取新的业务镜像；当前本地镜像均为 `pull_policy: never` 或本地已存在。
- 不要把 `source-local.env` 和 `source-built-local.env` 混在同一个默认命令里。
- 不要使用 `docker compose ls` 的文件并集作为重启命令。

## 已知非相关问题

`mattermost` 当前在重启，但它不属于 PLM/Modeling/sub2api 链路，本文和巡检脚本均不处理它。
