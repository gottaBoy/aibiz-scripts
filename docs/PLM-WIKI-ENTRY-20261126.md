# Wiki 静态入口与访客前置

检查点：2026-11-26。本轮仅准备私有入口候选，未应用 nginx、未发布静态目录、
未 reload/restart、未创建或登录访客。B01 未关闭，真实入口此前仍为 404。

## 手册要求

[知识规则](manual/TEST-KNOWLEDGE.md) 要求合法匿名访问、密码、过期、撤销、
子集及草稿隔离分别通过当前业务验证。不能用所有者 token、身份请求头、
旧内嵌匿名凭据、宽泛免认证路径或仅开启开关代替验收。

## 本地实现观察

入口资产来自既有私有提取目录
`.artifacts/plm-wiki-static-20261124-r1/dist`，固定 8,787 个文件、
318,317,488 bytes。清单 SHA-256 为
`0adfea566be5ce89245307e44794584b7f3b20ab3e7bc2eb2ad38755f3730c5f`。
不重新运行旧 Wiki 容器、不拉镜像、不从网络补文件。

环境文件使用固定本地 Acorn 解析为单一 `window.Environment` 字面量赋值，
不执行 JavaScript。仅清空旧 `anonymousUser`、`anonymousPwd`，
明确保持 `enableAnonymous=false`。`baseUrl` / `appId` 仍为
`ibizplm__plmwiki`，`BaseUrl` 仍为 `/api`；其他值及 Unicode 原样保留。
可执行表达式、重复键、spread/getter、原型键、额外赋值和命名空间漂移均拒绝。

候选只有 `environments/environment.js` 字节改变，其 SHA-256 为
`5dcb0bf206d8b0217162736965730a1783277eada6c5bd1f9975c5c452f6ac74`。
其余 8,786 文件逐一与原观察哈希一致；没有把解析器或验证二进制放入站点目录。
旧匿名用户名也未出现在其余候选资产中，不发布旧凭据或复用旧身份。

精确部署范围仅为下列位置，当前两个 Wiki 子目录都不存在：

| 输入/目标 | 位置 |
| --- | --- |
| 私有候选站点 | `.artifacts/plm-wiki-entry-candidate-20261126-r5/site` |
| 未来宿主源 | `plm-web/dist/plmwiki` |
| 既有只读 bind 可见位置 | `/opt/aibiz/local-dist/plmwiki` |
| 既有活动 tmpfs | `/dist/plmwiki` |
| nginx 宿主源 | `plm-web/nginx-local.conf` |
| nginx 当前运行文件 | `/etc/nginx/conf.d/nginx.conf` |

宿主源与活动 nginx 原文件均为
`64e92ebc923fb6bef7acc0ba296a92124d55c5f97db9f4e63779e585cee63e46`。
候选均为
`68e88a27dca2b87390e8a1c80b62205ca9d74fd665fd8a4f0ddb167a3d04c62d`，
只增加两个静态 location：

```nginx
location = /plmwiki {
    return 302 /plmwiki/$is_args$args;
}
location ^~ /plmwiki/ {
    alias /dist/plmwiki/;
    index index.html;
}
```

没有新增 API location、代理重写、身份头或权限放行。
既有 `start.sh` 会从本地 dist 复制完整目录，只覆盖顶层环境文件；
嵌套 Wiki 环境文件不会被 PLM 主应用的环境覆盖。

## 当前版本验收证据

```sh
node --test scripts/tests/prepare-existing-plm-wiki-entry.test.mjs
node scripts/prepare-existing-plm-wiki-entry.mjs \
  --output /home/my/workspace/ainfra/aibiz/.artifacts/plm-wiki-entry-candidate-20261126-r5
```

聚焦合同 **6/6 通过**。r5 准备状态为
`PREPARED-STATIC-ENTRY-GUEST-DISABLED`。
执行时间为 2026-11-26 22:58:12 至 22:58:16 UTC。
私有报告 SHA-256：
`01a90bf92043ec69b2c1bbce2451c080db07534b2159dd2df866bf7acd63647f`。

