# B03 可见文档文本检索

检查点：2026-11-26，Asia/Singapore。范围为静态 Docsify 搜索显示，
没有执行认证、业务 API、Docker、共享发布或数据库操作。

## 手册要求

双语、Unicode 和标点应按页面实际可见内容检索，不能要求用户输入 HTML 实体编码。
Development/API Reference 独立验收；模型/DTO 声明、静态页面和真实业务 API
不是同一证据。搜索原始正文需继续绑定生成来源，不伪造 DTO 字段或新 schema。

## 本地实现观察

通过合法的服务实体、方法返回 DTO、字段标签与 `jsonFormat` 源 fixture，
调用实际 `createApiReferenceContract` 和 `renderApiReferenceFiles` 生成中英文文档。
页面显示 `alpha&beta|gamma` 正确，但旧搜索索引使用生成 Markdown 中的
`<code>` 和数字实体串，输入真实字符时没有命中 DTO。中英文桌面/手机四格
均实际复现，旧失败报告保留，没有把纯字符串单元测试代替浏览器复现。

客户端现在用已随 Docsify 发布的 `window.marked` 和新的标准 Renderer，
将正文解析到不插入页面的 `template`，移除 script/style/noscript/template
节点并保留块、表格和换行的文本分隔。派生 `displayBody` 同时用于归一化检索
和摘要；结果仍通过 `textContent` 显示。原始 `entry.body`、搜索 schemaVersion、
来源哈希、字段代码、DTO、URL 和生成器均未改变。

没有引入新的 Markdown 或 DOM 依赖。缺少本地渲染器时显示既有索引错误和重试，
恢复渲染器后重试可以正常加载，不静默退化为空索引。
前批 IME 保护、字素摘要和缺少 Intl 的明确降级保留。
解析结果复用当前页面的语言索引缓存，不在每次按键时重新解析 Markdown。
本批没有采集索引就绪延迟或进行性能、完整平台基准。

## 当前版本验收证据

```sh
node --test scripts/tests/api-reference-search-ui.test.mjs \
  scripts/tests/localized-api-documentation.test.mjs \
  scripts/tests/local-documentation.test.mjs
node --test scripts/tests/api-reference-rendered-search.browser.mjs
node --test scripts/tests/api-reference-search-unicode.browser.mjs
node --test scripts/tests/localized-api-documentation.browser.mjs
```

- 定向实际脚本、已发布 Markdown 解析器及两个文档集成 **32/32**。
  测试核对 raw Markdown 未变、实际 DTO 字面值命中、摘要不含编码串、
  隐藏脚本/样式不进入检索，以及渲染器错误后重试恢复。
- 合法模型生成的特殊值四格实际 Docsify **5/5**（含父测试）。
  页面 DTO 的 9 列、原字段标签与格式值逐字校验；
  `&`、`|`、反引号、星号、下划线、方括号及英文标签均可按可见字符检索。
  格式值中的 HTML 样文本仍是文字，不产生 img/script 元素、
  额外 `/never-load.png` 请求或脚本 marker。
- 前批 Unicode/Intl 降级八格 **9/9**；权威文档双语桌面/手机与错误恢复
  **6/6**。原 IME、方法/DTO/字段深链接、刷新、查询保持和回车导航均保留。
- 三组 browser 的 console/pageerror、失败请求、HTTP 错误及外网尝试均为零。
  已查看中英文桌面/手机结果截图，无整体横向溢出。
  浏览器、context 和临时静态服务器在 Node 测试退出前完成清理。

| 回执 | SHA-256 |
| --- | --- |
| 特殊格式四格失败 `documentation-rendered-search/probe-7457ba98-a49b-4dc0-8981-fb10317c0c97/report.private.json` | `5312580f5014765622c4802cb1d0eb3eb76a00921d230fd8763d7b2de87606f6` |
| 最终特殊格式四格 `documentation-rendered-search/probe-ae25591e-df96-4a3f-84a1-fe3587bb856e/report.private.json` | `fa946cb6873d0860f04098f833ce2864e74fb0e7ccdcc8aa839ebc8ac2155be8` |
| 最终 Unicode 八格 `documentation-unicode-browser/probe-7c3bd030-6318-45d4-bbd5-f3d5ff5253db/report.private.json` | `e14327a6fae46170c41fd4c9172329a5eacfe53be96d61641060153d866de9be` |
| 最终权威四格 `localized-api-docs-browser/probe-d050a43a-ce99-4161-85b6-0bb62bf40e33/report.json` | `53477297906844335f437c7df68847ea34b81353511e9629afe4ad50a13913d7` |

以上路径均位于私有 `.artifacts/`。16 份执行源码、测试、fixture 与实际解析器
运行前以 0600 封存，运行后校验当前/快照哈希；184 个权威生成输入也事后核对。
执行 manifest 位于
`.artifacts/b03-rendered-search-20261126-r1/execution/manifest.private.json`，
SHA-256 `d0ac5e40cd2f611dc8ef08fe8db77c39bce107cfe493b6ff3c500cd55d9b030b`。
最终客户端源 SHA-256：
`e9f9b2f5d95805ea430dc4e46064e9abcb0156259a5251b9636aecaae4153b21`。

权威生成 manifest 仍为
`7ba25deac4ce7aaca94251f6c63b785941c0c7871f9b98343a08fc578519bf79`；
生成器和词典未变。原工作树两份既有模型差异继续明确保留：
独立 HEAD 导出的 184 输入已有相同 364 个正文/侧栏/索引字节重建证据，
只有来源 manifest 不同，见 [前批独立重建](B03-UNICODE-SEARCH-20261126.md)。
本批不重写旧报告为全 HEAD 运行，也不将两份旧模型修改纳入提交。

## 待决策/阻塞

这是合法模型 fixture 和当前权威静态文档的显示检索验收；
B03 真实宿主嵌入、API 正反向和角色流程、L03 实际 mapper/序列化仍开放。
没有扩展到任意远程 Markdown、完整 Markdown 插件或操作系统输入法验收。
未接入页面的模板和 HTML 样文本检查只证明本地文档提取行为，不是业务 API 安全验收。
