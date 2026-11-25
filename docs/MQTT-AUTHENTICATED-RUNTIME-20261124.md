# MQTT Authenticated Runtime

检查点：2026-11-24，America/Los_Angeles。复用现存 EMQX 和 PLM Nginx，
初始 broker/认证阶段未创建/重建容器、未 pull、未重启共享容器。
后续主线为修复原生业务发送链，在有精确 JAR 备份/恢复输入的前提下原地重启
同一个 All-in-One；镜像 ID 和容器 ID 保持，业务角色没有增加 APIUSERS 权限。

## 手册要求

MQTT 日志是独立能力：必须验证认证、WebSocket/代理、订阅权限、发布、
断线恢复及真实业务消息。匿名 broker 连通、显示日志组件或打开前端开关
不能代替这些门槛。PLM token、管理凭据和原始客户端信息保持私有。

## 本地实现观察

现存 EMQX 5.8.0 全局认证链为空；原四个 listener 和默认 file ACL 是历史匿名
运行输入。当前唯一持久在线客户端来自现存 All-in-One，连接始于 2026-11-22。
本轮不通过全局启用认证改变其行为。

`repair-existing-mqtt.mjs` 新增仅 Docker 网络可达的 `ws:aibiz_plm:8085`，
以 listener 独立认证链隔离本轮工作。此隐藏配置从当前安装的
`emqx_authn_schema.beam` 抽象源码核实，不猜测 API。管理操作用已配置 dashboard
凭据换取短时 Bearer，凭据及 token 只在内存。

第一阶段为两个自有 JWT 身份及专属 topic，验证 broker 本身的认证与 ACL。
随后 listener 已切换到原生 HTTP 认证 adapter；JWT 规则已退休，不能将
第一阶段 JWT 回执冒充当前 PLM token 链。

`mqtt-native-auth-adapter.mjs` 由 user systemd 监管，监听 Docker bridge 的 18085，
只允许当前 EMQX IP 调用认证。它先用原 Bearer 请求 All-in-One 原生
`/uaa/oauth/userinfo`，再用相同 token、固定 `srfsystemid=ibizplm` 与该已被原生
验证 token 中的组织请求 `/appdata`。不注入用户、员工或管理员头。
返回的主题、登录身份、组织和系统必须全部一致。允许订阅本人主题、相同系统的
`all` 和原生提供的精确扩展主题；禁止发布及其余主题，失效时间绑定 token。
原生查询异常、错误 token、主题换绑均拒绝。

当前实际 appdata 导出的 PLM system namespace 也在原 file ACL 前置保护：
仅已绑定的 All-in-One Docker peer IP 可向该 namespace 发布，其余 legacy
客户端对此 namespace 的发布和订阅均拒绝。原生 HTTP 认证返回的本人/系统 all
订阅 ACL 仍有效；其他 namespace 的原规则保留。该 IP 授权限于当前受信 Docker
网络和运行身份，不外推为跨主机或非受信网络的发布者身份协议。

运行源码封存在
`.artifacts/mqtt-native-adapter-runtime-20261124-r1/mqtt-native-auth-adapter.mjs`，
SHA-256 `9c8e10bbb803604237e9f09b754377cc08d8fd130a022363c286adb227f5b03e`。
服务为 `aibiz-mqtt-native-auth.service`，`Restart=on-failure`、停止预算 8 秒。
这是独立于当前对话的任务级监管，不是宿主重启后自动部署的验收。

## 当前版本验收证据

| 范围 | 当前证据 |
| --- | --- |
| 独立 broker 认证/ACL/直连与代理 | `.artifacts/mqtt-verify-20261124-r1/report.private.json`，SHA `dc11336fa6652a99df148d3226c72343647bdee7f3fde2c21173c4600ae52443` |
| 原生 HTTP 认证链切换 | `.artifacts/mqtt-native-apply-20261124-r2/report.private.json`，SHA `88de79ea19b2caff94ea4df94a5e1f96e4a48e83d0c7af71ba2c0de4f1cab55b` |
| 原生三账号、六组跨用户、代理与重连 | `.artifacts/mqtt-native-verify-20261124-r6/report.private.json`，SHA `df12d0d0adfa26e050140b6868a3afac571d5dea78ed8ab85a9dedd9dc56978c` |
| 退休自有 JWT ACL、恢复原 ACL 路径并精确移除新文件 | `.artifacts/mqtt-native-retire-20261124-r1/report.private.json`，SHA `865300ee8386d6b40e3403821beaba33dca0677a572af4ac90704f2265ff736f` |
| 封存源码与 user systemd 运行 | `.artifacts/mqtt-native-adapter-runtime-20261124-r1/report.private.json`，SHA `9864e886ce42fa5bc6cdb9528109a916070f4253bd82f07a8663d53c8f20ce55` |
| 真实 PLM namespace 窄保护 | `.artifacts/mqtt-namespace-apply-20261124-r1/report.private.json`，SHA `ff2b9f5801ea32f719a016243e05af47eaec6a94c54a4f60be4cda9868f83c8e` |
| 原 TCP/WS 匿名绕行拒绝与非 PLM 主题正控 | `.artifacts/mqtt-legacy-verify-20261124-r1/report.private.json`，SHA `a9df515e15594df9a66a22e33efa85bca41e7a62210893a4ebe6e8f84f70afb6` |

