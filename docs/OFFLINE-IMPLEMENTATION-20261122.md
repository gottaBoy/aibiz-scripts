# 离线包交付实现记录

检查点：2026-11-22，Asia/Singapore。
本轮遵守复用现有 Docker 的限制，没有创建、拉取、构建、启动、重启或删除容器，
没有修改共享数据库、dist、运行挂载或服务配置。
脱敏结果见 [记录](../records/aibiz-offline-implementation-20261122.json)。
后续已完成一项真实官方目录的源码打包、原生格式解析及内核断网文件流程，
见 [官方目录真实包交付](OFFICIAL-MARKETPLACE-PACKAGE-20261122.md)；
该进展不把独立文件存储称为原生市场安装。

## 手册要求

市场、源码闭包、干净环境重建和整栈恢复是独立能力，不从 PLM 使用手册推导。
仍沿用 [25 项待办](REMAINING-25-20261111.md) 中 D01-D03、K01-K03、
O01-O03 的关闭条件。23 个官方市场目录与本地编辑器入口目录并非同一身份字段，
不能用同名文件夹或本地替代编辑器覆盖缺失的来源、构建和安装证据。

12 组件门槛入口是 `harness-required-source-gates.mjs` 的
`REQUIRED_D01_COMPONENTS`；23 目录入口是
`docs/MARKETPLACE-SOURCE-INVENTORY-20261103.json`。
新工具复用 `native-candidate-files.mjs` 的目录固定和完整文件读取，
以及既有 SQL 产品解析、模型包引用解析与精确运行包校验器。

## 本地实现观察

新增 `owned-marketplace-offline.mjs`，提供本地文件交付命令：

| 动作 | 实际行为 |
| --- | --- |
| `init` | 只创建新的 `.artifacts/owned-marketplace-offline/<12位run-id>` 私有目录，写所有权标记；拒绝采用已有目录 |
| `verify` | 按调用方明确提供的 manifest SHA-256，核对官方 catalog ID、记录中的仓库身份和完整 payload 文件集 |
| `install` | 逐文件复制已校验字节，复验后保留独立版本目录；用原子 `state.json` 替换切换活动版本，要求调用方提供当前 state SHA-256 |
| `rollback` | 只允许切回该目录曾成功提交的同 catalog 版本；重新校验保留的全部字节 |
| `status` | 读取当前状态，并重新核对所有活动包文件集；不需要获取变更锁 |
| `recover` | 仅当原 PID/启动时间已不存活且事务 ID、所有者及当前 state SHA-256 精确匹配时归档完整 `lock.json`；不删除失败包或修改状态 |

包必须包含 `manifest.json` 和 `payload/`。manifest 契约为
`owned-marketplace-offline-bundle-v1`，字段只有 `contract`、`schemaVersion`、
`catalogId`、`version`、`source`、`files`。`source` 声明仓库、revision 和
已包含的 license 路径；每个文件声明相对路径、字节数、SHA-256 和用途。
至少包含应用产物、图标、README、CHANGELOG 和 license。
未声明文件、大小写冲突、越界路径、符号链接、哈希差异及未知字段均拒绝。
单文件限 64 MiB，每包限 256 MiB、10,000 文件。

这些来源字段是可校验输入，不是已认证上游、已审许可、源码构建或依赖闭合证明。
所有输出保持 `nativeMarketplaceAcceptance=false`，也不会执行包中的脚本。
传输层没有下载或安装依赖的实现；包缺失时不会尝试外网补齐。

私有 store 使用独立 `data/`；安装过程只读该目录并在切换前核对字节快照，
不会覆盖业务数据。CAS、防并发锁、持久化 intent、文件 fsync、目录 fsync 与
同目录原子 rename 使提交前失败保持旧版本；崩溃后的状态须先读回，再决定是否重试。
锁 owner 先写到随机候选文件并完成文件/目录同步，再用不替换已有目标的 hard link
原子发布为 `lock.json`。释放时原子 rename 到 `retired-lock-<事务ID>.json`，
保留完整 owner，不存在先删 owner、后删锁目录的不可恢复窗口。
状态 rename 成功时立即记录已发布标志与 SHA-256；随后目录 fsync、完成日志或
锁释放失败均明确报告 `revisionPublished=true` 并要求先读 `status`。
原异常保留为 `cause`，额外清理失败单独保留为 `suppressed`，不会冒充自动回滚。
保留的 release、staging、事务和恢复锁不自动清理，避免误删恢复输入。
这是文件级交付能力，尚未接入原生市场的安装记录、后端模型导入或数据库事务。

