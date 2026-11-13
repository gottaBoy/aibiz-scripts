# PLM 手册学习与 Agent 工作入口

整理日期：2026-11-14，Asia/Singapore。

## 范围与证据

来源是用户指定的 [PLM 官方使用手册](https://wiki.ibizlab.cn/plm/)，共享根 ID
为 `plm_space_user_manual`。2026-11-13 23:56 +08:00 的公开共享会话快照覆盖
125 页，全部选择 `publish_content`，没有使用未发布草稿。请求失败、未索引的目录内
链接、空白叶子均为零。正文提取长度为 53,042（JavaScript UTF-16 码元计数）；
801 处图片引用对应 800 个不同图片地址（按 `src` 去重，未比对图片字节）。
**全部正文、标题和表格已分工阅读；800 张图片没有逐张视觉核验。**

这套文件是改写的工作规则和验收依据，不是手册全文镜像，不是本地功能完成报告。
索引的 `reportedVersion` 来自源服务当前版本字段，不能直接当作发布版本号。
发布时间与更新时间保留源字符串，其时区未由源服务明确。

| 文档 | 覆盖 | 用途 |
| --- | --- | --- |
| [WORKSPACE-AGENTS.md](WORKSPACE-AGENTS.md) | 工作区级规则 | 根 `AGENTS.md` 的受版本管理副本 |
| [PRODUCT-PROJECT.md](PRODUCT-PROJECT.md) | 产品 18 页、项目 43 页 | 需求、工单、客户、项目类型、工作项、冲刺、基线、工时、容量 |
| [TEST-KNOWLEDGE.md](TEST-KNOWLEDGE.md) | 测试 31 页、知识 11 页 | 用例版本、评审、执行、报告、草稿、锁定、分享、空间权限 |
| [ADMIN-INTEGRATION-METRICS.md](ADMIN-INTEGRATION-METRICS.md) | 管理 10 页、集成 1 页、度量 6 页、协作 4 页 | 组织权限、配置、公式、主题讨论、钉钉和企业微信 |
| [CHAPTER-INDEX.md](CHAPTER-INDEX.md) | 全部 125 页 | 逐章路径、页面 ID、指南映射、正文与图片数量 |
| [chapter-index.json](chapter-index.json) | 全部 125 页 | 原始已发布 HTML / 提取正文 SHA-256、父子结构、源元数据 |
| [VALIDATION-BACKLOG.md](VALIDATION-BACKLOG.md) | 跨领域 | 多角色验收顺序、待核实差异、手册外能力和待补证据 |

根手册页介绍产品矩阵和帮助入口，本文件承担该页覆盖。协作空间概述提到目标管理，
但详细章节主要是主题/讨论，不能由此推断已给出完整 OKR 规则。Development、
API Reference、Data Model 和 Modeling IDE 不在这棵手册目录内，仍需独立规格和验收。

## 使用方法

1. 先读工作区 `AGENTS.md`，再按任务阅读对应领域指南。
2. 根据章节 ID 查索引，区分手册规定、代码位置和运行证据。查到源码文件不等于验收通过。
3. 用角色全流程执行正向和拒绝场景，再核对持久化、关联、版本、统计与清理结果。
4. 手册标 TODO、开发中、描述矛盾或未定义的边界，保留待决策状态，不自行冒充官方行为。
5. 将问题与原任务矩阵关联，附当前代码/模型/静态产物/镜像与挂载输入版本，再更新状态。

工作区根不是 Git 仓库。根 `AGENTS.md` 已在本机安装；受版本管理副本位于
`scripts/docs/manual/WORKSPACE-AGENTS.md`。迁移工作区时将此副本安装到同级各仓库
的公共根；变更规则时同步两份，测试在根文件存在时要求字节一致。不要初始化新的根仓库，
不要为提交文档而批量暂存其他子仓库。

## 可重复核对

在 `scripts/` 下执行，不访问数据库或 Docker：

```sh
node --test tests/plm-manual-reference.test.mjs
node prepare-plm-manual-reference.mjs ../.artifacts/plm-manual-study-20261113-r1/attempt-2/manual-index.private.json --check
git diff --check
```

第二条需要本机的私有抓取结果；CI 和其他机器可只运行第一条，校验受版本管理索引、
完整章节覆盖、来源元数据、文档链接和指南一致性。要刷新索引，先重新抓取公开共享目录，
复核变更章节后去掉 `--check` 生成。生成器只导出允许的结构/哈希字段，不导出正文、
图片二进制、令牌、Cookie 或原始请求响应。覆盖测试证明索引一致，不证明业务行为正确。

原始页面 JSON、浏览器轨迹、共享会话头、截图和全文提取保留在私有
`.artifacts/plm-manual-study-20261113-r1/`，不得提交。不要将共享会话令牌当作业务账号
或管理凭据。本文档任务不启动验证容器、不构建镜像、不运行可能拉起服务的全量测试。

<!-- manual-source-ids:start -->
```json
["plm_space_user_manual"]
```
<!-- manual-source-ids:end -->
