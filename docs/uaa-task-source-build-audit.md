# UAA / Task Source Build Audit

Run the fail-closed audit from the workspace root:

```bash
node scripts/harness-uaa-task-readiness.mjs
```

Each invocation writes a fresh immutable
`.artifacts/uaa-task-readiness/audit-<uuid>/report.json` and returns non-zero
if either service is not ready. The printed JSON is the exact report.
`UAA_TASK_READINESS_REPORT` can name a new report path; existing files are
never overwritten. Default execution is read-only: no Maven, Docker build,
container lifecycle changes or database provisioning.

Run the mandatory source subset independently:

```bash
node scripts/harness-required-source-gates.mjs
```

This retains S06 UAA own-source, S06 Task own-source and D01 compiler-in-Docker
as three required gates. Missing evidence fails, with zero skips;
frontend/static delivery passes cannot remove a gate. The reports retain
`nativeAcceptance=false` and `compilerBuildInDockerVerified=false`.

Receipt consumers bind the recorded clean source commit, known-stub audit,
own-bytecode diagnostics and image observation to the current input fingerprint.
Image tags are independently inspected twice; source inputs, receipt and
artifact bytes are rechecked after the final observation. An image identity
match is not compiler execution or proof that the image contains the artifact.
Controlled-runner observations cannot satisfy live image evidence. Required
service results list `unmetChecks` without promoting the remaining independent
source/protocol/compiler verifiers.

## Current Target And Blockers (2026-10-06)

**UAA 32666 is blocked, not source-ready.** The historical Java 8 Maven build
of `vendor-upstream/ibizlab-runtime/ibzuaa` produces a legacy `ibzuaa` JAR.
Its `ClientAuthenticationResource` exposes `v7/login` and `uaa/login`, and
`UAAUserService` uses `IBZUSER` and `pwencrymode0..3`. Those editable sources,
build receipts and the `aibiz/uaa:source-built` image do not replace the
running standalone `uaa-api` contract.

The current caller is `RTAuthAgent`, forwarding to `lb://uaa-api/auths/login`
and consuming an `AuthLoginResponse`. The standalone binary uses
`sys_person.UID` / `USER_PASSWORD`, a `POST /auths/login` request with
`loginname/password/dc`, and a `token/user` response. No matching editable
standalone implementation has been located in the current workspace.
The readiness audit therefore retains separate blocked editable-input and
source/runtime protocol-closure checks; same-name files cannot close them.

Read-only observation binds `ibizlab-uaa-api`'s `/entrypoint.sh`, live Java
`/uaa-api.jar` argument and JAR hash to `runtime-jars/ibizlab-uaa-api.jar`.
It performs before/after container and artifact rechecks and records only
allowlisted identity fields, paths and hashes, not environment values,
Java options, tokens, credentials or response bodies. A successful
`runtimeTargetObservation` is binary identity only, not replacement-source
or protocol evidence.

The binary's SM3 encoder is conditional on
`ibiz.auth.passwordStorageMode=sm3`; absent that bean, Boot security falls
back to `NoOpPasswordEncoder`. Packaged `application-dev.yml` is not proof
of effective external configuration or the running encoder. Conditional SM3
uses uppercase 64-hex digests and case-sensitive matching; raw inputs of
length 64 pass through, and stored inputs shorter than 64 are hashed.
The source/protocol gate still requires effective runtime selection proof.

Account setup must follow standalone, not legacy `IBZUSER`, semantics:

- Person organization/domain references must resolve through
  `sys_organization.ID` and `sys_domain.ID`.
- Direct membership uses `MEMBER_TYPE=inetOrgPerson`,
  `sys_role_member.MEMBER_UID=sys_person.ID` (not `UID`) and `ROLE_ID=sys_role.ID`.
- Role `DEPLOY_SYSTEM_ID` joins `sys_deploy_system.ID`; its projected system
  is `SYSTEM_ID`, with compatible domain bindings.
- Fine grants use `sys_granted_authority.ROLE_ID`, `AUTHORITY` and
  `PERMISSION_TYPE`. Login clears role authorities, so successful login is
  not fine-grant evidence; `/auths/user-info/self` needs authenticated validation.
- Do not use reserved `ROLE_APIUSERS` or `ROLE_SUPERADMIN` in isolation
  fixtures: standalone UAA checks role authority, while RT checks role ID.

These are binary-derived contract requirements, not a verified provisioning
recipe. The main lane owns provisioning and real permission/API checks.
This audit performs none.

**Task 30088 is also blocked.** Local dependency, WAR assembly, Dockerfile
and build entrypoint structure now exist; the former missing-structure claim
is stale. Actual blockers remain: unresolved `Complie` decompilation/throw
in `SAPAAS/src/sasrfdaeai/SA/SRFDA/EAI/Ctrl/Form/EAIAppIntFormActionHelper.java`,
three loose own `.class` inputs under `resources/classes/net/ibizsys/psts/web`,
and no successful current-input receipt accepted by the independent audit.
Before/after inventories, numeric zero compiler exit, platform, source
identity, artifact and image identity are all required. A dirty working-tree
snapshot is not a clean committed-source receipt.

Independent own-bytecode/dependency closure and real compiler-in-Docker
verification remain missing. Hashes, booleans, reconstructed fixtures,
prebuilt runtime images and historical receipts cannot satisfy those gates.
The readiness CLI's explicit `--build` executes existing builders but
does not remove these blockers; the required-gates runner never uses it.
