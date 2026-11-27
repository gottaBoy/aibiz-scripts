# Wiki 分享校验节点修复

检查点：2026-11-26。`CheckShared` 和 `AccessPassword` 的原 raw 方法未继续
模型链接，分享有效性 DTO 无法返回，正确密码也无法进入成功分支。
本轮修复两份源码的原生委派，未关闭 B01 或匿名分享验收。

## 手册要求

[测试与知识规则](manual/TEST-KNOWLEDGE.md) 要求密码、过期、撤销、子集分享
通过真实匿名流程验证，不泄露草稿，不用所有者会话代替匿名身份。
源码或隔离运行通过只能说明其实际覆盖范围。

## 本地实现观察

两份权威模型均连接 raw 节点到后续分支；相应 Groovy 源码却重复执行脚本，
随后注释原生节点委派。`CheckShared` 写入 `result`，但没有执行
`END1(result)`；`AccessPassword` 初始化 `check_access_password=0`，
却没有执行正确/错误密码条件及后续准备参数节点。

本轮两个 raw 方法均仅保留
`super.onExecutePSDELogicNode(session, node, true)`。
模型脚本、密码比较、日期比较、字段存储键、条件及返回参数均未改。
没有修改旧有的 `SharedUrl`、`PublishPage`、`ArticlePageDTO` 修改。

| 目标 | 权威模型 SHA-256 | 当前源码 SHA-256 |
| --- | --- | --- |
| `CheckShared.groovy` | `96f1af3cf6791c73407b7b988f0bb28323b3c80327b299d0fd4f48a1f974573e` | `3d947068f28fd3171c75648c346ec7260000e7c1f7b27517d5109014d35ef9ee` |
| `AccessPassword.groovy` | `e416cc1849469c1d0a1df00a32a207de627ae9cc7ad271e3c4750884fb05d8c9` | `0fc8635eaa45ca5a2fd03156af7a2bc7efd1a72f32280eaf12de040ad9e03fef` |

模型来源分别为
`plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/check_shared.json`
和同目录 `access_password.json`，并要求与实体
`article_page.json/getAllPSDELogics` 中的内嵌定义完全一致。

为避免重新生成覆盖修复，新增限定两目标的生成后修复命令：

```sh
node scripts/repair-generated-wiki-sharing-dispatch.mjs
node scripts/repair-generated-wiki-sharing-dispatch.mjs --apply
```

默认命令只检查；`--apply` 只接受两份已审查原生成完整源码哈希或本轮修复哈希。
两目标全部完成模型/完整源码检查后才写入，已经修复则不写。
未知生成器输出、任意源码追加、权威模型变化或实体内嵌不一致均拒绝。
这是一项限定版本的生成后修复，不宣称修改了上游通用生成器。

## 当前版本验收证据

```sh
cd scripts
node --test tests/repair-generated-wiki-sharing-dispatch.test.mjs
node --test tests/inspect-owned-wiki-sharing-dispatch.test.mjs
```

生成后修复合同 **3/3 通过**：从权威模型脚本按现有生成模板重建原方法，
核对原完整源码哈希，修复后与当前完整源码逐字节一致；
幂等检查不写文件，未审查源码/模型/目标/内嵌定义均拒绝。

原生合同 **1/1 通过，实际 16 格**。复用已封存的 488 个真实依赖，
执行前后校验每个 JAR、Java 和全部源/模型/fixture 快照。
在同一独立输出目录使用真实 Groovy 编译器编译两份当前源码，
新类加载来源为该编译目录；旧类及中央调度器、条件测试、准备参数、
结束节点和 DTO 来源均绑定实际封存 JAR。
编译沿用原 provider 封存命令的 `-Dgroovy.target.bytecode=1.8`，
两类均确认 major=52，与实际原类一致。

| 输入 | 原封存旧类 | 当前编译源 |
| --- | --- | --- |
| 检查分享：过期/未过期，各有/无密码 | 4 格均写入实际标记，但未到结束节点，返回为 null | 4 格均 `RAWSFCODE1 -> END1`，返回同一 result DTO；有效性和密码标记正确 |
| 校验密码：过期/未过期，各正确/错误密码 | 4 格均返回 null；正确且未过期也仍为失败标记 0 | 正确未过期走 `PREPAREPARAM1` 标记 1；错误未过期走 `PREPAREPARAM2` 标记 0；过期直接 END 且 effective=0 |

