# K01 精确源码导出与官方来源定位（2026-11-26）

本轮实际恢复标准逻辑设计器和模型素材仓库的完整源码交付输入。前者从已有 Git 对象导出 2,950 个文件；后者从官方仓库按精确提交取回 443 个文件。两者分别用两个新私有 bare 仓库重建原 Git 树，生成两遍字节相同的源码包，并恢复后再次核对全树。原对象仓库未检出的工作树保持原状。K01 顶层仍未关闭，没有改写 23 目录来源清单、任务总数或市场注册。

## 手册要求

官方市场来源、全部精确实现与许可、当前独立构建、已安装产物绑定以及断网安装/更新/回滚是独立验收要求，不由 PLM 使用手册学习关闭。目录 URL、官方 refs、模型路由、源码包、完整插件实现和已安装版本是不同证据。目录中“未安装”的两项也不按 N/A 冒充已闭合。

本轮延续 `DELIVERY-CLOSEOUT-20261123.md` 的边界：本地 origin 配置本身不是上游认证，模型 JSON 不等于前端 PF 实现，MIT 根 LICENSE 不代表递归依赖许可闭合。

## 本地实现观察

新增 `close-owned-marketplace-sources.mjs`，只写不存在的新 `.artifacts/k01-marketplace-source-*` 私有目录。它绑定受版本管理的 23 目录来源清单和原始目录回执，按清单的精确 commit 读取 Git 树及 blobs，不操作原工作树、index、refs 或 HEAD。

工具只接受本轮已审的普通非执行文件；拒绝链接、submodule、不安全路径、重复路径、非 UTF-8 路径、单文件超过 64 MiB 或全树超过 256 MiB。blob 批量协议逐个验证对象 ID、字节长度、内容哈希和结束边界。原有大小写冲突不合并、不改名。

导出后从真实文件重新读取内容，在新私有 bare 仓库内执行 `hash-object --no-filters`、`update-index --index-info` 和 `write-tree`。此过程不复用原对象库；重建树 ID 必须与原 commit 树一致。源码包采用固定时间、owner/group、排序和 GNU tar 格式，生成两遍并比较全部字节。随后解包到另一个新目录，重新逐文件核对，再用第二个私有 bare 仓库重建同一原树。

这不是调用 `git archive` 后假设完整。回归包含带 `export-ignore` 的文件，确保不会静默丢失提交内文件。Git 子进程清除继承的 `GIT_*`、禁用全局/系统配置、fsmonitor、可选锁和交互凭据；原仓库 HEAD、status 字节指纹、index 与 config 在结束时再次核对。实际 Node/Git/tar 可执行字节和实现输入也前后绑定。

`--upstream-refs` 仅对目录已有的 HTTPS 地址执行带 20 秒超时的只读 `ls-remote`，不下载源码、不安装依赖。原始 refs/错误仅存私有回执，stdout/摘要只提供白名单字段。目录广告为 HTTP 的上游不自动改成可信 HTTPS 来源。

显式 `--retrieve-model-library` 才获取模型素材仓库，地址与 commit 在实现中固定为目录来源及本轮已观察的精确 ref。它只对新私有 bare 仓库执行 depth=1、no-tags、no-submodules fetch，限制 Git 目录 192 MiB、90 秒及日志 4 MiB；阶段记录 PID、时间和实际目录字节，每 25 秒报告进度。不 checkout、不运行仓库脚本，也不执行 Maven/npm 安装。

取源模式用现有 `@xmldom/xmldom@0.8.11`、`yaml@2.3.3` 和结构化 JSON 解析依赖声明：保留 Maven parent/properties/模块/直接依赖/插件、原版本表达式、生成配置和精确 PF 引用。XML 拒绝 DOCTYPE；不通过正则猜测 XML 字段，不将声明当成传递依赖源码。解析器全部包文件、实现和实际 Node/Git/tar 字节在运行前后重新绑定。

## 当前版本验收证据

### 标准逻辑设计器全树恢复

私有目录 `.artifacts/k01-marketplace-source-20261126-r1/` 保留源码、两个完整 bare 树重建、两份源码 tar、恢复目录和回执。本轮开始 `2026-11-26T22:03:40.688Z`，结束 `2026-11-26T22:03:44.463Z`，退出码为零。实际工具为 Node `v24.21.0`、Git `2.43.0`、GNU tar `1.35`。

