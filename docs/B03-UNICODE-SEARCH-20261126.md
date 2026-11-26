# B03 Unicode 搜索摘要

检查点：2026-11-26，Asia/Singapore。本批只修文档搜索摘要，
没有改模型、词典、字段代码、API 路径、持久化值或共享服务。

## 手册要求

中文、补充平面字符、emoji 和组合字符应无损显示与往返。
搜索用的归一化形式与用户看到的原文分开，不用归一化字符串的位置直接截取原文。
Development/API Reference 属于独立能力，静态 UI 不替代真实宿主/API/角色验收。

## 本地实现观察

修改前实际复现两类错误：

- 摘要在 `normalize(body)` 上找到 UTF-16 位置，却在原始 body 上切片。
  `ﬃ` 的 NFKC 扩展、`e` 加组合重音的收缩和 `İ` 的小写扩展都会改变长度，
  结果摘要不再包含已匹配的 `needle`。
- 180 个 UTF-16 单元的硬切片会切开 emoji 的代理对，或留下缺失重音的 `e`。
  多码点 `👩🏽‍💻` 同样会被截断。

现在用标准 `Intl.Segmenter` 按字素分段，累计各段归一化后的长度定位原文，
再显示最多 180 个完整字素。匹配仍使用既有 NFKC/小写规则，
显示保留 `ﬃ`、组合重音及其他源文字，不把原文替换成归一化结果。
没有新增分割库或手写 Unicode 分段器。

缺少 `Intl.Segmenter` 或整个 `Intl` 的环境明确降级：
短 body 原样完整显示，超过 180 个 UTF-16 单元的 body 不生成摘要；
结果标题、链接、检索和回车导航仍工作。降级分支不做有损切片，也不展示无界长正文。

修改前的源/测试和独立差异封存在
`.artifacts/b03-unicode-search-20261126-r1/`，没有覆盖前一批 IME 回执。

## 当前版本验收证据

```sh
node --test scripts/tests/api-reference-search-ui.test.mjs
node --test scripts/tests/api-reference-search-unicode.browser.mjs
node --test scripts/tests/localized-api-documentation.browser.mjs
```

- 定向实际脚本渲染 **17/17**：三个原有 IME 场景、三种长度变化、
  单码点/ZWJ emoji/组合重音，以及缺少 Segmenter/Intl 的短长正文。
  六个新增错误场景先在旧源复现，再由修复通过。
- 实际本地 Docsify Unicode 专项：中英文桌面/手机四格，
  外加桌面/手机的无 Segmenter、无 Intl 四格；含父测试 **9/9**。
  这是明确的静态文档 UI fixture，不是实际业务或 DTO 运行证据。
- 权威文档再验：中文/英文桌面/手机、真实方法/字段/DTO 深链接、
  刷新、正常回车、IME 组合态、查询保持和错误重试；含父测试 **6/6**。
  365 个生成输出重复生成相等。此回执绑定当前工作树，不声称全部模型来自 HEAD。
- 两组浏览器的 console/pageerror、失败请求、HTTP 错误及外网尝试均为零。
  桌面/手机摘要和降级截图已查看；文档没有整体水平溢出。
  浏览器/context/私有静态服务器均在测试退出前关闭。

Unicode 专项报告：
`.artifacts/documentation-unicode-browser/probe-847a3e47-7f54-4df7-9198-9b428d317012/report.private.json`，
SHA-256 `2d27bcb36b40c643cdbb3efea9137d814c3acc306a643f193d9f9aa5c1cf96f7`。

权威文档报告：
`.artifacts/localized-api-docs-browser/probe-c0404df0-ba85-4d67-8da7-7d4bf01c61d8/report.json`，
SHA-256 `a171dd23999f6d1b1f54eafcaf27a3e7445a6dee2bfdd77572ca5399d8561381`；
生成 manifest SHA-256
`7ba25deac4ce7aaca94251f6c63b785941c0c7871f9b98343a08fc578519bf79`。

执行前封存 12 份源码/UI/词典/runner 输入，执行后逐项校验当前与快照哈希，
184 个权威生成输入也全部事后核对。执行快照 manifest：
`.artifacts/b03-unicode-search-20261126-r1/execution/manifest.private.json`，
SHA-256 `fe3e9aa86a51152d50938d3c5b7af0ceee6e1b7a90195a5d9b618330011f0687`。
最终搜索脚本 SHA-256：
`dfa5755bfbeb8b2951f7a3cca90961efd448584adaa337d3114876ad58031873`。

主线另用本轮词典从 Git HEAD 导出 184 个输入，未携带两份旧脏模型，
独立生成 365 文件；除 manifest 外 364/364 与本次权威候选一致。
本轮独立报告 `.artifacts/documentation-followup-closure-20261126-r1/report.private.json`，
SHA-256 `092d0519d6b2e12ddbb77374971b21710b7c71badbbc5217d1c41f438b0329d7`；
干净 manifest SHA-256
`c702697ddf10178181e095df1a85f071388bd64b54c5d18b4408779ac0082ff2`。
它与上文工作区 manifest 分别保留，原浏览器回执不改写。

## 待决策/阻塞

B03 完整宿主嵌入、真实 API 正反向及角色验收仍开放。
操作系统 IME、真实手机硬件、完整 Unicode 库/平台矩阵没有由受控 DOM 事件替代。
本批没有扩大到生成器、原始 Markdown 与 HTML 特殊字面量的全文索引格式转换。
