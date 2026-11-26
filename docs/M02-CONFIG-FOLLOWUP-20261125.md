# M02 Configuration Follow-up

Date: 2026-11-25, Asia/Singapore.

## Manual Requirements

Modeling is an independent capability outside the PLM manual's 125-page catalog.
The checkpoint requires native model CRUD, real associations, normal developer
identities, persisted readback, rejection of foreign roots and cleanup.
Configuration declarations, empty HTTP 200s, an administrator label and old
receipts do not satisfy those requirements.

## Local Implementation Observations

The owned fixture's historical empty configuration and the current shared
Modeling service are different scopes. The old owned read receipt remains
historical evidence for its fixture. It is not evidence that current shared
PSPF/PSPFStyle/PSAppType tables are empty.

This follow-up fixes these concrete problems:

- The audit accepted any three integer zero counts without checking the run,
  exact entity set, HTTP status, successful receipt status or response hashes.
  It now validates all of them and identifies conflicting historical reads.
  Model metadata now has `rows: null`, because metadata is not a database count.
- Configuration planning omitted required PSPF publishing-object fields and
  PSPFStyle's actual `PSPFID`. Required physical fields now come from the
  authoritative entity models. The plan binds builtin action contracts and
  records that no configuration data importer is declared in these models.
- A plan must preserve fetched configuration. It no longer asks for tables to
  be emptied as a precondition. The isolated owned plan remains blocked on its
  own evidence; existing coherent native options may independently support
  work in a legitimately authorized current developer root.
- Default `PSConfigDEAccessManager` record writes remain denied, including for
  an administrator. Its permissive search-context overload does not authorize
  Create/Update/Delete. Plugin selection precedence and source-only limits are
  explicit. No policy was relaxed.
- Standalone backend route helpers now enforce the same DNS-label length
  boundary as the full configuration builder.

No official version-bound configuration archive or approved configuration
maintenance importer was established. Historical shared SQL is still not an
owned seed. This does not mean that already configured native options must be
reimported before any application work.

## Current Version Evidence

`audit-owned-modeling-config-sources.mjs --probe-existing` used normal login,
native organization selection and exact non-parent FetchDefault routes against
the already running ModelDesign service:

| Configuration | Actual HTTP | Returned Rows |
| --- | --- | ---: |
| PSPF | 200 | 3 |
| PSPFStyle | 200 | 10 |
| PSAppType | 200 | 6 |

The receipt is private:
`.artifacts/m02-config-probe-20261125-r1/report.private.json`.
It contains request hashes and counts, not row values, tokens or credentials.
The three existing containers retained ID, image, configuration, mounts,
start time and restart count.

The independent prerequisite runner reused the existing native selection
contract rather than inventing IDs. Normal login, native organization selection,
native Modeling appdata, all three configuration reads and Central developer
and root lists returned 200. With the current configured account, Central's
`PSDevUser.FetchCurDC` returned zero rows and
`PSDevSlnSys.FetchCurUser` returned zero rows. That result establishes neither
an accessible developer root nor a coherent selection for a particular center.
The runner does not relabel it as missing global configuration.

The user authorized native creation of a minimal owned developer solution/root.
The same normal account therefore attempted the published Central native
`POST /api/ibizmodeling__central/psdevslns` with only a fresh own name, code name
and memo. No center ID, developer ID, admin mode or impersonation header was
supplied. The actual response was **403**, 102 bytes, SHA-256:
`8713d24250c7e3ac956469864a4a7af1ac93070d30f5652eb22c3f11343ea17a`.

The runner stopped further writes in that session. It did not retry the write, choose
another account, try a different write route, assign a role or create a root/App.
No issued resource ID was returned. The original run did not independently
read back persistence after the rejection.
The original receipt's `NO_CREATED_RESOURCES` cleanup label means only that no
issued IDs were captured; it is **not** cleanup or no-side-effect acceptance.
The runner's current contract labels that case
`NO_ISSUED_IDS_PERSISTENCE_NOT_VERIFIED`.

The final live receipt is:
`.artifacts/m02-config-prerequisites-20261125-r3/report.private.json`,
SHA-256:
`20c99a8dbeca74c2024b233a21948b320fee8592fce5d0e43e96ea82806b1027`.
Its status is `STOPPED_NATIVE_HTTP_403`, with the runtime unchanged.

