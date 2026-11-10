# Internal Message Authorization Candidate

Date: 2026-11-09

## Status

Source fix implemented only in `ibiz-cloud-saas-extension`. No retained
container, network or SQL resource was mutated. Compilation and JUnit execution
used fresh temporary `--network=none`, read-only, non-root containers.

Final receipt:
`.artifacts/internal-message-authorization-20261109-r6/report.json`

- Java 11 bytecode compilation passed in the pinned Java 17 image.
- JUnit Platform 1.7.0/Jupiter 5.7.0: 9 passed, 0 failed, 0 skipped.
- Real native model roles and `DataSetDRProvider` conditions executed in H2
  1.4.200 in-memory MySQL mode.
- Includes 144 by-key actor/target/action combinations, not merely list tests.
- This is offline source evidence, not a new packaged image or live HTTP
  authorization acceptance receipt.

## Defect And Fix

The extension's legacy `DataEntityAccessManager` returned true for every by-key
operation. `SystemRuntime` actually registered that manager, so declaring
CurReceiver/CurSender roles in JSON did not protect Get/Update/Delete/mark_read.

The system manager now selects `InternalMessageAccessManager` only for
`INTERNAL_MESSAGE`. Other extension entities are unchanged. The new manager
delegates to the existing native cloud superclass, using the actual
`cloud_user` model's CurReceiver/CurSender grants and dataset conditions for
by-key existence checks. Missing model assignments remain denied. Native
superuser and explicitly granted model ALL-data scope are preserved.

Ordinary personal creation additionally requires:

- Sender equals the authenticated `srfuserid`.
- System tag equals the actual employee context's `dcsystemid`.
- Owner type is PERSONAL; an explicitly supplied owner ID is the actor.
- Recipient is a real native CloudSaaS directory person in the actor's tenant.

The EBSX typed EmployeeDTO exposes `sys_person.DC` through `DOMAINS`; it does
not declare SRFDCID. Recipient validation uses this typed Domains membership,
and rejects a conflicting optional SRFDCID rather than choosing whichever
field matches. Directory absence/failure fails closed.

For ordinary updates, path/body key mismatch and changes to sender, receiver,
system tag, owner type or owner ID are denied. Normal status/title updates
remain possible after model-backed ownership authorization.

## Real Context And Fixture

The parent observed both tenants using `srfdcsystemid=ibizmodeling`, not the
generated tenant-deployment ID. SYSTEM_TAG must not be presented as a tenant
partition. Offline tests intentionally use this same logical tag for all six
people and distinguish real user IDs and directory tenant membership.

For bounded live F05 verification, create one real received personal message
through native Create for each ordinary account, with fresh UUIDs in the run
ledger. Use each actor's observed appdata user ID as sender/receiver, observed
logical system tag, PERSONAL owner type, actor owner ID and RECEIVED status.
Start from an empty owned INTERNAL_MESSAGE table and require six actual rows.

Each actor must fetch exactly its row and pass own-key operations. Same-tenant
other-person and cross-tenant Get/Update/Delete/mark_read attempts must deny
without physical changes. Mixed own/foreign batch keys must deny.

`mark_read` uses UPDATE permission and sets status READ. `mark_all_read` has
NONE action permission but its native SQL restricts updates to the session
receiver, session system tag and RECEIVED state. There is no separate native
mark_unread action; an authorized own-row UPDATE to RECEIVED represents that
transition. Verify only the intended rows change, including fresh-session
readback and unread filtering.

Finally, use each owner to perform native Delete for its UUID and require the
physical table to return to zero rows. Do not replace denied native cleanup
with a SQL fallback or erase failed negative-test evidence.

## Remaining Gates

- Rebuild/package the changed module and source-bound runtime image.
- Include the new module's JUnit tests in the source-package test selection.
- Execute the nonempty six-recipient native HTTP matrix and cleanup.
- Verify real CloudSaaS directory membership in the rebuilt application.
- Exercise draft/check-key/capability probes: CREATE checks without a payload
  now fail closed and are not claimed as UI composer acceptance.
- Audit remaining extension entities independently; their legacy allow-all
  behavior was deliberately not changed by this bounded fix.
