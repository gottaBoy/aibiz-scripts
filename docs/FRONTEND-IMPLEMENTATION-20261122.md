# 前端业务与双语增量

检查点：2026-11-22，Asia/Singapore。父项范围为 B01-B04、L01-L03，
首批具体实现涉及 B01/B02/L01/L02，后续补 B03/L03 文档全文检索；
不关闭任一顶层项。
遵守用户要求复用现存 Docker：没有创建、拉取、重启、替换或部署容器，
没有覆盖 `plm-web/public/plugins` 或 `dist`，没有业务 API 写入。

## 手册要求

按 [产品与项目](manual/PRODUCT-PROJECT.md)、
[测试与知识](manual/TEST-KNOWLEDGE.md)和
[管理、集成与度量](manual/ADMIN-INTEGRATION-METRICS.md)，
业务评论、成员选择、版本、测试计划与配置提示需要中英文显示。
显示适配不能改写身份、字段、角色、状态存储值、路径或用户内容；
测试结果仍需区分静态源码、受控组件与真实多角色流程。

## 本地实现观察

| 实现 | 原行为 | 本批改动 |
| --- | --- | --- |
| 评论列表 | 编辑/删除和今天/昨天/前天写死中文；按月份及日期分别相减，跨月/跨年漏判相邻日期；不匹配时间格式返回空白 | 从实际语言读取提示；以本地日历日期计算相隔天数，支持跨月、跨年及闰日；未知/非法时间原样显示 |
| 人员选择器 | 搜索、人员/部门、确认、空态、加载态及三种配置错误写死中文 | 在源码组件和控制器使用局部双语 helper；成员姓名、职位、ID、选择回调和请求配置保持原语义 |
| 模型词条 | 当前运行前静态审计有 3418 个未映射字面标签 | 补 34 个明确业务词条，包括草稿、命名版本、三类测试计划、开始迭代、工时、看板、模块等；减少 34 个唯一缺项、增加 211 处显示匹配 |
| 可见文案审计 | 仅缺项列表，缺少上下文分类和当前输入来源绑定 | 依据 TypeScript AST 对交互提示、字段、码表、导航、显示标签、布局及待 UI 复核分类；每类保留路径/行号样例，给全部消费模型、词典和适配器绑定 SHA-256；新增 `--output` 生成不覆盖旧文件的回执 |

源码入口：

- `plm-web/plugin-src/@ibiz-template-plm/comment-list/src/comment-list.ts`
  与新增 `comment-list.locale.ts`。
- `plm-web/plugin-src/@ibiz-template-plm/person-select/src/personel-select.tsx`、
  `personel-select-controller.ts` 与新增 `personel-select.locale.ts`。
- `plm-web/src/locale/en.json`、`tools/audit-model-locale.mjs`。

人员选择器现有源码已注明从发布包恢复；本批在该维护入口增量修改，
没有只改发布字节。现有插件构建器的 `build:one` 会写发布目录，本批未执行；
后续需在经过绑定的候选目录构建并重新验证实际浏览器加载的文件。
本批保留工作区此前所有源码、词典、工具与发布文件的未提交修改，
不能将完整工作区 diff 误当作本批独占增量。

## 当前版本验收证据

从 `plm-web/` 执行：

```sh
node --test tools/tests/frontend-workflow-locale.test.mjs \
  tools/tests/model-label-classification.test.mjs \
  tools/tests/person-select-binding.test.mjs \
  tools/tests/model-locale-audit.test.mjs \
  tools/tests/model-locale.test.mjs \
  tools/tests/model-label-source.test.mjs
node tools/ts-harness/index.mjs person-select comment-list
node tools/audit-model-locale.mjs \
  --output .artifacts/frontend-implementation-20261122-NEW/model-label-audit.private.json
git diff --check
```

- 聚焦 Node **60/60**。执行实际组件/控制器源代码的受控 render、错误分支及模型
  本地化，覆盖中英文、跨月/跨年/闰日、原始特殊字符、成员数据和持久化代码保留。
  它们不等同真实浏览器、后端权限或持久化流程通过。