| 证据 | 值 |
| --- | --- |
| catalog ID | `BASE.ibizmodeling.logicdesign.logicdesign` |
| 精确 commit | `0f82cebe561fadbe617d8b6d49e2a151d8b149ed` |
| 原树 / 源码重建树 / 恢复重建树 | 均为 `ae18fd06a60d7106869d366a221e85d7d32a1c4e` |
| 完整文件集 | 2,950 文件，39,518,262 字节 |
| 文件集 SHA-256 指纹 | `9d4941c1ad38a05566ac34fcf4bd3c3995e36249b54f9e20f4e34a83970f1ab4` |
| `source-bundle.tar` | 45,445,120 字节 |
| 两遍 tar SHA-256 | 均为 `9c3eb8f6fb70f361cdb23063f3ea9f563cb7f17dbe8291c87894266bc75bcac3` |
| 原 LICENSE | 首行 `MIT License`，1,063 字节；无改写 |
| LICENSE SHA-256 | `c9d67b28c67d1364c934b0cd9012fb36afa781b1e603a9e6faaab52f32f4dde1` |
| 原仓库与执行输入复核 | 均 unchanged |

源码中有 2,919 个 JSON、4 个 Java 文件，以及 BPMN/DRL/CSS/资源与工程配置；未观察到 TS/TSX/Vue 源码。不把文件数当作前端 PF 实现已闭合。

两组大小写冲突均完整保留在 `PSAPPDATAENTITIES` 中：`PSDEMSLOGIC.json` / `PSDEMSLogic.json`，`PSMSDELOGIC.json` / `PSMSDELogic.json`。因此源码包恢复要求支持区分大小写的文件系统；不能用重命名来伪造原树一致性。

本次官方 Gitee HTTPS `ls-remote` 返回 6 行，`HEAD` 和 `refs/heads/master` 均为上述精确 commit。这补上“本地对象与当前官方广告 ref 一致”的观察；不声称已验签 commit、认证全部历史、校验全部依赖或绑定当前安装版本。

| 回执/实现 | SHA-256 |
| --- | --- |
| `report.private.json` | `830414f42874074290fd6bbd81f8bf75e0ea6495739d0fe8af53df046c9393a6` |
| `summary.json` | `fd3aedd97404a1dbce2dff35abb61441c42e5bca548d4d2fb948859f7ae587e0` |
| 本次执行的导出工具 | `709de3e9add3c8d9bc53fff8c4a6dd94a724c2e8321f580c2b59dbc87a4e5d4e` |
| 来源清单输入 | `7226ad276eef2f78ee8a984826dfc5ddff9665ab4b461551c7d64ed85b77f4b0` |
| 原始目录回执输入 | `4d6262ef7c50b5f908f85ecf5e08c514ed0dea6e0341bcc50c8b0f7ca4fb7316` |

### 模型素材仓库精确取源与恢复

r1 只定位了官方 ref；主线授权后，新 r2 在 `.artifacts/k01-marketplace-source-20261126-r2/` 实际取源和恢复，没有覆盖 r1。r1 原执行工具也按原 SHA-256 封存于私有目录。r2 开始 `2026-11-26T22:48:39.177Z`，结束 `2026-11-26T22:48:44.474Z`，退出码为零。

| 证据 | r2 结果 |
| --- | --- |
| catalog ID | `EXTENSION.ibizmodeling.ibizmodellibrary` |
| 精确取回 commit | `9b0ffe7abd675767a14881a3524fde0709b97437` |
| 原树 / 源码重建树 / 恢复重建树 | 均为 `4cfcfbc48f94c6909de36175952c116d954a9146` |
| 全树 | 443 文件，2,154,128 字节 |
| 全树文件 SHA-256 指纹 | `069907d57f7f1594a2eb182193c3f4a35c87a1cbf5559f0ff571980f0ac996b6` |
| 两遍源码 tar | 均为 3,133,440 字节 |
| 两遍 tar SHA-256 | `9ef2495f9ca94a57c27663d58eeb994f57f3c89ac5a371b50409aa45dc52e63d` |
| 实际 LICENSE | `MIT License`，1,064 字节 |
| LICENSE SHA-256 | `2a1ff0728c3564f2946715d89c3a079df44e2a3120f119b47017aea4a55302b9` |
| fetch | 666 ms，Git 目录 258,137 字节，exit 0；PID `1976866` 已另行核对 `ESRCH` |

