# B01 知识业务当前验收

执行日期：2026-11-26；前两次运行分别为 17:05:00 至 17:05:19 UTC、
18:13:51 至 18:14:11 UTC；实际发布后的 r3 为 21:03:52 至 21:04:31 UTC
（America/Los_Angeles 2026-11-26；Asia/Singapore 2026-11-27）。
本轮执行真实管理员中文桌面单格，未关闭 B01。

## 手册要求

依据 [测试与知识规则](manual/TEST-KNOWLEDGE.md) 的 K-F01、K-F02、K-F05 至 K-F07：
私有空间、草稿与发布正文分离、有效锁/解锁、真实分享地址及匿名密码、
过期/撤销/子集均须分别验收。普通、只读、非成员与匿名角色不可用管理员代替。
字段存在、HTTP 200 或旧回执不能代替当前运行结果。

## 本地实现观察

现有 `current-owned-knowledge-lifecycle.spec.ts` 使用正常 UI 登录及实际
appdata 身份初始化；通过 UI 新建私有空间、编辑草稿、发布和再次编辑。
锁、保护字段读回、共享设置与共享链接检查使用同一正常 UI 发出的应用会话，
不注入用户/组织/管理员身份。

测试/helper/config 本轮开始时均与 `plm-e2e` HEAD 一致；执行前已私有封存，
没有修改断言以接受失败。原生共享步骤返回的 URL 必须来自真实响应，
不能手工拼接或把所有者会话传给匿名浏览器。

## 当前版本验收证据

实际命令，私有凭据文件不进入 Git：

```sh
cd plm-e2e
PLM_CURRENT_KNOWLEDGE_CREDENTIALS=/home/my/workspace/ainfra/aibiz/.artifacts/current-business-actors-20261122-r1/credentials.private.json \
PLM_CURRENT_KNOWLEDGE_ARTIFACT_DIR=/home/my/workspace/ainfra/aibiz/.artifacts/b01-knowledge-closeout-20261126-r1 \
node node_modules/@playwright/test/cli.js test --config playwright.current-owned-knowledge.config.ts --project knowledge-zh-desktop --workers 1
```

账号在本轮独占窗口使用。两次正常 UI 登录、组织/appdata 匹配均通过，
声明角色为 administrator，新建空间的实际成员关系独立读回为 admin。
没有切换账号来绕过失败，也没有使用受控业务 fixture。

| 前两次运行阶段 | 真实结果 |
| --- | --- |
| UI 新建唯一 nonce 私有空间与自动主页 | 通过；原生读回 visibility=private，创建者空间成员为 admin |
| Unicode 草稿关闭保存与独立读回 | 通过；包含中文、emoji、组合字符、引号、反斜线和换行 |
| 新正常 UI 登录读回草稿 | 通过 |
| UI 发布与发布正文读回 | 通过 |
| 第二次 UI 编辑草稿 | 通过；`content` 为新草稿，`publish_content` 保留原发布正文 |
| 锁定后写正文 | 403；11 个页面保护字段逐一读回不变 |
| 有效解锁与锁字段读回 | 通过 |
| 共享设置 | 原生 200 |
| 获取原生共享链接 | 原生 200，但缺少 `shared_page_url`；失败并停止 |
| 匿名密码/撤销/过期/子集 | 未执行，未创建匿名 context |

本次 `shared_url` 单对象响应为 91 bytes，仅含 `id`、`space_id`，原始字节 SHA-256：
`63848abbfdd4bd311327b576da33571fb9a4e84f3fcb761f770e3bc9e03a480e`。
没有将这次 200 当作分享成功。

主回执位于
`.artifacts/b01-knowledge-closeout-20261126-r1/test-results/current-owned-knowledge-li-d1f9d-nd-public-sharing-lifecycle-knowledge-zh-desktop/knowledge-lifecycle-evidence.private.json`，
SHA-256 `e4f7182ddc3a3055781fee755b3bcc45bd365103ea72307afbb64564487b29ef`，
状态保持 `FAILED`。Console error、page error、失败网络请求、非预期 HTTP 错误、
抓取错误均为 0；锁定 PUT 403 单列为预期拒绝。

