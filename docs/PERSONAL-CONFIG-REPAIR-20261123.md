# 个人配置原生持久化修复

检查点：2026-11-23，Asia/Singapore。F06 保持 PARTIAL。
本批复用现存容器，没有 create/recreate/pull 或服务重启。
后续于 [原生登记诊断](PERSONAL-CONFIG-REGISTRATION-20261122.md)及
[既有服务认证](EXISTING-SERVICE-AUTH-20261122.md)，不覆盖其原始失败。
脱敏摘要见 [修复记录](../records/aibiz-personal-config-repair-20261123.json)。

## 手册要求

按 [管理与集成指南](manual/ADMIN-INTEGRATION-METRICS.md)区分个人和共享设置，
实际保存、跨会话读回、隔离、拒绝和清理分别验收。
UTF-8 修复先备份、恢复自有克隆，再核对完整元数据、数据、幂等与真实 API；
中文、补充平面字符、组合字符、引号、反斜线和换行不删改。

## 本地实现观察

原生保存先因实际平台库缺少真实 PLM 系统登记而失败；配置表 `IBZCFG`
的 6 个文本列也仍为 `utf8`。网页三类配置入口另外被 Nginx 空成功 stub 截断。
这三个问题需要分别处理，单纯补前端回执或伪造父键均不能完成持久化。

现已通过原生管理员接口登记实际 `ibizplm / iBizPLM`：
候选绑定当前 `/app/model` 只读挂载及 `PSSYSTEM.json`，
字段来自原生 System 模型，平台身份先通过 CREATE 权限的 CheckKey，
实际 POST 后独立 GET 和物理精确计数确认从 0 到 1。
不新增模型来源、不加载/发布模型、不更改角色。
该登记属于真实现存系统修复，保持；只有自有配置探针 key 被清理。

`personal-config` 是独立、精确限定 `ibzcfg` 的迁移 profile，
不把它混入先前消息三表的回执。共 7 列、2 个索引、InnoDB Dynamic，
当时准确为 0 行。6 个字符列及本表默认值改为对应 `utf8mb4` collation；
datetime、类型、NULL/default/comment、主键和另一个索引均完整保持。
未执行 `ALTER DATABASE` 或全局修改。

消息和配置两个 profile 复用同一保留定义的 planner、只读 collector 与执行器，
分别限制 allowlist、备份目标及克隆探针。配置的旧/新 Unicode 实验使用
自有克隆中的事务 INSERT/ROLLBACK，未写共享 SQL 夹具。
两次克隆都已删除，二次计划没有 DDL。

Nginx 仅把 customtheme、menu、dynafilter 三个既有前缀代理到真实 `/configs/`，
透传 Authorization、固定真实系统及原组织，不补造人员头。
源配置同步维护；运行配置另有私有备份、精确哈希、`nginx -t`、reload 和条件回滚。
app_view_themes 空成功 stub 仍是独立未完成项。

## 当前版本验收证据

| 范围 | 结果 | 私有回执 SHA-256 |
| --- | --- | --- |
| 独立配置克隆预演 | 旧 Unicode 拒绝、新 Unicode 回读、完整元数据/数据与幂等通过 | `72332723e4313fa494e8806017d6f6f9119a2949e8bd3f75d6c7c88932b4c3ad` |
| 配置单表 live 迁移 | 6 列，重新备份/克隆后执行，0 行数据保持，生命周期未变 | `31f26708ab3658c61df8563682f7599dd2a67bc38c4418ba72a0e1e4d563bd51` |
| 真实系统原生登记 | POST、独立 GET 与精确 count=1；无模型发布/权限修改 | `2d3c85fe66fca9c2848d99719105f3015fc583532ea5316bf1fa81ec35816043` |
| 原生个人配置 | 三类共 30 次请求，写/更新、Unicode、新登录、匿名 401、清理通过 | `42e02f627f635ed9ad661a63c7e0c29bb25ae6bd90d7d21c54100b51f7c05991` |
| 三类运行代理 | 精确配置替换及测试 reload，容器生命周期未变 | `36791d1575c6a845533c7c31e8ca22dd1b7768a71106ac8f2cfa601064df0657` |
| 网页真实代理协议 | 三类共 36 次请求，proxy/native 内容一致、新登录、匿名 401、双端空读回通过 | `5a73de1225f0ad3d2f5e1b0f470bb21cf60e85116b5c603b17d8e6281c8a41d4` |

对应目录：

- `.artifacts/platform-config-utf8mb4-20261123-r1/` 和 `r2/`
- `.artifacts/plm-native-registration-20261123-r1/`
- `.artifacts/plm-personal-config-native-20261123-r1/`
- `.artifacts/plm-personal-config-route-repair-20261123-r1/`
- `.artifacts/plm-personal-config-proxy-20261123-r1/`

完整表备份 1625 字节，SHA-256
`9728d93f060c8e3a85e915a938922b8e410016d293bc6ebdb4ac9ca382336c5f`。
迁移前后数据 dump 均为 0 字节，SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；
明确是空源表的保持，不伪称有存量业务数据被覆盖验收。

新运行 Nginx 配置 SHA-256：
`1799e7ba1fcfe3905399047dd347f712f531c86068fa1bbd6197f873af7f68b3`。
登录凭据、token、配置探针内容与完整请求响应保留私有。
原迁移报告的 `apiUnicodeVerified=false` 不改写，后续真实协议另用新回执补证据。

