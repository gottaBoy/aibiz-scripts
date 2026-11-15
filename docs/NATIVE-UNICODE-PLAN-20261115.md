# 原生 Unicode 计划器

日期：2026-11-15，Asia/Singapore。范围：R06 的私有元数据采集源码、审计和迁移**提案**。
纯 planner 不连接数据库或运行 Docker/SQL；新增 collector 仅有显式自有环境 SELECT 入口。
本工作线实现/测试未自行连接 Docker/数据库/HTTP、复制备份、修改初始化文件或共享 schema。
主协调后续 r1 因存在性合同失败，修正后 r2 双读成功；pure plan r1 仍被真实宽行风险阻塞，
详见下方记录。没有迁移，因此不能关闭 R06、M02、L02、O02 或其他顶层验收项。

源码：[owned-native-unicode-plan.mjs](../owned-native-unicode-plan.mjs)。
测试：[owned-native-unicode-plan.test.mjs](../tests/owned-native-unicode-plan.test.mjs)。
采集器：[collect-owned-native-unicode-metadata.mjs](../collect-owned-native-unicode-metadata.mjs)、
[测试](../tests/collect-owned-native-unicode-metadata.test.mjs)。
前例：[PLM Unicode 修复](PLM-UNICODE-FIX-20261113.md)。
待办：[原生运行阻塞](OWNED-RUNTIME-BLOCKERS-20261115.md)、
[执行总计划](AUTONOMOUS-EXECUTION-20261115.md)。

## 当前事实

- 手册/工作区要求：中文、补充平面字符、组合字符、引号、反斜线和换行必须真实 API 无损往返；
  参数绑定和上下文转义不能靠删除字符替代。
- 本地实现观察：前轮原生 owned metadata 中仍有大量 `utf8_general_ci` 表；
  PLM 的 2026-11-13 mb4 修复不能外推到 metadata、UAA 或物理模型库。
- 当前版本证据：源码/本地文件测试通过，主协调实际 r2 双读发布了稳定结构化 inventory；
  没有本轮原生备份、克隆、DDL、数据一致性、幂等或 API Unicode 通过证据。
  受控测试 fixture 不是数据库观测。
- 待决策/阻塞：缺少完整 metadata、特殊列/索引/依赖、未知版本或 collation 时输出
  `BLOCKED`，不套一个统一默认 collation，也不猜索引截断和行格式转换。

## 输入与所有权

纯函数 `buildOwnedNativeUnicodePlan` 必须显式收到：

```js
{
  runId,
  manifest,
  manifestSha256,
  metadata
}
```

复用 `validateMatrixFixture` 验证现有自有 fixture 合同：
runId 必须是 12 位小写 hex，四个 schema 必须精确等于 manifest 的
`nf_<runId>_uaa`、`nf_<runId>_meta`、`nf_<runId>_model_a`、
`nf_<runId>_model_b`，不能用前缀匹配采用共享 schema。

`metadata` 必须绑定同一 runId 和 manifest SHA-256。schema 集合必须完整且无重复；
表/列/索引/依赖记录均不得逃出 manifest。跨 schema 外键若触及非自有库直接拒绝，
不主动读取或改动外部库。

CLI 只接受该 run 的 `.artifacts/native-nonadmin-fixtures/<runId>/` 内的文件；
manifest 必须是该目录下精确的 `manifest.json`。使用现有 `PinnedDirectories`/
`readPinnedFile`，拒绝 symlink、非普通文件、哈希不匹配、非当前用户所有或组/其他用户
可读的原始文件；输出目录必须新建，文件权限为 `0600`。不覆盖旧失败回执。

## 元数据合同

输入是 `owned-native-unicode-inventory-v1` JSON，不是 SQL dump，也不解析
`SHOW CREATE TABLE` 字符串。复用现有 editor/provider inventory 的结构化
`database/table/column/columnType/ordinal/key/nullable/default/extra/charset/collation`
和索引字段，补齐迁移所需信息。旧精简 inventory 缺长度/注释/生成表达式等信息时必须阻塞，
不能用空值补成“已经完整”。

