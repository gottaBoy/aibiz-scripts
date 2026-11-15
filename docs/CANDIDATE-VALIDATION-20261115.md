# 固定候选验证与口径纠正

日期：2026-11-15，Asia/Singapore。本轮仅使用自有夹具 `b5dc5669e6d1`，
未重启/替换共享服务，未迁移共享数据库。“源码通过”“启动通过”“完整功能验收”
不能互相替代。25 个顶层项是既有验收队列，不是本轮新增 25 个运行故障；
已通过的基线不因增加诊断而重新置为失败。

## 已通过的范围

| 检查 | 本轮证据 | 不外推到 |
| --- | --- | --- |
| 后端打包 | `2638748b`，402 项测试；三镜像归档字节绑定 | 完整业务功能、共享发布 |
| 前端构建 | 七包；2,891 入口 / 3,652 源文件，零类型诊断 | 所有页面、角色及语言布局 |
| 隔离启动 | SQL、32 项账号、workflow/EBSX/platform、16 项 UAA 认证、八节点后端通过 | 所有能力已验收 |
| A01 字符串根 | 36 个实际非法根请求全为 403；16 controls / 84 auth checks 通过 | 48 个无忠实原生 String-path 传输的 typed/null 计划行 |
| 数据库采集 | 四库双读一致：964 表 / 33,911 列 / 946 索引 | 已迁移或 API 已无损往返 |
| 浏览器启动 | 同一 A 根编辑者，中英 × 桌面/手机四组合登录/启动通过；errors、failedRequests、blocked 均为 0 | 保存/新会话读回、导航目标、全部角色或布局验收 |
| 最后数据比较 | 两模型库 848 表 / 30,660 列及全部行与浏览器前快照一致 | metadata/UAA/cache 或索引等全部状态无副作用 |

前端已审提交并 push：Hub `c9c7895a`、Modeling `cd5458f0`。
源码/工具提交不代表已替换 `30250` 共享运行版。截图仍有默认控制台抽屉及手机裁切等
现象，不能把无 console error 当作布局或完整编辑器工作流验收。

## 工具与隔离接线

这些失败不作为已通过功能回归的证据；原始失败回执没有覆写成通过。

| 回执 | 实际结果 | 分类 |
| --- | --- | --- |
| backend r1 | Central 与三视图 overlay 的组合未被旧比较器识别，未创建后端容器 | 补精确组合/负例后，backend r2 启动通过 |
| runtime assets r2 | 完整视图比较仍期待原模板 UUID | 补组合转换，保留整体 deepEqual；assets r3 准备通过 |
| Unicode metadata r1 | 当前夹具的两个 `nfx` 授权探针库未绑定存在证明 | 只补精确回执绑定；r2 双读通过 |
| context HTTP r1/r2 | provider 实为 JAR+两脚本，UAA 含 witness 挂载，工具清单不完整 | 未发送目标请求；补真实回执测试及守护 |
| context HTTP r3 | 完整快照/守护耗时使三段身份链耗尽短 token 余量 | 改正常逐操作续期，未延长 token、未减少快照 |
| context HTTP r4 | 两匿名请求 401、七认证请求 200；own-root query 200 但无投影 | 走了通用 UAA 层级，专用上下文仍未验收 |

当前 `/appdata` 被 `run-owned-backend-configuration.mjs` 转到 allinone。
`CloudUAAUtilRuntimeBase.onGetAppData` 直接构造通用身份数据，不调用 Modeling
`SystemAccessManagerBase.prepareModelContext`。本轮未给通用响应补假字段、
放宽权限或把 HTTP 200 当成功能成功。

已存在的系统入口为 `GatewayRestController` 的 `/{systemid}/appdata`，
经 `ServiceHubBase.invokeGetAppData`、`ServiceSystemRuntime` 调用系统访问管理器。
query 到 AppContext 的解析已有源码实现。下一步只应修隔离的精确
`GET /ibizmodeling/appdata?psdevslnsys=<ownedRoot>` 路由及请求合同，再验证；
该路径尚无本轮真实通过证据。通用 `/appdata` 继续用于基础身份检查。

## 未关闭的范围

- Unicode plan r2 为 `BLOCKED`：31 张物理宽表的 mb4 声明行大小超限，涉及
  14 类逻辑表。这是迁移前风险，不是 31 个新页面故障。未执行 ALTER、
  缩短索引、截断数据或修改源字段类型。
- 窄系统详情/设置读取、R05 门户/看板/统计、完整角色矩阵、MQTT、企业集成等
  保持原检查点，不由启动通过关单，也不在本轮临时扩项。
- 全量状态仍见[总矩阵](ALL-TASKS-20261111.md)和
  [账本](../records/aibiz-execution-backlog-20261115.json)。

## 私有证据

HTTP/token/配置/SQL/快照和截图均只留 `.artifacts/`：

- `model-context-source-package-20261115-r1/report.json`
- `model-context-source-images-20261115-r1/report.json`
- `native-nonadmin-fixtures/b5dc5669e6d1/authorization-a01-context-a01-r1/report.json`
- 同 run 下 `model-context-http-context-projection-r1` 至 `r4`
- 同 run 下 `unicode-metadata-context-unicode-r1/r2`、`unicode-plan-context-r1/r2`
- `owned-modeling-bootstrap-browser/context-20261115-r1/report.private.json`
- `model-context-campaign-20261115-r1/physical-final/report.private.json`

临时前端与 bridge、八个 tmpfs 夹具节点、三份本轮未引用镜像已精确退役；
未删除持久卷或 bind 源目录。最终为 12 共享服务、18 tags / 18 IDs、零 owned/历史容器。
共享容器的 ID、配置、启动时间、restart count 与网络身份前后完全匹配，
33 项观测 host inputs 也匹配；不外推为所有宿主字节持续冻结。
镜像锁通过，仅为 observed-image-lock，不是已验收发布版。

最终 inventory：`model-context-campaign-20261115-r1/runtime-final/report.json`，
SHA-256 `3bd84249d70436453abbbf63aefc3e8bc06c7effd1f030973dbdf244bc49de49`。
