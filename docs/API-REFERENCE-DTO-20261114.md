# API Reference DTO 字段声明

日期：2026-11-14，Asia/Singapore。关联：L03 文档内容完整性。

## 本轮范围

API 方法的输入/输出现在可链接到明确的 DTO 字段声明，不再只有 DTO 类型名称。
这是权威模型的只读参考，不是运行序列化、授权、请求必填校验或实际 API 调用验收。
主路由推导策略没有改变：仍是模型相对候选、保守 major 根及一种可达父路径。

修改入口：

- `plm/doc/tools/api-reference.mjs`、`api-reference.d.mts`
- 新增 `plm/doc/tools/api-reference-dto.mjs`
- `scripts/tests/plm-api-reference-generator.test.mjs`

没有改实体源模型、客户端、CSS、Vite 插件、数据库、共享服务或业务 HTTP。
客户端对 `dto-` 锚点和真实浏览器交互的适配由主任务独立完成。

## 权威来源

`plm/model/PSSYSSERVICEAPIS/ServiceAPI.json` 的每个实体通过
`getPSDataEntity.path` 指向其权威实体 JSON。方法输入/返回的
`getPSDEMethodDTO.id` 在该实体的 `getAllPSDEMethodDTOs` 中按原始名称查找，
不是从生成后端类名或实体总字段反推。

普通 DTO 的成员来自 `getPSDEMethodDTOFields`；
`DEFILTER` 的搜索字段来自 `getPSDEFilterDTOFields`。
字段有效名称、模型属性代码、类型、数值类型、长度、格式、搜索模式以及显式
`allowEmpty/readOnly/listMap` 都来自对应 DTO 的字段声明。

例如 `PSMODULES/Wiki/PSDATAENTITIES/article_page.json` 有 48 个实体字段，
但 `article_page_ai_info_dto` 只有 10 个字段，
`article_page_shared_fields_dto` 有 11 个，
`article_page_filter_dto` 有 43 个过滤字段。它们分别展示，不把 48 个实体字段复制为每个 DTO。

模型目录同时包含普通 `PSMODULES/.../PSDATAENTITIES/*.json` 和
`PSSYSMODELGROUPS/ebsx/PSMODULES/ebsx/PSDATAENTITIES/*.json`。
只加载实际引用闭包的安全相对路径；模型名、DTO 名和字段代码保持原样。

## 表示规则

- 179 个既有实体 Markdown 文件内追加 DTO 区域，不新增任意文件路径；
  输出仍为 365 个文件，中英文来自同一技术结构。
- 稳定锚为 `dto-` 加 16 位十六进制 SHA-256 前缀，输入为模型相对路径与 DTO 名。
  同名但不同实体的 DTO 不合并，嵌套循环保留为引用，不无限展开。
- 方法类型 `DTO/PAGE/DTOS` 原样保留；DTO 链接不把 PAGE 误写成裸对象，也不推测分页外壳。
- `getRefPSDataEntity/getRefPSDEMethodDTO` 表示嵌套类型；
  `getRelatedPSDataEntity/getRelatedPSDEMethodDTO/getRelatedPSDEMethodDTOField`
  表示投影来源。二者分别列出，不把来源 DTO 的全部成员替换进一个投影字段。
- 未声明的可空/只读值显示“未声明/Unspecified”。`allowEmpty=false` 不是
  每个创建或更新操作都必须提交该字段的证明，`readOnly` 也不是权限验收结果。
- 未声明字段列表与显式空数组区分：前者显示未解析，后者保留明确的空声明。
  过滤 DTO 没列出的通用分页、排序或运行时继承字段不擅自补入。
- 不输出默认值、表达式或执行示例；所有人文标签转义，英文缺词条时使用技术代码可读化。
  源字段类型和数值/布尔元数据严格检查，不把字符串 `"false"` 当作布尔值。
- 未解析方法引用仍保留原类型、DTO ID 和具体原因，不回退实体总字段。
  搜索索引沿用 `label/code/path/keywords` 形状，新增指向真实 DTO 锚的条目。

## 实际覆盖与缺口

2026-11-14 当前工作区模型结果：

| 项目 | 数量 |
| --- | ---: |
| 方法定义（独立 + 关联） | 4,853 |
| 方法输入/返回对象 | 9,706 |
| 其中含 DTO 引用 | 7,829 |
| 可解析字段声明的方法引用 | 7,827 |
| 未解析字段声明的方法引用 | 2 |
| 直接引用的独立 DTO | 390 |
| 递归引用闭包 DTO | 398 |
| 闭包中有明确字段列表的 DTO | 396 |
| DTO 字段声明 | 5,373 |
| 过滤 DTO | 171 |
| 嵌套类型/投影来源引用边 | 131 |
| 未解析引用边 | 1 |
| 实际参与的实体模型文件 | 177 |