| 数组 | 必须提供的结构化字段 |
| --- | --- |
| `schemas` | `schema`, `charset`, `collation` |
| `tables` | `database`, `table`, `kind`, `engine`, `rowFormat`, `collation`, `createOptions`, `comment` |
| `columns` | `database`, `table`, `column`, `type`, `columnType`, `ordinal`, `key`, `nullable`, `default`, `extra`, `charset`, `collation`, `characterLength`, `octetLength`, `comment`, `generationExpression` |
| `indexes` | `database`, `table`, `name`, `position`, `nonUnique`, `column`, `prefix`, `type`, `collation` |
| `characterSets` | `name`, `maxlen`，来自该 server 的 `CHARACTER_SETS` |
| `collations` | `name`, `charset`，来自该 server 的 `COLLATIONS` |
| `foreignKeys` | `database`, `name`, `table`, `column`, `referencedDatabase`, `referencedTable`, `referencedColumn` |
| `triggers` | `database`, `name`, `table` |
| `views`, `routines` | `database`, `name`；存在受影响 schema 依赖时另审 |

`default: null` 与缺少 `default` 不同；`prefix: null` 与遗漏索引前缀字段不同。
所有数组必须显式出现，即使为空。`counts` 须有上述每个数组的独立观测数量并与记录数一致，
不得把先过滤出的数组长度当成独立数据库数量证明。纯工具只能核对输入的一致性，不能证明
调用方真实进行了这些 SELECT；后续采集回执必须绑定查询、连接与运行资源身份。

`coverage` 必须完整声明：

```json
{
  "schemas": "manifest-exact",
  "tables": "all-base-tables",
  "columns": "all-columns",
  "indexes": "all-index-parts",
  "dependencies": "all-touching-selected-schemas",
  "collations": "server-catalog"
}
```

还需 `observedAt` 和 `server`：

- 首个支持 profile 仅为已观察的 Oracle MySQL `5.7.41`；其他版本/vendor 必须新审。
- 显式记录 `innodbPageSize`、布尔 `innodbLargePrefix`、`innodbFileFormat`、
  `innodbStrictMode: true` 和实际 `lowerCaseTableNames`。
  Case=0 保留精确大小写 profile；Case=1 只在四 schema/每库 table 的 ASCII 名称已经精确小写、
  规范键无碰撞时支持，不重写名称、不猜 Unicode case folding；Case=2 仍阻塞。
- `sqlModes` 必须含严格模式且不含 `NO_BACKSLASH_ESCAPES`；工具不修改会话模式。
- `characterSetClient`、`characterSetConnection`、`characterSetResults` 须实际观察为 `utf8mb4`；
  声明一个 JDBC URL 不代替连接变量观测。

这些字段由下述独立审查的 SELECT-only 采集器形成私有 artifact；
该入口的真实 r1 已失败，修正后的 r2 已由主协调双读通过。

## 只读采集器

入口必须同时提供 `--execute-owned --run-id --deployment-input --label`。
复用 `ownedNativeRuntimeContext` 的精确容器/镜像/网络/文件身份保护，
再要求恰为 MySQL/UAA/Redis/Nacos/ZooKeeper/allinone/provider/gateway 八节点。
缺节点、额外共享 peer 或已启动两个 frontend 的十节点网络均拒绝；应在 frontend 启动前
统一安排这一轮采集，不扩大原 context guard，也不移除现有 peer 来适配工具。

当前完整后端拓扑会另建 Workflow/EBSX/Platform 三库；它们不在 manifest 的四个目标库内。
仅在以下链条全部通过后，允许这三个**精确身份**在 server 中存在：

1. Runtime context 绑定的 deployment 文件 SHA-256 与旁侧完成的 `report.json` 对应，
   启动回执状态/保留/peer 完整性通过，不能采用别的启动尝试。
2. 该启动回执中的 `workflowSchema`、`ebsxSchema`、`platformSchema` 分别绑定同一 run
   内的 schema report SHA-256 和 configuration SHA-256。
3. Schema report 的 contract、成功/创建/验证/引导账号移除标志、错误集、源码 generator
   哈希及 running-image package receipt 一致；EBSX/Platform 的前置回执链也必须相符。
4. 使用既有 `workflowIdentity`、`ebsxIdentity`、`platformIdentity` 精确核对 schema、
   bootstrap/runtime 账号及无凭据 JDBC URL；不读 configuration 中的 password。

`topologySchemaPresence` 把这份凭据无关的存在性证明绑定到采集元数据及回执。
三个额外名字只出现在未声明 schema 的 COUNT 排除集合，不进入任何表/列/索引/view/routine
采集筛选，也不成为 planner 的转换目标。没有 `nf_<runId>_*` 前缀通配授权；
缺少回执、错误 run/身份/包/哈希、未完成启动或回执漂移一律拒绝。