源码与恢复包位于 r2 的 `model-library/` 下。取源时未下载 tag 或完整历史；恢复树完整，不将 shallow 历史冒充历史闭包。HTTPS 取源与当前官方广告 ref 对应，但未声明 commit 签名已验证，也未绑定已安装版本。

r2 同时重新导出了逻辑设计器；其 2,950 个文件、原树、文件集指纹、LICENSE 和 45,445,120 字节 tar 与 r1 全部一致。r2 共绑定 247 项执行输入，结束时全部 unchanged；原逻辑设计器 HEAD/status/index/config 不变。

| r2 回执/实现 | SHA-256 |
| --- | --- |
| `report.private.json` | `a58d2bfb66711dca4b8689147d73c6c098d541a46daf7ff48ed5500139360332` |
| `summary.json` | `2503a1a26e1d094ed7b9f21e81a1a19a32bfe00527bffbd18226a7a2807d50cc` |
| `final-verification.private.json` | `2c010a2f249987063579a9e21e9855908ad94146c977f39537bdbf57e33de79d` |
| `dependency-profile-verification.private.json` | `d8fac936cc11735c866a5993f9f8075677411d1c7dbc9772ee5611d58e8c4908` |
| 本次执行的工具 | `5fabee97a8c5fe219d1ed6fbd824f017563f70d68a5f4204072cce358020f599` |

独立复核重新读取两套导出/恢复源码、四个 bare 树、四份 tar 及 247 项当前执行输入，3,393 个源文件全部匹配，原仓库状态不变。首次复核脚本误将可缺省的原 `.git/index` 当成必有文件而报 ENOENT；原回执正确记录其为 null。该复核失败单独保留于 `final-verification-attempt-1.private.json`，修正为比较“缺失且仍缺失”后重新完整通过，没有创建原仓库 index 或改写旧失败。

两套源码各有 3 个真实 POM，根 POM 的父项为 Spring Boot `2.4.0`，平台依赖由 `${ibiz.cloud.version}` 声明为 `8.1.0.542`。parent/properties、直接依赖坐标、provided servlet、编译/Boot/versions 插件及未解析表达式保留在私有结构化回执。另用真实 XML 解析器逐个核对已绑定的六个 POM，每套各 5 项 exclusions、1 项 profile，约束和 activation 单列于独立回执；没有把只解析依赖坐标当成完整 Maven effective graph，也没有下载或重建这些传递依赖。

ModelLibraryWeb 的 `PSSYSAPP.json`、`.simple.json`、`.hubsubapp.json` 三个精确模型均无直接 `rtobjectrepo`，不据此推断没有宿主或后端依赖。真实生成输入包括 `.ibizproject` 与 `ibizmodel.yaml`，后者指向 `library_api-core/src/main/resources/model/cn/ibizlab/modeling/addin/modelinglibrary`。生成器实现没有重建。逻辑设计器三个模型则各有 8 处引用、6 个独立精确 PF 包，包括 `model-design@0.0.3-alpha.122`；没有把模型源码恢复计作这些 PF 实现已恢复。

### 两项未知来源的实际定位

原始目录回执包含两次独立 HTTP 200、各 23 项的响应；工具要求 ID 唯一，且两次 repository、catalog path、状态及来源清单逐字段相符。

| catalog ID | 权威目录给出的模型路径 | 本次上游定位与未闭合项 |
| --- | --- | --- |
| `EXTENSION.ibizmodeling.ibizmodellibrary` | `/modeling_addons/ibizmodellibrary` | r1 定位官方 HTTPS `HEAD/master` 为 `9b0ffe7abd675767a14881a3524fde0709b97437`；r2 已实际取源并验证全部 443 文件、MIT LICENSE、生成配置和恢复树，依赖源码/生成器/构建及已安装产物仍未闭合 |
| `EXTENSION.ibizmodeling.ibizmodelincrementpackage` | `/modeling_addons/ibizmodelincrementpackage` | 目录给出 `op.ibizlab.cn` 的 `iBizModelIncrementSync.git` HTTP 仓库；未通过未认证 HTTP 推断来源。另一次同 host/path 的 HTTPS 候选 refs 读取退出 128，443 端口连接失败，未取得 revision/LICENSE/实现 |

