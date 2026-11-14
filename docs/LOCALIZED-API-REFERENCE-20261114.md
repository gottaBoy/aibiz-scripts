# 双语 API 模型参考接线

日期：2026-11-14，Asia/Singapore。范围：L03 API Reference 文档。

## 接线与边界

两份 `vite-plugins/local-documentation.ts` 接受可选
`generatedFiles: () => Promise<Map<string, Buffer>>`，没有回调时保持旧静态文档行为。
两个 `ibiz-vite-plugin.ts` 注入同一个权威模型生成器，源目录均为 `plm/doc/docsify`。
生成器的模型、英文词条与路由策略另由生成器契约说明，本接线不推测实际 API。

- dev：只在 `api-reference/` 命名空间读取生成 Map；GET/HEAD，同原静态文件的 MIME、
  `no-cache/nosniff` 和路径拒绝规则，未知生成路径返回 404。
- build：先校验生成文件，再复制旧文档快照并追加双语 Markdown、sidebar、搜索与 manifest。
- preview：只读构建快照，不重新调用生成器或读取变化后的源模型。
- 生成 Map 只允许 manifest 及 `en/zh-CN` 的约定文件名/实体代码页，值必须是 Buffer；
  遍历、隐藏项、其他语言、绝对路径、反斜线、非约定文件和非字节值均拒绝。
  构建还检查目标真实路径，不能通过软链接把生成物写到快照外。

这是**模型候选参考文档**，不是完整运行 API 路由目录。权限声明不是授权结果，
模型推导的资源路径与最短父关系路径不是运行 mapper 验收；代码、ID、类型与状态值不翻译。
英文缺少词条时使用技术代码可读化，不代表手册或业务说明已全文翻译。
不提供“执行 API”或在线翻译。

## 生成来源与路由策略

`plm/doc/tools/api-reference.mjs` 从 `model/PSSYSSERVICEAPIS/ServiceAPI.json`
生成365个文件，覆盖179实体、3285字段、2489实体方法和2364关联方法定义；
两种语言包含相同技术字段、方法定义和稳定锚点，不意味着这些方法都已有可调用路由。
不写回源文档目录。必需模型缺失、软链接/硬链接输入、元数据读取期间变化或无效类型均拒绝，
不会退化成部分目录后继续发布。输入输出 manifest 绑定模型、英文词条、生成器及每个输出哈希。
英文词条来自同工作区 `plm-web/src/locale/en.json`，其未提交变化需按 manifest 独立计入，
不能仅用仓库提交号描述当前工作区生成物。

交叉审查修正了关系别名和 URL 集合混用：`space -> article_page` 的关系别名是
`pages`，候选路径采用子实体集合 `article_pages`；URL 集合小写，但保留源集合代码。
生成器保守地只为 `major=true` 展示独立根候选。该标志与默认运行 mapper 的
`aPIMode` 注册规则不完全等价，当前部署 mapper 字节尚未绑定；
不据此新增裸 `/comments`，也不宣称运行端永远没有该根入口。
关联页只选择一种最短可达父路径，不枚举运行通配符的全部变体。
这些边界以双语正文及 `manifest.routePolicy.runtimeMapperVerified=false` 明示。
模型中的输入/返回类型引用不等于逐方法 DTO 字段子集；原始数值类型与布尔元数据严格校验。

生成器聚焦回归 `14/14`：包括关系别名、小写路径、保守 API-mode 边界、全部技术条目、
双语结构、搜索锚、注入转义、确定性、来源哈希与不安全输入拒绝。
初版检查曾漏掉关联代码透传，新增回归失败后补齐；不将旧绿色测试当新路由策略验收。

## Docsify 客户端

`plm/doc/docsify/script/aibiz-api-reference.js` 在本地 Docsify 4 runtime 前注册
真实 `doneEach` 钩子，使用 `createElement/textContent` 构造搜索和语言链接，
不把索引内容写入 `innerHTML`。

