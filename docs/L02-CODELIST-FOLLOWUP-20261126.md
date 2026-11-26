# 动态代码表显示副本修复

检查点：2026-11-26，Asia/Singapore。范围为 L01/L02 的维护适配器与源码回归。
本批不是词典扩充，没有修改 `en.json` 或 `model-locale.ts`。

## 手册要求

中英文显示不得改变代码表存储值、字段代码、关联与原始数据。
只读、禁选、颜色、样式等运行元数据也应保留，不能因英文显示而变成不同的数据合同。
源码/受控测试与真实浏览器、动态业务 API、完整语言验收分开记录。

## 本地实现观察

工作区维护适配器此前已有未提交的三类改动：允许精确匹配的非主状态动态选项、
项目系统状态 alias，以及动态 cache 订阅显示适配。本批开始前已私有封存它们
及对应测试，没有回退、改写或冒领为本批新增功能。

本批实际复现的缺陷是显示副本的复制方式：

```js
{ ...item, text: translatedText }
```

框架真实 `CodeListDataItem` 使用非枚举 `$origin` 保存原始记录，
并以 getter 读取 value、color、disableSelect、textCls 和其他字段。
对象展开复制只取枚举属性的当时值，因此丢失原型、`$origin` 和 getter。
即使英文标签正确，显示副本已经失去其原数据绑定，颜色/禁选等字段的后续读取
也变成复制时的快照。

修复位于 `plm-web/src/locale/codelist-locale.ts`：
通过 `Object.create` 保留原型和全部自有属性描述符，只为精确匹配的显示 text
创建覆盖值。原缓存对象、原记录、字段 getter、非枚举数据及技术值均不写入。
注释同步为“精确模型定义的动态选项”，不再错误描述为只支持主状态。

当前实际模型中，18 个带选项定义的动态代码表均为平面；观察到的嵌套定义为静态
代码表。本批没有把未来可能的嵌套动态情况编造成当前缺陷，也没有添加无据递归。

## 当前版本验收证据

新增 `plm-web/tools/tests/codelist-locale-followup-20261126.test.mjs`。
它执行真实 `CodeListDataItem` 源类和当前实际 `project_state`、`SysOperator` 模型，
以受控 service 返回缓存项验证显示副本；不是原生动态 API 请求。

类依赖仅使用受控辅助：普通记录的 `ramda.clone` 用 `structuredClone`、
布尔转换用明确标量映射、`AppDataEntity` 用类型标记；
`ScriptFactory` 一旦被调用就抛错，测试没有执行模型脚本。
测试的禁选字段是显式添加的受控配置，用来验证真实类的 getter 合同，
不宣称实际项目状态模型已经配置该禁选字段。

本批原始失败先保留：工作区副本复制修复前，最初四项测试为 1 通过、3 失败。
最终新测试收敛为三项独立显示副本回归；原有订阅回归继续在既有测试文件，
避免让最小提交依赖未提交的订阅实现。

干净源码复验使用：

- `plm-web@0da40fb710924115c5bfe4e40a5ce1974c1b9683` 原适配器、模型、
  词典、原测试。
- `ibiz-app-hub@5ec1c2b72611aaa4cbe9b8cf2156772ff2c37529` 的真实
  `CodeListDataItem` 类，哈希与当前源相同。
- 新增三项回归。

结果分三步保留：

| 私有源码阶段 | 实际结果 |
| --- | --- |
| 原 HEAD，新测试 | 1 通过、2 失败；普通动态项目状态未进入翻译分支 |
| 仅移除主状态专用谓词，新测试 | 1 通过、2 失败；英文出现但原型/源绑定仍丢失 |
| 加上属性描述符/原型副本修复，新测试和原 HEAD 测试 | **5/5**，无失败/跳过/取消 |

最小可提交改动因此只含：移除 `DEMAINSTATE` 专用谓词、
保留副本属性描述符/原型及同步注释。项目 alias、cache 订阅及它们的旧测试改动
继续留在原工作区，不包含在最小干净候选。

最小适配器 SHA-256：
`52ab04db857f412623db33b6ce9eda137509a6c28ca919a79c716b0feb455aa5`。
新增测试 SHA-256：
`ca4e5922c6edfc03145560698c66018da4c2bcf57ee8214fc8a42652ee0b3751`。
真实 runtime 类 SHA-256：
`027e970da1dc66e7ecece048a1ade3badcc93a0fae13b029002aee4f0d63b783`。

工作区完整适配器另跑：

```sh
node --test tools/tests/codelist-locale-followup-20261126.test.mjs \
  tools/tests/codelist-locale.test.mjs \
  tools/tests/codelist-routing.test.mjs
```

结果 **9/9**。该组含原未提交 alias/订阅行为的回归，
与最小干净候选 **5/5** 是不同范围，不能混用。
工作区完整适配器 SHA-256：
`bbc1108d18b1582cb1c8af6f007f7ad9dacc861b568e7c7eb7e7151a21565d8a`。
新测试语法及修改空白检查通过。

私有目录 `.artifacts/l02-codelist-followup-20261126-r1/` 保留修改前字节、
原差异、三阶段干净回放、最小适配器 patch、最终源码快照和日志：

- `clean-receipt.private.json` SHA-256：
  `6fa83f87bb1a78475586a54c544854f04efa4066c471f576660bbf6fb2affc2f`。
- `receipt.private.json` SHA-256：
  `54608fddd389a4cf6b1fea4c45ed09d52c0f38b8da71fe38a48fc16ee76a05fa`。

本批没有 Docker 操作、业务 API、数据库或共享发布，没有修改词典。

## 待决策/阻塞

当前证据覆盖受控源码中的真实运行项类和显示副本，不证明动态 API、真实浏览器、
跨角色流程或完整中英文切换已经验收。订阅适配的工作区回归只证明其受控显示行为，
不证明运行 cache 的其他行为或共享服务已发布。
L01/L02 的完整语言、插件、导出、错误和嵌入 IDE 门槛继续开放。
