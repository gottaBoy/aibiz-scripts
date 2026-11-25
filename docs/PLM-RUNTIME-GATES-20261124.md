# PLM Runtime Gates

检查点：2026-11-24。本文先保留 r1 历史回执，再记录后续核验；
后续角色与 MQTT 修复不能由 r1 的结论推断。r1 未创建/重建容器、
未 pull 镜像、未创建角色、未写数据库。

## 当前版本验收证据

脱敏回执：

- `.artifacts/plm-runtime-gates-20261124-r1/report.private.json`
- SHA-256 `3338bb22bbe8bc377360ce8cef6e022f561f2df149e40863ac87618a60d8a5d8`

`plmservice` 当前同一容器 `e2b9db6202c28d519ff0080e67a1cdb4a635bb48793a4c33e5a9267cf0b64546`
健康运行，provider SHA-256 为
`2b4d9064212bca8465f2351e5c34dcbf8b6ce27986e2b4edfa67ad223952fc38`，
当前启动时间为 `2026-11-24T14:27:33.033237967Z`。

知识流程使用现有私有账号完成中文桌面回归：草稿、新会话读回、发布隔离、
锁定写拒绝、解锁和清理均通过。锁定 PUT 返回 403，正文、发布正文、版本和
锁字段保持不变；清理删除 2 个页面、1 个成员、3 条 RECENT，空间归零。
在 `shared_url` 动作处停止，响应没有 `shared_page_url`，因此未伪造匿名链接或
继续密码/撤销流程。

`plmwiki` 的既有容器只做了一次原地启动尝试，退出码 255；镜像为 `amd64`，
宿主为 `aarch64`，日志包含 `exec format error`。在不重建或 pull 的约束下，
不能把该镜像变成可运行的 `/plmwiki` 服务。

EMQX 当前 listener 端口 1883/TCP、8083/WebSocket 和 18083 管理端口可达。
真实匿名 TCP 流程完成连接、订阅、发布、断开和重连读回；WebSocket 完成连接、
订阅、发布和断开。环境明确 `EMQX_ALLOW_ANONYMOUS=true`，无可用 API key/secret，
错误用户名密码也被接受，所以认证、ACL 和拒绝矩阵未通过。

PLM appdata 返回了 `mqtttopic`，但当前前端环境 `enableMqtt=false`；
Nacos 的 MQTT 路由目标为 `lb:ws://ibizcloud-portal-mqtt`，该服务当前不存在。
不能只打开前端开关或把匿名 EMQX 直连当作应用 MQTT 完成。

## 后续核验

实际 GET 当前 Nacos `deploysystem-ibizplm`（group 为 `ibiz_config_group`）
返回 200，内容 SHA-256
`aa9a8476de4cc7ea7e7fb6fd827a6eb18bff1fb479fa5dd3ccf2a4d52265b3a0`。
`settings` 不含 `param`。框架 `SystemRTGroovyContext.param` 读取
`param.` 前缀，而 `SystemRuntimeSetting` 展平嵌套配置；
因此应补 `settings.param.plm_wiki`，不能继续猜测动作返回类型。

`scripts/configure-existing-plm-wiki.mjs` 已生成精确参数候选和私有原始配置备份，
仅允许本机现有入口 `http://127.0.0.1:30250`，保留所有其他配置值。
定向测试 2/2；最终准备回执
`.artifacts/plm-wiki-config-20261124-r2/prepared.private.json`，
SHA-256 `f32e88823bcad49d0438c5fedccf2bd7a0e80225b04b7f3aa48f47ce3c82fd6d`。
当前仍为 PREPARED-NOT-APPLIED，没有借此重载系统或变更数据库；
r1 准备回执因执行器输出字段修正而失效，不用于执行。

