# M01/M02 只读模型契约审计

检查点：2026-11-27，America/Los_Angeles。此轮没有登录、HTTP 请求、Docker 操作、
SQL、模型修改或共享写入。审计只读取已封存的权威 Modeling 模型和现有失败回执。

## M02：PSDevCenter FetchDefault 发布缺口

ModelDesign 应用实体
`PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/PSDevCenter.json`
声明了 `FetchDefault`，数据集标签为 `Default`。

它引用的权威服务实体
`PSMODULES/DevCenter/PSDATAENTITIES/PSDevCenter.json`
只定义 `Get` 和 `Update` 两个 ModelAPI 服务方法，没有 `FetchDefault`。
因此当前请求：

```text
POST /api/ibizmodeling__modeldesign/psdevcenters/fetchdefault
```

无法解析到已发布的服务方法。已有真实回执记录该请求 HTTP 500、106 字节：

```text
.artifacts/m02-modeling-center-context-20261126-r1/report.private.json
SHA-256 62e241bce5dc1b838359f5c51544527d5cd21c2b1e8cb612526ce0853aacaacc
```

这不是“中心列表为空”的证据，而是应用方法声明与 ModelAPI 发布面不一致。
安全修复需要二选一并重新构建、部署和验收：

- 删除或改用一个真实存在的只读服务方法，并同步视图/数据集契约；
- 在 `PSDevCenter` 服务实体及 ModelAPI 中新增真实 `FetchDefault`，补齐返回 DTO、
  权限、路由、错误和原生读取回归。

不能把请求改到 `PSDevUser`、返回空数组或在前端吞掉 500。

## M01：CurDCSLNUser 当前用户隔离缺口

Central/ModelDesign 的 `PSDevSln` 应用实体声明了：

```text
POST /api/ibizmodeling__central/psdevslns/fetchcurdcslnuser
dataset=CurDCSLNUser
```

对应服务方法确实存在，且要求中心上下文：

```sql
EXISTS (
  SELECT *
  FROM T_SRFPSDEVSLNUSER t41
  WHERE t1.PSDEVSLNID = t41.PSDEVSLNID
)
AND t1.PSDEVCENTERID = #{ctx.datacontext.psdevcenterid}
```

当前查询只证明某个成员记录存在，没有将 `srfpersonid`、开发者用户对象或当前
登录身份绑定到成员关系。共享运行中得到的 200 空数组，不能证明普通成员、非成员、
跨中心或匿名读取隔离已经正确。

原生请求保留为：

```text
POST /api/ibizmodeling__central/psdevslns/fetchcurdcslnuser
body: {"page":0,"size":1000}
```

安全修复应保留该路径和原生会话上下文，在权威 SQL/查询模型中加入当前用户绑定，
再用真实身份验证：

- 同中心成员可读；
- 同中心非成员被拒绝或得到空集；
- 跨中心和匿名被拒绝；
- 拒绝不产生持久化副作用；
- 刷新、新会话和跨中心切换保持一致。

不要由浏览器添加 `srfpersonid` 等身份头，也不要把非空列表当作权限证明。

## 可重复审计

脚本：

```sh
node scripts/inspect-m01-m02-contracts.mjs \
  .artifacts/m01-m02-readonly-contract-audit-20261127-r1/report.private.json
node --test scripts/tests/inspect-m01-m02-contracts.test.mjs
```

结果：

- M02 `PSDevCenter` 应用 `FetchDefault` 与服务方法缺失：`CONFIRMED`；
- M01 `CurDCSLNUser` 缺少当前 person/member 谓词：`CONFIRMED-MISSING-CURRENT-PERSON-PREDICATE`；
- 定向测试：2/2；
- 审计写入、共享请求、Docker 操作：均为 0。

私有报告：

```text
.artifacts/m01-m02-readonly-contract-audit-20261127-r1/report.private.json
```

本审计没有把任何父项关闭。下一步必须先取得合法 developer/center 身份或经过审查
的服务模型修复，再进行原生多角色读取和五实体流程；不得用旧管理员标签、伪造身份头、
空数组或 SQL 写入绕过前置。
