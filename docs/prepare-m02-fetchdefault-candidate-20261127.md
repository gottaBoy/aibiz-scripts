# M02 FetchDefault 候选与 M01 person 绑定

只读检查点：2026-11-27。没有修改 vendor 模型、没有登录、没有服务请求、
没有 Docker/SQL 或共享写入。

## M02 候选

已对比 `PSDevUser`、`PSDevCenterDBInst`、`PSAppType`、`PSSF` 和
`PSPFStyle` 的权威 ModelAPI。它们的 `FetchDefault` 共同使用：

```text
POST
dataAccessAction=READ
methodType=FETCH
dataset=Default
FilterDTO -> PAGE<DTO>
```

`PSDevCenter` 具备对应实体基础输入：

- `PSDevCenterFilterDTO`
- `PSDevCenterDTO`
- `Default` dataset/query
- 默认 access mode
- Default SQL 只 SELECT 六个非凭据字段

但 ModelAPI 服务实体完全缺少 `PSDevCenter.FetchDefault`，所以本轮只生成了
结构化 proposed method，状态为：

```text
PREPARED-BLOCKED-SERVICE-SOURCE
```

没有生成可部署 overlay。缺少的硬输入：

1. 权威 ModelAPI service source 插入点；
2. runtime route/access-manager 注册；
3. 构建后的 HTTP 200、DTO、权限和拒绝回归。

不能用同类 JSON 复制、空数组或前端 fallback 代替这三个输入。

## M01 person 绑定

原始 `CurDCSLNUser` 仍只有中心条件和任意成员 `EXISTS`。
`PSDevSlnSys.CurUser4` 提供可复用的：

```sql
PSDEVUSEROBJID = #{ctx.sessioncontext.srfpersonid}
```

候选只保留这一层字段/上下文绑定，继续明确以下授权语义没有来源闭合：

`ALLSYSFLAG`、`EXPIREDTIME`、`ACCMODE`、`PSDEVSLNSYSID` 和实时角色矩阵。

## 复现

```sh
node --test scripts/tests/prepare-m02-fetchdefault-candidate.test.mjs
node scripts/prepare-m02-fetchdefault-candidate.mjs \
  .artifacts/m02-fetchdefault-candidate-20261127-r1/report.private.json
```

结果：3/3，通过；`writes=0`、`vendorModified=false`。
报告状态为 `PREPARED-BLOCKED-SERVICE-SOURCE`。
