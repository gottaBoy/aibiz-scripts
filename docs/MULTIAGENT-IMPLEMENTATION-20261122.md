# 多 Agent 实现与现有 Docker 核对

检查点：2026-11-22，Asia/Singapore。

本批次落实 25 项清单中的 M01、A01、M02 前置实现。用户追加的执行约束是：
复用现有 Docker，不重新创建，不拉取镜像，保留此前通过的回执。
本轮没有创建、替换、启动、停止或重启容器，没有构建或 pull 镜像，
没有修改共享数据库、模型挂载、前端服务字节或容器配置。

顶层状态仍以 [总表](ALL-TASKS-20261111.md) 为准：25 项未完整验收，
没有因本轮源码修复、受控测试或只读观察关闭父项。

## 手册要求

正常用户操作、真实身份、持久化读回、拒绝后无副作用及双语/多角色要求继续适用，
详见 [工作区规则](manual/WORKSPACE-AGENTS.md)。
Development/API Reference、Data Model/IDE 和 MQTT 仍需各自独立验收。
历史回执保留其原版本、命令、结果和范围，不重写为本轮通过或失败。

## 本地实现观察

| 范围 | 已实现 | 仍未证明 |
| --- | --- | --- |
| A01 启动前置 | backend launcher 在读取输入或操作容器前验证所有生成服务主机名不超过 63 字符；配置生成器同时校验合法 DNS 标签；不截断、不改名，不变更 JWT 或授权 | 12 条 parentless absent HTTP 和 36 条 typed 边界 |
| M02 配置路线与权限 | planner 使用精确非嵌套配置读取路线；绑定配置注册、默认 manager 选择和 READ-only record 策略；元数据声明的 CREATE/DELETE 明确标记默认拒绝，删除误导性的普通配置清理建议 | 当前容器实际加载的 manager/插件、合法配置维护路径和真实五实体流程 |
| M02 配置来源 | 审计同时检查 `init.sql` 与 `sCloud9471c1eca.sql`，输出哈希和 INSERT/LOCK 语句提及数；明确不是行数，未确认所有权/许可/维护路径的历史来源不自动取得 owned 资格 | 可依法使用且关联完整的配置行；没有复制历史数据、执行导入或改权限绕过 |
| M01 HTTP 入口 | 移除 runner 按组织查人后额外设置 `srfuserid` / `srfpersonid` / `srfdcid` 的传输适配器；默认使用正常 token 与系统/组织上下文；异常时保留失败回执 | 移除额外适配后的当前版本 HTTP 结果；不能用受控传输测试代替真实登录 |
| M01 浏览器入口 | 增加绑定现存 launch/deployment 的只读正常 UI 验证入口，检查登录、appdata、真实成员响应、列表选择、刷新及完整模型物理快照；只观察原生客户端身份行为 | 尚未进行本轮真实浏览器回放；不宣称管理员创建、跨中心切换或完整 M01 验收 |

集成复核另补 HTTP runner 的物理状态门槛：每次快照都与初始状态比较，
覆盖登录/appdata 阶段产生的变化；匿名拒绝也有前后快照。
新成功回执应有 15 次快照，历史 13 次回执不改写。

A01 的两次历史 parentless 失败与现存 Docker 是不同场景：
历史成功 owned Nacos 名长 58 字符，失败名称长 69 字符。
本地 Java IDN 校验对后者报 `The label in the input is too long`。
现存五个后端容器名仅 5-18 字符，不需要为这个源码修复重建现有容器。

M01 历史六账号读取结果及 13 次相同物理快照继续保留，但原命令额外提供了
人员/中心请求头，因此其范围是该传输方式下的读取。它没有证明“只用 token、
无额外适配器”的 HTTP 路径，也没有证明正常浏览器导航。正常 UI 从真实
appdata 自然设置人员头属于产品原生行为，本轮浏览器入口不会注入、改写或阻止它。

## 当前版本验收证据

### 现存 Docker

以下是本轮只读观察，不是候选部署或功能验收：

| 现存容器 | 实际镜像 ID 前缀 | 观察状态 |
| --- | --- | --- |
| modelingservice | `0a0d4391f55f` | healthy |
| ibiz-ebsx-allinone | `0823e8b5dd2b` | healthy |
| ibiz-ebsx-gateway | `256d7e7ade13` | running；未配置 Docker healthcheck |
| nacos | `45bba63526de` | running；未配置 Docker healthcheck |
| ibizlab-uaa-api | `8f65be60bd12` | restarting；日志文件写入 Permission denied |

