# 25 项后续实施

检查点：2026-11-26，Asia/Singapore；本轮于 2026-11-25 开始，沿用原文件名。
本轮接续已 push 的六仓库提交，
复用三个原 agent 会话，文件边界分别为 A01 宿主启动、M01 原生导航及
M02 配置/开发身份，主线负责登录运行时与构建输入。没有新建或重建 Docker、
pull 镜像、执行共享 SQL 写入或部署开发候选。正常认证、原生查询及明确记录的
自有 API 操作可能产生审计或业务副作用，不宣称整个数据库不变。

## 手册要求

业务与建模能力分别验收，正常账号、组织选择、实际开发身份和授权缺一不可。
HTTP 200、空目录、管理员称谓或源码测试不等于业务完成。拒绝后仍需精确检查
自有数据和副作用，不能以停止业务写入为由放弃只读核对或自有数据清理。

## 本地实现观察

- V7 登录原先对不含 token 的 HTTP 200 返回成功。现在要求非空字符串 token，
  失败时保留正常错误通知，且不写匿名标记或残留旧登录 cookie。
- 匿名登录原先先加密密码，再调用会再次加密的普通登录。现在统一由普通登录
  执行一次加密。测试使用实际 RSA 工具生成密钥并单次解密校验。
- 私有 runtime/component 构建补齐两张登录图片的精确别名来源，逐项绑定
  public PNG、Nginx 启动源和实际 HTTP 字节，不允许其他绝对路径或外域。
- 历史语言部署测试改为读取并验证原回执的封存源码；实际部署入口仍须同时
  验证当前工作区源码。当前源码改变后不能重新执行旧发布计划。
- M02 的历史空配置审计原先可把任意三个零值当作完整证据。现在核对合同、
  run、实体全集、HTTP 状态、结果状态和响应哈希，并识别互相矛盾的旧读回。
  原生配置计划也补齐权威模型中的必填字段，且保留已有配置。

## 当前版本验收证据

共享登录源码定向测试 **16/16**，runtime TypeScript 检查通过。
构建输入、封存部署和精确图片路由定向检查 **19/19**。
以上不等同共享运行版已发布或 Wiki 匿名访问通过。

私有候选：
`.artifacts/plm-auth-runtime-candidate-20261125-r3/language-runtime-candidate.private.json`，
SHA-256 `69b3b278237270ceaffe305d7217ceec23b193b09583d2aa81f4ddb8bd5d62f1`。
它包含 18 个输出、57 个静态模块、2 个经过实际 HTTP 校验的图片别名，
未解析资源为 0；仍保留 1 个非字面动态导入，不宣称完整递归闭合。
2693 个 runtime/component 输入文件有独立快照，两个原 package dist 和共享
PLM dist 前后保持不变。该候选加入 M01 的组织开关适配，状态为
`PREPARED-NOT-PUBLISHED`。之后只修改了组件测试的真实 `qs` 解析别名；
不能宣称整个当前工作区仍与全部构建输入逐字相等。

M01 已修复 Central 组织开关被旧 core 忽略及 appdata 错投 standalone UAA
两个问题，移除未配置时自动猜测 `demo` 中心的逻辑。2026-11-26 私有候选中，
普通账号正常 UI 的登录、原生组织选择、All-in-One appdata 身份绑定、
APPINDEX 和菜单导航已实际通过；业务 `fetchcurdcslnuser` 返回 200 空数组，
因此整体仍为失败，不能记为非空中心导航或成员验收通过。
中文桌面报告 `.artifacts/m01-native-navigation-20261125-r4/report.private.json`，
SHA-256 `26fa5a0ea2796849aaa39c84de4abf397d286ffb9121673a30e45fbe50e8c2cb`。
共享 Nginx 未 reload，dist 未发布；`modelingweb/start.sh` 是现有容器的 bind
输入，本轮源码修改会影响未来启动，原字节已封存，不能宣称所有挂载输入未变。

M02 当前共享 ModelDesign 的真实 FetchDefault 返回：
PSPF **3**、PSPFStyle **10**、PSAppType **6**，均为原生 HTTP 200。
早期正常身份的裸开发用户/开发根目录为空，实际原生自有开发解决方案 Create
返回 403。该自有 nonce 的两次绑定物理只读 COUNT 均为 0；不外推全部审计无变化。
目录为空还需结合修复后的原生中心上下文诊断，不能单凭裸查询宣称不存在开发者，
也不能继续泛称配置全空。
详情及原始失败见 [M02 跟进](M02-CONFIG-FOLLOWUP-20261125.md)。

