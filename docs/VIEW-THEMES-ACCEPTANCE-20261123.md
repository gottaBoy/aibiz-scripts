# 视图分组配置验收

检查点：2026-11-23。F06、完整本地化及多角色权限验收保持未完成。
此文区分视图分组目录与个人 `customtheme / menu / dynafilter` 文件夹。
本轮没有重复系统登记、数据库迁移或 Nginx 修复，没有创建或重启容器。

## 手册要求

管理与集成指南要求区分个人、对象和系统共享作用范围，不能将管理员登录、
页面打开、空数组成功或按钮可见视为持久化与权限验收。
中英文、刷新、深链接、新会话及 Unicode 无损读回分别需要当前版本证据。
工作区多角色矩阵还要求普通、只读、非成员及跨组织身份，管理员单账号不能替代。

## 本地实现观察

`SearchBarService` 的 PLM 入口为 `/extension/app_view_themes`。
正常 `SEARCHBAR2` 搜索栏以视图 `codeName.toLowerCase()` 为 `app_view_tag`：

| 用户操作 | 浏览器路径 | 原生路径及权限 |
| --- | --- | --- |
| 加载当前用户与共享目录 | `POST .../fetch_cur_user_all` | `/extension/api/app_view_themes/fetch_cur_user_all`，READ |
| 选择已保存分组 | `GET .../{id}` | 同一用户级 API，READ |
| 新建个人分组 | `POST .../app_view_themes` | Create，CREATE |
| 保存筛选、排序及列配置 | `PUT .../{id}` | Update，UPDATE |
| 删除个人分组 | `DELETE .../{id}` | Remove，DELETE |

源模型 `AppPersonalization/app_view_theme.json` 使用 `APP_VIEW_THEME`，
不是 Conf 使用的 `IBZCFG`。`cur_user_all` 合并两组条件：

- `cur_user`：`CREATE_MAN = srfuserid` 且 `SYSTEM_TAG = srfdcsystemid`。
- `cur_system`：`OWNER_TYPE = SYSTEM` 且同一 `SYSTEM_TAG`。

普通 cloud 用户源角色关联 `CurUser`，管理员角色关联 `ALL`。
这些是源授权关系，不证明任意当前普通账号已经获得共享目录读取或个人写入能力。
对象内的“只读成员”也不能自动解释成个人偏好写入被禁止，需分别验证业务合同。

原生 Create 的 `OWNER_TYPE` 默认 `PERSONAL`；建立人、更新人和时间由原生预定义字段处理；
`SYSTEM_TAG` 从当前会话的 `srfdcsystemid` 取得。GUI 只传名称、标题、应用与视图标记，
不补造创建人、系统或角色。保存正文 `theme_model` 包含筛选、排序及列状态。

## 当前版本验收证据

只读探针及测试：

- `scripts/probe-existing-plm-app-view-themes.mjs`
- `scripts/tests/probe-existing-plm-app-view-themes.test.mjs`

修复前 r1：网页返回 200 空数组，真实原生目录返回 4 条 SYSTEM 配置，
个人目录为 0；匿名网页仍 200，原生为 401。对应物理同系统、同视图计数为
4 条共享、0 条当前用户记录。原生表的文字列当时仍为 `utf8`。
r1 报告 SHA-256：
`914277bfde3e76db6046c620d51e639b9e7beedb01134f45e78fa56ce5976e6e`。

主线完成精确路由和独立表迁移后，r2 同一真实账号、同一实际 `appdata` 上下文：
网页与原生均返回相同的 4 条 SYSTEM 记录，个人为 0，匿名双端均 401，
文字列均为 `utf8mb4`。源 Nginx 与运行配置均识别为精确用户级 API 代理。
没有将合法为空的个人数据集解释成完整能力。

```sh
node scripts/probe-existing-plm-app-view-themes.mjs \
  --output .artifacts/plm-app-view-themes-readonly-20261123-r2
node --test scripts/tests/probe-existing-plm-app-view-themes.test.mjs
```

r2 报告 SHA-256：
`e86ce1a085fdea6e2b98960cc81aa4ee7d4d03606828b68ffa0ec9914b8ac301`。
完整元数据回执 SHA-256：
`e121df1a00140f9175ea6a31e5f2483b83f0468297937adb7767c2fe4af1603a`。
探针测试 8/8 通过，未执行配置写入。

### 已保留的 GUI 失败

`plm-e2e` 新增独立 spec/config，未修改产品或知识 helper：

- `tests/current-owned-app-view-themes.spec.ts`
- `playwright.current-owned-app-view-themes.config.ts`
- `config-tests/current-owned-app-view-themes.test.mjs`

