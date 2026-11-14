# Central Member Read Route Repair

Date: 2026-11-14. Scope: M01 exact owned Central scheme-list routing,
member-bound model delivery and source/controlled regression. No native HTTP
or ordinary-member create acceptance is claimed.

## Corrected Diagnosis

The historical failed request was:

```text
POST /api/ibizmodeling__central/psdevslns/fetchcurdcslnuser
```

This is the `CurDCSLNUser` READ dataset, **not a Create operation**. POST is the
published fetch method. The November 12 browser receipt records successful
login/home, the expected published app/service models and authenticated 404
for this exact dataset request.

Historical receipt:

`.artifacts/owned-modeling-bootstrap-browser/config6-m01-route-20261112-r1/report.private.json`

That fixture was retired on November 13. The receipt is retained evidence,
not proof that the same backend or port exists now.

The current native ModelAPI already exports `FetchCurDCSLNUser`; its interface
is declared by `IPSDevSlnService`. `GatewayUtils.getAppGatewayNode` generates
the Central scheme route using its application API binding. The owned
configuration builder only published the ModelDesign root route and
configuration fetches, so the Central prefix never reached that native
method.

The old diagnostic proposed a plural route ID. Native IDs use the app entity
code name, so the canonical ID is `ibizmodeling__central__psdevsln`; its URL
collection remains the plural `psdevslns`.

## Native Create Boundary Is Preserved

`ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/security/PSDevSlnDEAccessManager.java`
explicitly rejects `CREATE` for ordinary members. The preceding developer
administrator branch binds the current developer's center. The source
contract was not changed to let ordinary members create schemes.

No admin endpoint, synthetic success body, permission header, shared SQL or
alternate API substitutes for a member route.

## Implemented Delivery Path

The owned launcher now accepts the explicit optional argument:

```text
--central-member-receipt <absolute receipt.json path>
```

Without that argument there is still no Central route. With it:

1. `readCentralMemberModelOverlay` calls the existing independent
   `verifyNativeServiceCandidate` recomputation. A view-only candidate is
   rejected; the complete `native-central-member-session-binding-candidate`
   is required.
2. Original source hashes, receipt contents and all five candidate files
   must match the existing pinned generator/contract.
3. `stageOwnedModelInput` checks those original hashes against the actual
   backend model input before creating the stage, then overlays and reads
   back exactly the five candidate files.
4. The stage receipt records original/staged model fingerprints, the selected
   receipt SHA-256 and every candidate output hash. The stage verifier
   independently rereads the complete source/stage and registers a private
   in-process WeakMap proof. Original vendor files are not changed.
5. The packaged Java route probe also extracts Central's canonical route
   from `GatewayUtils` on the staged model, rather than guessing its
   provider mapping.
6. Only when both the native route observation and fresh opaque stage proof
   are valid does `createOwnedBackendConfiguration` add the exact route to
   the private owned Nacos configuration. Before route construction it
   reverifies the candidate receipt and complete current stage fingerprint.
   A JSON binding with five valid paths and 64-character hashes, even a
   serialized copy of the actual binding, is not accepted as proof.

Published scope:

```text
Path:   /api/ibizmodeling__central/psdevslns/fetchcurdcslnuser
Method: POST
Target: the exact nf-<run>-backend-<label>-provider:32002
Filter: StripPrefix=2, PrefixPath=/ibizmodeling/modelapi
```

The route narrows the native generated entity route to a single READ
method. It does not publish the native `/**` route, Create, Update, Remove,
GetDraft or other scheme administration methods. No request authentication,
tenant, person, root or center header is added or rewritten.

The existing candidate changes both grid fetch references and synchronizes
the backend structured/SQL ordinary-member predicate:

```sql
t41.PSDEVUSEROBJID = #{ctx.sessioncontext.srfpersonid}
```

The center predicate and both original administrative branches remain
unchanged. A frontend-only view overlay no longer qualifies as backend
member-bound delivery.

## Files

Owned routing/launch changes:

- `scripts/owned-modeling-application-routes.mjs`
- `scripts/run-owned-backend-configuration.mjs`
- `scripts/launch-run-owned-native-backend.mjs`
- `scripts/fixtures/OwnedModelingApplicationRoutesProbe.java`