- 旧 `/api/ServiceAPI/ServiceAPI` 与旧实体 `deapi/<code>`/`<code>` 深链进入对应双语页。
  显式 URL `language/lang` 优先，其次宿主同源 `localStorage.language/lang`。
- 旧实体自带任意标题锚点落到新实体页；只有已经是新 `op-<hash>` 的锚保留。
  没有声称任意旧中文方法锚均已迁移。
- 已进入双语路径后以路径语言为准。切换中英文保留实体与新稳定方法锚，
  API 页局部更新标题/品牌；离开 API 时恢复旧文档标题/品牌，不改 Data Model 路由或正文。
- 本地 `search.json` 按实体/方法的 label、code、keywords 过滤，最多展示 50 条，
  点击生成的真实页面/稳定方法锚。索引路径限定同语言的安全本地 hash，
  无效/加载失败显示错误；异步过期结果不能覆盖新页面。
- Docsify 实体目录 sidebar 请求被定向到该语言 `_sidebar.md`，不靠失败后的 404 fallback。
- 外网 favicon 已改为无网络资源；本地主题单独补齐，避免只加载补丁 CSS 后内容被长 sidebar
  推到首屏以下。主题由主任务复核，本文不据布局截图宣称其他文档已全面本地化。

## 证据与命令

```sh
node --test scripts/tests/local-documentation.test.mjs scripts/tests/localized-api-documentation.test.mjs
node --test scripts/tests/localized-api-documentation.browser.mjs
```

集成契约覆盖两应用 dev/build/preview、GET/HEAD/拒绝方法、生成路径白名单、Map 字节、
输出软链接逃逸、真实权威生成文件以及旧 Data Model 静态行为。
浏览器用实际本地 Docsify、生成文件与中间件，不启动 PLM/Modeling 服务、不写业务数据：
中英文、桌面/移动覆盖旧实体深链、搜索方法、刷新后锚、语言切换锚、显式查询语言、
旧实体标题锚降级与 Data Model 不变。记录所有 console/pageerror、HTTP 4xx/5xx、
请求失败及外网尝试，不以过滤错误或拦外网后声称零尝试。

本轮结果：原静态文档 4 项 + 新接线 8 项共 `12/12` 通过；浏览器四场景及父项
`5/5` 通过，无跳过。私有回执为
`.artifacts/localized-api-docs-browser/probe-0f59efb8-62aa-4b17-bc16-03b63fb35dab/report.json`，
同目录保存各语言/视口的 `*-api.png` 和移动 `*-sidebar.png`。
四场景 HTTP 4xx/5xx、console/pageerror、请求失败、外网尝试均为空；
主方法标题在视口内，文档无 body 水平溢出，sidebar 为固定布局。移动通过正常侧栏按钮
开关后操作搜索和截图，没有强制点击或 CSS 隐藏。
英文抽样页仅显式“中文”切换器保留中文，不把这项抽样外推为全部业务文本翻译验收。

构建和预览接线测试只写临时目录；没有构建共享 `app/dist`，没有改容器或数据库，
没有替换运行服务字节。真实应用嵌入后的版本、角色、运行路由、权限与 API 执行仍需独立验收。

最初浏览器实测还发现主题缺失与 sidebar 404：页面能找到标题并不代表可读或无错。
现已补充本地 `css/local-theme.css`，修复布局并在表格内保持技术代码完整，
窄屏由表格内部滚动而非撑宽页面。根任务对最终暂存文件另做独立导出重放，
最终回执及提交绑定见 `REMAINING-EXECUTION-20261114.md`。

`plm-web/vite-plugins/ibiz-vite-plugin.ts` 本轮前已有用户的 build-output 修改；
已备份 `.artifacts/localized-api-docs-20261114-r1/plmweb-ibiz-vite-plugin.before.private.ts`，
备份 SHA-256 为 `7a015c17f682a2073bb15159cc02377942d7584a3551654706c40cc842c8193d`。
本轮该文件仅追加生成器 import 和文档回调，未撤销用户修改。
