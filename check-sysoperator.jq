# CloudConfUtilRuntimeBase sets code first and only sets items for nonempty results.
# Response compatibility does not verify org identity or a fresh database query.
type == "object"
and .code == "SysOperator"
and (has("error") or has("type") or has("message") or has("success")) == false
and (
  (keys == ["code"])
  or (
    (.items | type == "array")
    and all(.items[];
      type == "object"
      and (.value | type == "string" and length > 0)
      and (.text | type == "string")
    )
  )
)