两者原清单的预期本地目录均不存在，新的模型素材仓库源码只留私有 r2。工作区 `modelingservice`、`modelingweb`、`extensions`、`vendor-upstream`、`task7` 的受限源码关键词检索没有定位其具体 catalog ID、仓库名或 URL；另对 `extensions/upstream/ibizmodeling-standard` 的精确 `d52797076d9a200dcf068703d94ccf7838876b2f` 对象树执行关键词 `git grep`，同样未命中。这只约束本次查阅范围，不证明源码在任何位置都不存在。搜索范围/命令、原预期目录检查及增量同步 HTTPS 失败单列于 r1 的 `source-location.private.json`，SHA-256 为 `6b8020a7cb1777dc9d78fa2e1660b5cc9f96fa264f2bd782f6ab7043e06ea309`。

又读取官方 Gitee 组织公开仓库元数据，HTTP 200 返回 26 项；名称、路径、描述中没有 increment/sync/增量/同步的匹配线索。该观察仅约束当时的公开组织索引，不证明增量同步源码不存在，也没有用猜测的镜像替换原目录地址。私有 `official-org-mirror-metadata.private.json` SHA-256 为 `f9e01a8b0772fcb852b12da4ade6cd1faa23551a94b3108f181c4f45f84467cc`；前一个 user API 的 404 作为错误端点观察保留，没有当成仓库不存在。

目录路径本身不是生成器实现。r2 将模型素材仓库标记为 `exact-upstream-source-exported-rebuilt-and-restored-dependencies-open`，填入真实 revision、LICENSE 与已定位配置，但 `sourceClosure` 仍为 false。增量同步仍为 `catalog-repository-and-model-path-only`，revision/LICENSE 保持 null，不能复用另一目录的 MIT 声明。

### 重复入口与测试

```sh
node scripts/close-owned-marketplace-sources.mjs \
  --output .artifacts/k01-marketplace-source-NEW \
  --upstream-refs --retrieve-model-library

node --test scripts/tests/close-owned-marketplace-sources.test.mjs
node --test scripts/tests/plm-manual-reference.test.mjs
```

同时省略两个上游选项完全不请求上游。必须使用不存在的新目录；旧成功/失败输入不会覆盖。六项聚焦测试覆盖完整实际 Git 导出/双树重建/tar 恢复、大小写/引号/二进制/export-ignore、继承 Git 环境隔离、原 index 缺失时保持原状、源字节变化、树路径/预算/链接拒绝、截断或附加 blob 数据、多次目录回执不一致，以及真实 XML/YAML/JSON 依赖声明解析、DOCTYPE 拒绝和不执行源码脚本。连同手册引用契约为 **16/16，0 失败、0 跳过**；脚本语法和本轮三文件空白检查无诊断。

## 待决策/阻塞

本轮关闭了逻辑设计器“只有 Git 对象、没有可独立恢复的完整源码输入”和模型素材仓库“未取得精确源码/许可证/生成配置”两个具体缺口。原 `extensions/upstream/logic-design-standard` 仍无工作树；两个私有完整源码包及各自两次原树重建提供新增输入，不改写原历史清单成“已安装源码验收完成”。

K01 仍缺全部 23 目录精确安装 revision 与交付字节绑定、全部 PF/宿主实现和递归依赖来源/许可、当前独立 build；增量同步还缺可认证、可读取的权威源码输入。K02/K03 的原生市场安装、更新、失败回滚和宿主运行读回不由本轮源码恢复关闭。

本轮没有 Docker 生命周期、镜像 pull、依赖安装、SQL、业务 API、市场注册、共享写入或发布，也没有改动 D01 r10 源码/产物及运行版本。原始源码、完整 refs、请求结果和回执只留私有 `.artifacts/`，提交范围仅工具、聚焦测试和本文。
