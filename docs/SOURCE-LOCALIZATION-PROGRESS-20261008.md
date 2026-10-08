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

## 深度扫描中断记录

深度功能扫描已启动，但因“二次开发”菜单失败后按用户要求中断，未完成剩余用例。中断前已完成 18 个测试，其中桌面端 11 个通过、1 个失败，移动端 5 个通过，另有 setup 通过。

失败菜单：`二次开发`（desktop）
失败时长：约 18.4 秒
报告目录：`/home/my/workspace/ainfra/aibiz/plm-e2e/test-results/runs/2026-10-08T01-22-07.282Z-d9457d4d-cfbb-4ecc-89bf-7d58751380c7`

## 下次待办

1. 定位并修复“二次开发”深度扫描失败原因
2. 重跑完整深度扫描（桌面端 + 移动端）
3. 重跑 `modelingweb/app` 的 `pnpm test:run` 和 `pnpm verify:release --dist`
4. 重跑 `plm-web` 的发布验证（如可用）
5. 如需正式镜像验证，检查 `Dockerfile.plmweb` 并构建本地生产镜像
6. 最终提交所有新增修复和测试

## 环境信息

- 容器：`plmweb`
- 地址：`http://127.0.0.1:30250/ibizplm-plmweb/`
- 部署注意：容器启动时才复制 bind mount 的静态资源，重建后必须重启容器，使用 `pnpm deploy:local` 可自动处理
