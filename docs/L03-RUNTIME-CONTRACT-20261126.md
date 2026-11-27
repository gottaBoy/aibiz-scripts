# L03 DTO 与返回逻辑原生合同

检查点：2026-11-26。本轮修复客户分数逻辑的返回节点委派，并补充真实缓存
DTO、Jackson 和结束节点验证。没有关闭 L03；两处方法 DTO 声明缺失及一处
嵌套 DTO 未解析引用仍保留。

## 手册要求

依据 [工作区规则](manual/WORKSPACE-AGENTS.md)，DTO/API 文档须与权威模型、
当前实现和实际返回相符。开放容器能序列化动态键，不代表权威模型已经声明
字段、类型、nullable、校验或授权规则。中文、补充平面字符、组合字符、
引号、反斜线和换行应无损往返。

## 本地实现观察

权威来源仍与 [L03 声明追踪](L03-DTO-SOURCE-FOLLOWUP-20261118.md) 一致：

| 来源 | 本轮观察 |
| --- | --- |
| `idea_def_group_common_dto` | 模型没有字段数组；`DEFGroup_common` 没有 detail；对应 Groovy DTO 是无成员的 `GroovyDTO` 子类 |
| `view_theme_setting_usr1014979662dto` | 指向系统 DTO `Usr1014979662DTO`；系统 DYNAMODEL 和 `searchcond` 模型没有属性声明；Groovy DTO 也无成员 |
| `ViewThemeSettingDTO.search_conds` | 权威模型明确为 `DTOS`，源码明确为 `List<ViewThemeSettingUsr1014979662DTO>` |
| `get_customer_score` | action 明确返回 `idea_def_group_common_dto`；模型计算节点设置两个现有键，随后连接 `END1` 返回 `result` |

`GetCustomerScore.groovy` 原实现重复执行了模型脚本，却注释了原生节点委派。
控制数据下，DTO 已包含计算值，但中央调度器没有进入 `END1`，
`session.result` 仍为 null。本轮仅将 `RAWSFCODE1` 改为原生
`super.onExecutePSDELogicNode(session, node, true)`，沿用模型脚本、链接及结束节点。
没有改评分公式、持久化键 `customer_score_precent`、响应类型或权威字段定义。

生成来源为
`plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDELOGICS/get_customer_score.json`；
本轮不执行全量生成。精确源码使用原有本地 Groovy 编译器与真实依赖编译，
命令由新增 inspector 自动构造，完整命令和源码快照保留于私有回执。

新增独立、限定版本的生成后修复入口：

```sh
node scripts/repair-generated-customer-score-dispatch.mjs
node scripts/repair-generated-customer-score-dispatch.mjs --apply
```

默认只检查，`--apply` 只允许本节原/修复后完整源哈希及精确权威模型
`2443c042869be1c901023dde87c6d6920ae7814f0d93fe4ce555c5f01857b849`；
实体内嵌与独立逻辑必须一致。未知源码、公式/模型字节或内嵌变化均拒绝。
`node --test scripts/tests/repair-generated-customer-score-dispatch.test.mjs`
为 **3/3 通过**：按权威脚本重建原生成方法，重放得到当前完整源，
另在自有临时目录实际 apply 一次并验证第二次幂等、两个模型输入字节不变。
未执行全量代码生成，也不宣称已修复上游通用生成器。

## 当前版本验收证据

命令：

```sh
cd scripts
node --test tests/inspect-owned-dto-runtime-contract.test.mjs
```

当前结果 **4/4 通过**。测试复用已封存的 488 个真实 provider 依赖，
Java 可执行文件与所有依赖在执行前后逐项校验 SHA-256，不下载依赖，
不连接 HTTP、数据库、账号或 Docker。

| 验证 | 真实结果与边界 |
| --- | --- |
| 实际 `IdeaDefGroupCommonDTO` + `MethodHandlerBase.MAPPER` | 中文、emoji、组合字符、引号、反斜线、换行往返一致；数值保持数值 |
| 显式 null | 当前原生动态 DTO 序列化保留显式 null；这不补充缺失的 nullable 声明 |
| 实际 `ViewThemeSettingDTO` 嵌套列表 | 两次读回均为真实 `ViewThemeSettingUsr1014979662DTO` 实例，Unicode 一致 |
| 嵌套开放容器 | `diagnostic_payload` 仅为合成 codec 探针键，明确不视为业务字段声明 |
| 原缓存客户分数类 | 空集及 `10/20/30/40/50` 两组均能计算字段，但默认路径不返回 DTO；原生委派对照进入结束节点 |
| 修复后的当前源编译类 | 两组均经过 `RAWSFCODE1 -> END1`，返回同一 DTO；空集为 `0分`/0，另一组为 `7分`/`7 / 15` |
| 合同漂移拒绝 | action 返回类型/DTO、结束参数、嵌套 DTO 引用改变均拒绝视为同一合同 |

上述计算使用控制客户行和模型原脚本，中央调度器、真实 END runtime、
DTO 与 Jackson 来自封存依赖。未执行前置客户数据集查询、完整 action/HTTP、
真实业务授权或数据库读写，因此不是客户评分业务验收。

修复前有效负回执：
`.artifacts/owned-dto-runtime-tests-c45a487d1df4/report.private.json`，
状态 `FAILED_CURRENT_SOURCE_RETURN_NOT_REACHED`，
SHA-256 `aecde6412ebd7b7339df79e0aa7a794022469416c62c721081cc60ce8eb139ba`。
原源码 SHA-256
`ee0f4ea9eae79078afc9ad22da3204a0603d01e3b768ea4bb93534bbd34b56da`。

修复后回执：
`.artifacts/owned-dto-runtime-tests-7a83145141fc/report.private.json`，
状态 `PASS_NATIVE_MAPPER_AND_CURRENT_SOURCE_RETURN_CONTRACT`，
执行时间为 2026-11-26 19:08:25 至 19:08:30 UTC，
SHA-256 `1cb3c95187b1d4dfc5219e30d7f2ea9758c5441b9993448b6e8b4e76bbc15805`。
修复源码 SHA-256
`a7868d0a6f3685cfd19e85c6513c841b930b02257466cddfb2d1db3138456905`；
精确编译类 SHA-256
`63cd3f112a6bb084c7edb79ba57c011436dce282e0f3a873138e30bec4e2de8c`。
所有参与输入和依赖执行前后稳定，当前源码类的加载来源确认为独立编译目录。

最初三份探针准备失败也保留在私有目录，未计为生产缺陷或通过证据：
两份错误假定动态 null 会省略，另一份日志 override 签名不符。
有效负回执和修复后正回执均使用最终正确探针。

## 待决策/阻塞

1. 两个 DTO 字段列表仍须权威模型补齐。运行中动态键、现有脚本输出或合成探针
   均不能代替声明；方法未解析数保持 2，嵌套未解析数保持 1。
2. 原生 codec 证据只覆盖上述精确 DTO、嵌套列表与输出计算，不扩充到所有
   7,829 个引用，也不声明字段校验、类型和 nullable 已完整验收。
3. 本轮后端修复尚未打包或部署；当前共享 provider 不自动包含该修改。
   后续需按真实业务账号、对象归属、API 返回、跨角色拒绝及清理逐项验收。
4. 中英文业务结果中的现有 `分` 文案仍属于 L01 的格式化业务文案范围；
   本轮保留原公式和输出，未将已有中文输出冒称英文验收完成。

未 pull、新建、重建或重启容器，未修改共享配置、数据库、权限或账号。