中文桌面只读 r1 正常登录后到达真实产品列表，但误以为点击行会打开产品主视图。
回执保留失败；之后按源码 `product.open_new` 的正常“新窗口打开”按钮监听真实 popup。

只读 r2 已正常进入产品 popup 与 `idea_all_grid_view`，并观察到认证目录 POST
及单条 GET；测试在异步 JSON 回填前检查了空数组而失败，未完成管理弹窗、
刷新或新登录阶段。不得将此次失败重新标为通过。
r2 报告 SHA-256：
`4ffdde3681741dceda25b63fdcd6df9fb25ca382c521df9756fe72d5bf8d39fa`。
两轮记录均未捕获主题 Create/Update/Delete，清理为 `not-required`，运行态不变。
正常浏览可能产生 RECENT 等自动访问记录，本轮没有独立核查其全部副作用。

两次运行前分别封存 15、16 份原始 source/spec/config 私有文件，
使用独占 `wx`、文件及目录 `fsync`：

- r1 manifest：`44d526299d11b475e34c170e55f466c1066cfd2dc839d35086437c239cad166d`
- r2 manifest：`a5ef7612197e29387440a4cd7e6af99e645bd56fa6322a05d682ff10716e9a81`

### 本轮离线修复

修复前四份工具/spec/config 原始快照保存在
`.artifacts/view-themes-offline-implementation-20261123-r1/`，
manifest SHA-256：
`637aad87f7d78c5baa4e87cc58bf3c1079c48b19c2dc6be35dc3e0a23030eaa1`。

GUI 使用 `ViewThemeDirectoryGate` 等待同一页面、认证 POST、
精确 `app_view_tag=idea_all_grid_view` 的真实响应完成 JSON 解析。
请求开始时记录序号并绑定原始 Request；刷新、新登录及删除后分别要求新请求的解析结果，
刷新前在途请求的迟到响应、旧数组、其他 popup 或其他视图不能满足。
HTTP 错误、解析错误及超时保留失败；未用固定 sleep、controller 注入或 forced click。

可写模式仍默认关闭，需主线释放 UI 窗口后显式启用：

```sh
PLM_CURRENT_VIEW_THEMES_WRITE=1 \
PLM_CURRENT_VIEW_THEMES_WRITE_GATE=native-route-and-exact-theme-table-utf8mb4-verified \
./node_modules/.bin/playwright test \
  -c playwright.current-owned-app-view-themes.config.ts \
  --project=view-themes-zh-desktop
```

流程仅操作本轮唯一标记的 PERSONAL 分组：正常 UI 创建 -> 选择/原生 GET ->
正常保存 -> 刷新后 GET 对比完整配置 -> 新正常登录后再对比 ->
正常删除 -> 新目录响应与独立页面刷新均确认缺失。
任何删除前核对真实 ID、完整名称与标题、PERSONAL、视图、系统及建立人。
创建返回失败后仍通过正常刷新识别是否已持久化；未知或有歧义时保留阻塞，
不删除 SYSTEM 或其他用户记录。源码快照在每次 GUI 开始前再次独占写入并同步落盘。

以上为修复前检查点，原失败回执保留。后续中文桌面写入 r1 已完成创建、
保存、刷新、新登录和原生 DELETE 200，但 runner 对合法空 DELETE 响应
调用 JSON 解析而失败；不把这一失败改记为通过。独立只读 r3 确认网页与原生
均为四条 SYSTEM、零条 PERSONAL，匿名双端 401，文字列仍为 utf8mb4。

随后修正仅 DELETE 可接受空响应、GET/POST/PUT 仍须合法 JSON 的解析门；
确认删除成功即清除待删状态，再独立核对缺失，避免读回失败时重复删除。
中文桌面写入 r2 **PASS-normal-ui-owned-theme-lifecycle**：
正常 UI 新建唯一 Unicode PERSONAL 分组、保存、刷新及新正常登录后完整配置读回，
再正常 UI 精确删除，独立刷新后的新目录确认缺失；四条 SYSTEM 未被改写。
console、pageerror、HTTP、requestfailed、capture 五类原始错误均为零，
13 份源码输入已封存，运行身份与输入检查保持一致。

当前回执位于
`.artifacts/current-owned-app-view-themes-20261123-write-r2/test-results/`
对应中文桌面项目的 `view-theme-evidence.private.json`，
SHA-256：
`04bac2f22cb4c02a778c2aa0f8a5d12e6b903d44efa8cc9775c4174982bcb268`。
这是当前管理员的中文桌面个人分组闭环，不能代替其他语言、移动端、
跨用户/组织、共享写与撤权矩阵。英文四条系统标题仍有中文源数据覆盖风险，
不改数据库标签来掩盖本地化缺口。

