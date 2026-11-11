# ModelDesign Editor Factory Regression

Date: 2026-11-10, Asia/Singapore
Updated: 2026-11-11, Asia/Singapore

## Test Scope

New Java suite:

`ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/security/SystemAccessManagerEditorRegistryTest.java`

The ten tests call the production
`SystemAccessManagerBase.createDataEntityAccessManager` method and initialize
the actual returned manager. No test overrides the manager factory, its
registry decision, root authorization method or permission-bit logic.

Each entity descriptor is a real `PSDataEntityImpl`, initialized by the real
`PSModelServiceImpl`, with the native name, code name and SELF access-control
mode. The lightweight runtime dependencies are strict in-memory proxies:
only model access, explicit plugin lookup, manager autowiring and runtime
provider discovery are allowed. Any unrelated operation fails the test.

The five editor entities must select exactly `PSModelDEAccessManager`:

- `PSSYSDBSCHEME`
- `PSSYSAPP`
- `PSSYSSFPUB`
- `PSSYSSERVICEAPI`
- `PSSUBSYSSERVICEAPI`

The tests also require their exact model table mapping, nonmembership in
the configuration registry, and preservation of the existing module,
data-entity, configuration, metadata and unknown-entity factory branches.
An explicitly configured per-entity plugin must still take precedence.

## Security Preconditions

The factory-selected root managers are exercised for both record and search
overloads:

- Ordinary editor: READ/CREATE/UPDATE/DELETE only, no MANAGE or unknown action.
- Ordinary viewer: READ only.
- No-access person: cannot reuse the editor's person-scoped fixture grant.
- Cross-root: cannot reuse a grant for another root.
- Mismatched returned root: rejected even if the lookup returns a grant.
- Zero, negative and expired grants: rejected without rewriting input.
- Missing/null/numeric/boolean/whitespace/control-character roots: rejected
  before any authorization lookup.
- Successful access: canonical system ID replaces untrusted record/filter
  fields only after authorization.

The grant lookup is a strict, explicit in-memory `(person, root)` fixture.
It does not certify database grant hydration, authentication, current-person
mapping or cache transport. Existing native grant/session/security suites
and fresh live owned HTTP checks remain mandatory.

## Execution

No new test dependency or external model fixture is needed. The existing
`libs/ibiz-modeling-core` Jupiter setup is sufficient.

```sh
cd ibiz-service-hub
mvn -B -o \
  -pl libs/ibiz-modeling-core -am \
  -Dmaven.test.skip=false -DskipTests=false \
  -Dmaven.test.failure.ignore=false \
  -Dtest=SystemAccessManagerEditorRegistryTest \
  -Dsurefire.failIfNoSpecifiedTests=false \
  test
```

The suite is included in `REQUIRED_PERMISSION_SUITES`. The build owner ran
it in the source-frozen permission harness and retained actual Surefire XML:
`.artifacts/modeling-permission-registry-20261110-r1/report.json`.
All ten factory tests passed, within 134 focused and 274 full-reactor tests.

This is actual unit execution, not native acceptance. Runtime completeness,
nonempty native list results, editor save/readback/restore and both language
workflows are separate acceptance gates. No native, permission or release
acceptance is claimed by these unit tests. Subsequent scoped native results
and remaining blockers are in `MODELDESIGN-REGISTRY-20261111.md`.