Diagnostic and tests:

- `modelingweb/app/tests/owned-central-route-diagnostic.mjs`
- `modelingweb/app/tests/owned-central-route-diagnostic.test.mjs`
- `scripts/tests/central-member-route.test.mjs`

The diagnostic now reads the route probe's real wrapper shape
`report.probe.contract`, distinguishes the READ fetch from Create, proposes
only the exact POST path, and refuses to reuse its missing-route diagnosis
when a Central route is already present or the observed failure is not 404.
Its regression uses local controlled files instead of requiring private
historical receipts.

## Verification

Failure-first test run: **0/4 passed**, reproducing absent route function,
missing candidate rejection/staging and original-source drift checks.
Those failures were not counted as acceptance.

Targeted regression command:

```sh
node --test \
  modelingweb/app/tests/owned-central-route-diagnostic.test.mjs \
  scripts/tests/central-member-route.test.mjs \
  scripts/tests/owned-modeling-application-routes.test.mjs \
  scripts/tests/run-owned-backend-configuration.test.mjs \
  scripts/tests/launch-run-owned-native-backend.test.mjs \
  scripts/tests/native-service-candidate.test.mjs
```

The focused route/configuration/diagnostic subset passed **135/135**.
The full roster above, including the existing native-service candidate
suite, passed **313/313**, zero failed or skipped tests, in approximately
9.3 seconds.

The tests exercise real source candidate generation/reverification, actual
temporary model staging and Nacos configuration construction. Missing,
view-only, changed-source, broad-route, changed-provider, malformed binding
tampered member SQL, forged all-valid metadata, receipt traversal and
post-verification stage mutation inputs fail closed. The route is absent by default
and scoped to one Path+Method when explicitly selected. Source files remain
unchanged. Controlled executors are not reported as native HTTP evidence.

Root independently compiled and executed the updated probe with a JUnit
wrapper in a fresh current-source Maven reactor. The fixture received only a
package declaration adaptation; its logic was unchanged. The wrapper passed
**1/1** against the actual readonly native model, and required both
`GatewayUtils` and the application factory to originate from current
`ibiz-cloud-core/target/classes`, not a cached runtime JAR. Source, model and
Maven inputs remained unchanged, and the bounded offline compiler was removed.

Receipt: `.artifacts/central-route-probe-java-20261114-r1/report.json`,
SHA-256 `b510977f240c91d37cb0c6005700a6171ffe598ce5383eee263ea424d0c98736`.
This source probe does not replace the launcher's exact packaged-dependency
origin checks or its actual staged-model probe. Neither source compilation
nor the controlled routing tests establish a live HTTP permission result.

## Remaining Acceptance

1. Use one new/recovered owned fixture with reviewed restored SQL/account
   receipts, not retired container IDs. Select and bind the full current
   member candidate to both the backend model and frontend view delivery.
2. Compile/run the updated packaged route probe with the exact backend
   dependency set and actual staged model. Fail rather than use an older
   ModelDesign-only result if Central evidence is absent.
3. Verify normal login/appdata identity and trusted center. The existing
   fixture deliberately aligns employee person/developer/user-object IDs;
   this is not a universal platform invariant. Do not substitute a body
   person ID to make membership match.
4. Execute the actual list POST with editor/viewer/no-access, another member
   in the same center, another center and anonymous identities. Compare
   response IDs to the owned authority, then navigate into the selected
   library with fresh-login evidence and unchanged physical snapshots.
5. The existing member-binding candidate does not add access-mode, expiry
   or grant-enabled predicates. Do not promote its identity equality or READ
   action to complete authorization parity; those permission semantics
   remain separately unaccepted.
6. Ordinary-member Create remains rejected by native policy. Any requested
   change to scheme-creation roles requires an explicit product/security
   decision and independent native flow, not a wider route.

No container was created/restarted, no shared configuration was published,
no HTTP write was sent and no SQL was executed by this implementation task.
The generated private configuration is not a claim that the historical 404
has been fixed in a running deployment. M01 remains active pending the native
member-list/navigation matrix.