- 现有类型基线门槛通过：person-select **8** 条、comment-list **22** 条既有诊断；
  新 locale helper 无诊断。不是类型全清零，也未更改基线放宽门槛。
  回执位于 `plm-web/.artifacts/plm-ts-harness/2026-11-22T08-29-21-573Z-800070.json`。
- 审计两次源输入指纹一致；最终保存回执覆盖 **3162** 个模型文件、
  **50,781** 处标签、**4661** 个唯一标签。其中 **43,934** 处匹配词典，
  **1277** 个唯一标签匹配，**3384** 个唯一标签仍未映射。
- 模型源清单指纹：
  `07b54b449e792276f5c711c8360603da6e72e49d5b001d3688cb718f7fa539df`。
  最终词典 SHA：
  `2db9a8fc425443b36e8a265dc004ea27aadd6060ebbb2ed96f2b46dca591552d`。
- 私有完整审计：
  `plm-web/.artifacts/frontend-implementation-20261122-r1/model-label-audit.private.json`，
  SHA `bdb2a1813344dedc492d4b1fdfd993df3b47fdf0ad1dff33737586e1aa103463`。
  私有输出不提交。

当前缺项的源码分类如下；同一标签可在多类出现，唯一标签列不能相加当总数：

| 源码上下文 | 唯一缺项 | 出现次数 |
| --- | ---: | ---: |
| 交互提示 | 493 | 810 |
| 字段显示名 | 727 | 960 |
| 选择器标签 | 0 | 0 |
| 码表显示值 | 430 | 571 |
| 静态导航标签 | 42 | 59 |
| 显示标签 | 933 | 1674 |
| 显式隐藏的布局标题 | 0 | 0 |
| 布局标题待复核 | 27 | 62 |
| 其他待 UI 复核 | 1608 | 2711 |

分类依赖明确元数据，未凭“容器”名称过滤标题，没有丢弃未知标签或把待复核
转换为“无需翻译”。本次运行前数值恰与历史 3418 相同，也不证明历史候选
集合/版本完全相等，回执对此明确保留 `historicalCandidateIdentityVerified=false`。

## 待决策/阻塞

- B01/B02：本批两个插件的源码行为已修；尚需当前候选实际浏览器的中英文、
  桌面/手机、刷新、角色及持久化回放，73 插件完整矩阵仍开放。
- L01：3384 个当前候选仍需逐类复核；源码分类不证明页面实际显示和认证后
  使用结果，也没有重跑全部 12 项语言门槛。
- L02：真实错误响应、通知、导出及全部认证后插件流程仍需验证。
- B03/B04：首批没有新增 Development/API Reference 执行或 PLM 内原生 IDE
  CRUD 证据；下方文档检索后续批次也不证明 API 权限执行或 IDE CRUD。
- L03：两处方法 DTO 声明、一个嵌套字段来源、运行 mapper/序列化及真实嵌入
  没有由本次前端词条工作解决。
- 不以现存共享旧字节代替本批源码浏览器验收。真实身份链或现存 UAA 不可用时，
  记录阻塞并保留原现场，不创建替代环境或注入身份取得通过。

## API 文档全文检索后续批次

### 本地实现观察

本地 `aibiz-api-reference.js` 原先已经提供实体/方法/DTO 代码元数据搜索；
`index.html` 中注释掉的 CDN search 插件不能据此推断所有搜索都不存在。
实际补充的是尚未进入索引的实体字段显示名、生成正文、逻辑输出字段及
未解析 DTO 来源说明，同时改进搜索状态和跳转后的查询保持。

生成入口仍为 `plm/doc/tools/api-reference.mjs`：

- 从本次实际生成 Markdown 段落提取全文，索引 `body` 必须原样存在于相应页面；
  不加入编造的条目、字段或 DTO。新增稳定 `fields-<hash>` 字段段落锚点，
  方法 `op-` 和 DTO `dto-` 锚继续保持。
- 每种语言有 **5785** 条搜索记录，其中 **4853** 条方法、**179** 条实体字段
  段落和 **573** 条 DTO 段落引用；573 不是独立 DTO 声明数。
  没有独立根路径的方法仍可搜索到其文档，正文保留路径未声明说明，不伪造可调用 API。
