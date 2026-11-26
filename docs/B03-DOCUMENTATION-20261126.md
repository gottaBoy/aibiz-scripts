# B03 文档搜索输入法修复

检查点：2026-11-26，Asia/Singapore。范围为本地静态 Docsify 文档 UI，
不执行认证、业务 API 或共享服务操作，不关闭 B03/L03 顶层项。

## 手册要求

Development/API Reference 不在 PLM 手册的 125 页目录内，需要独立验收。
双语输入、搜索、深链接、刷新、移动端和错误恢复必须在实际页面验证；
本地静态文档与真实应用嵌入、API 执行及权限是不同证据范围。

## 本地实现观察

现有搜索框把所有 Enter 都交给首条结果链接。中文输入法确认候选时也会产生
Enter，可能在文字尚未输入完成时跳离当前文档。`aibiz-api-reference.js`
现在记录 composition 生命周期，并检查 `KeyboardEvent.isComposing` 及兼容
keyCode 229；组合状态的按键交由浏览器处理，组合结束后按最终输入重新检索。
普通 Enter 和 ArrowDown 保持原来的搜索导航行为。

本轮开始前的源码、既有未提交差异及 SHA-256 已私有封存于
`.artifacts/b03-documentation-20261126-r1/`。此前正文搜索、查询保持、
加载/错误/重试和样式改动属于已有工作树，本轮未冒领为新增实现。
本轮没有修改 CSS、HTML、词典、模型、DTO 声明、共享 dist 或 Docker。

## 当前版本验收证据

定向渲染测试运行实际搜索脚本，通过受控 DOM 事件分别验证 composition
生命周期、`isComposing` 和 229。三个场景在修改前均误触发导航；最终脚本及
两应用文档集成定向测试 16/16，通过组合态拒绝跳转和普通 Enter 首条导航。

```sh
node --test scripts/tests/api-reference-search-ui.test.mjs
node --test scripts/tests/api-reference-search-ui.test.mjs \
  scripts/tests/localized-api-documentation.test.mjs \
  scripts/tests/local-documentation.test.mjs
node --test scripts/tests/localized-api-documentation.browser.mjs
```

浏览器用实际本地 Docsify 和权威生成 Markdown/搜索索引，覆盖中文/英文与
桌面/手机四格，并通过错误索引/重试场景；包含父测试合计 6/6。
四格的 console/pageerror、HTTP 错误、失败请求和外网尝试均为零。
深链接、刷新、语言切换、正常 Enter 跨实体跳转以及原 Data Model 返回均通过。
已检查桌面、手机与错误恢复截图，侧栏和内容无整体横向溢出。
输入法事件验证为受控 DOM 事件，不能声称操作系统输入法或真实设备输入已验收。
浏览器/context/临时静态服务器由测试钩子关闭，Node 进程正常退出。

最终私有回执：
`.artifacts/localized-api-docs-browser/probe-1da09cdf-40c2-4996-a781-0879b93a8071/report.json`，
SHA-256 `565fae8d5eef4b2663108552a1b8e8ae59e42818316cc97dbecbce79a2081b6f`。
生成 manifest SHA-256：
`15090a00443f549a4874f0afd3c860a1195d513347a2bfb5447b7ac9d657a299`。
实际候选包含 365 个生成文件，重复生成全部相等。

11 份执行源码/UI 输入已在运行前以 0600 封存，运行后逐一核对当前和快照哈希；
184 个生成输入也在事后全部核对。执行快照 manifest：
`.artifacts/b03-documentation-20261126-r1/execution-r3/manifest.private.json`，
SHA-256 `47dee65f87a37e4d2e5cbef31c2e9fb9941a7b19cf38d3901375a02d4f32608f`。
最终搜索脚本 SHA-256：
`54f763adb85f01fd140975ea7c4cfeb0d596e4550e9e8ffc757971c51dcd5d34`；
浏览器 runner SHA-256：
`2a8b4e14a8ea447a3c54521059ddfc75cbeeaa9c85d8661a4688b02d4c7205ae`。

这份浏览器回执绑定当前工作树输入，包括两份此前已有差异的模型，不声称全部
来自 HEAD。独立 L03 导出改用 184 个已提交输入加本轮冻结生成器/词典，
重新生成 365 文件，其中除 manifest 外 364/364 与本次实际服务内容逐字节相同；
两份旧模型差异未纳入本轮提交。该独立复验不修改本次原回执的 manifest。

此前两轮失败保留：

- `probe-b4bf709c-aff0-44b7-82f1-66be06fdd8c8`：Happy DOM 支持但 Chromium
  不支持输入框 `oncompositionstart` DOM 属性，组合生命周期未生效；
  真实浏览器门阻止通过，最终改用 `addEventListener`。
- `probe-338290bb-499e-4a71-8ba9-f657e9bdd571`：三个组合态检查已通过，
  但 normal Enter 的首结果正是当前实体页，不能据此证明发生导航；
  修正测试为真实跨实体查询后才取得最终通过，不放宽门槛。

## 待决策/阻塞

完整 B03 的真实应用宿主嵌入、实际 API 正反向和角色权限仍开放。
L03 缺失 DTO 来源、运行 mapper/序列化等门槛不由本次搜索输入修复关闭。