冻结计划为该目录的 `prepared.private.json`，
SHA-256 `2241ea527f6eef7bf156af02cdfd17614e6cef08b57cb277fab75263531dbacc`。
候选清单 SHA-256：
`126f7f0e6ea3f9c9593367bfcf4433a7a6b0d0a80430ae577c87da5b27e6bf32`。
源码、模型、解析器、全部原/候选文件执行前后重新校验；
现有 plmweb 容器、镜像、配置、启动时间、nginx 与 start.sh 字节不变。

只读复制实际容器的 nginx 与所需动态库到私有目录，使用同架构实际二进制
验证两个新增 location，临时目录限定在候选私有目录，原生检查退出 0。
该检查范围是新增静态块；没有宣称完整候选运行配置已在容器内验收。
完整 nginx 配置检查仍是主线应用前的明确门槛。

r1 至 r4 准备失败均保留：pnpm 解析器的正常硬链接触发初始守卫；
nginx 不按普通文件解析管道、也不接受 `-g` 中的配置块；
私有原生检查初次缺少宿主机默认缓存目录。
最终只为固定哈希解析器允许只读硬链接，并将验证程序/库/缓存全部限定在
私有目录，没有放宽资产或 nginx 增量范围，也没有修改容器配置。

计划要求未来与既有静态发布使用同一
`.artifacts/.plm-notification-style-recovery.lock` writer 窗口。
先复核当前源/运行配置、目录不存在及候选清单，再分别暂存/发布两个自有目录，
保持文件 0644、目录 0755，并按原元数据发布两份精确 nginx 配置。
恢复输入保留源/运行 nginx 原字节；只在完整自有清单匹配时移除本计划新增的
两个 Wiki 子目录，禁止删除其他目录，不需要容器重启。

## 待决策/阻塞

当前合法访客激活合同仍未闭合，机器可执行的安全配置保存在
`guest-configuration.private.json`：匿名关闭、两凭据为空，
API level 不覆盖、ignoreAuthPatterns 为空、新账号和角色授权均为空。
工具拒绝擅自把该配置改成开启、添加凭据、放行接口或创建账号。

原生合同追踪有两类独立机制：

1. **实际缓存前端字节**：`V7AuthService.anonymousLogin` 读取两环境凭据并委派
   常规 `/v7/login`。本轮 AST 追踪到实际缓存方法，不能假称存在无凭据 bootstrap。
   两个共享视图的模型 `accUserMode=3` 只表示前端访问模式。
2. **平台后端源码**：`SysServiceAPILevels.ANONYMOUSUSER=4` 会为整个 service
   注册 `/**` 免认证；也支持精确 `ignoreAuthPatterns`，并创建原生匿名上下文。
   当前 plmwiki 使用通用 ServiceAPI，仍包含创建、更新、删除与 GetDraft，
   所以不将其整体改成匿名，也不添加身份头来代替认证。

共享表单展示 `publish_content`，但其 load 动作是通用 Get，
`article_page_dto` 同时声明 `content`、`publish_content`、`access_password`。
内部 `shared/get_shared_info` 的返回逻辑还会复制解密后的访问密码，
其 action 当前权限为 UPDATE。上述是权威源码观察，
**不是已经观测到匿名泄露**，也不能据此把内部 shared 接口公开。

激活前须明确并真实证明：精确命名空间/metadata/bootstrap 路由，
服务端分享范围、密码、过期、撤销与子集约束，以及匿名响应排除草稿和密码。
若需新的专用公开读合同，先按权威模型和原生运行机制实现并审查；
在合法路径得到证明前不创建访客账号、不放宽通用 API。
静态入口可独立进入主线审查，但不能以入口文件存在或页面 200 关闭分享父项。