五者使用 11 月 13 日锁定基线，并连接同一现有网络。11 月 21 日三张后端候选
镜像也已在本地，但没有运行在这三个后端容器中。现存 provider 的挂载 JAR
与候选 JAR 不同；不能仅因镜像本地存在就将当前容器记为候选同版本验收。

UAA 最近有界日志显示：Logback 写入 `logs/uaa-api.2026-11-22.0.log`
时得到 `Permission denied`，随后 `FileNotFoundException` /
`IllegalStateException` 导致启动失败。当前容器以 `65532:65532` 运行，
日志 tmpfs 未显式设置 uid/gid。这里只确认实际错误及配置，没有将推测的目录
所有权当作实测，也没有改动或重启 UAA。历史登录通过不等于本次启动状态通过。

### 输入与静态资源

- 现存服务的只读运行输入捕获成功：33 个挂载/Compose 输入、6 个仓库身份，
  完成两遍字节核对。私有结果：
  `.artifacts/runtime-inputs-ma-existing-20261122-r1/report.json`。
  这不包含未挂载源码完整闭合、运行中类身份或完整源到产物证明。
- 同一现存 PLM 的声明插件审计：73 插件、356 文件，343 文件三方一致。
  剩余 7 插件/13 文件仍是 public 与 HTTP 一致、与旧 dist 不同，
  与前轮记录一致。审计按差异返回非零，未覆盖共享 dist 来消除差异。
  私有结果：`.artifacts/plm-plugin-ma-existing-20261122-r1/report.private.json`。

### 聚焦回归

最终单次联合 Node 回归 **281/281**，16 个套件、零失败/取消/跳过/todo。
没有运行全量 `npm test`、Java 构建或真实浏览器/原生 HTTP 流程；
本轮也未修改后端 Java 或模型。先前的 213、36 和 agent 聚焦结果与本次重叠，
不相加为测试覆盖数或功能完成数。

两仓 `git diff --check` 通过。源码仍在工作树，未提交或 push；
两个 HEAD、14 个实现/测试文件哈希及完整命令绑定在私有回执，
脱敏摘要见 [本轮记录](../records/aibiz-multiagent-implementation-20261122.json)。

从工作区根执行：

```sh
node --test --test-concurrency=2 \
  scripts/tests/launch-run-owned-native-backend.test.mjs \
  scripts/tests/run-owned-backend-configuration.test.mjs \
  scripts/tests/owned-a01-parentless-routes.test.mjs \
  scripts/tests/run-owned-a01-root-http.test.mjs \
  scripts/tests/owned-a01-root-http.test.mjs \
  scripts/tests/a01-transport-coverage.test.mjs \
  scripts/tests/owned-central-member-http.test.mjs \
  scripts/tests/owned-modeling-config-policy.test.mjs \
  scripts/tests/audit-owned-modeling-config-sources.test.mjs \
  scripts/tests/plan-owned-modeling-config-seed.test.mjs \
  scripts/tests/plm-manual-reference.test.mjs \
  scripts/tests/autonomous-backlog.test.mjs \
  scripts/tests/seed-owned-editor-registry-native.test.mjs \
  scripts/tests/owned-editor-registry-http.test.mjs \
  scripts/tests/audit-owned-modeling-config-blocked.test.mjs \
  modelingweb/app/tests/owned-central-member.test.mjs
```

## 待决策/阻塞

1. 本轮正常登录回放受现存 UAA 日志权限故障阻塞；没有为此新建替代栈、
   pull 镜像或把其他历史部署伪装为当前环境。
2. M01 新入口要求实际运行的 launch、deployment 与完整成员模型绑定。
   现存共享基线缺少该 owned 绑定时不能强行套用；历史成功仍按原范围保留。
3. M02 默认配置 API 的 READ-only 策略没有改变。合法来源与维护/导入路径
   未建立前，不执行配置写入，不导入历史共享 SQL。
4. A02/A03 的撤权/嵌套协议、R05 插件计数范围与 JWT 时序、业务多角色全流程、
   双语、离线、整栈恢复及共享发布继续按 [25 项清单](REMAINING-25-20261111.md)
   排程，本轮没有将它们改为完成。