- 客户端使用本地索引的 NFKC/大小写归一及多词 AND 匹配，按代码、标题与关键词
  排序，显示正文片段；查询只保留在当前站点页面路径的 `sessionStorage`，
  不放进网络请求、不请求远程翻译。
- 保留中英文入口、已加载索引缓存与异步过期保护；提供加载、空查询、明确无结果、
  错误重试及键盘进入结果。语言切换、结果跳转和刷新保持查询。
- 当前搜索范围限定生成的 API 模型参考，未声称整个旧 Data Model 文档已全文索引。

修改源文件是生成器、`docsify/script/aibiz-api-reference.js`、
`docsify/css/local-theme.css` 与 `docsify/index.html`。
两应用现有文档生成/发布接线保持；没有覆盖共享前端输出。

### 当前版本验收证据

```sh
node --test scripts/tests/plm-api-reference-generator.test.mjs \
  scripts/tests/localized-api-documentation.test.mjs \
  scripts/tests/local-documentation.test.mjs \
  scripts/tests/documentation-browser.test.mjs
node --test scripts/tests/localized-api-documentation.browser.mjs
```

第一组 **44/44**。第二组用本地 publisher 写入新的私有静态候选，重复生成的
**365** 个输出全部相等，再以静态候选启动临时 localhost 服务器并运行实际
Docsify/Chromium，最终 **6/6**（四格及错误恢复子项/父项），无跳过。
临时服务器和浏览器均由测试 teardown 关闭，Node 会话已正常退出。

最终候选：
`.artifacts/localized-api-docs-browser/probe-5d3785d3-73b9-42cc-b247-6addd8b2c5e4/candidate/`。
回执为同级 `report.json`，
SHA `f328e388e491e13fb3b6409eca633f2824555ced44849d8138c5421d6dad7abc`；
生成 manifest SHA
`8669da0bd8208fd9c60319fcaf43fee2a8c58505d7d84a6e970b16e4c4562830`。
184 个生成输入哈希及实际候选 HTML、runtime、搜索脚本和主题哈希记录在回执，
完成后又与当前源文件核对一致。私有候选、截图及原始回执不提交。

真实验证包括：

- 中英文桌面/手机，`访问密码` / `Access Password` 命中真实字段正文，
  `fields-605f2926a88bb3eb` 深链刷新后仍存在，查询保持。
- 多词 `customer_score_precent get_customer_score` 必须命中真实逻辑输出正文，
  保留权威拼写和原来的未解析 DTO 提示。
- 空查询、无结果、方法/DTO 锚点、语言切换、旧深链及原 Data Model 入口回归。
- 单独负向场景在索引请求处延迟真实文件以观察 loading，再返回明确无效索引，
  确认错误状态；重试实际读取同一候选真实索引恢复。这个故障注入不作为业务
  API 证据，也没有使用假成功结果。
- 四个正常场景 console/pageerror、HTTP 错误、失败请求和外网尝试均为空；
  错误恢复场景没有浏览器异常，所有请求均为本地 GET 且不含查询文本。
  手机侧栏实际边界为 `[0, 280]`，视口宽 390，无侧栏水平溢出；截图已复核。

### 待决策/阻塞

本批只补正文检索，不增加 API Try It。B03 的真实权限执行、Development 浏览与
完整业务角色仍开放；L03 两处 DTO 声明、一个嵌套字段来源、运行 mapper/
序列化及实际应用嵌入仍开放。搜索能找到未解析说明不等于补齐了缺失来源。

## 当前产品原生生命周期批次

新增独立 `plm-e2e/playwright.current-owned-product.config.ts`、
`tests/current-owned-product-lifecycle.spec.ts`、`current-owned-product-helper.ts`
及 `current-owned-product-cleanup.spec.ts`，不改旧共享 helper/config。
只通过正常 UI 登录取得原生应用请求头，严格检查 appdata 的账号、system、组织；
每次写入前保存不可覆盖并 fsync 的运行标记/操作记录。清理只允许精确标识、
完整名称和已记录 ID 对应的产品；成员记录还必须有相同 `product_id`。
受控身份、清理和有限等待测试 **6/6**；测试列表能解析双语桌面项目。

