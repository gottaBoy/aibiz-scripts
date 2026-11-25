# 官方目录真实包交付

检查点：2026-11-22，Asia/Singapore。
本轮从真实目录和 Git 源码生成完整的模型交付包、编译核心 Java 类，
在内核断网条件下完成文件级安装、更新、回滚和失败保持。
它进一步推进 K01-K03/D 来源，不关闭原生市场安装或 23 目录验收。
脱敏证据见 [记录](../records/aibiz-real-marketplace-package-20261122.json)。

## 手册要求

市场安装、源码闭包和离线发布不由 PLM 使用手册承诺。
继续使用既有 [25 项清单](REMAINING-25-20261111.md) 的独立关闭条件，
不把一个目录包、零外部插件引用或文件存储成功等同完整平台能力。
真实应用角色、运行重载、业务数据和跨角色流程仍需要各自回执。

## 本地实现观察

选择官方目录 `EXTENSION.ibizmodeling.modelperspectivetool`：

| 输入 | 绑定 |
| --- | --- |
| 原仓库 | `extensions/upstream/model-perspective-tool` |
| Git revision | `d0ef3450691bf8833b51c40bd97001bd2e8aff6e` |
| Git tree | `0a4f1e18637affb32aff3d5b85c37ff40c0cbdce` |
| 核心交付源输入 | 2,310 文件，逐项核对 Git blob；不是把全部仓库或 provider 部署闭包标为完成 |
| 完整模型目录 | 2,301 文件，保留源目录结构和全部字节 |
| 原生 Java | 3 个核心模块类由宿主 JDK17 重新编译，`--release 11 -proc:none` |
| 应用变体 | main、simple、hubsubapp 三份真实模型均扫描；外部 PF 包引用为零 |
| 宿主依赖 | 688 个现有 Java JAR / 461,228,578 字节，编译/解析前后复验；内建前端宿主资源另行待绑定 |
| 许可证与 README | 复制该提交的原始文件，不以有 LICENSE 推断所有传递依赖许可已闭合 |

没有改写模型 ID、权限或 API 路径，没有用别名代替缺失的运行包。
其他目录如果存在精确外部 PF 包引用，当前打包器会拒绝，不生成零引用替代包。
FormDesign 的六个精确外部包仍属于其独立缺口。

原提交没有 CHANGELOG。新增 `renderLocalDeliveryChangelog` 从目录 ID、
精确 revision/tree、提交时间、提交标题及本地交付版本生成记录，规则为
`local-delivery-record-v1`。正文明确写明这不是上游 CHANGELOG，
也不是一个新的上游 release。

图标取自此前真实官方 catalog 条目声明的精确公开 PNG 地址。已有本地 trace
没有该 URL 的原始图片，因此本轮按明确授权做有界只读下载：
无凭据、不跟随重定向，最多 4 MiB、15 秒，校验 MIME、PNG 签名及图像尺寸。
实际为 HTTP 200、`image/png`、7,107 字节，
SHA-256 为 `d2f34eef6080fee70176575bdc5df2f4db305d6f5b19644da2826c65a81889fd`。
观察时间为 `2026-11-22T11:32:16.407Z`；源地址使用 master，
回执明确标记 `sourceRefImmutable=false`。后续断网构建只使用已绑定字节。

新增 `package-owned-marketplace-offline.mjs`，输出内容包括：

- 原模型完整目录、核心 Java/资源源文件、原 LICENSE 和 README。
- 来源明确的原始图标和本地目录投影，持久化 catalog ID 保持原值。
- 标识为本地生成的交付记录。
- 原生模型 ZIP 和源码编译的核心 JAR。
- 包含每个源文件、模型文件、宿主 Java 依赖、生成器和解析器源码哈希的 provenance。

## 原生格式边界

确实检查了维护源码
`ibiz-plugin-extension/.../HubSysExtensionUtilRuntimeBase.onGetSystemModelFolder`：
有 `V2SystemSource.ossfile` 时，通过原生文件运行时取得 ZIP，
`ZipUtils.unzip` 解压后在根目录读取 `PSSYSTEM.json`。
本轮按此格式生成 `native/model.zip`，不是将任意自制 store 清单冒充市场包。