新增 `prepare-owned-marketplace-offline.mjs`，以真实官方 catalog ID 选择本地来源：

1. 连接官方目录、已有 SQL 产品与本地宿主插件身份。
2. 读取确切 Git HEAD、工作区状态，并把 README、license、CHANGELOG 和
   `PSSYSAPP.json` 的当前字节与对应提交字节比较。
3. 从实际模型提取精确 `name@version` 引用；指定本地候选包时复用现有
   `validateCandidate` 检查，不接受同名其他版本或未知包输入。
4. 输出缺失前置，不创建虚假安装包、不执行市场安装。

## 当前版本验收证据

针对真实 `form-design-standard` 本地候选运行了输入规划，未使用模拟响应：

- 官方 ID：`BASE.ibizmodeling.formdesign.formdesign`。
- Git HEAD：`2a0d5707a55a941eee95514586573749da5517a3`，与历史目录记录相同，
  当前 checkout 干净；这不证明其等于已安装的服务版本。
- LICENSE、README 和 739,339 字节的原生应用模型与该提交一致。
- 模型实际引用 6 个精确运行包，其中 dnd-design 同时引用
  `0.0.3-alpha.141` 和 `0.0.3-alpha.72`，不得互相替代。
- 该来源没有已跟踪的 CHANGELOG，未提供确切本地图标和 6 个完整运行包输入。
  因此结果为 `blocked-local-inputs-incomplete`，没有组包或安装。

文件交付测试使用临时自有目录执行真实复制、更新和回滚，覆盖 Unicode 字节、
数据保持、陈旧 CAS、并发拒绝、清单篡改、非法路径、符号链接、未提交回滚拒绝、
保留包复验和历史预算。独立故障注入包括 owner 写入失败、提交前抛错、
状态发布后的 fsync 失败、完成日志与释放同时失败，
以及两次实际 SIGKILL（提交前、锁退休 rename 之后）；
后者验证旧版本仍可读取、存活锁不能恢复、死进程锁按精确身份归档、随后可重试。
测试中的小包为受控夹具，其通过不代表真实 23 目录安装完成。
最终聚焦检查为 18/18 通过，无失败或跳过；`git diff --check` 通过。

```sh
node --test scripts/tests/owned-marketplace-offline.test.mjs \
  scripts/tests/prepare-owned-marketplace-offline.test.mjs
node scripts/prepare-owned-marketplace-offline.mjs \
  --catalog-id=BASE.ibizmodeling.formdesign.formdesign
```

新工具的工作目录由文件位置推导，上述命令从公共工作区根执行。
已有且内容已审的本地包可以用下列入口检验；哈希须由当前交付输入提供：

```sh
node scripts/owned-marketplace-offline.mjs --action=verify \
  --bundle=.artifacts/REVIEWED-BUNDLE --manifest-sha256=EXPECTED_SHA256
node scripts/owned-marketplace-offline.mjs --action=init --run-id=OWNED_RUN_ID
node scripts/owned-marketplace-offline.mjs --action=install --run-id=OWNED_RUN_ID \
  --bundle=.artifacts/REVIEWED-BUNDLE --manifest-sha256=EXPECTED_SHA256 \
  --expected-state-sha256=CURRENT_STATE_SHA256
```

这些占位符不是可发送给原生 API 的业务 ID。
首次用户态网络 namespace 验证被宿主拒绝，失败证据保留。后续新增
`tools/offline-network-guard.c`，使用宿主现有 `cc` 编译本地小型启动器，
在 `PR_SET_NO_NEW_PRIVS` 后安装 Linux seccomp BPF，再 exec 指定程序。
没有获取新的权限、修改宿主网络或采用 Docker。