从既有停止的 `plmwiki` 容器直接提取了 8,787 个静态文件，共 318,317,488 bytes，
无需执行其 amd64 二进制，也没有 pull 或创建容器。私有清单
`.artifacts/plm-wiki-static-20261124-r1/inventory.private.json`，
SHA-256 `0adfea566be5ce89245307e44794584b7f3b20ab3e7bc2eb2ad38755f3730c5f`。
首次直接 `docker cp` 因源目录只读模式失败，后通过 tar 保留内容、
调整自有副本的目录写权限完成；没有覆盖服务目录。
该副本仍为 PRIVATE-COPY-NOT-SERVED。使用镜像原有匿名账号执行一次正常登录，
HTTP 500 且无 token，不能靠打开匿名开关或注入所有者身份完成分享。
原始 environment 含匿名凭据，仅保存在私有目录，不发布。

`shared_url` 的单独动作、聚合模型及前端源模型已恢复原有 VOID 契约，
没有回退其他发布/权限修复，也未重启 provider。针对真实原生依赖的返回契约、
逻辑 END 返回和精确 MQTT 路由测试合计 8/8。该结果只说明源码契约恢复；
不代表 Wiki 匿名业务流程通过。

精确 WebSocket 路由
`/api/ibizplm__plmweb/portal/mqtt/mqtt` 已在当前 `plmweb` 增加并通过
`nginx -t` 和 reload。只代理到既有 EMQX 内部 8085 listener，不注入身份头，
未改通用 portal 路由、未启用前端 MQTT、未重启或重建容器。
宿主启动源和容器实际 Nginx 配置字节一致，SHA-256
`8b7d2d26192b6ab0752deb22aebb3a05f1648d24eb3a5de5be20978244736c1a`。
私有回执 `.artifacts/plm-mqtt-route-repair-20261124-r1/report.private.json`，
SHA-256 `3f7c7c018a3e3107154daac8ea91e6fb33ec6c3b1b6e85d400ade2e431f9416e`。
路由及原有恢复执行器定向测试 15/15；仅语法/代理输入检查通过，
真实 WebSocket、认证和消息投递由独立 MQTT 回执覆盖。

## 待验收

- Wiki 可以复用已提取静态输入，但仍须修复真实匿名认证、精确 API 入口、
  参数生效路径，再验密码、过期、撤销、子集和草稿隔离。
- r1 匿名传输不升级为完整应用验收；MQTT 的最终认证、隔离、代理及业务推送
  已由下面新的独立回执覆盖，原生 IDE 日志和完整恢复仍未验。

## 最终运行补充

此前记录是分阶段历史；当前 PLM provider SHA 为
`75b38f38badd32130d6306f49ea4534bee5ea3ffa329141a45d35c9d827a8f1e`。
实际缺失记录 GET 已返回 404，锁拒写继续保留 403 语义。
All-in-One 当前 JAR 为
`1b25c2779dbe919165f275cdbd6a93b5273afdf5a4c609bab08a304fad4d6390`。
均复用既有容器和镜像，在精确源/JAR/归档审计与恢复输入下原地重启；
不将“无镜像重建”解释为“原镜像已经包含新代码”。

MQTT 前端 enableMqtt 为 true，宿主构建源/启动 dist 与实际 HTTP 环境已绑定；
独立内部 listener 使用正常 PLM token 认证，旧匿名 listener 对实际 PLM
namespace 的绕行已拒绝。最终五用户/20 组换绑及 TCP/WS 负控复验通过。
产品四格分别收齐六个真实事件，通知双语四格完成已读、新登录和自有清理。
这项结果来自 `current-owned-product-realtime-20261124-r4`，
不来自旧匿名测试或 REST 合成消息。

最终范围及留存失败见
[REAL-ROLE-AND-MQTT-REPAIR-20261124.md](REAL-ROLE-AND-MQTT-REPAIR-20261124.md)；
MQTT 来源见 [MQTT-AUTHENTICATED-RUNTIME-20261124.md](MQTT-AUTHENTICATED-RUNTIME-20261124.md)。