执行提交基线为 `plm@8a13b29cdc21832366c31d7c1103dae7ce4018da`、
`plm-web@fd33baa8866686363503a54c75d9f9175427a242`、
`plm-e2e@f4ad493073067c9348898c590613e6098464fd98`。
前两个仓库的脏状态哈希、16 个观察源码输入快照、实际浏览器服务字节、
全部容器 Mounts/configuration/lifecycle 与 provider 哈希均在私有回执中。
所有参与源码在本轮运行期间稳定；不宣称观察源码与加载模型全量等价。

### 运行包与共享结果归因

本次前后 provider 均为
`75b38f38badd32130d6306f49ea4534bee5ea3ffa329141a45d35c9d827a8f1e`，
容器 ID、镜像、挂载内容、配置、启动时间和重启次数不变。
后续只读提取该精确 archive 的类，与既有审查 seal 相同：

| 当前 archive 条目 | SHA-256 |
| --- | --- |
| `SharedUrl.class` | `80d17e44ab2f0f7b37ed53967dc3509bf9d8487a263f4e76894e4a649116ffde` |
| `ArticlePageDTO.class` | `9ff764594266a9bd87afb8e610e22319a6d0c919941c04039263cdf4e43ea326` |

归档核对回执 SHA-256：
`960db1c4968fd3facbc9ba2fd07cd3692d97e4cc0a765581ff2bcbf470602d8e`。
这是当前运行 provider archive 的字节绑定；没有 attach/inject 类加载器，
不冒称直接证明所有运行类的 classloader origin。
容器内无 unzip 的首次只读提取退出 127，随后只读复制到私有目录在宿主解包，
没有安装工具或修改容器。

原生单 DTO 服务链和真实 Jackson 的既有合同见
[共享 URL 返回合同](SHARED-URL-CONTRACT-20261123.md)。外层 VOID 不应改成
猜测的 DTO 返回来掩盖配置缺失；当前模型脚本只有在 `sys.param('plm_wiki','')`
非空时才设置链接。第一次只读 prepare 确认当时 Nacos 未提供该参数。
旧 prepare hash 为 `f32e88823bcad49d0438c5fedccf2bd7a0e80225b04b7f3aa48f47ce3c82fd6d`，
仅保留诊断用途，未直接 apply 旧计划。

主线随后按新计划临时应用 Nacos 参数并完成模型 reload，第二次真实 UI
仍得到 91 bytes 的 `shared_url` 响应，仅有 `id`、`space_id`。
第二次响应 SHA-256：
`c9c635a61d77f79cefcd9b1264768474f4c56ce53fbb6995c0ab0d766207a525`。
其余已执行阶段与第一次相同通过，匿名阶段仍未执行；所有错误计数仍为 0，
预期锁定 403 单列。第二次主回执位于对应
`.artifacts/b01-knowledge-closeout-20261126-r2/test-results/` 内，SHA-256：
`2662895f3dec0e870951b1811dce939006a369e94db344e83f6a999909dd62d6`，
状态保持 `FAILED`。源码输入、挂载配置、provider 字节和生命周期核对均通过；
Mounts 数组排序差异归一化后没有内容变化。

后续主线核对真正生效的 provider 环境：部署系统 ID 为
`ibizservicerunner`，`INITMODE=auto`、`LOCALMODE=true`、
`PUBLISH_CONFIG=false`。该模式优先读取本地 `application-auto.yml`
及对应部署系统配置，修改 Nacos `ibizplm` 不会替代这一本地输入。
临时 Nacos 与宿主源配置已由主线恢复，不能将第二次失败写成参数已生效。

