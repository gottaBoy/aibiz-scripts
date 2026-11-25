# 知识页面发布修复与受控部署

检查点：2026-11-23，Asia/Singapore（America/Los_Angeles 为 2026-11-22）。
当前状态：首轮部署因 Docker 输出兼容问题触发恢复，原 JAR 已独立读回；
修正后的新计划已成功部署，真实 UI 发布状态与正文读回通过。
第二次编辑与完整知识清理/分享流程仍待继续，整条回执仍为失败。
不关闭 B01、O03 或任何顶层能力组。

## 手册要求

依据 [测试与知识](manual/TEST-KNOWLEDGE.md)：草稿保存与发布分离，发布后
新会话必须读回已发布内容和状态；匿名分享不得泄露第二份未发布草稿。
锁定页面的正文和发布拒绝必须检查持久化无副作用，解锁走原生授权动作。
管理员正向流程不能替代普通/只读/非成员与跨组织矩阵。

## 本地实现观察

正常 UI 保存 Unicode 私有空间/页面草稿、新登录读回及自有关系清理已经执行；
真实发布 POST 返回 200 并复制 `publish_content`，但 `is_published/published`
仍为 0，新 GET 也为 0，不能把这个响应记为发布成功。

`PublishPage.groovy` 的 `RAWSFCODE_01` 自定义分支只执行序号脚本，
没有交给中央逻辑分派器继续权威模型的后继节点，因而跳过设置状态与 Save。
源码已改为 `super.onExecutePSDELogicNode(session, node, true)`，
由同一中央运行时执行脚本和后继；移除重复脚本外壳。
真实 Groovy 和中央 DELogicRuntime 分派回归同时核对序号、后继只执行一次，
保留旧实现的反例；本次聚焦发布 **8/8**、知识边界 **13/13**。

实际 `/app/plm-provider.jar` 位于现存镜像的可写容器层，不是宿主 bind 文件，
运行时缓存类；只改源码不会更新已加载类。候选使用现存 provider 内的依赖，
按实际 classpath.idx 顺序编译，保留 Java major 52。
两次独立构建字节相同；只有内层 `PublishPage.class` 内容变化，
外层仅 `BOOT-INF/lib/plm-core-v1.0.2.jar` 变化，其余 payload 哈希逐项保持。
原始 JAR SHA 为
`9e98932a7de4fa64bef470c107342a4f5a227ce9ed5016787765027c6a8105bb`，
候选 SHA 为
`23dc35241e8ca2a583d9ecddbf2cf3ccb91dca883471857f44dae7e591de1377`，
候选报告 SHA 为
`57b4be760a3f0ec4e90d14fa851bee318ad337206b65fe5df74fa2fbabe65b24`。
实际 Boot JarFile 读取和独立 JVM 类加载通过；未把这两项当作业务启动验收。

## 当前版本验收证据

`deploy-existing-plm-publication-provider.mjs` 分离 prepare、apply 和显式 rollback。
准备封存完整原包、候选、源码/测试/审计等 11 项输入，
逐字节核对宿主与容器 13,723 个模型文件（304,704,631 字节）及 readiness。
执行前后拒绝容器、镜像、配置、挂载、模型、原 JAR inode/哈希及未知 stage 漂移。
使用固定描述符写入自有 stage，核对目标与 stage 后原子 rename，
再同步文件及 `/app` 目录；仅对同一容器请求一次重启。
启动失败有条件恢复原包；成功发布后的业务失败可按原 plan 和实际 apply 回执
执行显式回滚。未知修改保留现场，不覆盖其他写入。

首轮实际 apply：
`.artifacts/plm-publication-deploy-apply-20261123-r1/report.private.json`，
SHA `526a844fcd14c4a9a9ad8ec25e4ffeeb297ed4b14b10043881e7f7496640c415`。
Docker 的 `restart --time 20` 已执行，但 stdout 混入弃用提示，
执行器要求输出严格等于容器 ID，因此认定响应不明并恢复原包。
恢复重启同样遇到提示，原报告保留 `FAILED-CONDITIONAL-RECOVERY` 和
`RECOVERY-FAILED-RETAINED-FOR-REVIEW`，没有事后改写成通过。

主线随后独立观察：同一容器/镜像为 running healthy，
StartedAt `2026-11-23T02:05:44.671920076Z`、RestartCount 0；
原包 SHA 与备份完全相同，恢复 inode 为 `2752551`。
实际请求过两次同 ID 重启，不能因为 Docker 的 RestartCount 不增加就写成零次。
该独立状态不回填为首轮执行器成功，也不证明候选业务通过。
后续改用本机明确支持的 `--timeout` 参数；仍严格核对 ID，不过滤未知输出。