过滤器检查 syscall architecture，源代码支持原生 aarch64 与 x86_64，
其他 ABI（包括 x32）拒绝；本机实际验证的是 aarch64，未运行 x86_64 分支。
网络 socket、connect、bind/listen/accept、显式 socket send/recv 及
io_uring 网络旁路入口返回 EACCES。启动前关闭 3 及以上继承描述符，
拒绝网络标准描述符；保留本地 AF_UNIX socketpair 以支持 Node 子进程管道。
fork/exec 后过滤继续生效，不依赖 JavaScript mock 或 LD_PRELOAD。

最终实际运行：

```sh
AIBIZ_OFFLINE_GUARD_LIVE=1 node --test scripts/tests/offline-network-guard.test.mjs
```

内核验证 **5/5**，无失败或跳过：

- 未隔离的只读 `GET` 访问现存本机 UAA userinfo，实际响应 401。
- 过滤后的同一目标：原生 Node fetch、TCP connect、UDP send 均得到 EACCES。
- 过滤进程启动的子进程重复三类请求，同样得到 EACCES；
  两层均确认 `NoNewPrivs=1`、`Seccomp=2`。
- 同一内核过滤条件下重新执行前述真实文件操作和故障恢复测试 **18/18**。
- 启动器缺少命令时拒绝执行，并保留被执行命令的退出状态。

5 项外层检查与内层 18 项分别记账，不相加为能力完成数。未访问外部网络，
没有启动新服务。普通测试命令默认不运行依赖本机端口的 401 对照，
需要上述明确环境开关；本轮使用该开关实际执行，未跳过。
初次外层检查为 4/5：Node 测试子进程继承了 `NODE_TEST_CONTEXT`，
内层 runner 虽退出 0，却拒绝递归运行文件；工具检查发现缺少 18 项结果，
正确判失败。改为独立测试进程后通过，旧失败回执没有覆盖。

最终独占回执为
`.artifacts/offline-network-guard-20261122-7owT5G/report.private.json`；
源码、编译产物和回执 SHA-256 固定在脱敏记录内。
该启动器证明受控命令及其子进程的联网系统调用被内核拒绝，
文件与标准输入输出仍按受控命令自身权限工作，不是任意恶意程序的完整隔离器。
没有提供完整真实 23 目录安装包，因此仍未执行原生市场安装。

## 待决策/阻塞

| 父项 | 本轮带来的具体变化 | 仍缺少的关闭条件 |
| --- | --- | --- |
| D01 | 实际候选绑定模型提交及精确包引用 | 12 组件递归源码、依赖、独立构建和产物闭合 |
| D02 | 本地包完整文件哈希及交付后复验 | 镜像/挂载、传递资源和实际 HTTP 服务字节 |
| D03 | 源 HEAD、目录、模型输入和活动包 revision 可明确关联 | 全仓有效输入、脏源码/缓存、构建等价和运行身份 |
| K01 | 官方 catalog / SQL product / host plugin 对应及精确候选源观察 | 23 目录上游真实性、许可、生成依赖和已安装版本绑定 |
| K02 | 本地文件包校验/私有目录安装，以及内核断网条件下 18 项文件操作回放 | 审核完整真实 23 目录包，验证原生市场安装及所有资源可用 |
| K03 | 内核断网条件下的 CAS 更新、真实失败/SIGKILL 恢复与历史版本回滚 | 原生市场更新/失败恢复、运行重载和业务数据/权限全流程 |
| O01 | 安装器可从明确本地文件恢复包交付 | 干净主机/工具链的完整离线重建 |
| O02 | 文件级数据保持与包版本恢复已有受控测试 | 当前整栈持久化备份、数据库/模型迁移及失败恢复 |
| O03 | 包交付具备局部可审输入和可回退版本 | 共享发布范围、已审恢复计划、真实服务验证和整栈回滚 |

本轮不关闭任何顶层项，不启动共享发布。未运行全量 `npm test`，
没有重跑 Java、浏览器或原生市场/数据库流程。
