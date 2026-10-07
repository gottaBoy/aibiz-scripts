# Modeling Java version boundary (2026-09-28)

Status: **not verified compatible**. This record covers the Java Modeling
dependency boundary; `npm run ledger` only verifies the frontend package,
plugin, and SystemJS import-map contracts.

| Authority | Declared version | Evidence |
|---|---|---|
| Upstream `modelapi` | `ibiz.cloud.version=8.1.0.542` | `vendor-upstream/ibizmodeling-standard/pom.xml` |
| Local service hub | project and `ibiz.cloud.version=8.1.0.584.1` | `ibiz-service-hub/pom.xml` |
| Local Modeling core | parent and direct iBiz dependencies `8.1.0.584.1` | `ibiz-service-hub/libs/ibiz-modeling-core/pom.xml` |
| Historical deployed reference | `8.1.0.570.33` | `runtime-analysis/extracted/modelingservice/ibiz-modeling-core-8.1.0.570.33.jar` |

The three verified remote Modeling heads all retain that `542` property:

| Branch | Commit | `modelapi` version | `ibiz.cloud.version` |
|---|---|---|---|
| `20250421` | `96e9e54e` | `1.0.0.0` | `8.1.0.542` |
| `develop` | `c88cde17` | `1.0.0.0` | `8.1.0.542` |
| `master` | `d5279707` | `1.0.0.0` | `8.1.0.542` |

These values come from `git show <commit>:pom.xml`, not branch names. The
Git blobs for `PSASUWSysInitDERuntime.groovy`,
`ModelSysDBSchemeRuntimeEx.groovy`, and `K8sPSDCClusterProvider.groovy`
are identical at all three heads. The branches contain other different files,
but switching between them cannot fix the observed failures in these scripts.

The upstream parent POM directly declares 27 `net.ibizsys.plugin`
dependencies at `${ibiz.cloud.version}`. Comparison by parsed Maven
`artifactId` against `ibiz-service-hub/libs/*/pom.xml` finds 26 same-name
local modules; all 26 have the different `cn.ibizlab.plugin` parent groupId.
`ibiz-plugin-jasperreports` has no same-name local module. Matching directory
names are **not** equivalent Maven coordinates or proof of API compatibility;
an explicit dependency mapping and a compiled runtime graph are required.

## Known DTO contract

`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/groovy/net/ibizsys/modeling/core/dataentity/PSASUWSysInitDERuntime.groovy`
uses `@CompileStatic`. It calls eight extra setters on `PSSysAppDTO`:
`setAppPKGName`, `setPSAppTypeId`, `setPSPFId`, `setPSPFName`,
`setPSPFStyleId`, `setPSPFStyleName`, `setPSSysServiceAPIId`,
`setPSSysServiceAPIName`; and four on `PSSysServiceAPIDTO`:
`setCodeName`, `setAPIMode`, `setAPIType`, `setVer`. The two DTOs in
`ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/dto/`
currently contain these methods as **uncommitted edits**. The Groovy call
sites also use `getPSSysServiceAPIId`, `getPSSysServiceAPIName`, and
`getPSSysAppId`, which are present in the current DTO source. A source
inspection is not a Groovy compile or a runtime integration test. No other
calls to these two DTO types were found in upstream Java/Groovy source at the
time of this audit; other DTO types and transitive APIs are not cleared.

The live `modelingservice` log on 2026-09-28 confirms wider startup failures:
`PSASUWSysInitDERuntime` fails static compilation on DTO setters;
`IBizCloudPSDCMSPlatformProvider` and `K8sPSDCClusterProvider` fail on
typed addin-data methods (among other missing API calls); and
`ModelSysDBSchemeRuntimeEx` cannot override `fillDataSource(DataSource,
PSSysModelInstDTO)` because the local base declares
`fillDataSource(DataSource, Object)`. The latest observed failure was a
Spring `Application run failed` registering `ModelSysDBSchemeRuntimeEx`;
an HTTP probe of `/modelservice/` returned a connection reset even though
`docker ps` temporarily showed a healthy container. DTO setters alone do
not resolve this boundary.

Do not use an older `target/` JAR to validate these uncommitted DTO changes.
The available `570.33` reference is neither the upstream `542` binary nor
the current `584.1` source build. No `542` JAR/POM was located in the local
Maven cache during this audit, so a full binary API comparison is pending.

## Verification and next gate

On 2026-09-28, from `scripts/`:

* `npm test`: **463 pass, 0 fail** (workspace scripts contracts).
* `npm run ledger`: **RESULT PASS**, 10/10 base packages locally linked,
  73 model-pinned plugins, 365 peer constraints; Java compatibility is
  outside this command's scope.

Before claiming `542` to `584.1` compatibility: compile the upstream
`modelapi-core` Groovy sources against a freshly built local `584.1`
`ibiz-modeling-core` and mapped iBiz dependencies, resolve the missing
JasperReports dependency deliberately, then run the Modeling wizard and
serialization/runtime tests. Obtain the exact `542` dependencies to compare
binary signatures if binary substitution is required. Record the new build
receipt and tested runtime image; until then this boundary remains blocked.

Preferred alignment for the current local-source objective: keep the local
`584.1` platform as one coordinated build, migrate the `542` Modeling
Groovy/model contracts to its real APIs (DTOs, addin-data types, database
override and other static errors), and rebuild the source JAR and Docker
image before testing system registration and endpoints. The alternative is a
complete `542` platform dependency graph and corresponding runtime image,
if obtainable; mixing selected `542` JARs into `584.1` or editing the
`ibiz.cloud.version` string alone is not an alignment.
