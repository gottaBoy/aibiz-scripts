# L03 权威 DTO 闭合检查

检查点：2026-11-27。本轮只读追踪两个方法 DTO 声明和一个嵌套 DTO
目标，没有修改模型、生成源码、后端 DTO、运行包或共享服务。

## 手册要求

DTO 字段、类型、nullable 和嵌套目标必须来自可追溯的权威模型/生成输入。
逻辑脚本动态写入的键、Jackson 可以序列化的 Map 键、前端显示字段和历史
文档示例都不能替代模型声明。发现来源缺失时保持未闭合，不能猜字段补齐。

## 当前权威观察

### `idea_def_group_common_dto`

当前实体模型、Web 应用模型和 Mobile 应用模型均只有 DTO 名称和
`sourceType=DE`，没有 `get*MethodDTOFields`。`DEFGroup_common` 也没有
`getPSDEFGroupDetails`。

`get_customer_score` 的实体 action、独立 action 模型以及 Web/Mobile 方法都
绑定到这个返回 DTO。当前逻辑脚本确实观察到
`customer_score`、`customer_score_precent` 两个运行时键，但没有字段名、
类型、nullable 或校验声明。

当前后端 `IdeaDefGroupCommonDTO.groovy` 是空的 `GroovyDTO` 子类；两个
vendor-upstream 同路径源码与当前字节一致。前端发布模型保留空 DTO 定义，
没有新增字段。

### `view_theme_setting_usr1014979662dto`

`ViewThemeSettingDTO.search_conds` 的父字段有明确权威声明：

```text
name=search_conds
type=DTOS
target=view_theme_setting_usr1014979662dto
```

但目标 DTO 在当前实体模型、Mobile 应用模型、`PSSYSTEM.json`、
`PSSYSTEM.json.bak`、当前后端源码和两个 vendor-upstream 源中均无字段。
`PSSYSDYNAMODELS/Usr1014979662.json` 只有：

```json
{"codeName":"Usr1014979662","dynaModelFilePath":"PSSYSDYNAMODELS/Usr1014979662.json","name":"searchcond"}
```

没有 `getPSDynaModelAttrs`。`fill_search_conds` 的原生逻辑只是把
`themeModel.get("searchconds")` 写入父 DTO，证明运行时动态值来源，
不能推出子项结构。

`diagnostic_payload` 只在此前 codec 探针中作为合成开放容器键使用，不属于
权威业务字段。

## 当前回执

```sh
cd scripts
node --test tests/inspect-l03-authority-closure.test.mjs
node inspect-l03-authority-closure.mjs \
  --output /home/my/workspace/ainfra/aibiz/.artifacts/l03-authority-closure-20261127-r3
```

检查结果 **4/4 通过**。报告：

`.artifacts/l03-authority-closure-20261127-r3/report.private.json`

报告 SHA-256：
`918345a216cf32e182f2a8ceced6b85db9e72b36ede3737082eafbee0c52840b`。

报告固定的未闭合计数：

| 项目 | 数量 |
| --- | ---: |
| 未解析方法 DTO 声明 | 2 |
| 未解析嵌套 DTO 目标引用 | 1 |
| 独立观察到的逻辑输出键 | 2 |

当前、两个 vendor-upstream 和备份系统模型的目标 DTO 观察一致；备份文件
整体字节可能包含其他历史差异，但 `Usr1014979662DTO` 目标定义等价。
文档/API 只提供 `Object` 示例和逻辑脚本说明，归类为文档观察，不能提升
为字段权威来源。

## 最小修复候选

当前候选状态为 `BLOCKED_NO_AUTHORITATIVE_FIELD_DEFINITION`：

1. `idea_def_group_common_dto`：先在权威实体模型和对应 Web/Mobile 模型中
   补充明确的 `getPSDEMethodDTOFields` / app DTO 字段定义，确定字段名、
   标准类型、nullable、校验和权限；随后重新生成后端 DTO、前端发布模型和
   API 文档，再运行 DTO/返回 action 回归。不能把两个逻辑输出键直接当成
   字段。
2. `search_conds` 目标：先在 `PSSYSDYNAMODELS/Usr1014979662.json` 增加
   权威 attributes（每项名称、类型、nullable、校验和显示语义），再重新
   生成 `PSSYSTEM` 系统 DTO、实体/应用 DTO、后端子 DTO 和文档。不能从
   `themeModel.get("searchconds")` 的动态值或探针键推断结构。

两条候选都要求生成过程可重放；只改生成结果或只改运行时序列化映射都不
能关闭 L03。此前真实 Jackson/END 运行探针只能证明当前动态容器可往返，
不能降低上述声明缺口。

未部署、未登录、未写数据库、未修改共享服务或已有业务源文件。
