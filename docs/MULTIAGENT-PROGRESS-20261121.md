# 多 Agent 执行清单

检查点：2026-11-21，Asia/Singapore。

仍为 **30 个顶层项中的 5 项已有验证记录、25 项未完整验收**。
本轮完成下列四个具体子任务，不将其误计为四个顶层关单。
原始矩阵见 [ALL-TASKS-20261111.md](ALL-TASKS-20261111.md)。

## 本轮已完成

| 分工 | 实际实现与验证 | 未覆盖边界 |
| --- | --- | --- |
| 登录布局 agent | 修复标题贴边与裁切风险：固定 24px、内侧留白和自然换行；新构建候选在 320/360/390/430/768/1280/1440/1920px 两种语言共 16/16 通过；正文行框、登录控件、横向溢出均检查，截图已抽查 | 登录后界面与共享服务部署 |
| R05 agent + 主任务编译 | 从四个权威模型生成仅私有的覆盖层，统一六处返回声明及两套五字段 BIGINT DTO；生成/漂移/越界测试 10/10；新原生解析测试 5/5，连同 reader/API 19/19；默认 portable 模型分支另跑 5/5 | 完整模型/运行包绑定、自动 runtime 选择、真实 HTTP、数据库计数及真实角色授权 |
| 插件来源 agent + 主任务全量核验 | 新只读审计工具比较模型引用的 73 个插件、356 个声明文件的 public/dist/HTTP 完整 SHA-256；共享基线检出 7 个插件/13 个文件差异；同一新候选 356/356 一致 | 传递资源、插件业务行为、源码闭包和共享发布 |
| 主任务语言回归 | 补普通取消按钮、取消后存储/HTML/可见标签不变、刷新保持、确认切换与切回；真实新候选 zh-CN/en × 桌面/手机 4/4 | 认证后双语业务流程、任意延迟任务的穷尽证明 |

共享差异的 13 个文件均为 **HTTP 与 public 一致、与旧 dist 不同**，不是
HTTP 404。本轮没有为了变绿而覆盖共享 dist、重启服务或忽略差异。
受影响插件为 attention、baseline-compare、grid-change-version-column、
html-vditor、lucky-sheet-editor、repeater-grid-case-steps 和 cron-editor。

前端实际候选包含保留的其他工作树输入，4,565 个 src 文件绑定于构建回执，
输出共 38,185 个文件；不是干净索引重建或完整依赖闭包。复用的组件 runtime
仍来自先前已验证的本地构建，未宣称本轮重新构建全部框架。

两个浏览器回归均未提交登录，实际 API 请求为零，console/pageerror/HTTP/
requestfailed/外网尝试集合为空；没有业务写入。临时浏览器与候选服务器均关闭。
两个编译助手顺序执行，均限 2 CPU/3GB、断网、依赖只读，均已删除；没有启动
业务验证栈、修改共享数据库或替换共享服务。

## 全部 25 项待办

