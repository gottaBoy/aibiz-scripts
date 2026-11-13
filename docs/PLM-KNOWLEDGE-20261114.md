# PLM Knowledge Boundaries

Date: 2026-11-14. Scope: MV10 draft/publication/lock/share review and narrow
server-model repairs. This is not full multi-role or anonymous-share acceptance.

## Manual Requirements

The knowledge rules in `docs/manual/TEST-KNOWLEDGE.md` require:

- Draft and published content are separate; public viewers must not receive
  unpublished content.
- A locked page cannot be edited by a normal member, shared editor or
  administrator until a valid unlock operation occurs.
- Read-only members may associate a page with another resource but cannot edit
  page content.
- Revocation, expiry, password and shared-subtree restrictions must apply to
  real requests, not only the shared-page UI.

## Findings And Repairs

### Persisted Lock Guard

Observed source chain:

1. `article_page` maps to the physical `PAGE` table.
2. Its `Update` action previously ran `sync_name`, then `commit_version`, with
   no persisted lock check.
3. The existing, already-dirty `publish_page` repair routes existing-page
   publication through `Update`, with `Save` used on another branch.
4. In the local framework source, `DataEntityRuntime.executeAction` routes a
   persistent existing-key `Save` to `Update`.

Implemented in `plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/`:

- New backend-only `PSDELOGICS/guard_locked_page.json`.
- The first `Update` BEFORE hook resolves that guard, before name sync and
  version creation; standalone and entity-embedded action metadata agree.
- The guard reads only persisted `ID` and `IS_LOCK` from `PAGE` by a bound ID
  using `FOR UPDATE`; it does not fetch bodies or `ACCESS_PASSWORD` and does not trust request
  `is_lock`, administrator status or a client-supplied override.
- A missing stored row is denied. When the stored lock is set, a request
  containing any listed content, publication, version, hierarchy, attachment,
  deletion or lock field is denied even if its value looks unchanged.
- This presence check also prevents a crafted no-op `TYPE`/`IS_PUBLISHED`
  request from reaching the subsequent name-sync/version hooks.
- `closed_shared` and `shared_setting` call the new backend
  `share_metadata_patch` logic after preparing their metadata. This builds a
  fresh DTO containing only ID and the allowed sharing fields before Update.
  Full input DTOs, native parent-route `SPACE_ID` and malicious body fields
  cannot contaminate the generic page write. Passwords are included only
  while enabling/configuring sharing, not by a revocation payload.
- The resulting metadata-only patch can revoke or update sharing on a locked
  page without providing the `TYPE` or `IS_PUBLISHED` conditions used by the
  later hooks. A direct generic locked Update containing body fields still
  fails; the content lock was not weakened to accommodate the UI.

The guard is model-executed and resolved by the official model loader; no
unwired Java/Groovy helper was added as a substitute for integration.

### Narrow Lock And Unlock

The original lock and unlock logic fetched a full page DTO, changed its lock
flag, then updated the full DTO. Besides conflicting with a persisted guard,
that could write an older fetched body back during concurrent editing.

The last node of both `lock_page` and `unlock_page` now updates only `IS_LOCK`,
with a bound ID from the fetched page and `IS_DELETED = 0`. Their existing
outer `UPDATE` authorization and Get step remain. Supplying a new body to
these actions cannot include that body in the final SQL.

These actions no longer pass the flag-only mutation through generic
`Update`/version/name-sync hooks. Whether additional audit/notification
behavior is required for lock transitions needs native regression; no
equivalence claim is made for those secondary effects.

### Password-Bearing Configuration Read

`shared` is the settings-read action: `get_shared_info` reads and decrypts the
stored share password for its response. It previously required `READ`, while
`shared_setting` and `closed_shared` require `UPDATE`.

The settings-read permission is now `UPDATE` in:

- The standalone `shared` action.
- The entity's embedded `shared` action.
- All three article-page `/shared` method definitions in `ServiceAPI.json`.

This preserves the existing page-editor permission model. It does not
replace it with the space-administrator-only `space__SHARED` privilege.
`check_shared` and `check_access_password` retain their existing `READ`
metadata. They are not promoted to complete anonymous security gates.

## Verification

Command:

```sh
node --test scripts/tests/plm-knowledge-boundaries.test.mjs
```

