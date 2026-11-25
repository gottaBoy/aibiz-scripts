# 既有服务认证只读验证

2026-11-22。A04 保持 PARTIAL。本轮实际验证了现存服务的 PASSWORD 令牌交换与 OIDC 身份读回，没有将该证据改称 `client_credentials` OAuth 验收。

## 手册要求

平台、组织、对象与普通成员身份必须分别验证；不能因账号可登录或具有某个业务管理员名称就授予平台权限。真实外部或平台集成需要实际认证、授权与失败证据。凭据、令牌及原始业务响应保持私有。

## 本地实现观察

- `CloudClient.json` 的 `authMode` 为 `PASSWORD`，认证脚本向 token URL 发送 JSON `{loginname: api.clientid, password: api.clientsecret}`，读取响应 `token`。
- `SysCloudClientUtilRuntimeBase` 从 `cloudclientutil` 设置读取客户端、密钥和 token URL；PLM 的 `application-auto.yml` 将这些设置绑定到 `cloud.clientid / cloud.clientsecret / cloud.accesstokenurl`。
- 实际 `plmservice`、`modelingservice` 均配置了 `CLOUD_CLIENTID / CLOUD_CLIENTSECRET / CLOUD_ACCESSTOKENURL`；端点为 `http://ibiz-ebsx-allinone:30000/v7/login`，客户端不带原生 `oauth__` 前缀。
- 原生 `/uaa/oauth/token` 是另一条协议：`UAARestController.doOAuthToken` 校验 `client_id / client_secret`，要求认证结果 `apiuser == 1`，并在 `grant_type=client_credentials` 时使用该客户端身份。`RTAuthAgent` 对 `oauth__` 前缀又会转交 UAA `/oauth/token`。
- `AIBIZ_OAUTH_CLIENT_ID / AIBIZ_OAUTH_CLIENT_SECRET` 为既有 A04 baseline 的可选输入，本次进程中均未配置。没有借用 PASSWORD 凭据、源码默认值或业务账号补充这些 OAuth 输入。

## 当前版本验收证据

```sh
node scripts/probe-existing-service-oauth.mjs \
  --execute-existing-service-authentication \
  --output .artifacts/existing-service-oauth-20261122-r3
```

最终证据时间为 `2026-11-22T15:18:08.928Z` 至 `15:18:09.470Z`。仅从现存容器内存读取服务配置，按实际 Docker 端口映射访问本机；不向未审查主机发送凭据，不跟随重定向。

| 服务配置来源 | 原生 PASSWORD POST | Bearer GET `/uaa/oauth/userinfo` | 身份校验 | 两条原生系统 GET |
| --- | --- | --- | --- | --- |
| `plmservice` | 200，真实 `token` | 200，非空 `sub` | 严格等于该服务配置的客户端身份 | 均 500 |
| `modelingservice` | 200，真实 `token` | 200，非空 `sub` | 严格等于该服务配置的客户端身份 | 均 500 |

下游只发送 Bearer 与 Accept，未添加 `srfsystemid / srfuserid / srforgid` 等代理身份上下文。令牌和凭据未写入回执；仅保留响应长度、哈希、状态、身份匹配布尔值和固定错误类别。

两条精确系统读取路径为 `/ebsx/oldapi/systems/ibizplm` 和 `/ebsx/oldcoreapi/syspssystems/ibizplm`。四次响应均为 `DataEntityRuntimeException`、`code=3`，消息 SHA-256 为 `e1119afcbedb007c6e22c80c52f4db3c239c8f28a56ac9a4998dc4212499b877`，严格等于源码错误 `无法获取指定数据[ibizplm]` 的哈希。`Errors.INVALIDDATA=3`，且 `DataEntityRuntime.java:1919` 的原生 Get 在找不到数据时使用该错误。结合独立父表计数 0 的证据，服务身份已到达实体读取，而系统记录确实缺失；不能把 500 当成资源读取或创建权限验收成功。

同次读取现有 `uaa-api` Nacos 实例：1 个健康且启用实例，地址为与 allinone 共同 Docker 网络上 UAA 容器的精确 DNS 别名，端口 32666。`ephemeral=true`，仅证明当前快照一致；未修改别名，也未证明持久别名策略或跟踪本轮运行时 `lb://` 实际解析。

五个现存容器的 ID、镜像、启动时间、重启计数、完整配置、完整挂载与网络输入前后相同，六个源码输入哈希不变。认证端点可能产生其正常会话与认证日志副作用；未直接写数据库、注册系统、变更权限、更新业务数据或运行配置。