辅助离线探针使用同一批 488 个真实缓存依赖，验证实际
`ServiceHubProperties`、`DeploySystem`、`SystemRuntimeSetting` 和
`SystemRTGroovyContext.param`：`sys.param('plm_wiki','')` 最终读取
`param.plm_wiki`；若显式同 ID 部署配置已有 `settings`，其 `copyTo(master)`
会整块替换 `master.settings`。因此需核对最终
`ibiz.deploysystems.ibizservicerunner.settings.param.plm_wiki`，或确认
`servicehub.systemsettings` 与部署 settings 的实际合并结果。
探针没有执行 ServiceHub loader，也没有修改共享配置；
主线负责本地源修复、生效验证及精确回滚。

独立原生诊断还确认 `CheckShared`、`AccessPassword` 的重复 raw 脚本
同样未继续模型后继节点：前者没有返回 result，后者正确密码仍停在初始化的
失败标记。经主线明确授权，两份当前源码已改为原生委派，并完成旧类负控、
当前编译源正控共 16 格；模型条件和认证/授权未改。
详见 [分享校验节点合同](WIKI-SHARING-DISPATCH-20261126.md)。
该证据没有执行 HTTP、数据库或匿名浏览器，本文件两次 UI 失败结果仍保留，
部署后须从真实共享入口重新验收。

### r3：实际发布后原流程复验

主线已按冻结计划应用
[r5 合并 provider](PLM-WIKI-COMBINED-PROVIDER-20261126.md)，
同一 provider 容器 healthy，一次 restart、零 recovery。
实际 apply 回执 SHA-256
`2d7a5d435d8c3e8a8c35ee440d412f72d2b1cb77f91ecb336ede6da1cdbd1771`。
确认 B03 两份 canonical 源修改完成并冻结、该 agent 未写 PLM 服务字节后，
在新的独占管理员窗口使用原 spec、helper、config 重跑中文桌面单格。
没有修改断言、重试或路由；命令与首轮相同，仅将
`PLM_CURRENT_KNOWLEDGE_ARTIFACT_DIR` 改为
`/home/my/workspace/ainfra/aibiz/.artifacts/b01-knowledge-closeout-20261126-r3`。

| r3 阶段 | 当前真实结果 |
| --- | --- |
| 私有空间、Unicode 草稿、独立登录读回、发布、第二草稿隔离 | 全部通过 |
| 锁定写拒绝、11 个保护字段无变化、有效解锁 | 通过；锁定 PUT 403 单列为预期拒绝 |
| `shared_setting` / `shared_url` | 原生 200；本次返回真实 `shared_page_url` |
| 原生共享地址 | 响应 273 bytes，键为 `id`、`space_id`、`shared_page_url`；原始 origin 校验为配置的本地地址，没有改写 |
| 新匿名 context 访问该原始地址 | 实际 GET `/plmwiki/` 返回 nginx 404 |
| 密码输入框 | 20 秒内不存在；保留失败，不改成跳过或忽略 404 |
| 错误/正确密码、撤销旧访客会话 | 因真实入口 404 未执行，不由隔离 16 格替代 |
| 过期、子集 | 本原 spec 未覆盖，仍需独立真实业务用例 |

本轮原生共享响应 SHA-256：
`577fd68c1c6d9fb06fdffa9bc9f61fc7b9bb38383d45b301685df92184d0e7ea`。
主回执位于
`.artifacts/b01-knowledge-closeout-20261126-r3/test-results/current-owned-knowledge-li-d1f9d-nd-public-sharing-lifecycle-knowledge-zh-desktop/knowledge-lifecycle-evidence.private.json`，
SHA-256 `c5822ab29a049fe233d2b4219a196401ed83b35661f85782c6dba4ae5a3ae601`，
状态 `FAILED`。匿名 404 导致 console error **1**、非预期 HTTP error **1**；
page error、failed request、capture error 均为 **0**，未隐藏实际错误。
页面快照实际内容为 nginx `404 Not Found`，因此不是密码控件 selector 修复问题。

