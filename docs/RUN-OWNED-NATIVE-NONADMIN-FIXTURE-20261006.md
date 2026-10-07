# Run-Owned Native Nonadmin Fixture

Date: 2026-10-06

This lane provisions a disposable, run-owned SQL fixture for validating the
UAA-to-modeling identity joins and two physical model databases. It is not a
native HTTP acceptance receipt and it is not a complete application schema.

## Minimal Commands

Run the unit contract tests:

```sh
node --test scripts/tests/run-owned-native-nonadmin-fixture.test.mjs
```

Run a retained two-center SQL fixture. The MySQL image must already exist
locally and the source schema container must be explicitly named:

```sh
node scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs \
  --execute-owned-sql-smoke \
  --retain-owned-sql-fixture \
  --mysql-image=sha256:a086c6276f57c2b8067d0fda21893b7e3e542513cb5997b224cd0538d4970ece \
  --uaa-schema-container=mysql \
  --uaa-schema=a_lab01_3f9ebc219 \
  --uaa-schema-mode=legacy-views \
  --scenario=two-center \
  --model-version=816
```

The command prints a JSON result containing a new 12-hex `runId`. Use that
value for cleanup after the main-owned integration peers have been detached:

```sh
node scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs \
  --cleanup-owned-run=<runId>
```

Omit `--retain-owned-sql-fixture` for an automatic cleanup after a passing
SQL-only run. Candidate generation without Docker execution is:

```sh
node scripts/prepare-run-owned-native-nonadmin-fixture.mjs \
  --scenario=two-center \
  --password-storage-mode=sm3 \
  --uaa-schema-mode=legacy-views \
  --model-version=816
```

Private credentials are written only below:

```text
.artifacts/native-nonadmin-fixtures/<runId>/credentials.private.json
```

Do not print or copy this file into a public receipt. The manifest contains
login names, centers, roots, and roles, but no passwords:

```text
.artifacts/native-nonadmin-fixtures/<runId>/manifest.json
```

## Current Evidence

Latest two-center run:

```text
.artifacts/native-nonadmin-fixtures/8ba3d0219f5d/isolated-sql-report.json
sha256 4395c8a3a0e853afe021cf7edfc74972298c43665d2a8fc435fe8587c9eb61d3
status passed-isolated-sql-fixture-only
checks 54
```

Latest same-center run:

```text
.artifacts/native-nonadmin-fixtures/2ac836eafbc6/isolated-sql-report.json
sha256 753eda77b901db027adcb232d852423f8fe67be0b5770d0aa8995161ab1dccce
status passed-isolated-sql-fixture-only
checks 54
```

The same-center retained run was explicitly cleaned:

```text
.artifacts/native-nonadmin-fixtures/2ac836eafbc6/cleanup-874f46850c09.json
status passed-owned-cleanup
```

The two-center run used automatic cleanup. At the time of this document there
are no containers or networks carrying the `aibiz.native-fixture.run` label.

The current source/test hashes are:

```text
scripts/prepare-run-owned-native-nonadmin-fixture.mjs
3ceabbcf3f13f2376005bf24a9cbcc034e65602275986112b8094513224dfa5b

scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs
8d87490753857e14cfbab349d3ab0d2a71a25cee9c742c0b36622c407b24fa53

scripts/tests/run-owned-native-nonadmin-fixture.test.mjs
c9c70bb78fbb10e85476852268381748c64c8184dce0af9a0c6a6a4d15b7ed21

modelingservice/sql/sCloud9471c1eca.sql
f7beab91573f0eef6e39db5a0b16043adf949adca68dbae1f583b62866c3e9fa
```

Local verification on 2026-10-06:

```text
node --test scripts/tests/run-owned-native-nonadmin-fixture.test.mjs
20 passed, 0 failed

node --check scripts/prepare-run-owned-native-nonadmin-fixture.mjs
node --check scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs
passed
```

## Fixture Contract

Each run owns:

```text
nf-<runId>-mysql
nf-<runId>-private
nf_<runId>_uaa
nf_<runId>_meta
nf_<runId>_model_a
nf_<runId>_model_b
```

The MySQL container uses an immutable cached amd64 MySQL 5.7.26 image,
`lower_case_table_names=1`, a 1 GiB tmpfs data directory, no published port,
no bind mount, no privilege, and one internal bridge network. Ownership is
rechecked by exact container/network IDs and labels before cleanup.

The source UAA database is accessed only through `SHOW CREATE TABLE` and
`SHOW CREATE VIEW` from the explicitly supplied `mysql` container and
`a_lab01_3f9ebc219` schema. No source account, password, or business/demo row
is read or changed.

The fixture has six globally unique bare UAA login names:

```text
<run>_a_e  editor
<run>_a_v  viewer
<run>_a_n  no-access
<run>_b_e  editor
<run>_b_v  viewer
<run>_b_n  no-access
```