An independently bound, read-only follow-up then used the same configured
identity and normal native session initialization. It verified the original r3
report hash and exact pre-dispatch nonce/name/code intent, and issued only the
native current-center read with those exact filters. Both the exact name and
exact code counts are zero. There was no second Create, alternate identity,
SQL request, or modification of the original failed receipt. This verifies the
rejected solution namespace through that native dataset; it is not a
whole-database snapshot or full M02 acceptance.

The independent receipt is
`.artifacts/m02-config-rejected-create-20261125-r1/report.private.json`,
status `PASS_NATIVE_EXACT_REJECTED_SOLUTION_ABSENT`, SHA-256:
`f12efad18aca8b07f15e18a4c6599ef41f6aa1bee35daf40fde283920f7b09f3`.
Readback and precise owned cleanup are permitted after a rejected write;
the rejection prevents bypass or repeated writes, not independent verification.

Because native dataset visibility can filter rows, a separate physical read
subsequently strengthened this evidence. It bound the current Modeling
container's model mount, `PSDevSln` model `dSLink=DEFAULT` and table definition,
the container's declared Nacos group/service-hub ID, and both actual Nacos
`DEFAULT` and `ibizmodeling__default` datasource URLs. Both point to the same
current MySQL metadata schema, which also matches the container's declared
default schema. Independent table/column metadata was checked before SQL.

Two `START TRANSACTION READ ONLY` checks counted only the original intent's
exact name or code in that bound table. Each returned `ownRows=0`,
`exactNameRows=0`, `exactCodeRows=0`. MySQL/Modeling/Nacos runtime identities,
configuration/mount hashes and lifecycle remained unchanged; the Nacos
configuration hash was rechecked. No business row data was returned.
The original failed r3 receipt remains unchanged.

The physical receipt is
`.artifacts/m02-config-rejected-physical-20261125-r1/report.private.json`,
status `PASS_EXACT_SOLUTION_PHYSICAL_ABSENCE`, SHA-256:
`2e8161dbe63d277fad06edfce36ed312caa2efdf4684f132bc1136fb8b2142da`.
This proves absence of that rejected solution namespace in the actual bound
physical table. It does not claim that every audit/log side effect was examined.

## 2026-11-26 Center Context Control

After the rejected Create, a separate normal administrator session performed only
read-only center/context checks. Normal login, native organization selection,
All-in-One appdata and Modeling appdata all returned 200; the returned
organization, user and person identifiers matched the authenticated session.
Modeling appdata still contained no `srfmodelcontext`, so this session had no
selected development root. The published Central
`PSDevCenter.FetchDefault` request returned HTTP 500 with a 106-byte response and
was stopped. No alternate route, guessed center, Create, SQL request, role grant
or second write was attempted.

Private receipt:
`.artifacts/m02-modeling-center-context-20261126-r1/report.private.json`,
SHA-256 `62e241bce5dc1b838359f5c51544527d5cd21c2b1e8cb612526ce0853aacaacc`.

The mounted current `ModelAPI.json` was also checked. `PSDevCenter` publishes
GET and PUT operations, but no FetchDefault operation, even though the Central
app metadata declares that dataset. The 500 therefore remains a published-model
contract gap requiring an explicit reviewed implementation; it is not evidence
of an empty center list or a missing developer. The un-deployed
`ibiz-service-hub` model-context changes are not used as current runtime evidence.

The relevant source permissions are explicit:

- `PSDevSlnDEAccessManager` allows solution Create only for an actual current
  developer with admin mode, not merely a UAA superuser.
- `PSDCResourceDEAccessManager` maps developer-member Create to current-center
  Update authorization.
- `PSDevCenterDEAccessManager` rejects center Create/Delete and requires a
  matching current developer center for other operations.
- `PSDevUser.CreateEx` is also a CREATE action. Its memo says it avoids creating
  a duplicate employee; it is not an unauthenticated registration or a way
  around center authorization.

There were no SQL writes, configuration-base-table writes, container
pull/create/recreate/restart operations, role grants, commits or pushes.

## Pending Decisions / Blockers

M02 remains open. The immediate current blocker is a legitimate native
developer/center administration identity or its authorized provisioning entry.
Nonempty shared configuration has been proven and must no longer be described
as universally empty. The official-source/import question remains relevant to
rebuilding the isolated owned configuration, rather than a blanket prohibition
on all existing native application work.

PSSysApp Create/Update/Remove and cross-root rejection were not executed.
The read-only chooser tests prove the selection contract, not those workflows.
If an authorized developer identity is established later, the runner must use
the root and logical system returned by native Modeling context, preserve
configuration, and bind every own write/readback/cleanup to the issued IDs.