运行前后 provider 均为
`aa14fc31c081ddc2960842fadebe4bd21f0d6649ec03f93b10164188381f3965`，
同一容器/镜像/配置/启动时间及 provider 元数据不变。
16 个观察源码输入稳定；plmweb Mounts 数组顺序变化归一化后内容比较通过。
本轮额外把后端提交
`d542741bb72213bbfc0696f6c1ba66bd3cc19414` 的四个文件与当前工作区
逐字节核对，前后相同；主工作区 HEAD 仍为既有提交，
不将它冒充该独立提交已 checkout。该提交中的客户分数源并未进入 r5 provider。
补充回执为 r3 目录的 `source-commit-before.private.json` /
`source-commit-after.private.json`，SHA-256 分别为
`c585bf06571d72811a1128bb1f5abd886a72fa219afa20ad90e349b62c5cfdf1` /
`f24b7cd01420cb8590b7f418e7f4f711da7e78aa82fa303e08c69a7cf37b34a6`。
没有改动原 16 格原生回执。

### 清理与副作用范围

r1/r2 native cleanup 均逐项验证归属后删除各轮两页（含自动主页）、空间、
一个空间成员及三条 RECENT；页面的 default/draft/deleted 数据集与空间精确
标识读回均为空，剩余成员及 RECENT 也为 0。所有正常浏览器 context 已关闭。

该 PASS 只覆盖上述业务资源。现有知识 spec 未独立检查本轮 CK 标记的站内信
或发送审计，不能称为全数据库/全部副作用不变。历史知识流程会生成消息；
后续应在独占正常账号窗口按本轮唯一 marker 和真实 owner 精确查询、自有消息
逐项 GET/DELETE/读回，发送审计作为审计保留，不使用 SQL 删除。
本轮没有为补检查而擅自重复登录。

r3 同样清理通过：两页、一个空间、一个成员、三条 RECENT 均已删除并读回为空；
清理中按原生接口关闭仍在共享的自有页面，不将该清理动作计为匿名撤销验收。
两次正常登录 context 及新匿名 context 全部关闭，管理员独占窗口已释放。
CK 消息/发送审计仍未独立检查，因此清理 PASS 的范围未扩大。

轻量合同检查：
`node --test config-tests/current-owned-knowledge-lifecycle.test.mjs` 为 **5/5**，
只说明身份/归属/运行见证/失败清理等待合同，不替代上述真实业务结果。

## 实现方案与剩余门槛

1. r5 的本地参数已由 r3 原生 URL 生成步骤证明生效，保留其配置、类和精确回滚
   输入绑定，不重复修改 Nacos 或在测试里硬编码 URL。
2. 用已提取的本地 Wiki 静态资源准备真实 `/plmwiki/` 入口，保持
   `ibizplm__plmwiki` 应用/API 命名空间。r3 实际入口为 404；
   早前只读观察没有显式 Wiki location，既有 Wiki 容器为 exited/255，
   不能以该历史容器状态代替当前入口验收。本验收代理未重启或新建容器。
3. 旧私有 Wiki environment 明确 `enableAnonymous=false` 且含旧匿名凭据，
   原样不得直接发布。需合法、最小范围访客配置与正常入口验证，不能复用空间
   所有者 token、伪造身份头或以开启开关冒充匿名业务通过。
4. 上述前置实际可用后，协调单一账号窗口重跑正常共享 UI，验证错误/正确密码、
   草稿隔离、撤销后的旧访客会话、过期、子集外页面与附件，并完成自有消息清理。
5. 再补普通/只读/非成员及中英文桌面/移动完整知识流程。其他产品、项目和测试
   领域的 B01 门槛仍独立保留，不能由这一管理员单格关闭父项。

只读入口核对回执 SHA-256
`b88aee69e2e17f73962a22c8287861e67458dc2dc5d0261b9039cec03f6c6022`。
本轮 UI 验收未再修改认证/授权机制、provider、模型、数据库或共享服务配置；
主线 r5 发布由独立 apply 回执记录。本验收代理未 pull、新建、重建或重启
Docker，未绕过任何真实失败。