The actual generated names and passwords are available only in the private
run directory. Editors use `ACCMODE=3`, viewers use `ACCMODE=1`, and no-access
users have no `t_srfpsdevslnuser` row. All six developers are `ADMINMODE=0`
and no scheme owner or reserved super/API role is seeded.

The identity evidence checks:

```text
sys_person.UID = t_srfpsdevuser.LOGINNAME
t_srfpsdevuser.PSDEVUSERID = t_srfpsdevuserobj.PSDEVUSEROBJID
t_srfpsdevuserobj.PSDEVCENTERID = sys_person.DC
sys_role_member.MEMBER_UID = sys_person.ID
t_srfpsdevslnuser.PSDEVUSEROBJID = t_srfpsdevuserobj.PSDEVUSEROBJID
```

The two physical model databases use the same logical system/module IDs but
different physical system names and tags. Each generated JDBC principal has
`SELECT, INSERT, UPDATE, DELETE` only on its own exact model schema; schema
underscores are escaped in the grants to prevent wildcard access.

## UAA Protocol Requirements

The reconstructed UAA candidate was inspected, but it is not authenticated
original source. Relevant source evidence is under:

```text
.artifacts/standalone-uaa-recovery-20261006-R4/source/
```

Direct UAA login must use the DTO field names `loginname`, `password`, and,
for center-qualified lookup, `dc`. The endpoint is:

```text
POST /auths/login
GET  /auths/user-info/self
```

`AuthLoginServiceImpl` composes `loginname|dc`; `AuthUserServiceImpl` then
filters `sys_person.UID` and `sys_person.DC`. This is why direct UAA tests
must send the generated center ID. The modeling backend's `RTAuthAgent`
forwards `loginname` and `password` by default, not `dc`, so backend test
accounts must remain globally unique bare names. Do not use the reserved
`aibizhi`, `demo_admin`, super-admin, API-user, or WXMP identities.

Before starting an isolated UAA, the main-owned runtime configuration must
override all shared defaults:

```text
spring.datasource.url                  owned UAA schema
spring.datasource.username/password    owned UAA application account
spring.datasource.defaultSchema        owned UAA schema
spring.datasource.isSyncDBSchema       false
spring.liquibase.enabled               false unless an owned migration is intentional
ibiz.auth.passwordStorageMode          sm3
ibiz.auth.imageCaptcha.enable          false for direct no-captcha login
spring.cloud.nacos.config.enabled      false
spring.cloud.nacos.discovery.enabled   false
spring.cloud.discovery.enabled         false
ibiz.ref.service.rt.version            a value other than RT2
```

`isSyncDBSchema=false` selects `empty.xml` in
`uaa-core/.../LiquibaseConfiguration.java`, but the Liquibase bean still
exists while `spring.liquibase.enabled` defaults to true. Therefore disabling
Liquibase is a separate isolation requirement.

The recovered `application-dev.yml` defaults to the shared schema
`a_lab01_3f9ebc219`, Redis host `redis`, Nacos discovery/config, SM3, image
captcha enabled, and `ibiz.cacheLevel=L2`. These values must not leak into the
isolated run. If `L2` is retained, Redis must be a run-owned isolated peer.
If `L1` is selected, OAuth2 token storage uses JDBC and the owned UAA schema
must contain the OAuth token tables required by `JdbcTokenStore`.

`ibiz.ref.service.rt.version=RT2` conditionally starts `AppSyncJob`, which
waits ten seconds and posts `permission/resource.json` to UAA. Disable it for
the fixture unless the resource import target and payload are also fully
run-owned.

## Remaining Native Steps

The following are intentionally not claimed by either SQL receipt:

1. Start the main-owned source-built UAA against the owned UAA schema and
   isolated cache/registry configuration.
2. Execute `/auths/login` and `/auths/user-info/self` for editor, viewer, and
   no-access identities in both centers. Keep passwords in the private run
   directory and do not put tokens in public reports.
3. Attach the source-built all-in-one, gateway, and modeling provider only to
   the run-owned network or to a separately verified integration network.
4. Configure narrowly scoped UAA/metadata application database users. The
   current fixture creates only the two physical-model JDBC users; it does not
   create non-root UAA or metadata application accounts.
5. Prove editor/viewer/no-access behavior over HTTP for own and foreign roots,
   including before/after sentinels in both physical model databases.
6. Add negative cases for absent, expired, zero, forged-root, forged-system,
   session-versus-scoped-holder, and nested-holder restoration behavior.
7. Preserve separate source/build/native receipts. SQL joins, JDBC grants, or
   a reconstructed UAA source tree cannot close those gates.

The `standalone-tables` mode is implemented as a candidate path but has not
been validated against an actual standalone-table source schema. The current
executed evidence is `legacy-views` only.