初步只按 DTO 名称查找会得到“全部引用的定义存在”，但定义存在不等于字段列表存在。
实现后的统计明确保留以下缺口，不能报告 100% 字段覆盖：

| 源模型 / DTO | 影响 | 缺口 |
| --- | --- | --- |
| `PSMODULES/ProdMgmt/PSDATAENTITIES/idea.json` / `idea_def_group_common_dto` | `idea.get_customer_score` 的独立及关联返回各一处，共 2 个方法引用 | 声明 `DEFAULT/DE`，没有字段列表 |
| `PSMODULES/Base/PSDATAENTITIES/view_theme_setting.json` / `view_theme_setting_usr1014979662dto` | 一个嵌套来源引用 | `DYNAMODEL` 指向 `Usr1014979662DTO`，当前实体及系统模型都未给出字段列表 |

仅用于实体 API 定义但无 DTO 引用的三个 extension 逻辑节点模型不参与 DTO 文件读取；
闭包会额外读取确有引用的非 API 实体。因而“最初预加载全部实体得到 180 个模型”
不是实际生成器输入数量，当前准确数量是 177。

## 来源绑定

Manifest 增加 `dtoCoverage/dtoPolicy`，每个 DTO 模型输入包含
安全相对 `modelPath`、字节数与 SHA-256。生成器及 DTO helper 也独立绑定。
当前共 181 个参与输入：177 个实体模型、服务模型、英文词条、主生成器和 DTO helper。

每次读取拒绝路径跳转、软链接、硬链接、非普通/超限文件及读取期间元数据变化。
完整引用闭包加载后，再读取并核对所有参与文件的 inode/device/size/mtime/ctime
和内容哈希；最初缺失的模型或可选词条若中途出现也拒绝发布，避免混合来源快照。
未知模型/DTO 保留未解析，而不是伪造字段成功。

私有精确输入路径清单：
`.artifacts/api-reference-dto-20261114-r1/inputs.private.json`；
同目录 `manifest.private.json` 记录本轮字段覆盖和输出哈希。
发布/导出应按该清单复核实际字节，不把模型目录的其他脏修改一起提交。
英文词条和部分实体模型本来已有用户修改，manifest 绑定的是实测工作区字节，
不能仅用提交号冒充全部来源一致。

## 验证与剩余范围

```sh
node --test scripts/tests/plm-api-reference-generator.test.mjs
```

新增用例执行真实解析与渲染：字段子集、过滤 DTO、PAGE 包装、嵌套循环、
投影来源、缺模型/缺 DTO/缺字段列表、双语稳定锚、可空/只读未知值、搜索链接、
注入转义、重复字段/非法类型、软硬链接及读取中触碰早期文件的混合快照拒绝。
生成仍不写回原文档目录，也不执行 API。

Agent 冻结时生成器聚焦 `23/23` 通过；与旧静态文档和双应用接线联跑 `35/35` 通过，
0 失败、0 跳过。两种语言的搜索索引各有 5,513 条，其中 571 条指向页面内 DTO 声明；
条目属于不同实体页的引用闭包，不等同于 571 个独立 DTO。
客户端和真实 Docsify 的 DTO 点击/刷新/切换回归由主任务另行记录，不计入上述数目。

当前单次本机生成约 0.45 秒、9.5 MB 输出，包含全量参与文件的最终复查，
仅是一次开发机观察，不是 Vite dev 或生产并发性能验收。
dev 当前按请求生成，后续缓存必须有明确失效与输入绑定，不能用过期缓存冒充当前模型。

仍需补齐两个权威字段定义缺口、真实运行 DTO 序列化与分页外壳、逐方法校验、
写入/只读权限及部署路由验证。来源声明不等于这些运行行为已经通过。

主任务实际浏览器发现 Markdown `#/...` 被本地 Docsify 当作标题 ID，导致正文
语言链接和 DTO 链接不能正常跳转。现 Markdown 改用 `/api-reference/...` 路由，
DOM 搜索链接仍使用 `#/...`；新增独立回归后生成器为 `24/24`，接线合计 `36/36`。
真实四场景及父项 `5/5`，覆盖 DTO 正常点击、刷新、保锚语言切换，以及正文语言和概览实体链接。
没有通过注入控制器或改断言伪装错误的链接有效。

最终按 Git index 导出204个精确文件（含177个权威实体模型），重跑 `36/36 + 5/5`，
DTO 覆盖和两处缺口与当前工作区一致。使用 index 中的既有英文词条和模型，
没有把用户其他脏改动一起提交。该最终导出的 manifest 才绑定修正后的生成器字节；
上述 agent 冻结时的私有输入表保留为历史观察，不冒充最后版本。
回执：`.artifacts/remaining-20261114-r3/staged/report.json`，
SHA-256 `a0986df54a799e6c71837f1d118be73ba44bf953c66c526c5d8db096a8c930dc`。
标准章节标题锚点的完整交互与语言映射仍需另补覆盖，不能用方法/DTO 锚通过代替。