SQL fixture 另外创建了 `nfx<runId>_model_a`、`nfx<runId>_model_b` 两个 wildcard-grant
负向探针。它们也只能按精确名字获存在性许可：

- `isolated-sql-report.json` 的 SHA-256 必须已绑定在同一 startup 的 `inputs` 中。
- 复用 `validateFixtureReceipt`，核对保留/未清理、全部检查通过、同一 manifest、
  owned-resources SHA-256、MySQL ID/image 与 network ID。
- `ownedGrantWildcardProbeSchemas` 必须精确为这两个名字，fixture SQL 源码哈希必须一致，
  两侧 SELECT/UPDATE 拒绝与探针未变更的六个精确检查均须通过。
- 这两个名字只加入存在性 COUNT 的排除集合；不读探针表/列/业务值，不扩展四库转换范围。
  任何额外同前缀 schema、过期/错误 run 回执或缺失拒绝证据仍失败。

SQL 仅有一个由 manifest 构造的 **22 条固定 SELECT 批次**，两次各使用新 MySQL CLI
进程且仅执行该批次；`--no-defaults` 不加载默认 client option file。
十类数组各有独立数据库 `COUNT(*)`，加 server variables 和
未声明 schema 的数量检查。不是用投影结果的数组长度伪造独立 COUNT。

现有 A01 `SELECT JSON_OBJECT` 检查只作为附加防线；权威白名单是整个批次的精确字符串。
追加一条看似只读的业务表 SELECT、删改 COUNT 或换 schema 都拒绝。
没有任意 `--query` 参数、SQL文件导入或 DDL 入口。原物理业务 snapshot 查询不适用本任务，
因此不复用其中读取业务行值的语句；只复用固定 snapshot 执行模式和只读 predicate。

| 范围 | 采集与拒绝规则 |
| --- | --- |
| 四个 owned schema | 完整 base tables/columns/indexes，列含默认/注释/生成表达式；不 SELECT 业务表中的任何行值 |
| Server catalogs | `CHARACTER_SETS`/`COLLATIONS` 及独立计数；变量记录真实 page size、large-prefix、模式、连接 charset 和大小写 profile |
| 外键 | `KEY_COLUMN_USAGE` 仅返回触及四个目标库的入向/出向指针；四目标内跨库保留给 planner 阻塞，任何目标外 referenced/owner（包括仅获存在证明的三库）均拒绝，不采集那些库的完整 metadata |
| Trigger/view/routine | 采集自有对象身份、字符集和模式，不读取/解析程序体；跨 schema trigger 不猜授权 |
| 外部 schema | 仅计数是否存在四目标库、四系统库、三份 schema 回执和两个 SQL fixture 精确探针以外的 schema；若有即拒绝，不前缀放行或扫描其内容 |
| 程序依赖边界 | 不声称解析了动态 SQL 或所有程序体引用；受影响 schema 的这些对象仍由 planner 阻塞，后续单独审查 |

完整批次前后均有资源/源码 guard，字符串键按 binary 顺序避免大小写同权排序不稳定；
两次都记录查询批次及逐语句 SHA-256、
独立 COUNT、结果哈希、来源和观察时间。只有观察时间可以在一致性比较中不同，
其余所有 metadata/count/server 字段必须精确一致。两次一致是连续只读观测，
**不是事务快照、DDL 冻结或业务写入静止证明**。
这一证明也不代表 server 没有其他 client；本工具不查询 PROCESSLIST，
不把运行中的八节点服务连接当作已经停止。

输出为新的私有 `unicode-metadata-<label>/` 目录：

- `queries.private.json`：精确白名单语句及逐语句身份。
- `snapshot-1/2-...private.json`：dispatch intent、进程结果哈希和前后 guard。
- `inventory.pass-1.private.json`、`inventory.pass-2.private.json`：两次完整观测。
- `inventory.private.json`：仅在两次一致且最终 guard 通过后发布给 planner。
- `report.private.json`：绑定 collector/planner/context/只读检查源码和原运行输入。