Result: **13 passed, 0 failed, 0 skipped**, approximately 3.5 seconds.

The focused suite:

- Executes the actual model guard code with local Groovy 3.0.20 and the real
  framework `ErrorException`/`ACCESSDENY` classes.
- Checks locked content/publication/version changes, forged inline unlock,
  missing rows, same-value hook-trigger fields, Unicode input preservation
  and metadata-only revocation.
- Executes the actual metadata projector followed by the lock guard with a
  full DTO, native injected `SPACE_ID`, forged lock/body fields, revocation
  and a synthetic encrypted-password update. The source DTO stays unchanged.
- Checks action order, bound SQL, narrow lock/unlock writes, the standard
  existing-key Save-to-Update dispatch, and all three settings-endpoint
  permission definitions. It does not require the pre-existing uncommitted
  publication `CUSTOM` mode or explicit Update branch.
- Checks the desktop app's shared-settings method uses the same existing
  write privilege as `shared_setting`, and all three settings UI entry
  actions have consistent authoritative/generated privilege gates.
- Loads the changed entity and the external guard model reference with
  official `PSModelServiceImpl` 8.1.0.584.1, including the actual BEFORE
  reference, both sharing-projection calls/return bindings and lock/unlock
  node types.

The official model API identifies these objects by full dynamic model paths,
not short runtime action names. The initial probe's short `Update` lookup
failed; using the authoritative path resolved the same model successfully.

This is executable model/script evidence, not HTTP, SQL-provider, role,
deployment or browser acceptance. The page DTO in the script tests is a
controlled field container, not a running service.

## Transaction Boundary

Inspected local framework source:

- `ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/dataentity/DataEntityRuntimeBase.java`,
  `getTransactionalPropagation`: ordinary UPDATE defaults to REQUIRED;
  READ/GETDRAFT use SUPPORTS.
- `ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/DataEntityRuntime.java`,
  `executeActionReal`: action execution requests the selected propagation.
- `ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/ActionSession.java`,
  `execute`: absent transaction utilities or non-database source tags can
  execute without a database transaction.
- `ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/database/SysDBSchemeRuntimeBase.java`,
  `executeSelectSQL`: an inactive scheme can create a separate transaction.

Therefore the SQL's row-lock syntax alone does not prove that the guard
and final Update share one active database transaction/connection. Actual
provider transaction binding, lock contention, rollback and cross-process
lock/edit races remain mandatory owned-environment checks.

## Dirty Worktree Preservation

The pre-existing `article_page.json` bytes were saved before edits at:

`.artifacts/plm-knowledge-boundaries-20261114-r1/original/article_page.json`

SHA-256:

`7fd79fe2899d082d96fd56f48acece9c3c1509a07a414b8d6b84290b93fa5c01`

The generated private delta against those original bytes is:

`.artifacts/plm-knowledge-boundaries-20261114-r1/article_page.owned.patch`

Delta SHA-256:

`31cdad901e9427a4a43510690e4be4c5d8572c3263b79cf9048ea203863a3fba`

Desktop app/generated originals and their separate owned deltas are under
the same private artifact directory:

| File | Original SHA-256 | Owned delta file and SHA-256 |
| --- | --- | --- |
| `original/plmweb-article_page.json` | `5599208f2c0aaa1e4cf1778ede0967c870ddc1a5442b073599f7059cf02e32ec` | `plmweb-article_page.owned.patch`: `b9f0afeb72ffa8a1fc51b143b96f9df26816480846d643b4a2c1a2d0cc0c4a4b` |
| `original/plmweb-article-page.ts` | `01129578d07314e2596254692c206c834ae5404581ad1700dbb52852798d4af0` | `plmweb-article-page.owned.patch`: `a9cfde3fdcc3defa407a6a4fecc6cf380406b0cc28f7ddea8114afc6767cd4cb` |

The new aggregate delta is limited to the guard/projector references,
sharing-patch calls and parameters, settings-read permission, and lock/unlock
final nodes. Existing publication mode and publication logic repairs are
preserved. The two separately backed-up dirty desktop app/generated files
receive only the settings permission alignment described below. No `space`
model, existing `publish_page` logic, root matrix or other agent's file was edited.
No staging, commit or push was performed by this task.

