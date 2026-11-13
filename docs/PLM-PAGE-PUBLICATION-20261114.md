# Page Publication Flow Repair

Date: 2026-11-14, Asia/Singapore. Scope: MV10 source-model publication and
the lock-guard boundary, not full native publication acceptance.

## Findings

The existing uncommitted publication repair introduced an Update destination
for existing IDs while retaining an unconditional fallback from
`RAWSFCODE_01`, which has `parallelOutput: true`. The actual framework runs
every matching outgoing link in this mode. Existing drafts could therefore
reach two persistence branches, and the new direct Update branch skipped
the node setting `IS_PUBLISHED/PUBLISHED` to 1.

The earlier published/unpublished decision also had gaps for mixed or missing
publication flags. A client-generated draft ID does not prove that a physical
row exists, so direct Update is not a safe substitute for standard Save.

## Integrated Repair

- Keep publication `CUSTOM`, with its existing `UPDATE` authorization.
  This adopts the previously uncommitted, related mode correction in the
  entity, standalone action, desktop/wiki/mobile app methods and generated
  desktop TypeScript. Other pre-existing worktree edits are not bundled.
- Preserve the added `DEACTION3` node, but use the standard Save action.
  Standard Save selects Create or Update using the provider, not ID presence.
- Make the existing/new-ID links complementary. Both first-publication paths
  set the two publication flags before Save. Parallel output is retained but
  exactly one branch can run.
- Define the unpublished decision as the actual framework `notMode` negation
  of the two published flags. Missing/mixed flags no longer fall through with
  no persistence.
- Preserve publication name/content/author/time, identifier sequencing,
  returned object and the existing placeholder-ID normalization.
- Synchronize the entity-embedded logic with the standalone definition using
  TypeScript's JSON AST range. The mechanical synchronization verifies that
  no other entity property changes.

The persisted-lock guard is a separate repair documented in
[PLM-KNOWLEDGE-20261114.md](PLM-KNOWLEDGE-20261114.md). Standard Save's existing-row
path reaches guarded Update. No SQL bypass, private test endpoint or direct
database cleanup is introduced.

## Verification

```sh
node --test scripts/tests/plm-page-publication.test.mjs
```

The seven tests include:

- Exact standalone/embedded action and logic equality.
- CUSTOM/UPDATE consistency across desktop/wiki/mobile models and parsing
  the actual generated desktop TypeScript with the TypeScript AST.
- Actual Groovy sequence script execution and actual framework
  `DataTypeUtils` comparisons.
- A bounded interpreter for the real JSON graph, with JavaScript timestamp
  code executed in a controlled VM and storage represented by an observable
  Save boundary.
- 1008 combinations of IDs, flags and identifiers, checking one Save,
  publication flags, metadata, Unicode preservation and returned values.
- A negative regression that restores the unconditional link and reproduces
  two Save calls.
- Official `PSModelServiceImpl` parsing of `notMode` and both Save references.

These are script/model/conditional-path checks, not a real provider or HTTP
transaction. The Save boundary's record set and generated IDs are controlled
test data. Actual database key generation, permission checks, content
versioning, locking and transactional rollback require the owned environment.

The first five standalone tests passed before parent integration; the parent
then added aggregate and client consistency checks and synchronized the
aggregate. No failed native run was relabeled as a source success.

## Preservation And Remaining Gates

The knowledge agent's aggregate delta remains a historical snapshot of its
own lock/share changes. Parent publication synchronization adds an explicitly
reviewed related dependency; its final source must be identified by the
integrated Git commit, not by replaying the earlier knowledge-only patch.

Private source backups and intermediate tests remain under `.artifacts/`.
No shared service restart, SQL write, new business container or candidate
promotion was performed for this repair. Models are existing bind inputs,
so possible lazy loading is not equated with a controlled deployment.

Before closing MV10, execute new draft, existing draft, republish and failed
publication over real APIs for ordinary/read-only/nonmember/shared-editor
roles. Verify one persistence/version transition, lock denial without side
effects, correct Create/Update behavior, draft/public separation, rollback,
refresh and cleanup by exact owned IDs. Broad anonymous sharing security and
Chinese error localization remain separate open gates.