文件 `0600`、新目录 `0700`，使用既有 pinned/exclusive API；manifest 也必须私有且
与 runtime context 绑定的哈希一致。失败保留原始私有输出和阶段，不覆盖旧回执、不自动重试
到共享地址、不发起任何清理/重建/迁移。进程失败时也执行返回后的资源检查。
只读 context 的关闭在最终 inventory 发布前完成；关闭失败不能留下成功的完整采集回执。
调用者最终仍负责按原自有环境回执清理资源；collector 本身不创建/删除容器。

```sh
node scripts/collect-owned-native-unicode-metadata.mjs \
  --execute-owned \
  --run-id=<owned-run-id> \
  --deployment-input=.artifacts/native-nonadmin-fixtures/<owned-run-id>/backend-runtime-<label>/deployment-input.private.json \
  --label=unicode-r1
```

stdout 仅有脱敏状态、计数和哈希。`COLLECTED-NOT-MIGRATED` 只表示两次结构化采集一致；
备份/恢复/迁移/幂等/API/native/full acceptance 标志始终为 false。
r1 是主协调执行的真实只读失败记录；本工作线只离线读取现有私有回执进行重放，
不把受控执行器或离线重放记为新的数据库观测。

## r1 与 r2

`b5dc5669e6d1/unicode-metadata-context-unicode-r1` 的实际执行停在
`snapshot-1-structured-verification`：`unapprovedSchemaCount=2`。
这是存在性合同漏记两个 fixture 自建 wildcard 探针，而非字符迁移失败；
此轮没有执行迁移、没有发布最终稳定 inventory，原始失败回执不改写。

修正仅按上述当前 SQL fixture 哈希/精确身份/拒绝后未改证据允许两探针存在。
parser 仍要求**新查询的未声明数量为 0**；不能把历史或未知来源的 COUNT=2 减二变绿。

离线重放读取 r1 私有原始 stdout，只在内存中执行：

- 原 COUNT=2 继续被拒绝，原始 artifact SHA-256 前后一致。
- 新旧批次除了存在性 COUNT 外，其余 21 条查询逐字相同。
- 仅将新批次预期的 control=0 作为反事实测试输入后，原始其余
  4 schemas / 964 tables / 33,911 columns 全部通过 parser。

这只证明其余真实 metadata 兼容 parser，**不证明 r2 的实际 COUNT 已是 0**。
修正后的真实 r2 已由主协调重新执行双读/全部 guard：
4 schemas / 964 tables / 33,911 columns / 946 indexes。
它仅为 `COLLECTED-NOT-MIGRATED`，不包含字符 DDL 或 API 特殊字符写入。

## 转换与保留

- 按实际旧 collation 后缀逐一映射，如 `utf8_unicode_ci` -> `utf8mb4_unicode_ci`；
  只有 server catalog 中存在对应项才生成提案。`utf8mb3` 别名也必须明确被观测到。
- 已有 mb4 列及其显式 collation 原样保留；binary/numeric 字段不重写。
- 仅支持 plain `CHAR`、`VARCHAR` 和四类 `TEXT`；严格核对 `COLUMN_TYPE`、
  nullable/default/comment/extra/长度，不拼接任意 SQL 类型片段。
- 使用逐列 `MODIFY COLUMN`，保留原类型和 TEXT byte capacity，不做 table-wide
  `CONVERT TO CHARACTER SET`，也不自动扩展成 MEDIUMTEXT/LONGTEXT。
- 表和数据库默认 collation 分别按各自旧值映射；不使用一个统一值盖掉差异。
- 已观察生成列/特殊 EXTRA、ENUM/SET、未知字符集、TEXT 非空默认、外键/触发器、
  受影响 schema 的 view/routine、特殊 table options 等阻塞并保留原元数据。
- 标识符使用独立组件 backtick 引用并把内部 backtick 加倍；支持中文/引号等合法 BMP 名称，
  保守拒绝控制字符、补充平面名称、超长/尾空格和数据库/表文件名分隔符。
- 默认值和注释逐字符转义；不删补充平面/组合字符，不把字面量当表达式。
  SQL mode 不兼容时阻塞，不临时切换 SQL mode 来执行。

## 索引与行格式

每个索引记录原 parts、唯一性、每段原/目标最大字节、前缀单位和总字节。
字符前缀按字符数乘 charset `MAXLEN`，binary 前缀按字节数；复合键逐段累加。
索引定义、前缀和唯一性绝不由工具修改。

