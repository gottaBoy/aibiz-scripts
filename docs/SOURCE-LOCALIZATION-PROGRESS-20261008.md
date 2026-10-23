# 源码本地化进度记录（2026-10-08）

## 当前状态

源码本地化主体工作已完成，四个相关仓库的代码均已提交：

- `plm-web`: `85717e05`（人员选择分页修复）、`de4c9f07`（插件产物刷新）、`4b5a51f8`（建模运行时路由）、`050f3eb4`（本地容器下发防陈旧校验）
- `plm-e2e`: `731b451`（本地 PLM 插件与流程覆盖）
- `scripts`: `76902db`（建模源码来源验证加固）
- `modelingweb`: `68c18310`（建模源码覆盖层来源验证）

`plm-web` 现在提供 `pnpm deploy:local`，会按顺序重建插件、重建主应用、重启 `plmweb` 容器、等待健康检查，并校验 `public/`、`dist/` 与容器 HTTP 返回字节一致。该脚本已随部署契约测试提交。

## 已完成验证

- `scripts`: 624 个聚焦契约测试通过
- `modelingweb/app`: 619 个 Vitest 测试 + 8 个原生报告测试通过，`pnpm verify:release --dist` 通过，11 个 import-map 来源验证通过
- `plm-e2e`: 39 个配置测试通过，完整 Playwright 回归桌面端和移动端均 85/85 通过
- `plm-web`: 人员选择 21/21、资源甘特 4/4、主应用与插件构建通过，部署契约测试通过
- 本地容器：`pnpm deploy:local --no-build` 已通过，两个关键插件（person-select、resource-gantt）的字节一致性已验证

## 公钥缓存修复（2026-10-08 晚）

### 根因

`JWTSysUAAUtilRuntime` 将 UAA 公钥无限期缓存在进程内存中。UAA 重启或密钥轮换后，下游服务仍使用旧公钥验签，RSA 验签失败并被上游转换为 401。

### 修复

- 公钥缓存增加 5 分钟 TTL。
- RSA 验签失败时强制刷新公钥并重试一次。
- 公钥拉取拆分为 `fetchPublicKeyString()`，便于单测隔离。
- 刷新失败后 5 秒节流，成功刷新后清空节流状态。
- 过期判断改用注入的 `clock`。
- `libs/ibiz-cloud-core/pom.xml` 增加 JUnit Jupiter test 依赖。

### 测试与验证

- 聚焦单测：`JWTSysUAAUtilRuntimeTest`，5/5 通过。
- allinone/gateway 源码镜像：`aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-key-refresh-20261008`、`aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-key-refresh-20261008`，构建成功并已运行。
- plmservice 源码镜像：`aibiz/plmservice:local-key-refresh-20261008`，内嵌 `ibiz-cloud-core` 与修复版 jar SHA256 一致，构建成功并已运行。
- 平台冒烟：登录、allinone 受保护接口、gateway 路由全部 PASS。
- UAA 重启回归：UAA 重启后的短暂 500 是 Nacos 服务发现窗口；服务注册完成后同一冒烟全部 PASS。
- 深度回归：`二次开发 every tree node and tab renders @deep-sweep` 通过。
- 配置回归：`modeling-ide-contract` 6/6 通过，`artifact-isolation` 10/10 通过。

当前运行镜像：

- `ibiz-ebsx-allinone`: `aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-key-refresh-20261008`
- `ibiz-ebsx-gateway`: `aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-key-refresh-20261008`
- `plmservice`: `aibiz/plmservice:local-key-refresh-20261008`
- `ibizlab-uaa-api`: `aibiz/uaa:source-built-local-cache-fix2-jdk8-20261008`

基础设施继续共用现有容器：

- MySQL: `mysql`，镜像 `swr.ap-southeast-1.myhuaweicloud.com/find1024/mysql:5.7.41.ibiz-arm64`
- Redis: `sub2api-redis`，网络别名 `redis`

## 深度扫描记录

此前深度功能扫描因“二次开发”菜单失败中断。2026-10-08 晚已重跑该用例，`二次开发 every tree node and tab renders @deep-sweep` 通过（2 个执行项通过，含认证 setup）。

最新通过报告目录：`/home/my/workspace/ainfra/aibiz/plm-e2e/test-results/runs/2026-10-08T15-46-54.108Z-bced99bc-4c4d-4f0f-9de9-1ef7583aae98`

## 下次待办

1. 如需最终收口，重跑完整深度扫描（桌面端 + 移动端）。
2. 如需收尾历史代码变更，整理并提交 `ibiz-service-hub` 与 `plm` 中的本次修复文件。
3. 旧镜像和旧容器保留作回滚，不建议在当前版本上立即清理。

## 环境信息

- 容器：`plmweb`
- 地址：`http://127.0.0.1:30250/ibizplm-plmweb/`
- 部署注意：容器启动时才复制 bind mount 的静态资源，重建后必须重启容器，使用 `pnpm deploy:local` 可自动处理
