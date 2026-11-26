# A01 启动跟进

检查点：2026-11-26，Asia/Singapore；沿用原文件名。
状态：自有宿主八服务、schema 初始化、Nacos alias 和六个 actor 的 UAA
登录/self 已真实通过；业务 gateway 登录仍在前置阶段返回 403，A01 不关单。
本轮保留早期失败，并补正业务登录请求以绑定实际 fixture center，需用新的
源快照重新运行后才能接受。

## 手册要求

原生 Modeling 根授权属于独立能力。越权拒绝、合法对照、真实路由、
持久化无副作用及当前部署输入都需要实际验收；启动、配置保存和 HTTP 端口可达不能替代。
历史边界见 [A01 HTTP runner](AUTHORIZATION-A01-20261114.md)、
[2026-11-22 运行证据](CONVERGENCE-LIVE-20261122.md)和
[授权实现说明](AUTHORIZATION-IMPLEMENTATION-20261122.md)。

## 本地实现观察

历史 owned run `6189aef47735` 的两次 parentless 启动均失败：

- `converge-backend-parentless-20261122-r1` 和 `r2` 的 Nacos 日志均有
  `Nacos started successfully in stand alone mode`。
- All-in-One 均在 `NacosConfigManager` 初始化时报告
  `InvocationTargetException`，随后 `APPLICATION FAILED TO START`，
  错误中的 Nacos 单段主机名长 69 字符。
- 启动脚本最终记录 `Owned service exited during startup`。
  日志没有展开到 Java IDN 底层异常，不能称为完整异常因果链。

本机缓存 Temurin `17.0.20+8` 的 `java.net.IDN.toASCII(host,
IDN.USE_STD3_ASCII_RULES)` 实际结果如下。此项是独立 Java 复现，
支持长度故障诊断，不是 Nacos 客户端或真实后端复测。

| 输入 | 长度 | Java 结果 |
| --- | --- | --- |
| 历史通过批次的 Nacos 名称 | 58 | 接受 |
| 历史 parentless 批次的 Nacos 名称 | 69 | `The label in the input is too long` |
| 63 个 ASCII `x` | 63 | 接受 |
| 64 个 ASCII `x` | 64 | `The label in the input is too long` |

[启动脚本](../launch-run-owned-native-backend.mjs)已有保护保留：
实际生成的五种服务名及保留 UAA/Redis 名均要求不超过 63 字符；
启动标签校验在打开输入和调用 Docker 之前执行，不截断或自动改名。
12 位 run ID 加固定前缀及最长的 `zookeeper` 后缀决定标签最多 29 字符。
本次补充错误中的角色、实际长度和标签上限，避免只得到笼统的启动退出。
命令构造函数仍对调用方提供的实际名称单独检查长度。

新增测试覆盖五种启动命令保留边界名称、拒绝超长标签，以及短标签下额外传入的
超长实际名称；已有超长 launcher 测试同时启用 parentless 选项，验证同样提前拒绝。
相邻配置生成器已有相同 DNS 标签限制，本轮未修改它。

## 当前版本验收证据

2026-11-26 01:25 至 01:26 +08 的封存 r3 执行入口实际完成：

- MySQL、Redis、ZooKeeper、Nacos、UAA、All-in-One、provider、gateway 八个
  自有宿主进程均启动并通过监听/依赖检查。
- Workflow 和 EBSX schema 均完成真实 bootstrap/verify；四类错误 host witness
  被拒绝，bootstrap 账号已移除。
- 两个 Nacos alias 精确读回，六个自有 actor 的 `/auths/login` 和 self 均 200，
  身份字段逐一核对；所有 PID 最终清理。
- 首个 gateway `/v7/login` 返回 403，未发送缺根请求或合法 root control。
  All-in-One 日志绑定到下游 UAA `POST /auths/login` 返回 400，最终记录为认证失败。
  该回执没有把 403 当作授权通过，也没有改用身份头或换账号绕过。

该回执：
`.artifacts/native-nonadmin-fixtures/6189aef47735/backend-host-a01-20261125-r1/campaign-1795627501752-1235354.private.json`，
SHA-256 `cc674fae80b81234588dcbf334ca667c28abc73e46ca395bbc2dbbfdab50e60e`。
执行入口的 81 个源/测试/模型输入快照 manifest：
`.artifacts/a01-host-followup-20261125-r1/execution-20261126-r3/manifest.private.json`，
SHA-256 `6f251fa7ec627e467af01a8c82566d2fa2ec5f637df62261cf3edad069823765`。
早期 auth-only 回执仍保留，不与本次 schema/后端阶段混并。