当前真实执行保留以下不同批次，不把工具或业务失败覆盖为通过：

| 批次 | 实际观察 | 结果边界 |
| --- | --- | --- |
| product r1 | 正常 PLM 请求使用 `ibizplm`，appdata 返回 `ibizmodeling`，严格 gate 阻止写入 | 无产品创建；旧 helper 收尾等待超时另留证，后补有界等待 |
| product r2 | 主线修复现存代理后，采集器对静态响应 `allHeaders` 有未完成等待 | 无产品创建；后改浏览器请求头快照，静态资源丢失原 body 时仅同 ETag 条件读回并单独记来源 |
| product r3 | 新正常登录的账号/system/org gate 通过，UI 两步产品向导创建时 HTTP 500；产品/默认成员却已持久化 | 真实业务失败；前端报“发送消息发生异常，数据库执行异常”，不继续建立新数据 |
| cleanup r2 | 由原私有失败回执恢复精确运行标记，正常新登录后查到该产品；先前 member DELETE 500 实际已移除成员，随后仅删除该产品 ID | 产品 active/archived/deleted 列表及 own `product_id` 成员查询全部验空；仅清理 **1/1**，不是功能通过 |

主线通过真实后台日志将四字节字符失败定位到平台消息队列
`ibzmsgsendqueue.DDCONTENT` 的旧字符集；本线不写共享 SQL，也不移除 Unicode
取得绿色结果。产品状态迁移、新会话持久化闭环和全部中英文/角色矩阵尚待
该前置修复后的新批次；当前只完成了原生失败与清理证据。

原失败数据唯一标记为 `CP-fa3ac974-de9c-4c62-a2eb-d8eee53ac234`，
产品 ID `2ec34ed1-e44f-9a37-bd8b-ce6420c6e4fd`，
原成员关系 ID `26cf7162d26cc14f69a0fb5c161a6a4e`。
cleanup r2 的回执为
`.artifacts/current-owned-product-cleanup-20261122-r2/test-results/current-owned-product-clea-a3639-duct-and-membership-absence-current-product-zh-desktop/cleanup-evidence.private.json`，
SHA `39014df7d2eba0c6cc609f4f4fdee997c746c7570628493e180229c96e5b15b5`。
清理保留了原预登录 Navigation aborted console，`featureAcceptance=false`，
没有将 raw 异常丢掉或把列表验空冒充产品生命周期成功。

账号使用主线本轮已验证的现存管理员私有输入，其旧账号基线标为 super；
本线没有将它标为普通成员或只读角色，没有创建替代身份、额外容器或安装新镜像。

### 2026-11-23 私有守卫候选后续

平台消息字符集窄范围修复后，真实 Unicode 创建已不再返回原通知 500。
共享 product r6 完成产品全部正向生命周期和精确产品/成员清理，HTTP、
pageerror、requestfailed、采集错误均为 0，但仍因实际加载的旧框架预登录
Navigation aborted 保持总结果 FAILED，没有过滤该错误。

随后仅在私有 loopback HTTP origin 准备 17 文件守卫覆盖包，保留原服务其他字节、
知识模型及插件；r7 中文桌面和 r9 英文桌面/中英文手机均完整产品闭环 PASS，
每格两次正常登录、Unicode 编辑刷新与独立会话回读、UI 归档/删除、
原生激活/恢复及产品/成员精确清理，全部 raw 错误计数为 0。
English 归档仍显示错误动作标签 Archived Products，回执保留 mismatch。
没有据此声称完整本地化、角色矩阵、通知 UI 或共享发布完成。

覆盖输出、3231 个实际静态依赖、10 个动态边界、3 个继承 CSS 资源 404、
历史单体源码差异、四格 SHA 和拟议回滚输入详见
[PLM-GUARD-OVERLAY-20261123.md](PLM-GUARD-OVERLAY-20261123.md)。
私有预览按主线明确要求保留供审核，浏览器 worker 已退出；未再新建数据集。
