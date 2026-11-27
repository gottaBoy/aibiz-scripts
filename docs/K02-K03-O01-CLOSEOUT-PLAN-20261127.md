# K02/K03/O01 最小闭合计划（2026-11-27）

本轮只做当前回执和脚本的只读审查，新增 `prepare-marketplace-closeout-plan.mjs`、聚焦测试和本文。没有 Docker、网络、镜像 pull、数据库写入、原生市场注册、共享文件写入或服务重载。输出是可审阅的下一步计划，不是 K02/K03/O01 完成回执。

## 当前事实

现有 `aibiz-real-marketplace-package-20261122.json` 绑定一个真实目录 `EXTENSION.ibizmodeling.modelperspectivetool` 的精确来源、模型 ZIP、源码编译核心 JAR，以及两个本地交付版本。`real-flow-r2/report.private.json` 的状态为 `passed-kernel-isolated-real-package-file-replay-not-native-installed`，且明确 `nativeInstallationExecuted=false`、`nativeMarketplaceAcceptance=false`。

离线文件 store 已通过真实文件系统的 install、local update、rollback、提交前失败保持和死 owner 恢复；这证明 journal、锁、完整 payload 哈希和数据见证范围内的文件交付合同。它不提供原生市场的 OSS 上传、系统源/合并关系登记、运行重载、宿主前端资源加载、业务权限读回或原生数据回滚。

O01 的现有离线 guard 与 18 项聚焦文件测试证明同一宿主内核网络拒绝和已有缓存依赖下的受控重放。它没有证明干净主机的完整组件源码构建、递归依赖/Node/编译器源码闭合或整栈业务恢复。

## 可复用入口

| 入口 | 可复用范围 | 不能代替 |
| --- | --- | --- |
| `owned-marketplace-offline.mjs` | 私有文件 store 的 init/status/install/update/rollback/recover | 原生市场注册、合并、重载、业务/权限读回 |
| `package-owned-marketplace-offline.mjs` | 真实来源、模型 ZIP、原生 parser、核心 JAR 和 bundle manifest | 原生 OSS/system/source API、当前安装版本绑定 |
| `prepare-owned-marketplace-offline.mjs` | 精确来源、catalog、SQL 产品和 host plugin 只读输入计划 | 原生市场事务或共享服务状态 |
| `tools/offline-network-guard.c` | 内核网络拒绝 | 干净主机和完整工具链重建 |

## K02 最小可执行补证

在明确授权的独占原生市场窗口，先绑定当前服务/镜像/挂载和候选包字节，再按真实市场 API 或原生模型流程创建自有登记。必须保留：

1. 官方 OSS/来源登记的请求和响应，精确 source/system/merge 关系 ID。
2. 运行服务加载和资源合并/重载前后 receipt，包含静态/模型/JAR 字节。
3. 当前管理员、普通成员、只读、非成员和跨组织用户对已安装能力的实际读写/拒绝读回。
4. 失败时只恢复本轮精确自有登记和文件；不删除共享市场中无法证明属于本轮的条目。

直到这些证据存在，`nativeMarketplaceAcceptance` 必须保持 false。离线 bundle 的 `manifest.json` 不是原生市场请求格式。

## K03 最小可执行补证

使用同一个原生登记执行 `previous -> next` 更新，并分别记录：

- 更新前的系统/来源/合并关系、加载字节、业务数据/权限快照；
- 更新中的 journal、失败注入点、服务重载结果和新版本读回；
- `next -> previous` 精确回滚、重载后业务数据/权限/关系保持；
- 每个失败路径的自有文件/登记清理和旧版本恢复。

当前文件 CAS、SIGKILL 恢复和本地 revision rollback 只能作为前置安全合同；不能据此关闭 K03。

## O01 最小可执行补证

在不改变共享服务的前提下，选定明确的独占干净目录和已有离线 guard，记录全部 12 组件的源码、生成器、递归依赖、Node/compiler/toolchain 输入；双遍构建并绑定产物字节。若没有干净主机或完整来源，保留当前 `PARTIAL-OFFLINE-SAME-HOST-ONLY`，不要把同宿主缓存构建升级为 O01。

## 当前计划回执

执行：

```sh
node scripts/prepare-marketplace-closeout-plan.mjs \
  --output .artifacts/marketplace-closeout-plan-NEW
node --test scripts/tests/prepare-marketplace-closeout-plan.test.mjs
```

计划仅读取现有脱敏记录和私有报告，输出目录必须不存在。当前分类固定为：

- K02 `BLOCKED-NATIVE-MARKET-UNEXECUTED`
- K03 `BLOCKED-NATIVE-UPDATE-ROLLBACK-UNEXECUTED`
- O01 `PARTIAL-OFFLINE-SAME-HOST-ONLY`

本计划不改任务总表，不创建/重建容器，不拉镜像，不执行网络或 SQL，不把本地 ZIP/store 当成原生市场完成。

### r2 只读计划回执

输出目录：`.artifacts/marketplace-closeout-plan-20261127-r2/`。

`plan.private.json` SHA-256 为 `db4ee63be9446714e1e3161116622bdebd3cf213f528cc5b19f75db46b33da93`。r2 额外绑定了当前计划生成器 SHA，分类保持：

- K02 `BLOCKED-NATIVE-MARKET-UNEXECUTED`
- K03 `BLOCKED-NATIVE-UPDATE-ROLLBACK-UNEXECUTED`
- O01 `PARTIAL-OFFLINE-SAME-HOST-ONLY`

计划回执声明 Docker、network、pull、shared writes、database writes 和 native marketplace registration 均为 false。聚焦测试 **4/4，0 失败、0 跳过**；脚本语法与新增文件空白检查通过。