根因核对显示，当前 runner 对 standalone UAA 直接登录已带 `dc`，但 gateway
业务登录请求原先没有携带用户对应的 `dc`，导致下游请求不能绑定 fixture
center。当前源码已统一使用 `ownedA01LoginBody`，让 UAA 与 gateway 共享
`loginname/password/dc` 绑定；此修复尚未重新执行真实 backend HTTP，因此不宣称
403 已解决。下一次执行必须重新封存该 runner、测试及闭包输入，再继续到
合法 root control 和 absent/typed 请求。

代码基线为 `scripts@d148c059aa0991ae8a41ae6a9c6ecb4aadb04440`
加当前工作树差异。以下 SHA-256 绑定定向测试字节，不表示已提交或部署。

| 文件，相对 `scripts/` | SHA-256 |
| --- | --- |
| `launch-run-owned-native-backend.mjs` | `79711b342eb93c234b70ba801e27d6e7ed1d0b47b58a27c4b5578d6fd79ab903` |
| `tests/launch-run-owned-native-backend.test.mjs` | `ed61b5ab8367ac82126b88656472e280e2677af8a7b351390599a47b46eb247e` |
| `run-owned-backend-configuration.mjs`，只读相邻依赖 | `af8dd565f48f67aec780ec5f6f29ca7c10259c2fd564b398c7633718b519ec15` |
| `tests/run-owned-backend-configuration.test.mjs`，只读相邻测试 | `18f0a618dddd6b001dfcf582d8259282cd93874c196f78c9100c120fd59d1bce` |

在 `scripts/` 执行：

```sh
node --test tests/launch-run-owned-native-backend.test.mjs tests/run-owned-backend-configuration.test.mjs
```

结果：119 项通过，0 失败、取消、跳过；只覆盖名称、启动命令、配置和既有防护契约，
没有启动 Docker 服务。Java 复现使用工作区已有工具链
`.artifacts/local-java-toolchain-20261122-r1/openjdk/bin/jshell`，输入为上述四个名称。

重新读取的历史文件仅用于定位旧失败，SHA-256 如下。原始日志继续保持私有。
下表路径均位于 `.artifacts/native-nonadmin-fixtures/6189aef47735/`。

| 历史文件 | SHA-256 |
| --- | --- |
| `backend-runtime-converge-backend-parentless-20261122-r1/report.json` | `f56cdf53ac3f4b72ea91658ba52a6d369674028691000a3cf8e079a015e53e2b` |
| 同目录 `allinone.private.log` | `d570b3bf4ea3949fa010ea0dcfe655df58ff2b026e6ea8ef15c0c2ed24c6a0ff` |
| 同目录 `nacos.private.log` | `014e894800ca51487003790896d74149161d64aa890e8fdfbf2c0b41cef7d75c` |
| `backend-runtime-converge-backend-parentless-20261122-r2/report.json` | `3c253a75f3a34a92943aa7d1cfdfbfe9d56ee01b5010aa717ca66c46885a2887` |
| 同目录 `allinone.private.log` | `d9b9dcd9a1b633b613816e45bc887131b1e0be77ee5132125e5e94969fef9e09` |
| 同目录 `nacos.private.log` | `cb4eb06be8f99837b4fb57e145b3130b22b978fa7d2d60e9258293ed3139a97c` |

## 待决策/阻塞

2026-11-26 只读资源检查：
`docker ps -a --filter label=aibiz.native-fixture.run` 没有容器；
Java 进程只有现有共享服务，没有可复用的自有 parentless 后端。
旧验证环境已清理。本轮只使用自有宿主进程和既有二进制，未创建或重建 Docker、
未 pull 镜像、未修改共享服务或写共享库；真实宿主 HTTP 已运行到 gateway
登录前置，但因 403 停止。

历史 string-root 回执仍是
`authorization-a01-converge-a01-legacy-20261122-r1/report.json`，
SHA-256 为 `3ca4dcdaabe1f02bf214a73191d994e82e6c6ebc3b18ccad8d7ce14bcd7bd6f5`：
36 条字符串根请求、16 个对照和 84 个认证检查是该历史运行的证据。
其 `fullA01Acceptance` 和 `typedRootHTTPAcceptance` 均为 `false`。
仍待 12 条 absent 和 36 条 typed/null/empty/numeric 的真实 HTTP 验收；
本轮保护和测试不升级这些状态。

后续复测需已有可验证所有权的隔离后端及有效账号、模型/配置/包绑定，
选择不超过 29 字符的启动标签（例如 `a01p-20261125-r1`），
先完成真实初始化，再逐项验证请求、合法对照与拒绝无持久化副作用。
36 条 typed 边界还需保留类型语义的真实传输入口，不能把字符串路径换名当作 typed 通过。
