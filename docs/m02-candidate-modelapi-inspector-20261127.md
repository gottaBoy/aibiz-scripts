# M02/M01 只读候选契约分析

检查点：2026-11-27，America/Los_Angeles。没有修改 vendor 模型、没有登录、
没有 HTTP/Docker/SQL 或共享写入。

## M02：同类 FetchDefault 对比

`PSAppType`、`PSSF`、`PSPFStyle` 的权威 ModelAPI 都发布同样的：

```text
POST
dataAccessAction=READ
methodType=FETCH
dataset=Default
return type=PAGE
input/return=实体 FilterDTO/DTO
```

`PSDevCenter` 的实体本身也有 `Default` 数据集、`Default` 查询和默认访问模式。
其 Default SQL 只选择以下六个字段：

```text
CREATEDATE, CREATEMAN, PSDEVCENTERID, PSDEVCENTERNAME, UPDATEDATE, UPDATEMAN
```

`LICKEY` 和 `LICINFO` 虽在实体查询表达式声明中存在，但没有进入实际 SELECT，
因此不应因补 FetchDefault 而自动泄露。

缺口仍然是服务 API：ModelDesign app entity 声明了 `FetchDefault`，而
`PSDevCenter` ModelAPI service entity 没有该方法，只有 `Get` 和 `Update`。
因此可以参考同类方法的结构，但不能直接复制一个 peer 方法宣称完成。仍缺：

- 权威服务 API/生成器中 `PSDevCenter.FetchDefault` 的来源；
- 当前运行时访问管理器、路由注册和权限绑定；
- 新构建、部署后的 HTTP 200、返回 DTO 和拒绝矩阵。

安全候选是新增真实 `FetchDefault` 服务方法，绑定 `Default` 数据集、PAGE DTO、
READ/FETCH 权限，并在部署后验证；不能返回空页、映射到 `PSDevUser`，或只在前端
吞掉 HTTP 500。

## M01：当前 person 谓词可复用范围

原始 `CurDCSLNUser` 只有：

```sql
EXISTS (
  SELECT *
  FROM T_SRFPSDEVSLNUSER t41
  WHERE t1.PSDEVSLNID = t41.PSDEVSLNID
)
AND t1.PSDEVCENTERID = #{ctx.datacontext.psdevcenterid}
```

同模型 `PSDevSlnSys.CurUser4` 已有可复用的字段/上下文绑定形状：

```sql
t71.PSDEVUSEROBJID = #{ctx.sessioncontext.srfpersonid}
```

现有 Central candidate 也只补了这一层 person 绑定。它可以作为当前用户谓词
的来源依据，但还不能当完整授权实现。仍需独立核对：

- `ALLSYSFLAG=0` 与全局成员语义；
- `EXPIREDTIME` 非过期；
- `ACCMODE` viewer/editor；
- `PSDEVSLNSYSID` 根范围；
- 真实成员、同中心非成员、跨中心和匿名的当前服务结果。

不要由浏览器伪造 `srfpersonid`，也不要把非空列表直接当权限证明。

## 可重复检查

```sh
node --test scripts/tests/m02-candidate-modelapi-inspector.test.mjs
node scripts/m02-candidate-modelapi-inspector.mjs \
  .artifacts/m02-candidate-modelapi-inspector-20261127-r2/report.private.json
```

结果：定向测试 3/3；报告状态
`BLOCKED-M02-SERVICE-INPUTS-MISSING-M01-PREDICATE-ONLY-PARTIAL`。
候选报告明确记录 `writes=0`、`sharedRequests=0`、`dockerOperations=0`、
`sourceModified=false`。父项保持未完成。
