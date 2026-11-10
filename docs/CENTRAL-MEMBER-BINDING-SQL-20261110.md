# Central Member Binding: Offline Model And SQL Evidence

Date: 2026-11-10

## Result

An existing identity-binding candidate is available. Its ordinary-member
predicate can be applied as a separately bound native model artifact without
changing shared services, Java authorization code or authorization rows.
It must not be presented as full permission parity or production acceptance.
The changed backend metadata/SQL must actually be loaded by the owned backend;
a frontend fetch-reference change alone is insufficient.

Implemented only independent validation files:

- `scripts/harness-central-member-binding-sql.mjs`
- `scripts/fixtures/CentralMemberBindingSqlProbe.java`
- `scripts/tests/central-member-binding-sql.test.mjs`

Executed evidence:
`.artifacts/central-member-binding-sql/central-binding-20261110-r1/report.json`

- 150 passed native typed-model and actual SQL checks.
- 14 actors across original/candidate three-query branches and the published
  UNION; both admin branches also compared directly for every actor.
- Four standalone harness tests plus existing candidate regressions:
  182 passed, 0 failed, 0 skipped.
- H2 1.4.200, in-memory MySQL mode, with source-defined native SELECT fields,
  joins and conditions.
- Immutable Java 17 image
  `sha256:42ec2338f05fe160e6885cc5d245e8eada367f3954f41a8fb7adbebc0e473bb4`.
- The temporary helper used network `none`, read-only root/source/dependencies,
  non-root UID/GID, dropped capabilities and no-new-privileges. It was removed
  by its inspected exact container ID. No owned/shared database or runtime
  container/network was changed.
- All columns of six native-model-derived fixture tables and synthetic source
  accounts remained identical across all SELECT executions.

`nativeAcceptance`, `permissionAcceptance`, production and expiry/access-mode
acceptance remain false.

## Existing Candidate

Generator:
`scripts/prepare-native-service-candidate.mjs --member-binding`

Contract:
`scripts/fixtures/native-service-migration-contract.json`, `memberBinding`

Pinned original model root:
`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling`

Pinned upstream commit:
`96e9e54e5a20c0eea7f9ada21bdd1a38177caf9f`

The existing generator emits five files, without editing originals:

1. `PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json`: both grid fetch
   references change from `FetchDefault` to published `FetchCurDCSLNUser`.
2. `PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln.json`: the ordinary member query
   gains one AND/EQ structured join condition on `PSDEVUSEROBJID`, sourced from
   `SESSIONCONTEXT(SRFPERSONID)`, with no ignore-empty behavior.
3. `PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln/PSDEDATAQUERIES/CurDCSLNUser/PSDEDQCODES/MYSQL5.json`:
   its membership EXISTS gains the same actual session-person equality.
4. The corresponding `CurDCAdmin/PSDEDQCODES/MYSQL5.json`.
5. The corresponding `CurDCSLNAdmin/PSDEDQCODES/MYSQL5.json`.

The last two files retain their original bytes. Both structured admin query
objects, the center predicate, published three-branch UNION and READ action
remain unchanged. The new tests reuse the existing rewrite function in memory
and verify pinned original hashes; the generator and contract were not changed.

## Reproduced Defect

The original `CurDCSLNUser` condition is effectively:

```sql
EXISTS (
  SELECT * FROM T_SRFPSDEVSLNUSER t41
  WHERE t1.PSDEVSLNID = t41.PSDEVSLNID
)
```

The separate center condition uses `ctx.datacontext.psdevcenterid`. There is no
person equality in the original membership EXISTS. In the nonempty H2 fixture,
an ordinary same-center nonmember, a login-name string, a membership-row ID or
a missing session person could therefore see membered schemes under that
selected center through the ordinary branch.

The existing candidate adds:

```sql
AND t41.PSDEVUSEROBJID = #{ctx.sessioncontext.srfpersonid}
```