三账号来自同轮原生身份准备的普通、只读和非成员账号。每个账号均实际正常浏览器
登录，从真实 bootstrap 请求捕获 token、组织和 `mqtttopic`，未向页面注入身份。
三人均验证错误/缺失 token 拒绝、本人及系统 all 订阅、越权订阅 SUBACK 128、
发布拒绝、真实消息读回和自动重连；六组跨用户 token/topic 换绑及订阅均拒绝。
验证发布使用 EMQX 原生 REST 对精确自有主题投递，未将该测试消息写成业务通知。
所有测试客户端已关闭，publish 均 `retain=false`，未留持久 MQTT 会话。

原四个 listener 的 authn flags 保留。EMQX 对 `:1883/:8083` 返回形式规范化为
`0.0.0.0:1883/:8083`，原始变化保留；只有已证实等价的 IPv4 wildcard 表示
被规范化，其他字段仍逐项比较。原 All-in-One client 的连接时间、状态、来源与
username/client ID 私有见证均保持。

前序失败独立保留：首次准备绑定 mount 数组顺序差异，零写入拒绝；JWT config
缺 `use_jwks=false` 时 schema 拒绝；native listener 的部分 merge 遗漏 bind 时
误用 8083，只有自有 listener 停止，原始持久配置未改变。已在原始私有状态见证下
恢复本轮 listener，再用完整字段切换成功；未覆盖历史失败。封存服务前一次停止
因 HTTP keepalive 达 systemd 停止预算，原 journal 保留；最终服务使用明确 8 秒预算。

## 验证命令

```sh
node --test scripts/tests/repair-existing-mqtt.test.mjs \
  scripts/tests/mqtt-native-auth-adapter.test.mjs \
  scripts/tests/protect-existing-mqtt-plm-namespace.test.mjs
```

聚焦测试 14/14。真实原生三账号验证入口为 `verify-native-mqtt.mjs`，
凭据使用显式私有文件；新输出目录必须不存在。

## 待决策/阻塞

- 原匿名 listener 对当前 PLM namespace 的绕行已拒绝；其他 namespace 仍保留
  原匿名政策，不外推为整个 broker 已完成权限验收。
- 主线已启用前端环境，并修复内部 Portal 的远程 API-only 403：
  当前同进程存在 Portal runtime 时直接委派，分布式缺少本地 runtime 时保留远程
  客户端；对外 Portal API-only 判断不变。没有给人加 API 权限。
- `current-owned-product-realtime-20261124-r4` 当前四格均收齐六个真实产品事件，
  每格记录六类事件、11 个匹配 PUBLISH 和接收帧哈希；测试没有用 REST 发布
  替代业务。`current-owned-product-notification-language-20261124-r5` 四格另验
  翻译、已读、新登录和精确清理。Modeling IDE 日志仍为独立未验能力。
- 任务级 adapter 不等于宿主重启后的完整部署；全角色消息发布、撤权传播、
  集群及故障恢复仍按各父项门槛保留。

## 最终版本复验

All-in-One 最终 JAR 为
`1b25c2779dbe919165f275cdbd6a93b5273afdf5a4c609bab08a304fad4d6390`。
其原地重启后的当前 publisher 重新建立连接；不能把初期“旧客户端 lifetime 不变”
外推到跨重启。以下每次独立验证均绑定自己开始时的当前 publisher 并确认期间不变：

- 五真实用户、20 跨用户换绑/订阅拒绝、代理与重连：
  `mqtt-native-verify-20261124-r9/report.private.json`，
  SHA `6e56c23adadeeeb0e45a2a22fff46278739fab841b09cafe643d645ee7391d48`。
- TCP/WS 旧匿名入口的 PLM 发布/订阅绕行拒绝、其他自有 namespace 正控：
  `mqtt-legacy-verify-20261124-r3/report.private.json`，
  SHA `540f593d9e0df7ed04cb0db342dc326a4e5dbb5a086cfd041e0800c961ff5e69`。

全部测试客户端已关闭；认证 adapter 保持独立 user systemd 监管。
原始失败、REST 传输正控和最终真实业务四格分别保留，不混成一份成功历史。