历史回执保留：

- r1 在凭据发送前被挂载检查拒绝，交换次数为 0。Docker 两条挂载返回顺序反转即可严格重现该哈希差异。修复只按 Destination 排序，仍绑定完整挂载内容。
- r2 的两条 PASSWORD 链通过，但初版别名匹配仅接受数值 IP，未接受实际容器 DNS 名。r3 限定为共同观察网络上的精确 UAA 地址或别名；未接受任意 DNS、其他网络别名、重复实例或错误端口。

```sh
node --test scripts/tests/probe-existing-service-oauth.test.mjs
git -C scripts diff --check
```

9/9 通过。测试覆盖真实源码协议、两类编码保持、空 200/拒绝不误报、凭据与令牌不落盘、未知错误脱敏、精确别名范围、配置或挂载内容变化时发送前拒绝，以及单纯挂载排序变化。

## 11 月 23 日跟进

`AIBIZ_OAUTH_*` 是测试输入约定，其缺失本身不是平台权限政策。后续已按当前两个
真实 configured client 精确只读核对权威人员与角色来源：各只有一个启用身份，
均有超级管理员角色，均没有 `ROLE_APIUSERS`。因此实际缺口是原生
`apiuser == 1` 前置不满足。没有给现存服务提权，没有发送冒充 API 用户的
`client_credentials` 请求，也没有修改服务正在使用的 PASSWORD 配置。

分类回执 `.artifacts/existing-service-client-credentials-20261123-r1/report.private.json`，
SHA-256 `4f8afca6956098296115eac6ab703c8f260e1e535de9c5d1f230de6b9a39db2a`。
新工具源码现已包含精确、只读的 role 分类及缺少 API 角色时的发送前拒绝；
当前聚焦测试 **11/11**。原 r3 执行源码保存在同目录的
`executed-probe-source.mjs`，SHA 仍为
`29edb658869314aefc5e6bbd2f6283cef6cb5c9f00f80248981d5674ba36fd4d`；
原 r3 及其 9 项测试不被后续源码或 11 项结果替换。
辅助还原旧测试源码的断言失败被保留，没有伪造旧测试快照。

同一现存 PLM 服务 PASSWORD 身份随后调用原生
`POST /ebsx/oldcoreapi/syspssystems/checkkey`，真实 body 为
`{"pssystemid":"ibizplm","pssystemname":"iBizPLM"}`，HTTP 200、整数 0。
源 action/method 均采用 CREATE 访问动作；这是只读创建权限预检，
不是实际创建或全局权限闭合。父行前后仍为 0。
回执 `.artifacts/plm-native-system-checkkey-20261123-r1/report.private.json`，
SHA-256 `404e2bb2439e676aa0b28ef3f0f193542b7e46491b65033019c4847c9cd6bd8c`。

已准备绑定当前只读 PLM 模型挂载的真实系统登记候选，最小字段来自原生模型，
Create 扩展 hooks 为空，官方初始系统也是 id/name 登记。
候选不加载或发布模型；条件撤销需确认本次创建、完整行未变且没有新增依赖或业务采用。
候选 SHA-256 为
`6fc061637625e84bf35a8f75e1205fa3c5c9ac5bf15fd6a9c0a4f1f800672823`。
到此检查点没有执行 Create。

随后真实登记已执行，见
[个人配置持久化修复](PERSONAL-CONFIG-REPAIR-20261123.md)：同一配置服务身份
通过原生 POST Create `ibizplm / iBizPLM`，独立 GET 与精确物理计数 1 通过。
登记回执 SHA-256 为
`2d3c85fe66fca9c2848d99719105f3015fc583532ea5316bf1fa81ec35816043`。
该真实系统已被个人配置采用并保留；没有加载/发布模型或改变账号角色。
上述父行 0、CheckKey 和“未执行 Create”保留为各自历史检查点，不再作为当前阻塞。

## 待决策/阻塞

1. 两个现存服务均缺少原生 API 用户角色，OAuth 交换、下游使用、过期与撤销均未执行。需通过合法平台管理流程建立最小自有 API 客户端及清理方案，不能直接改现存服务角色来换取通过。
2. 真实系统登记与读回已通过，但不等于 API client 授权闭合；userinfo 本身不证明 `apiuser / superuser`。
3. 系统登记与 IBZCFG Unicode 后续修复见独立 F06 记录；GUI、多角色、组织与共享写范围仍开放。
4. 尚未验证服务令牌过期、撤销、错误重试、运行时别名追踪或长时间启动稳定性。本轮未重启服务，也未撤销共享服务会话。