首版仅对 BTREE/plain 列，以及整数和 binary/varbinary 索引段做精确预算；
FULLTEXT/SPATIAL/functional、缺失段、未知类型（包括尚未实现 byte 精算的 decimal/time 等）
直接阻塞，不把其字节数当零。

Dynamic/Barracuda/large-prefix profile 使用 page-size 对应预算：16 KiB 及以上为 3072，
8 KiB 为 1536，4 KiB 为 768。超预算阻塞，不建议隐式缩短到 191 字符。
Compact/Redundant 或 large-prefix 禁用的单段保守使用 767 字节。

旧格式**复合键**存在 MySQL 官方已确认的文档问题 #103146：767 的逐段限制不等同已经
验证的整个复合键总长。工具明确标记 `LEGACY-COMPOSITE-LIMIT-UNREVIEWED`，
总限制设为未知，等待精确版本 clone DDL；不把报告中的歧义转为自动批准。

行风险报告 CHAR/VARCHAR 声明最大字节、VARCHAR/VARBINARY 长度前缀、已精算固定类型，
以及每个 TEXT/BLOB 对全局行限制的最小 9 字节贡献。绝不把 TEXT/MEDIUMTEXT/LONGTEXT
的完整容量当作页内数据相加；未知类型、NULL/记录开销和 off-page placement 仍标明未精算。
已知声明下界超过 65535 即阻塞，未超过也不是完整行可行性证明，
仍保留 `CLONE-DDL-REQUIRED` review。
Compressed/未知格式、特殊 create options 或无法确定的 key budget 阻塞，不改成 Dynamic。

## Case=1 与 31 张宽表

真实 r2 的 profile 为 MySQL 5.7.41/Barracuda/Dynamic/16 KiB/strict/mb4 connection，
`lower_case_table_names=1`。旧 pure plan r1 报 32 个 blocker：1 个未支持的 case profile、
31 个 `ROW-PAYLOAD-OVERFLOW`。本次支持并审计当前四 schema/964 张表的精确小写 ASCII
规范键，零碰撞、零隐式改名；只移除 profile blocker。

31 张表的 CHAR/VARCHAR 目标最大字节实际为 **66,920..77,800**，原三字节为
50,190..58,350，单独字符声明已超过 65,535。不是 TEXT off-page 误计。
加入已知前缀/TEXT 最小贡献/整数等下界后为 67,091..77,856，仍恰为同 31 张。
新源码仅在内存重放现有库存，结果仍 **BLOCKED31、零迁移语句**，
884 个 unique-key 与 884 个 row/clone review 保留。没有通过降低风险、截断或转换字段变绿。

`rowRisk.declaredBudget` 明列逐列贡献、排除的 TEXT/BLOB 容量和未定类型。
宽表额外输出 `SOURCE-SCHEMA-REDESIGN-REQUIRED-NOT-EXECUTED`：
每个 VARCHAR 的原类型/NULL/default 类型及哈希/最大字符数/索引与前缀，
TEXT/MEDIUMTEXT 最小容量提示、维持原字符上限的要求、未解决的来源与验证门槛。
不会选择字段、不生成改类型 DDL；原 VARCHAR 定义和所有数据不变。

以下为 14 个逻辑表，展开 A/B 与三个 metadata 副本共 31 张。候选仅用于下一轮源码设计审查：
所列候选在真实库存中均为 nullable、默认 metadata NULL、非索引字段；不能由此推断可自动转换。

