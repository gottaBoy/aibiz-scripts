# 当前主题与通知语言回归

2026-11-24。范围为 F06、L02、B01 的限定增量，不关闭父项。
所有账号、令牌、原始业务数据和浏览器回执保留在私有 `.artifacts/`。

## 手册要求

显示本地化不改持久化 ID、状态、角色或用户内容。SYSTEM 分组显示与原生存储值分开，
PERSONAL 配置只修改自有标记；通知须绑定真实接收者、完整业务来源、已读请求、
新登录读回、原文和精确清理。MQTT 认证/订阅成功不等于业务通知实际送达。

## 本地实现观察

通知显示层六事件翻译及 SYSTEM caption runtime 合并修复已通过源码/DOM测试，
构建来源与继承资源边界见 `PLM-LANGUAGE-RUNTIME-CANDIDATE-20261124.md`。
新增部署器 `deploy-existing-plm-language-runtime.mjs` 只接受两份封定候选：
十八文件 runtime/components 覆盖，以及后续两个文件的应用 caption 入口覆盖。

部署前后核对精确容器 ID/image、StartedAt、restart count、Config/HostConfig、
完整 mount、startup 源/实际脚本、环境变换、Nginx 实际配置，以及排除仅本 epoch
目标/暂存的完整 host/live dist、plugins、model 清单。保留新增树，不递归删除。
新资源先发布，新 map 随后发布，首页最后切换；每步意图/日志及备份独占写入并 fsync。
应用失败尝试仅按精确 epoch inode/dev/hash/uid/gid/mode 恢复，两个原首页恢复前
不清理依赖。未知漂移保留。共同本地锁只协调合作工具，可信独占窗口不是原子 CAS。
不修改 Nginx、环境、模型、JAR，不创建/重启容器。

## 当前版本验收证据

### 十八文件发布

- candidate `.artifacts/plm-language-runtime-20261124-r4/`，
  manifest SHA `271fc7444d0a20b573faa53059c4e60869a2d29a5be1ec8702ed53978e3f0d58`。
- plan `.artifacts/plm-language-prepare-20261124-r1/prepared.private.json`，
  epoch `79dba6cc-3afc-4455-a2e6-beb16a762b02`，
  SHA `f7734de7c22ef1acd2cdec11400349d73b935f391dbd7e3ccd5ba538aa4ef6e8`。
- apply `.artifacts/plm-language-apply-20261124-r1/report.private.json`，
  SHA `6b77a3a3f7c93197a3b7ce309e615f8a53070a931359b41c188d1542f27ceddf`，
  **APPLIED-STATIC-BUSINESS-ACCEPTANCE-PENDING**。

两处共 36 个精确发布及 18 个 HTTP 字节校验通过，其他资源完整清单保持一致。
实际 import map 指向 revision `85bb771e88717181`。静态窗口完成后主动交回主线，
主线随后另行变更 Nginx/MQTT 环境；不将它们混入本发布器的通过范围。

### 三个系统分组缺词与两个文件发布

新 runtime 上的真实只读主题批次：
`.artifacts/current-owned-app-view-themes-20261124-r4/`，
中文桌面通过；英文桌面真实失败。
旧测试还按持久化“全部需求”找行，实际已显示 `All Ideas`，因此该失败包含验收器
过约束。原 screenshot 同时明确显示三项仍为中文：
我负责的需求、我创建的需求、已归档的需求。没有业务 HTTP 500，也没有主题写入。

补充三个精确显示词：
`Ideas Assigned to Me`、`Ideas Created by Me`、`Archived Ideas`。
F06 runner 现独立核对 API 的中文 SYSTEM caption 未改，UI 显示词来自明确词典，
并使用实际 mobile tap 及正常菜单折叠；不将三项持久化中文改成英文。

全新 Vite 应用构建仅提取 fresh legacy main entry 与首页，不覆盖框架/模型/环境：

- candidate `.artifacts/plm-caption-entry-candidate-20261124-r2/`，
  manifest SHA `ed9f89bbbdbbaffa9d09b8918f3c140aea6048f7ec48c7f06991ae5becd071e9`。
- new main `static/js/index-legacy-27013305.js`，1,753,762 bytes，
  SHA `875cf75c80729a8283abb9db98081d4ec30e87daab56a778b7cfe6ede4637f2e`。
- new index SHA `ed62777f1bb743fdd9e1c2ac1592c3f48947e7c865e70229356541851b22b8de`。
- plan `.artifacts/plm-language-prepare-20261124-r2/prepared.private.json`，
  epoch `337e02d1-72f9-4bac-9466-b04ad963a26f`，
  SHA `12fc628473a704501766bee32f5754f599c6d75c04118948a283b9ecb9f864ba`。