独立完整恢复核验另存于
`.artifacts/plm-publication-recovery-verification-20261123-r2/`，
报告 SHA
`6aabd4c1b18569ee79a775c5df888ff548d339b5249cb86ea4724dadfe7fa3c7`。
核对原 JAR inode/哈希/属主/权限、完整模型、readiness、容器配置及前后生命周期。
其只读 r1 因调用 wrapper 少设模型清单的 8 MiB 输出预算失败，原报告也保留；
r2 采用实际 adapter 预算重跑，没有运行时写入。

修正后的执行器与 **33/33** 故障测试已重新封存。
新 r3 计划 SHA
`56e87ffe565de0ed11f45b40609396ca7eda8bca5afa5137888199022e288581`，
epoch `a2135a0e-4721-4391-910d-768dc65baa1d`。
原包恢复后的 inode、生命周期重新绑定，候选、11 项输入和完整模型与旧计划一致。
实际 apply r2 成功：
`.artifacts/plm-publication-deploy-apply-20261123-r2/report.private.json`，
SHA `3f66a8ec7629e028dcd70ea224e9ffc6c4bb701f69adca9d821bac9bcec5ea2d`。
一次同 ID 重启，无恢复重启及不明响应；同容器/镜像 running healthy，
StartedAt `2026-11-23T02:33:42.254488242Z`、RestartCount 0，
实际 JAR 为上述候选哈希。首尝试两次加本次一次，共请求三次同容器重启。

随后新共享中文桌面真实业务：
`.artifacts/current-owned-knowledge-shared-20261123-r1/`，
回执 SHA
`e9404e14d2ee470c75352192426ea7f72da8f0a59de390b928fd52945d14c918`。
UI 新建私有空间/页面、Unicode 草稿、新登录读回及正常 UI 发布均通过；
新 GET 的 `is_published=1` 且 `publish_content` 保留完整内容。
第二次编辑的 modal 关闭定位超时；清理严格拒绝把自动主页当作本次具名页面，
因此停止删除，不能把整条流程记为通过。原始 console/page/network/HTTP/capture
错误均为 0，实际 provider 字节、完整挂载、运行身份和源码输入前后不变。
新 runner 根据权威 `auto_create_home_page` 约束主页 ID=space ID、
TYPE=1、HTML 和真实创建者，再按旧 journal 精确恢复清理；
不放宽对其他页面或其他空间的删除。

该 r1 数据已完成后续精确恢复：首个资源恢复删除空间/页面/成员后，
最近访问清理未携带原 journal 已知的页面 ID，因强归属校验停止。
后续仅按原始 `draft-created` ID 和当前账号/空间/标识/标题逐字段核对，
经原生 API 删除最后一条自有 RECENT；独立只读物理计数
`SPACE/PAGE/SPACE_MEMBER/RECENT` 均为 0。报告 SHA 为
`250d7347cf91722f9a07a0a7934d15c57385356c10003d6bad65298dc900bda7`。
新清理器保留完整已知页面集合，不因数据集未枚举到某个已记录页面就丢弃其归属依据。

新知识 r2 再次真实发布通过，但编辑 view 有三层同名 DOM 包装，
测试错误要求仅一个 wrapper；未填第二份草稿即失败，当前编辑弹层又阻挡了离开菜单。
该失败回执 SHA
`55be3ac32203d915cdbbd41397087f5cb2d10cbd791bbc58cf99822b49d41152`
保留。后续独立资源恢复 r2 **PASS**，精确删除 2 个页面、1 个空间成员及
3 条 RECENT，空间与三类页面列表、成员和最近访问均为空，全部原始错误为 0；
恢复回执 SHA
`05505dbc08d789545913e1dbbdd89aa15b4d27d9d7acdd71e1c5e99790fe5e53`。
这只是恢复通过，不将原失败测试改为通过。后续 r3 进一步确认实际关闭节点为
`i.el-dialog__close`；旧 runner 猜测的 `ibiz-modal__close` 不足以定位该节点。
独立资源恢复 r3 **PASS**，精确清理两个页面、一个空间成员与三条最近访问，
回执 SHA-256：
`a586452edc83f2a436a1b5f1b739b8345e3e2794466920a181b5f4cd65ed98ed`。
新 runner 使用实际关闭节点和最后一层可见编辑 view，发布后先选择本轮页面，
不强制点击穿透遮挡；动作/响应等待使用同一 Promise.all，避免迟到的未处理拒绝。

真实知识 r4 在正常登录返回 HTTP 500 时停止，未创建空间或页面。
失败回执 SHA-256：
`34244325ec5fc8fbc912358f5903cf571f6cf108c14806be1cc6df6cc8ec4ce5`。
独立普通登录及浏览器请求头重放随后均返回 200，容器及运行输入未变；
该间歇失败保留，不以随后的成功覆盖。