后续写入 r3 尝试英文桌面及中英文手机，显式 `--max-failures=1 --retries=0`。
首个英文桌面正常登录并读取产品列表后，打开既有产品的真实 GET 返回 500，
页面未完成加载，因而未出现需求 tab；没有触达分组 CRUD。
三条原始 console error 和一条 HTTP 500 保留，清理为 `not-required`；
两个手机项目未运行，不能按跳过计为通过，也未改选择器或换产品来掩盖失败。
英文失败回执 SHA-256：
`5c04432a9e29f8490bf9c086917b2b08742df3b329e5d020a755a0cae6a37f1b`，
位于 `.artifacts/current-owned-app-view-themes-20261123-write-r3/test-results/`
英文桌面项目的 `view-theme-evidence.private.json`。

离线定向验证：

```sh
cd plm-e2e
node --test config-tests/current-owned-app-view-themes.test.mjs
./node_modules/.bin/tsc --noEmit --target es2023 --module commonjs \
  --moduleResolution node --esModuleInterop --skipLibCheck \
  --typeRoots ../ibiz-app-hub/node_modules/.pnpm/@types+node@20.19.1/node_modules/@types \
  tests/current-owned-app-view-themes.spec.ts \
  playwright.current-owned-app-view-themes.config.ts
```

响应门、归属与空 DELETE focused 测试 6/6、探针测试 8/8、
手册引用测试 10/10 分别通过，
类型检查通过。这些离线结果不会升级 GUI、真实权限矩阵或 F06 状态。

## 不同真实用户的前置

本轮只读取私有文件和管理源码，未调用正常业务 HTTP、未登录其他账号，
未创建用户或修改角色。

当前已用的私有业务凭据文件为 owned、600 regular file，声明管理员；
该声明本身不是服务器角色证明。历史目录存在 71 份有效非管理员 manifest，
全部标为 `sql-candidate-only`，使用各自 `nf_<run>_*` 隔离 schema；
包含 editor/viewer/no-access，但没有本轮共享 PLM 登录与成员读回。
不能把它们变成当前普通、只读、非成员或跨组织回执。
脱敏私有盘点 SHA-256：
`db99f17f9b2874a95e7cc2c89a7cc7ef2c79c8c642aff9da531fe7be34e10bd6`。

正常管理来源为 UAA 的 `POST /sys_people`、`POST /sys_role_members`、
相应 GET/DELETE，分别具有 `ROLE_SUPERADMIN` 或明确实体授权条件。
`SysPersonServiceImpl.create` 处理密码存储并初始化基础 `ROLE_USERS`，
Remove 会移除人员关联和角色关联并按原生逻辑删除语义处理人员。
现有导出脚本仅提供历史账号列表，其简化 UID 关联不能替代当前原生授权和租户核对。

后续需要分别准备并验证：

| 身份 | 真实前置及验收 |
| --- | --- |
| 普通成员 | 正常平台管理创建最小自有用户及基础角色；正常登录；从当前 appdata 取得真实 user/system/org；独立成员读回 |
| 只读成员 | 在具体自有对象的正常成员入口赋其只读角色；业务写拒绝与个人分组合同分别验证 |
| 非成员 | 第二个正常账号没有目标自有对象成员关联，仍需证明其合法组织身份；不得伪造人员请求头 |
| 跨组织用户 | 第二组织真实成员与当前组织/对象读回；目标关联与目录不能越域 |

不将现存共享服务 client 改成测试角色，不给普通账号附加
`ROLE_APIUSERS / ROLE_SUPERADMIN`，不使用 SQL 夹具插入账号或关系。
新增真实用户的角色、口令私有保管和精确原生清理需先完整准备，
然后由主线在独占窗口中执行。

后续只读 [运行 classpath 核对](NATIVE-ACTOR-CONTRACT-20261123.md) 已确认
19 个选定实际类的 CRUD/DTO/密码及删除依赖与维护源码合同匹配，267 个 JAR 前后稳定。
这不等于完整源码等价、当前配置、管理员权限或身份建立通过；
三个候选继续 NOT_CREATED，未作为 GUI 登录凭据使用。
最新 [HTTP 前置](NATIVE-ACTOR-HTTP-PREFLIGHT-20261123.md) 仅确认正常登录、
Bearer subject 与三个已声明配置读取；原生 prefix、password mode、
管理权限及组织普通角色均未闭合，未发送原生账号请求。
