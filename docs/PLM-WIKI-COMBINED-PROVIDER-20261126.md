# 本地 Wiki 参数与校验逻辑合并候选

检查点：2026-11-26。候选已由主线应用到同一现有容器，一次 restart、
零 recovery；实际共享 URL 复验通过，匿名静态入口仍为 404，未关闭 B01。
没有 pull、新建或重建容器。

## 手册要求

[工作区规则](manual/WORKSPACE-AGENTS.md) 要求实际运行输入、源码、编译类、
归档、容器、模型和恢复原包逐项绑定。配置保存、HTTP 200、隔离原生合同或
容器健康不能代替正常匿名分享业务验收。

## 本地实现观察

实际 provider 使用 `INITMODE=auto`、`LOCALMODE=true`、
`PUBLISH_CONFIG=false`，部署系统为 `ibizservicerunner`。
前两次知识 UI 获取共享 URL 均因缺少真实 `shared_page_url` 停止。
修改 Nacos `ibizplm` 后 reload 没有替代本地配置，临时配置已回滚。

本候选仅将可覆盖 origin 的
`${plm.wiki:http://127.0.0.1:30250}` 放到实际
`ibiz.servicehub.systemsettings.param.plm_wiki`，并合入已独立验证的
`CheckShared`、`AccessPassword` 原生委派修复。
没有改模型、认证、授权、数据源或其他运行参数。

归档范围：

| 层级 | 仅允许的变化 |
| --- | --- |
| provider 外层 | `BOOT-INF/classes/application-auto.yml`、`BOOT-INF/lib/plm-core-v1.0.2.jar` |
| plm-core 内层 | articlepage 的 `CheckShared.class`、`AccessPassword.class` |
| 其他内容 | 全部 entry 内容哈希保持原值，无增加或删除；两份原 closure 类也保留 |

`GetCustomerScore` 源码修复独立保留，未进入本候选。
旧有 `SharedUrl`、`PublishPage`、`ArticlePageDTO` 已在当前原包中的字节也未改变。

## 当前版本验收证据

准备和只读冻结命令：

```sh
node scripts/prepare-existing-plm-wiki-settings.mjs \
  --output /home/my/workspace/ainfra/aibiz/.artifacts/plm-wiki-settings-candidate-20261126-r5
node scripts/deploy-existing-runtime-archive.mjs --prepare --profile wikisettings \
  --output /home/my/workspace/ainfra/aibiz/.artifacts/existing-runtime-prepare-wikisettings-20261126-r5
```

聚焦检查：

```sh
node --test scripts/tests/prepare-existing-plm-wiki-settings.test.mjs \
  scripts/tests/deploy-existing-runtime-archive.test.mjs
```

结果 **11/11 通过**。覆盖精确配置增量、重复 YAML 键拒绝、可覆盖 origin、
未审查配置/源码/class/proof 拒绝、旧 closure 保留，以及其余发布 profile
原有边界。实际候选另执行真实本地配置解析，验证未配置/已配置两格与
origin override；辅助 helper 实际拒绝其他 YAML entry。

固定原生回执见 [Wiki 节点合同](WIKI-SHARING-DISPATCH-20261126.md)。
builder 与部署前复验该回执 SHA、16 格结果、major52 编译类、对应源码、
模型、fixture、测试、Java、封存 receipt 和 488 个依赖。
Java helper 先 overlay 内层，再 overlay 外层；完整命令、日志、helper 源码、
差异清单和原生回执副本均留在私有候选目录。

| 绑定 | SHA-256 |
| --- | --- |
| 实际原 provider | `75b38f38badd32130d6306f49ea4534bee5ea3ffa329141a45d35c9d827a8f1e` |
| r5 provider 候选 | `aa14fc31c081ddc2960842fadebe4bd21f0d6649ec03f93b10164188381f3965` |
| r5 plm-core 候选 | `460d9e02133d0d22bec1dc0ad0482b263786f60d2901d717ff3d5404b6d541e6` |
| r5 候选回执 | `8f367896112be0fd9b0b860b2bf21467869ae4cab467a8cfac160ca37b5edd99` |
| r5 frozen plan | `c93cff3e868399a66e130041c58bd66c7ee3d9887c3d456249961f206228d877` |

计划路径为
`.artifacts/existing-runtime-prepare-wikisettings-20261126-r5/prepared.private.json`，
状态 `PREPARED-NOT-APPLIED`。现有 provider 容器 ID、镜像和配置哈希不变，
冻结时仍 healthy，启动时间 `2026-11-26T18:11:25.612594298Z`。
计划绑定原 archive 身份/权限/哈希、原包和候选私有副本、13,725 个真实模型
文件清单及 readiness 脚本哈希；最多一次 apply 重启及失败后一次精确恢复重启。
本代理当时只执行 `--prepare`；后续实际 apply 由主线执行。

实际 apply 回执为
`.artifacts/existing-runtime-apply-wikisettings-20261126-r5/report.private.json`，
状态 `APPLIED-SAME-CONTAINER-HEALTHY-BUSINESS-PENDING`，
SHA-256 `2d7a5d435d8c3e8a8c35ee440d412f72d2b1cb77f91ecb336ede6da1cdbd1771`。
提交的 archive 为上述 `aa14...f3965`，同一现有容器/镜像/配置，
`restartRequests=1`、`recoveryRestartRequests=0`，
启动时间为 `2026-11-26T20:37:22.035203884Z`，健康检查通过。

发布后原知识 spec 中文桌面 r3 于 21:03:52 至 21:04:31 UTC 实际执行：
原生 `shared_url` 返回含 `shared_page_url` 的 273 bytes 响应，
全新匿名 context 使用该原始 URL 后 GET `/plmwiki/` 得到 nginx 404。
密码输入框阶段失败，没有执行密码/撤销后的匿名访问验证。
私有空间、草稿/发布隔离和锁/解锁前置均通过；
业务资源按原流程清理通过，运行包/容器和参与源码前后稳定。
主回执 SHA-256
`c5822ab29a049fe233d2b4219a196401ed83b35661f85782c6dba4ae5a3ae601`，
状态保持 `FAILED`，console/非预期 HTTP 错误各 1，未忽略。
详见 [当前知识流程](B01-KNOWLEDGE-CLOSEOUT-20261126.md)。

r1/r2 的原生准备失败、r3 的仅 YAML 候选成功均保留。
r4 因首次行为探针编译 target11、原类 target8 而被 class-version 守卫拒绝，
失败产物也保留；r5 采用原封存编译参数 target1.8、两类 major52 并重跑
16 格后成功，没有把被拒绝的候选升级为通过。

## 待决策/阻塞

实际发布及 URL 生成不替代分享全流程。首先修复当前 `/plmwiki/` 静态入口 404，
再验证合法匿名入口、正确/错误密码、过期、撤销、子集外访问、草稿隔离和
跨角色读回。r3 清理 PASS 仅覆盖自有页/空间/成员/RECENT，
CK 消息和发送审计未独立检查。管理员窗口在 r3 结束后已释放，
后续正常账号执行仍由主线协调。