| ID | 状态 | 下一步及关闭条件 |
| --- | --- | --- |
| F06 | PARTIAL | 自有全局配置的组织/对象管理员、普通/只读/非成员正负向读写，以及撤权后旧会话回归 |
| M01 | ACTIVE | 同版本自有中心真实非空成员列表、进入路线、跨中心隔离及管理员创建/普通成员拒绝 |
| M02 | ACTIVE | 经原生合法操作准备 PSPF/PSPFStyle/PSAppType，完成五实体及配置路线读写、关联与清理 |
| M03 | ACTIVE | 从正常 UI 完成各原生编辑器保存、刷新、跨会话读回、恢复及无权拒绝 |
| M04 | OPEN | 非空 viewer 成功、no-access/cross-root 拒绝及完整角色/root/语言/视口矩阵 |
| A01 | PARTIAL | 解决 48 条 typed/null 在原生 String URL 的忠实传输缺口；保持已通过的 36 条拒绝及无副作用证据 |
| A02 | BLOCKED | 完成权威修订/请求重新授权协议、所有写入口接线和失败时拒绝，再验证同 token、多节点撤权 |
| A03 | BLOCKED | 完成嵌套会话及 REQUIRES_NEW 回调/事务协议，验证真实请求事务生命周期 |
| A04 | PARTIAL | 实际服务 token 交换、下游使用、拒绝、过期与撤销链路 |
| B01 | PARTIAL | 手册 MV01-MV14 自有数据多角色生命周期、版本、关联、报表、通知、恢复与清理 |
| B02 | PARTIAL | 73 插件逐项验证桌面/手机状态、读写/只读、错误/空态、刷新和持久化；不能以 356 个静态文件一致代替 |
| B03 | PARTIAL | Development/API Reference 真实检索、内容浏览、受控 API 执行及无权拒绝 |
| B04 | PARTIAL | 在真实 PLM 宿主完成 Data Model/IDE CRUD；R05 下一步是完整 owned runtime/model 绑定与真实关系 HTTP；MQTT 独立验收 |
| L01 | PARTIAL | 分类历史可见文案候选，重跑完整语言命令门槛，保留失败/跳过而不折算为完成 |
| L02 | PARTIAL | 从已通过登录布局/切换扩展到认证后业务写入、插件、错误、通知、导出及内嵌视图 |
| L03 | PARTIAL | 权威补齐两处方法 DTO 声明及一个嵌套字段来源；验证运行 mapper/序列化与实际应用嵌入 |
| D01 | PARTIAL | 逐一闭合 12 组件的递归源码、依赖、构建和产物；不能用预编译 JAR 冒充 |
| D02 | PARTIAL | 从本轮候选 356/356 声明文件一致继续覆盖传递资源、来源和共享实际服务字节 |
| D03 | PARTIAL | 将未挂载脏源码、依赖及构建来源纳入清单，证明运行挂载与输出/HTTP 对应 |
| K01 | PARTIAL | 23 类市场目录的精确源码版本、许可及生成依赖可复现审计 |
| K02 | PARTIAL | 阻断外网的自有环境从指定本地包安装目录/资源并核对完整性 |
| K03 | OPEN | 同版本断网更新、故障注入、恢复/回滚及数据保持 |
| O01 | OPEN | 固定工具链、离线依赖、备份和配置，在全新自有环境离线重建 |
| O02 | PARTIAL | 当前整栈备份恢复、精确迁移、失败恢复，以及数据/权限/模型回归 |
| O03 | OPEN | 经审核候选/备份/回滚输入后受控发布，核验真实服务字节、业务、权限和回滚 |

## 后续执行顺序

1. 用一套可清理的 owned 环境绑定当前 R05 元数据与后端产物，验证自动选择、
   原生关系路由、两组不同非零计数、空根以及六项逐一拒绝。当前原生解析测试的
   查询/授权仍使用可控依赖，不作为该步骤的替代。
2. 在同一版本环境推进 M01/M02 前置，然后完成 M03/M04 与 F06/A04；
   每条流程要求新会话读回、拒绝后无副作用和精确清理。
3. 以真实业务流程展开 B01-B04/L01-L03；并行补 D01-D03 与 K01 来源链，
   再运行 K02/K03/O01 离线验证。钉钉/企业微信须真实受控企业应用、用户绑定和
   接收账号；MQTT 须真实认证、代理、订阅 ACL、发布与断线恢复，不能模拟关单。
4. A02/A03 协议需独立安全/事务审查；O02/O03 需完整恢复计划与受控共享变更。
   在此之前不自动推广候选，不删数据卷，不运行全局 prune。

## 可重复命令

```sh
node scripts/prepare-r05-owned-model.mjs \
  --output .artifacts/r05-owned-model/NEW
node scripts/prepare-r05-owned-model.mjs \
  --output .artifacts/r05-owned-model/NEW --verify
node scripts/audit-plm-plugin-served-bytes.mjs \
  --output .artifacts/NEW-AUDIT \
  --base-url http://127.0.0.1:30250/ibizplm-plmweb/
node plm-web/tools/check-plm-login-layout.mjs \
  --candidate .artifacts/plm-multiagent-combined-20261121-r1 \
  --upstream http://127.0.0.1:30250 --output .artifacts/NEW-LAYOUT
node scripts/check-plm-source-startup.mjs \
  --candidate .artifacts/plm-multiagent-combined-20261121-r1 \
  --upstream http://127.0.0.1:30250 --output .artifacts/NEW-LANGUAGE \
  --language-switch
```

输出必须是新私有路径。共享审计如发现字节差异，退出非零是正确结果，不表示
应该直接重建/替换共享环境。

聚焦联合 Node 回归：scripts **128/128**，PLM Web **19/19**；
与 Java/浏览器证据分别记账，不相加为功能数。未运行全量 `npm test`。
原始日志、模型、XML 和截图均留在根 `.artifacts/`；
文件路径和 SHA 见 `records/aibiz-multiagent-progress-20261121.json`。