定向测试：迁移/元数据/执行器 **27/27**，三类路由及 appdata **11/11**，
原生登记执行器 **11/11**。这些是分别运行的子组，不与此前 48 项组合相加。
原生登记测试包括 HTTP 500 后已经落库、响应丢失、证据 fsync 失败和未知状态，
避免将失败误认成无持久化副作用；不自动删除已被采用的真实系统。

## 视图主题目录后续修复

`app_view_themes` 是 SEARCHBAR2 搜索栏的个人分组/系统视图配置目录，
与 `IBZCFG` 的 `customtheme` folder 不同。源模型的 `cur_user_all` 合并
`cur_user` 与 `cur_system`：前者按当前 `srfuserid / srfdcsystemid`，
后者按当前系统及 `OWNER_TYPE=SYSTEM` 读取。

实际 `idea_all_grid_view` 原生接口返回 4 条合法系统配置，个人配置为 0；
旧前端 exact stub 返回 `200 []`，匿名也为 `200 []`。这个响应掩盖了真实目录和
原生匿名 401。只读诊断 r1 报告 SHA 为
`914277bfde3e76db6046c620d51e639b9e7beedb01134f45e78fa56ce5976e6e`。

已用相同备份/克隆/完整元数据与数据比较协议，对精确 `app_view_theme` 单表
14 列中的 10 个文本列执行独立 utf8mb4 修复。备份 203,827 字节，
SHA `fb1c7282791979568e4741a5b9e8c1370164daf779044c341e96e8c524c50169`；
数据 dump 前后均 298,950 字节，
SHA `8582af9631af14fd98edf52dd3f3ed8a3dd3c5e0cb727460a6fabaa5ecdf9548`。
原克隆拒绝补充平面字符，转换后 INSERT/ROLLBACK 无损读回；
完整类型、空值、默认值、注释、主键、表属性和已有数据保持，二次规划无变化。
只做克隆的 r1 与重新备份后 live 的 r2 均已精确删除自身克隆，
MySQL 容器生命周期不变，未执行 `ALTER DATABASE`。
r2 报告 SHA 为
`b2b622fc7bb52abd1192cb949506bc1aa4682d5772a163542aa34c90b1051d78`。
四个实际执行源码已在本次证据目录私有封存。

前端路由已改为精确 collection 和带斜线的子路径代理
`/extension/api/app_view_themes`，保留 Authorization、真实组织与 PLM 系统，
不注入人员头、不开放 core API。宿主源配置与现存 Nginx 均修复，仅测试 reload。
路由报告 SHA 为
`544bfc9f15cbab9e9b633275fafe56f60aaa30e713909484adee08ef98d44aaf`，
当前配置 SHA 为
`6d423181ab75117c29504e3bfdbcb66e3b2712cc94577edde5647ca7827add40`。

独立 r2 正常登录重新读取：前端/原生都返回 4 条且 body 严格相同，
个人目录 0、系统目录 4，匿名双端均 401；精确只读物理计数一致，文本列均为 mb4，
源码和运行输入前后不变。该报告 SHA 为
`e86ce1a085fdea6e2b98960cc81aa4ee7d4d03606828b68ffa0ec9914b8ac301`。
GUI 只读 r1 因旧 runner 假设产品列表直接进入主题视图而未触达目标，业务写入为 0；
修正为真实“新窗口打开”后，r2 实际弹出 `idea_all_grid_view` 并捕获
authenticated `POST /extension/app_view_themes/fetch_cur_user_all` 和主题 `GET`
均为 200，CRUD 写入为 0、无 console/page/network/HTTP/capture 错误、运行输入不变。
runner 在异步列表回填前检查数量而判 FAILED，报告 SHA
`4ffdde3681741dceda25b63fdcd6df9fb25ca382c521df9756fe72d5bf8d39fa`；
该时序门失败保留，不能改写为 GUI 通过，但路由/API 的真实请求证据通过。
这些是只读与存储证据，尚未宣称真实 GUI 创建/保存或多角色隔离通过。
现有系统配置标题包含中文，前端覆盖模型翻译的风险另待英文 GUI 实测，
不能通过改写持久化标题掩盖缺少本地化。

定向迁移测试当前 **30/30**，包含三个互斥精确表 profile；
路由 **13/13**，视图目录探针 **8/8**。它们不相加为 F06 完成数。

## 待决策/阻塞

这里只验证真实管理员身份的个人 key 和匿名拒绝，没有宣称普通/只读/非成员、
跨用户/组织、对象管理员、共享写授权或同 token 撤权矩阵通过。
后续中文桌面个人视图分组已取得正常 UI 创建、保存、刷新、新登录读回、
精确删除与独立刷新验空的当前 PASS；五类原始错误为零。
回执 SHA-256：
`04bac2f22cb4c02a778c2aa0f8a5d12e6b903d44efa8cc9775c4174982bcb268`。
此前空 DELETE 响应误解析导致的失败保留，独立只读检查证实该记录已清除。
详见 [视图分组验收](VIEW-THEMES-ACCEPTANCE-20261123.md)。
其他语言/视口、主题/菜单/筛选完整 GUI 和多角色权限仍需分别验证。
Conf/SaaS 中央共享写守卫仍为独立 Java 候选，未在本批部署。
F06、A04 与其他父项保持原状态。