新增 `OwnedMarketplaceModelProbe.java`，实际使用相同 `ZipUtils` 解压，
并通过 `PSModelServiceImpl` 读取完整模型。得到真实
`ModelPerspectiveTool` 系统和应用；解压后全部 2,301 文件的哈希与源目录一致。

`PSCorePrdFuncRTService.doInstall` 还需要实际系统、系统源、OSS 文件、
系统合并关系以及发布/重载操作。独立 store 的 `manifest.json` 不是该 API 的
原生请求格式。本轮没有向共享市场写入这些记录，没有伪造上传文件 ID、
系统源 ID 或接口路线。已交付的是可被原生解压和模型解析器消费的真实模型包，
原生市场安装流程仍未验收。

## 当前版本验收证据

两个本地交付版本均来自同一个上游提交：

| 本地交付版本 | Manifest SHA-256 |
| --- | --- |
| `1.0.0.0-local.1` | `e7173b600758e1428e9843627c32074db5cabd50a4d7010fab202b2d94164e62` |
| `1.0.0.0-local.2` | `fc780895f45c7cad50c08932e33c7319a8af787013efcacd9e10ea4973aa6bca` |

每包 2,317 文件。两个独立构建的原生 ZIP 均为
`3801e0e8f082ed9148b3b8325000078f65c2e7ce1f1bb5e400ef1cbbdfde6c9d`，
核心 JAR 均为
`44e0628b81171c5fe32f725886267829d0c9a4e2b4c814c69924723ced962094`。
更新变化是明确标识的本地交付元数据，不冒充上游源代码更新。

在 [seccomp 网络过滤器](OFFLINE-IMPLEMENTATION-20261122.md) 内：

1. 使用真实 local.1 包完成安装，generation 为 1。
2. 使用真实 local.2 包完成更新，generation 为 2。
3. 切回先前真实 local.1 包，generation 为 3。
4. 用真实 local.2 包注入提交前失败，状态、generation 和文件见证保持原样。

每步都由新 Node 进程重新读取磁盘状态，并复验活动包的完整哈希。
同一进程确认 `NoNewPrivs=1`、`Seccomp=2`，
对已知本机 UAA 的联网尝试被内核拒绝为 EACCES。
保留的文件见证含中文、emoji、组合字符、引号、反斜线及换行；
它是自有非业务文件，不被计为原生业务数据库验收。

当前成功回执：

- 构建：`.artifacts/owned-marketplace-packages/4a9bb362d8c1/package-local-r5/`
  和 `package-local-r6/`。
- 真实包流程：同 run 的 `real-flow-r2/report.private.json`。
- 独立存储 run：`6e0b3a9d582f`，只位于自有 `.artifacts/`。
- 新聚焦测试：**3/3**，无失败或跳过；包含真实包而非小型夹具包的来源检查。
- `git diff --check` 通过；原 source checkout 仍干净。

可重复入口：

```sh
node scripts/package-owned-marketplace-offline.mjs --action=fetch-icon \
  --catalog-id=EXTENSION.ibizmodeling.modelperspectivetool \
  --output=.artifacts/owned-marketplace-packages/NEW_RUN/NEW_ICON
```

构建需将精确 icon receipt、其 SHA-256、revision 和新私有输出路径传给
`--action=package`。实际运行时外层使用已验证的
`offline-network-guard`，所有编译、ZIP 导出、原生解析及安装流程继承内核过滤。
测试实际命令为：

```sh
AIBIZ_OFFICIAL_MARKETPLACE_PACKAGE=.artifacts/owned-marketplace-packages/4a9bb362d8c1/package-local-r5 \
  .artifacts/offline-network-guard-20261122-7owT5G/offline-network-guard \
  node --test scripts/tests/package-owned-marketplace-offline.test.mjs
```

`NEW_RUN` 要替换为新自有 12 位十六进制 run ID；已存在的输出拒绝覆盖。
无需复制或改写共享 dist。没有创建、重启、停止、构建或拉取 Docker 资源。

## 待决策/阻塞

K01-K03/D 仍未完整关闭：一项真实目录包不代替 23 项全部来源、许可与运行矩阵。
宿主前端框架、递归构建依赖和当前已安装版本来源仍有独立门槛。
原生市场的受控 OSS/系统源/合并/重载、多角色权限及业务数据保持仍未执行。
本轮没有覆盖共享配置、迁移数据库或将候选作为共享运行版发布。