Wiki 原静态配置中的匿名账号正常登录仍返回 500，消息表示凭据拒绝，
没有获得 token。此部署的 `enableAnonymous=false`。上述客户端修复没有
将该失败改写成成功，也未发布携带原匿名凭据的静态入口。

A04 原生 standalone UAA 链现已实际通过：正常管理身份创建并独立读回非人 client，
只允许 client_credentials、无权限角色、无 refresh token；正确 Basic 得到
59 秒 token，错误 Basic 返回 401，check_token 核对实际 client-only 主体。
原生删除后 Get 404、精确目录为空，旧 token 和再次授权均返回 401。
全流程仅 696 毫秒，远早于 token 自然过期，不能将此结果误读为过期测试。
原始报告未改：
`.artifacts/native-api-client-20261125-r1/report.private.json`，
SHA-256 `7f40660ede5a975cb3a6319066a00f0d5a02457cd448f53dff2456dbc4196ba1`。
自有 client 已清理，管理员和人类账号的角色未改变。Cloud 下游没有借此冒领通过。

2026-11-26 00:58:09 至 00:59:11 +08，最终冻结版本完成一次独立的自然过期、
续发和撤销验证：首发及续发均核对实际 client-only 主体、空角色和无 refresh token；
自然过期 check 返回 400，同 client 重新授权及检查均 200；
原生删除 200、Get 404、精确目录 0，续发 token 随后检查 401、再次授权 401。
撤销检查完成于续发请求开始后约 233 毫秒，早于保守过期边界。
自有 client 已清理，运行输入及容器状态不变。

最终报告 `.artifacts/native-api-client-final-validation-20261126-r1/report.private.json`，
SHA-256 `0490939251963f61f624283960d718a7acf1480b5e695c5010f30ad58bb0b323`。
执行脚本 SHA-256
`d64e33ac8a6166076f168f290b7305433bd686dfde062d278747fa9d22dd847c`，
测试脚本 SHA-256
`9e1db1351bfb37b6709ed15c510cdad29ff17b38c2ae14e484cddc2b8deb184f`。
14 份私有源码快照逐一核对当前/前后哈希及 0600 权限，独立 executed-provisioner
也一致；定向测试 6/6。此回执覆盖 standalone 单实例，不关闭 Cloud 下游、
服务权限、密钥轮换或负载均衡/多节点门槛。

## 待决策/阻塞

M01 继续补齐语言/视口以及原生中心上下文；A01 已在自有宿主依赖上实际完成
六个原 actor 的 UAA 登录和 self 身份校验，各请求均为 200，全部自有进程已清理。
该认证报告 SHA-256 为
`ac316a147158c16bd7a8512098e978e9f2eeeab18e0a42e4539eb7450b54d3be`。
A01 自有宿主阶段已完成 Workflow/EBSX bootstrap/verify、八服务启动、两个 alias
读回和六 actor UAA 登录/self；gateway `/v7/login` 随后返回 403，All-in-One
日志显示其下游 UAA `/auths/login` 返回 400。当前 runner 已补充实际 fixture
center 的 `dc` 登录字段，但尚未用新源快照重跑，故不把 403 记为 A01 通过。
根请求尚未发送，36 个 typed 边界也不由字符串路径测试代替。

M01 严格就绪补格的三次真实登录遇到共享 UAA Redis 连接失败，日志出现
`RedisConnectionFailureException`、连接拒绝/无路由；浏览器和私有 server 已关闭，
没有重启或修改共享 Redis。Modeling admin 只读控制的中心 `FetchDefault` 返回
500，挂载 ModelAPI 只发布 GET/PUT，未发布该 FetchDefault 方法；没有猜测中心
或拼接 `demo`，中心上下文和 member 200 空仍保持阻塞。
API client 必须使用原生管理接口和独立非人 client，不能给普通账号接口权限。
市场、离线及整栈恢复事项仍按此前约定待定。

顶层状态暂保持 PARTIAL 16、ACTIVE 3、OPEN 4、BLOCKED 2。
后续只在真实运行、持久化读回、拒绝副作用及清理证据齐备后更新对应项。
