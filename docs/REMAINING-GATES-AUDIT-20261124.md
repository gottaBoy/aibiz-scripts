# Remaining Gate Audit

检查点：2026-11-24。本文只核对 A02/A03、D01-D03、K01-K03、O01-O03
的现有回执与 `ALL-TASKS-20261111.md` 状态，不把源码回归、文件包流程或
局部离线编译升级为顶层能力完成。审计未部署、未重启、未 pull、未创建容器，
也未写数据库。

## 手册要求

授权撤销、事务生命周期、源码/构建闭合、官方市场安装以及整栈恢复必须分别
绑定当前源码、运行输入和真实角色/数据回读。私有文件 store、预编译依赖、
健康检查、旧镜像锁或单个目录包不能替代原生市场、当前 HTTP 字节或整栈恢复。

## 本地实现观察

新增 `audit-remaining-gates.mjs` 只读读取任务总表、授权 closeout、D/K/O
交付审计、官方包和离线网络 guard 回执，输出每项当前状态、已观察范围和缺口。
`tests/audit-remaining-gates.test.mjs` 覆盖完整 ID 集、状态漂移、缺失 gate 和
“有源码/文件回执但仍不能关单”的负向合同。

复跑 A02/A03 聚焦测试时发现测试夹具只替换了两个清理调用中的一个，已改为
全量替换；生产授权源码未改。修复后 A02/A03 与交付审计共 17/17 通过，
D/K/O 的 guarded 聚焦套件为 23/23。

审计结果保持现有检查点：

| ID | 当前状态 | 仍缺的关闭证据 |
| --- | --- | --- |
| A02 | BLOCKED | WXMP 权威角色刷新；同 token 撤权、多节点可见性；事务可见性与撤权延迟 |
| A03 | BLOCKED | 共享 Servlet 部署；剩余后台/开发调用方迁移；外部事务与 pooled worker 生命周期 |
| D01 | PARTIAL | 每组件完整构建；递归依赖源码构建；生成资源来源；工具链源码闭合 |
| D02 | PARTIAL | source → artifact → image/mount 绑定；当前 HTTP 服务字节等价 |
| D03 | PARTIAL | 所有 ignored/unmounted 有效输入；源码构建与 served output 等价 |
| K01 | PARTIAL | 23 目录上游与已安装 revision 认证；传递许可/源码；PF 依赖来源绑定 |
| K02 | PARTIAL | 23 目录原生 OSS/系统源/合并/重载；宿主前端资源绑定 |
| K03 | OPEN | 原生市场更新、失败恢复、回滚；业务/权限/运行重载读回 |
| O01 | OPEN | 干净主机完整 12 组件重建；递归工具链和依赖源码重放 |
| O02 | PARTIAL | 当前整栈持久化备份；隔离完整恢复；schema/model 迁移重放 |
| O03 | OPEN | 审查后的共享发布输入与恢复计划；整栈回滚和真实角色服务验证 |

## 当前版本验收证据

只读审计回执：

- `.artifacts/remaining-gates-audit-20261124-r4/report.private.json`
  SHA-256 `c0601c46532eb3865bab0a59e6843fa516cd7520fd9f1c8fe80d9307fae2f343`
- 授权回归 `.artifacts/authorization-closeout-20261123-r5/report.private.json`
  SHA-256 `eb6e65a10738e3d32348b12803fb89c337046e259910d73bcab326f58aa10957`
 ；编译/测试退出码均为 0，文档绑定 393/393；只使用内存 H2，未执行业务 HTTP。
- D/K/O 审计 `.artifacts/delivery-closeout-20261123-r3/report.private.json`
  SHA-256 `659df11c9f1c89b3e4c7de90271edc3dbf982b001fd8d8e5948294bebeec3325`
 ；其 gate 状态仍为 blocked。
- 离线 guard `.artifacts/offline-network-guard-20261122-7owT5G/report.private.json`
  SHA-256 `d67431a6624008d02ba92eee1744c97fed2b263a821ee27d0189b39f3fd73e57`
 ；NoNewPrivs/seccomp 与文件级 18 项回放通过，但 `all23NativeMarketplaceAcceptance=false`。
- 官方包回执 `.artifacts/owned-marketplace-packages/4a9bb362d8c1/real-flow-r2/report.private.json`
  SHA-256 `07e6445b3c361b792ffce8a13174040d10a301a206e34f01ea78d2ebda81df2d`
 ；`nativeInstallationExecuted=false`、`nativeMarketplaceAcceptance=false`。

授权回执的 52 个源码/测试输入与当前工作区逐项匹配；本审计没有发现
“回执已是当前源码而总表尚未同步”的情况。A02/A03 仍因运行时协议和部署边界
缺失保持 BLOCKED。

## 验证命令

```sh
node scripts/audit-remaining-gates.mjs \
  --root /home/my/workspace/ainfra/aibiz \
  --output /home/my/workspace/ainfra/aibiz/.artifacts/remaining-gates-audit-NEW/report.private.json

node --test scripts/tests/audit-remaining-gates.test.mjs
```

输出目录必须是新的私有目录。工具不运行 Docker、数据库、网络或依赖下载；
它只在证据缺失或任务状态漂移时报告错误。

## 待决策/阻塞

本轮没有发现“已有当前证据却应同步关闭”的父项。A02/A03 的 393/393 是
源码/隔离回归；D/K/O 的文件包、seccomp 和局部重建均有明确范围，仍不足以
满足原生市场、当前服务字节、干净主机或整栈恢复门槛。父项状态按总表保持不变。