当前测试入口限定 `RAWSFCODE1`，使用控制输入及原模型脚本；
中央条件判断、准备参数和结束节点是真实 runtime。
未执行上游 `shared` 数据查询、真实 HTTP、数据库、账号或匿名浏览器，
因此不能把这 16 格写成分享全流程通过。

实际回执：
`.artifacts/owned-wiki-dispatch-tests-7314b7706fdd/report.private.json`，
状态 `PASS_16_NATIVE_DISPATCH_CELLS`，
执行时间为 2026-11-26 19:44:15 至 19:44:20 UTC，
SHA-256 `9ef11502968b3d79e76b6916db2d7078239de8586e95dcfb7f8a7655c3a056e0`。
绑定 `scripts@e508edce97cdbd224b7be0a38dabb51b6e5bcbd5`、
`plm@8a13b29cdc21832366c31d7c1103dae7ce4018da`、
`plm/backend@8c0dd6bfd8a9362b23af354ae3047ef66533ebfc`
及各仓库当时脏状态哈希、精确参与源码哈希。
原始回执和编译产物均不提交。

精确编译目录：
`.artifacts/owned-wiki-dispatch-tests-7314b7706fdd/classes`。

| 仅有的编译类 | SHA-256 |
| --- | --- |
| `cn/ibizlab/plm/wiki/articlepage/logic/CheckShared.class` | `7f7dc564abca791f427ac39812d50602e43c4c2097391d5ff937e3b981f04acc` |
| `cn/ibizlab/plm/wiki/articlepage/logic/AccessPassword.class` | `c2245434bda0fd13814ec27ae0a003d0e0b46a6cd05f24dcc1d40b07d013870a` |

该目录不含 `GetCustomerScore.class`。主线如需 overlay，须将这两个精确类、
实际本地分享参数输入、provider archive 前后哈希与恢复输入一并绑定，
不能从目录中猜测其他上线文件。

此前 target=11 的行为探针也通过 16 格，其回执
`b596e444c103f7e8d54ed6f0315c84a5e3d9355809859eca3a1883e5eb9a9eb6`
仍私有保留，但不能用于当前归档 overlay。r4 候选因 major55/52 不一致被原
`Class version changed` 守卫拒绝，未放宽守卫；改用上述 major52 编译后，
合并本地参数的 r5 候选才准备成功。详见
[合并 provider 候选](PLM-WIKI-COMBINED-PROVIDER-20261126.md)。

独立序列化探针使用 r5 实际 `ArticlePageDTO`、真实
`MethodHandlerBase.MAPPER` 和模型 END runtime，分别返回同一 result/Default
DTO 后序列化。`effective`、`check_access_pwd`、`check_access_password`
三个动态标记的内存值和 JSON 值均为 1；`shared_page_url` 正控也保留。
没有发现这三个标记在该精确 codec 下丢失，也没有因此修改旧脏 DTO。
这仍是逻辑输出观察：权威 `article_page` DTO 列表没有三个字段声明，
`check_shared` action 返回 `article_page_dto`，
`check_access_password` action 外层仍为 VOID。未改变这些声明。
私有回执
`.artifacts/wiki-return-dto-codec-20261126-r1/report.private.json`，
SHA-256 `319a8da0c54f0872866a56dbdfc1f46d5719cf0767d7ffc0addc7740415dc8d5`。

## 待决策/阻塞

本轮未部署、未改共享配置、未登录、未重启容器。
分享 URL 参数必须在当前 localmode 实际配置中生效；
入口、合法匿名访问、正确/错误密码、过期、撤销、子集外访问、
草稿隔离、跨角色拒绝及自有数据清理仍由真实当前业务流程验证。

B01 当前真实 UI 结果仍见
[知识业务验收](B01-KNOWLEDGE-CLOSEOUT-20261126.md)。