| 逻辑表 | 出现范围 | CHAR/VARCHAR 目标字节 | 优先审查列 / 原最大字符数 | 权威来源与缺口 |
| --- | --- | --- | --- | --- |
| `t_srfpsdetbitem` | meta/A/B | 66920 | `RAWCONTENT` / 4000 | DEFAULT + DB2，std25 |
| `t_srfpsdevslnsysref` | meta/A/B | 76840 | `DENAMES`、`REFPARAM`、`REFPARAMS` / 各4000 | dump 字段，当前 DEFAULT 找不到对应列，须先补映射 |
| `t_srfpsdevslntempl` | meta/A/B | 70720 | `MEMO` / 2000；`PKGPARAM`、`TEMPLPARAMS` / 各4000 | MEMO 在 DEFAULT；后两项是待追溯 dump 字段 |
| `t_srfpsdedataview` | A/B | 67320 | `TODOTASK` / 4000 | DB2，std25 |
| `t_srfpsdeformdetail` | A/B | 68144 | `EDITORPARAMS` / 2000 | DB2，std25；物理 `DATA` 还缺模型列映射 |
| `t_srfpsdegrid` | A/B | 73280 | `TODOTASK` / 4000 | DB2，std25 |
| `t_srfpsdelist` | A/B | 77080 | `MEMO`、`TODOTASK` / 各4000 | DB2，std25 |
| `t_srfpsdetreenode` | A/B | 73760 | `ACTIONPARAM`、`MEMO` / 各2000 | DB2，std25；单个2000列的缩减不足，不能只改一个就宣称可行 |
| `t_srfpsdeuiaction` | A/B | 71320 | `TODOTASK` / 4000 | DB2，std25 |
| `t_srfpssubsysserviceapi` | A/B | 66960 | `MEMO` / 4000 | DB2，std25；dump 的 `BASECLSPARAMS` 还缺映射 |
| `t_srfpssysdmitem` | A/B | 77800 | `CREATESQL4` / 4000 | DB2，std25 |
| `t_srfpssyspfpitempl` | A/B | 68320 | `TEMPLCODE2/3/4` / 物理各4000 | DB2 已是 std21、length1048576；现有 fixture mapper 把 std21 映射 MEDIUMTEXT，须先解决 dump/model 类型差异 |
| `t_srfpssysportlet` | A/B | 71800 | `MEMO`、`TODOTASK` / 各4000 | DB2，std25 |
| `t_srfpssysutilde` | A/B | 76400 | `UTILPARAMS` / 4000 | DB2，std25 |

原始 dump 为 `modelingservice/sql/sCloud9471c1eca.sql`；所有 14 表都来自
`dump-with-model-additions`。DEFAULT/DB2 是
`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSDBSCHEMES/`
下的同名 JSON；合并/fixture 类型来源是 `scripts/model-fixture-schema.mjs`。
先以结构化表/列对象核对这些源码及应用实体长度/序列化合同，不能只改运行库或生成 DDL。

源码方案必须保持 NULL、默认和字符上限，不为 TEXT 私自删除 literal default；
完整/唯一索引不可改成短前缀。MySQL 5.7 的 CHECK 不能代替真实长度强制，
需审查所有 native 写入口及数据库约束策略。模型已有 std21 的模板列尤其不能把
物理4000未经审查当作业务规范上限。若采用纵向拆表，关联、事务、DTO/mapper 同样要补证据。
本轮未选定或应用任何方案，未跑 backup/clone/DDL/API；root 才可在新目录生成新 pure plan，
原 plan r1 与原库存全部保留。

## 输出与命令

`plan.private.json` 保留原逐列/索引 metadata 和提案，只能留在私有 artifact。
CLI 回执同时绑定实际 manifest/inventory 文件与 planner 源文件 SHA-256。
有任一 blocker 时，顶层 `migrationStatements` 必须为空；局部审计仍保留原因和原始定义。
所有结果都保持 `executionAllowed: false`，其余备份/恢复/数据/幂等/API/全量验收标志也为 false。

状态只有：

- `BLOCKED`：元数据/版本/风险尚未解决，不提供整体可执行列表。
- `PLANNED-NOT-EXECUTED`：形成提案，仍需备份/克隆/审查，不是迁移授权。
- `NO-UTF8-CHANGES-PLANNED`：输入未发现旧 UTF-8 变更，不等于已验证幂等或 API 支持。

CLI 必须显式 `--plan`，不存在 `--execute` 或 SQL 连接参数。示例的路径与哈希需由实际
私有输入确定，不能复制占位值制造执行记录：

```sh
node scripts/owned-native-unicode-plan.mjs --plan \
  --run-id=<owned-run-id> \
  --manifest=.artifacts/native-nonadmin-fixtures/<owned-run-id>/manifest.json \
  --manifest-sha256=<actual-file-sha256> \
  --metadata=.artifacts/native-nonadmin-fixtures/<owned-run-id>/unicode-inventory.private.json \
  --metadata-sha256=<actual-file-sha256> \
  --output=.artifacts/native-nonadmin-fixtures/<owned-run-id>/unicode-plan-r1
```

stdout 仅输出脱敏状态、计数、结果哈希；不输出 schema、标识符、默认值、注释或提案 SQL。
退出码：0 表示计划形成/无变更计划，2 表示已保存阻塞计划，1 表示输入/文件安全拒绝；
三者都不表示迁移或业务验收通过。