真实知识 r5 正常创建私有空间、保存 Unicode 草稿、新正常登录读回、
正常 UI 发布、再次打开正确页面并保存第二份草稿均通过；
原生 GET 验证 `content` 为第二份草稿而 `publish_content` 仍为首次发布内容。
锁定后尝试正文 PUT 返回 **500**，测试按预定 400/403 合同停止；
未将内部错误计为权限拒绝通过，也未触达后续分享流程。
原始响应为 `DataEntityRuntimeException / code=1`，消息指向
`guard_locked_page` 抛出的 `ErrorException(Errors.ACCESSDENY)`，
待修脚本异常包装层，不放宽测试为接受 500。
事后核对本回执内两个独立精确页面 GET（`native-response-0079.private.json`
与清理前 `native-response-0093.private.json`），两完整响应 SHA-256 均为
`3c7b1eedafa15565a9efe7dd7cf7647f229da806277695a0bbc872a9c8e5f5f1`。
正文、发布正文、锁、发布状态和当前版本字段未变；这证明本次页面读回无变化，
不把它外推为全部关联表或版本集合已核验，也不将 HTTP 500 改记为通过。
本轮最终精确清理两个页面、一个空间成员及三条 RECENT，
空间、页面、成员和最近访问读回均为空，运行身份/配置/挂载及 provider 字节一致。
回执：
`.artifacts/current-owned-knowledge-shared-20261123-r5/test-results/`
中文桌面 `knowledge-lifecycle-evidence.private.json`，
SHA-256：
`c07258a532ba78afee4c2049921f428492f595ce1c767278af2b4cf47be3f893`。

## 待决策/阻塞

第二次编辑和发布内容分离现已有管理员中文桌面证据；
仍需修锁拒写状态并验证拒绝后无内容副作用、有效解锁、
匿名错误密码/草稿隔离/撤销及整条流程清理，再补其他语言/视口/角色。
执行器故障测试和候选类加载不替代这些流程。
脚本包装层后续已有最小源码候选：仅沿三种已知 JSR223/反射包装、
最多 32 层且防环地保留真实 `ErrorException`，普通/语法错误仍为内部错误。
真实 Groovy、锁模型和现有响应处理器的旧类 500 负控及当前编译 403 正向
**6/6** 通过；源和 class 已封存，尚未打包或部署。
详见 [脚本业务拒绝修复](PLM-SCRIPT-ERROR-20261123.md)。
当前 JAR 修复位于原容器可写层，同容器重启会保留；镜像内容未被修改，
未来重新创建容器必须重新核对/部署已审输入，不能宣称已闭合镜像构建来源。

共享链接逻辑另有独立风险：`SharedUrl.groovy` 的自定义脚本写入
`shared_page_url` 后跳过模型 `END1`，隔离实际中央 dispatcher 证明
`session.result` 为 `null`；委托框架后可返回同一 DTO。当前 action/service API
声明为 VOID 且输入非 output，尚未把该隔离证据写成 HTTP 失败。
后续已修改源 `SharedUrl.groovy`：将 RAWSFCODE1 委托原生模型路径并保留 END1
结果传播，删除重复脚本。聚焦测试用实际中央 dispatcher 编译当前源，
正向委托/框架控制与封存旧类负控 **3/3** 通过。
这次源修复尚未打包或部署，当前服务仍是只含 PublishPage 修复的原候选 JAR；
不能把共享链接能力记为运行验收通过。
后续真实单 DTO 服务与 Jackson 回归 **3/3** 证明现有 `VOID` 合同仍返回逻辑 DTO，
空逻辑结果负控会丢失 URL，无须改外层 action 返回类型；
内存数据/ACL 夹具的范围及真实封存类来源见
[共享 URL 合同](SHARED-URL-CONTRACT-20261123.md)。

### 当前服务锁页与共享链接回归

2026-11-24 同容器应用脚本业务拒绝候选后，知识 r6 完成私有空间、
Unicode 草稿、新登录读回、发布隔离、锁定拒写和解锁。锁定写入现在通过
预期的 400/403 门，随后逐字段核对页面名称、父空间、正文、发布正文、
锁状态、发布状态、当前版本和发布时间等保护字段均未变化；空间、两页、
成员及三条 RECENT 均已精确清理。

该回归随后在 `shared_url` 动作处停止：HTTP 200 响应仍仅含 `id`、`space_id`，
缺少 `shared_page_url`。源码和 DTO 输出字段候选已经部署并重启验证，
因此剩余缺陷定位为运行时 `sys.param('plm_wiki','')` 没有有效值；
真实 `plmwiki` 入口也未在当前 30250 静态入口提供（直接探测返回 404）。
没有伪造 URL 或继续匿名流程。
当前证据 SHA-256：
`63aa3d6b8108eb4b5ea76066db7b846e923766dc7603d927c8b206cd4aa8383e`。
这进一步把剩余阻塞缩小到公开 Wiki 服务地址/运行参数配置和入口部署，
不是锁页权限或 DTO 字段。需要真实配置并验证 `plm_wiki` 的 public origin、
`/plmwiki` 路由和匿名密码/撤销流程，不能在逻辑脚本中硬编码当前测试地址。
不创建/重建容器、不拉镜像，不更改数据库/模型或其他服务配置来消除失败。