Its typed model and SQL were both inspected and executed. The candidate
ordinary branch returns only schemes with that session-person membership.
Same-center nonmembers, foreign people, unmatched login/grant-row IDs,
anonymous/missing/empty person values return no rows in the covered fixture.
Scheme-owner and center-admin branches preserve their original results,
including legitimate visibility of an empty scheme that has no member rows.

## Identity Prerequisite

`PSDEVSLNUSERID` is a membership row key, not the actor identity.
`LOGINNAME` is a lookup/login string, not the user-object key.
The native `PSDevUserObj` model key is `PSDEVUSEROBJID`, and memberships refer
to that key.

The existing owned account fixture explicitly joins:

- authenticated UAA `sys_person.ID`, UID and DC;
- native `PSDevUser.PSDEVUSERID` and `LOGINNAME`;
- native `PSDevUserObj.PSDEVUSEROBJID` and `PSDEVCENTERID`;
- membership `PSDevSlnUser.PSDEVUSEROBJID`.

The native `EmployeeContext` initializes `srfpersonid` from the actual employee
user ID. Modeling `SystemAccessManagerBase.getPSDevUser` looks up a developer
by authenticated login and its configured default center; it does not rewrite
the employee's session person ID to a developer ID.

Consequently, `personId = developerId = userObjectId` is a deliberate verified
owned-fixture choice, not a general platform invariant. The source fixture
already discloses this at
`scripts/prepare-run-owned-native-nonadmin-fixture.mjs` under
`personEqualsDeveloperId`. Before using this candidate on another account
population, prove the actual server-side appdata person and user-object mapping.
Do not replace the trusted session value with a body/query/header person
override to make the result appear correct.

The isolated test uses distinct login strings, person/user-object IDs and grant
row IDs, verifies the native-model key and real relational identity joins, and
confirms login/grant-row values cannot substitute for the person binding.
It does not invent a new production identity mapper.

## Deliberately Unclosed Gates

The candidate only adds identity equality. Neither its original nor candidate
member SQL includes active `ACCMODE`, `EXPIREDTIME`, target-type/root or
membership enablement predicates. The probe deliberately includes a matching
membership with ACCMODE=0 and an expired timestamp and confirms it is still
listed. This is recorded as a limitation, not hidden by removing the row or
claiming the list is fully authorized. Existing authorization-manager behavior
must be independently exercised through actual native HTTP.

The center value remains the original data-context parameter. This probe does
not establish that every caller can only select its authenticated center.
The parent-owned route/default-center/configuration binding must prove that
boundary, along with actual ordinary authentication and no privileged flags.

H2 fixture columns are derived from all actual native field names and use
simple nullable string storage for relational SELECT tests. This is not native
MySQL schema-migration/type acceptance. Native typed PSModel objects provide
the actual query code, conditions, structured join and published dataset.
Only the two reviewed native placeholders are translated to JDBC bind
parameters. No alternative list implementation or replacement API is tested.

Still required before wider acceptance:

- Bind the five candidate model outputs to an exact owned backend/frontend
  delivery chain, preserving the frozen source-image provenance.
- Prove actual source-account/appdata/user-object identity and trusted center.
- Execute real multi-user published-query HTTP and fresh-login behavior.
- Independently verify access mode, expiry, target scope and admin semantics.
- Exercise Central browser navigation and real scheme/system operations.

## Reproduction

```sh
node --test scripts/tests/central-member-binding-sql.test.mjs \
  scripts/tests/native-service-candidate.test.mjs

node scripts/harness-central-member-binding-sql.mjs \
  --label central-binding-20261110-r2 \
  --dependencies .artifacts/native-nonadmin-fixtures/5d3585516a77/workflow-schema-phase1-wf/dependencies \
  --compiler-image sha256:42ec2338f05fe160e6885cc5d245e8eada367f3954f41a8fb7adbebc0e473bb4
```

Use a fresh label; existing receipts are never overwritten. The receipt binds
the original models, input, standalone Java source, harness source, dependency
bytes, compiler image, actual checks and exact helper cleanup.