No shared-data request, database write or container lifecycle operation was
executed. Model files are existing bind-mount inputs: no explicit reload was
requested, and whether a long-running service lazily observes these changes
has not been tested.

## Remaining Acceptance And Blockers

1. Root-coordinated owned environment: native locked Update, Save and publish
   rejection for editor/shared editor/admin; no content or version delta.
2. Authorized native lock/unlock ignores body fields; unauthorized/read-only
   callers are denied; valid unlock then permits editing.
3. Lock/edit concurrency uses the same real transaction and connection;
   failed multi-step actions roll back version/relationship side effects.
4. Locked share revocation reaches the endpoint, preserves page body/version
   and invalidates existing viewer sessions. Direct generic Update requests
   carrying full DTO protected fields must fail. `shared_setting` and
   `closed_shared` full DTO inputs must instead succeed through projection,
   without silently changing the title/body or creating a version.
5. `/shared` settings denies read-only, nonmember and anonymous callers;
   existing authorized settings editors still work. Test whether internal
   `check_shared` calls retain the intended service-side execution contract.
   The UI audit found `open_shared` and `open_shared_setting` already gated
   by `SHARED`/`space__shared`. The same gate was narrowly added to
   `open_shared_setting_management`, and both desktop `shared` app method
   copies now use the existing `shared_setting` privilege `UPDATE`.
   Exact locations are
   `plm-web/src/publish/model/entities/article-page.ts` (three UI actions),
   `plm/model/PSSYSAPPS/plmweb/PSAPPDATAENTITIES/article_page.json` (the same
   actions and `shared` method), and
   `plm-web/src/publish/model/views/article-page-shared-setting-view.ts`
   (dialog load). The app JSON and generated TS were backed up and patched
   without rewriting unrelated user changes. Mobile/wiki app copies and
   inline/monolithic generated view copies were not regenerated; multi-entry
   read-only UI regression remains follow-up work. No unconditional normal-preview settings
   fetch was found in that inspected path.
6. Public/Get/search/attachment/version responses must select published
   content, never draft `CONTENT` or password material. This broader response
   projection has **not been repaired or accepted** by this change.
7. `check_shared` still compares calendar dates rather than the precise
   expiry instant and does not establish full revocation/deleted-page rules.
   Frontend preflight is not a reusable server authorization proof.
8. Page vs. space shares, password refresh, expiry, subset/ancestor boundaries,
   revoked grants and cross-space/tenant traversal require an explicit
   runtime contract and negative HTTP matrix. No synthetic share token or
   alternate route was introduced.
9. The lock guard enumerates current protected model fields; custom extension
   attributes and independent attachment/relationship write endpoints still
   need separate coverage.
10. Guard failures retain stable framework error code `ACCESSDENY` (2) and
    canonical English messages. Chinese UI error mapping and bilingual
    browser evidence remain a localization gate; no unverified translation
    API was invented.
11. The task-start working tree already changed `publish_page` mode from
    CREATE to CUSTOM and added an existing-page Update branch. These changes
    are excluded from this task's owned aggregate delta, and tests must also
    pass against the committed base publication model. That dirty logic's
    `RAWSFCODE_01` has `parallelOutput=true`, a conditional existing-page link
    and an unconditional first-save link; possible double execution, UUID
    behavior and complete publish semantics require separate review. Nothing
    was reverted or implicitly adopted as this task's repair.

MV10 remains **partially repaired / native multi-role acceptance pending**.
This document does not close the draft, public sharing, inheritance or
concurrent-transaction gates.

## Parent Integration

The parent reviewed the pre-existing publication changes separately, repaired
their parallel branches/flag handling, synchronized the entity copy, and
included the related CUSTOM action-mode corrections as explicit dependencies.
See [PLM-PAGE-PUBLICATION-20261114.md](PLM-PAGE-PUBLICATION-20261114.md).
The knowledge-only private delta above remains a historical scoped receipt,
not a patch to replay over the integrated final model.

The integrated PLM source is `56f1d50a0`; the desktop permission and publication
mode changes are PLM Web `44cad299` and `6ce5d8bb`. Parent validation exported
only the staged model tree and desktop TS into a private clean directory:
the 13 knowledge and seven publication tests passed **20/20** there.
This verifies that no other uncommitted work is required for those tests,
not that provider transactions or real role/shared-link behavior are accepted.