## 下一执行链

1. 审查 SELECT-only 元数据采集器和精确 owned 容器/镜像/网络/无其他连接保护。
2. 全量备份 -> 单独 owned clone 恢复 -> 数据/schema/grant 一致性证明。
3. 解决每项 blocker；通过严格模式 clone DDL 证明行/索引/唯一性和类型/默认值/注释保留。
4. 比较完整表定义、数据、权限、既有 mb4，重复新鲜采集和第二次迁移证明幂等。
5. 正常认证 API 创建/读/改/新会话读回/删除全部特殊字符样本，检查负向角色无副作用。
6. 清理精确自有数据与 clone，保留私有原始证据；共享迁移另有批准/恢复计划。

## 官方依据与未决边界

查询日期 2026-11-15；只参考 MySQL 官方资料，不采用第三方 SQL 自动修补建议：

```text
https://dev.mysql.com/doc/refman/8.0/en/innodb-limits.html
https://dev.mysql.com/doc/refman/8.0/en/identifiers.html
https://dev.mysql.com/doc/refman/8.0/en/charset-conversion.html
https://bugs.mysql.com/bug.php?id=103146
https://dev.mysql.com/doc/refman/8.0/en/column-count-limit.html
https://dev.mysql.com/doc/refman/5.7/en/identifier-case-sensitivity.html
https://downloads.mysql.com/docs/refman-5.7-en.pdf
```

旧 5.7 HTML 路由当前不能作为原版本语义已验证的证据；可访问的 8.0 文档仅用于交叉核对
稳定的字节预算/名称/逐列转换原则，不作为 5.7.41 clone 测试替代。官方 bug 实际涉及
5.7.33，不能据此声称 5.7.41 已验证；因此旧格式复合键保持阻塞。
归档 5.7 PDF 的大文件读取未成功，未把失败读取写成已核验。
后续通过官方搜索索引核对 5.7 的 case=1 存储小写/比较规则与 CHECK 未执行说明；
全局 65,535 与 TEXT/BLOB 9..12 字节按官方列限制文档交叉核对。

可重复定向测试只读本地源码并创建临时 JSON，不启动任何服务：

```sh
node --test scripts/tests/owned-native-unicode-plan.test.mjs \
  scripts/tests/plm-utf8mb4-migration.test.mjs
```

本轮 planner 28/28、既有 PLM migration contract 4/4，共 **32/32**。
与执行账本/手册检查联合运行 **56/56**，无取消/跳过/todo；
这只是本地计划/契约证据，不是数据库迁移计数。
初轮标识符测试发现 Unicode regex 的 `/u` 模式未拒绝成对代理表示的补充平面名称，
已显式排除 U+10000 以上标识符并重跑全部通过；业务字符串中的这些字符仍原样保留。

后续新增 collector **21/21**，覆盖固定白名单、独立 COUNT、双读漂移、八节点/额外 peer、
进程失败、源码漂移、私有/独占文件、晚到的 context-close 失败与脱敏输出。
最终联合 collector/planner/PLM/账本/手册 **77/77**，零取消/跳过/todo；
所有 Docker executor 均由受控测试替身提供，没有运行真实数据库采集。

存在性修正后 collector **24/24**、与 planner 联合 **52/52**。
增加 deployment -> startup -> schema/package/generator/配置哈希链、凭据无关精确身份、
目标不扩展以及回执漂移拒绝；最终五文件定向联合 **80/80**，仍未执行实际采集。

探针存在性修正后 collector **26/26**、与 planner 联合 **54/54**。
新增 fixture 哈希/资源/创建和拒绝未改证据、历史 COUNT 不重解释的保护；
上方真实 r1 离线重放另记，不混同单测或新的运行通过。

Case=1/宽行审查后 planner **35/35**、PLM contract **4/4**、collector **26/26**，
定向联合 **65/65**，零失败/跳过/todo，diff whitespace 检查通过。
授权的 collector 测试单点调整只检查原样保留 case=1 与显式 casePolicy，
不再错误要求所有 case=1 都阻塞；collector production 源码未改。
真实库存仅在纯内存重放，原 pure plan r1、metadata r2 均未改写；
32 -> 31 是 profile 支持与已有风险保留，**不是产品已经迁移或验收完成**。