- apply `.artifacts/plm-language-apply-20261124-r2/report.private.json`，
  SHA `bf53dd687e1b30c094bdeacfaabeda420edf9683bb377ef6624d91e1214330ef`，
  **APPLIED-STATIC-BUSINESS-ACCEPTANCE-PENDING**。

新 main 的 3,148 个字面引用均存在，host/live hash 与候选继承输入一致；
四个非字面边界保持明示。原 language import map 和十八包输出没有再次修改。
MQTT 环境是独立加载资源，PUBLIC env 不在本次 `src` 编译快照；部署 guard
绑定已切换为 true 的当前环境，没有把构建目录中旧 PUBLIC 环境复制回共享服务。

部署器及负控 **11/11**，通知/主题 Playwright 源码独立 TypeScript 检查通过，
产品与主题合同 **19/19**。十八文件阶段的 **10/10** 以及原所有失败回执保留。

### 新产品与实时失败

`.artifacts/current-owned-product-language-20261124-r1/` 的四格新管理员产品流程
均通过正常 UI 创建/编辑、Unicode 刷新、新登录读回、归档/激活、删除/恢复及精确
产品/成员清理。此批发生于 MQTT true 前，产生的 24 条自有通知保留待显示/清理验收；
不能把它们作为实时送达证据。

MQTT true 后另起 `.artifacts/current-owned-product-realtime-20261124-r1/`，
首个中文桌面在完整业务及产品/成员精确清理后失败，后三格按 `max-failures=1`
未执行。真实浏览器记录三个 MQTT WebSocket 连接、12 帧，均收到
CONNACK 0 / SUBACK `[0,0]`，没有收到任何 PUBLISH。等待 15 秒没有自有 marker
的 `INTERNALMESSAGE`，因此实时阶段保持 **FAILED**。
console/pageerror/requestfailed/HTTP/capture 均为零，不覆盖实时失败。

没有注入控制器、构造假 publish 或过滤错误来取得通过。首格产生的自有通知保留，
失败 source receipt 不冒充成功 lifecycle receipt，需在明确合同下单独处理清理。
MQTT 服务、认证适配器、授权和发送链由主线及 MQTT 线定位，本线没有修改。

## 待决策/阻塞

- 上述失败和候选历史保留；最终补充见下，不能把旧 FAILED 改写成 PASS。
- 新角色曾出现的 Bearer-only 产品 403 已由正常组织选择协议澄清，
  不放宽权限或伪造身份头；readonly/nonmember Create 的真实越权由主线另修。
- 初期通知显示/24 条消息清理以及 MQTT publish 失败的后续结果见最终复验；
  完整语言名册、原生移动包和其他业务域仍保持独立未验范围。
- 原生移动包只有源码/DOM测试，PLM 手机视口使用 web 包；不外推独立移动包已部署。

## 最终真实角色复验

主线补充系统分组只读角色及配置写范围后，管理员、普通成员、只读成员分别在
中文/英文桌面/手机执行正常个人分组创建、保存、刷新、新登录读回、删除和独立
刷新缺失：`current-owned-app-view-themes-{admin,ordinary,readonly}-20261124-r2`
合计 **12/12**。所有 SYSTEM 原始中文 caption 和未授权记录保持原值。
首个手机 tap 原本会在当前页进入产品，旧验收器仍等 popup；修为真实页内导航。
英文手机另有实际按钮遮挡，已通过源 CSS 与精确首页覆盖修复。没有强制点击。

当前最后一批 `current-owned-product-realtime-20261124-r4` 四格通过完整产品
流程及六事件 PUBLISH，消息显示另由
`current-owned-product-notification-language-20261124-r5` 四格验证六事件翻译、
叶节点已读、第二次正常登录 READ、原文哈希和精确删除，原无关消息不变。

早期 language 批 24 条通知和实时失败首格六条通知已单独清理；
失败来源使用独立严格校验器，不通过改状态或 typecast 冒充成功来源。
该校验器要求全部业务/清理阶段成功、原始错误数组为空、唯一失败为缺实时消息，
并保留原来源的 FAILED 与 SHA。初期实时失败仍不是业务推送通过证据。

完整来源、最终 JAR 和权限边界见
[REAL-ROLE-AND-MQTT-REPAIR-20261124.md](REAL-ROLE-AND-MQTT-REPAIR-20261124.md)。
