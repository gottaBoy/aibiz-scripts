# Model Context Bootstrap

Checkpoint: 2026-11-15, Asia/Singapore. Scope: R01/R02 routing metadata,
not a grant of generic `PSSYSTEM.READ`. All **25 top-level acceptance items**
retain their previous status.

## Read-Only Contract

The existing authenticated `/appdata` path can now return an optional,
top-level `srfmodelcontext` object containing exactly two strings:

```json
{
  "psdevslnsys": "<selected-root>",
  "pssystemid": "<authorized-logical-system>"
}
```

This is routing metadata, not a credential, full system record or promise
that every system view/action is permitted. The existing native root
authorization resolves its values; no client logical-system value is used.
There are no additional service reads, account/role mutations, SQL writes
or token-lifetime changes in the projection helper.

The projection requires a valid requested root, a positive, unexpired
READ-capable root grant (or its existing scoped admin mode), and a matching
current developer identity and developer center. The logical system must
be valid and the resolved grant must match the request root. A conflicting
principal/center/root/logical ID raises ACCESSDENY before metadata is
published. Unreadable/missing/expired grants and malformed/missing request
roots receive no projection; a previous projection is cleared first.
Base appdata can still succeed without granting library READ access.

Only the root ID and logical system ID are serialized. Configuration,
`USERPARAMS`, DSL/model data, datasource information, admin flags, grants and
the complete `PSSystemDTO` are not included in this object. Native entity
permissions and the modeling entity registry are unchanged.

## Frontend Binding

Both maintained Vue utility source trees consume the optional projection
through the normal `parseRouteViewData` path. They snapshot the authenticated
appdata/projection/token generation before awaiting the actual view-model
lookup. When a rooted route is resolved, they:

- Require the exact two-field shape and valid, nonblank identifiers.
- Require the selected root and any incoming logical-system values to agree.
- Reject a changed token, appdata object, projection object, in-place root/
  logical ID, or reactive route during the asynchronous lookup.
- Reject a projection first introduced while a legacy lookup is pending.
- Set `pssystem` and `pssystemid` only after all checks, without changing the
  source appdata or overwriting a conflicting supplied context.

Messages have Chinese and English entries. Accessor-backed projection
fields are rejected without invoking their getters. Unrooted routes do not
inherit a previous root's logical IDs. Older servers without the field keep
their old route semantics; this compatibility is not native acceptance.

These checks protect an invoked route-parser operation. They do not prove
every host component reloads on every root change or handles disposal
correctly. Complete shell/menu/root-switch/relogin workflows remain open.
The current shell maps route-parser failures to its 404 route, so correct
visible presentation of these failures also needs a host-level review.
The metadata is not cryptographically attested and does not replace native
server authorization of subsequent requests.

## Source Delivery

| Repository | Commit |
| --- | --- |
| `ibiz-service-hub/master` | `2638748b` |
| `ibiz-app-hub/master` | `991b2fe7` |
| `modelingweb/main` | `88e33cdd` |
| `scripts/main` | This document's commit: cross-fork route tests and progress |

The hub's existing automatic-pull hooks were skipped per command with
`HUSKY=0`; explicit tests and diff checks ran. No hook configuration changed.
Shared JARs, static dist, raw bind-mounted models, services and databases
were not modified in this wave. The previous three-view model patch remains
isolated and unapplied to shared input.

## Current Evidence

| Scope | Result | Private Receipt |
| --- | --- | --- |
| Current Java authorization selection | 151 tests, zero failure/error/skip | `.artifacts/model-context-permission-20261115-r3/report.json` |
| Modeling module and reactor prerequisites | 320 tests, zero failure/error/skip; includes the focused tests | Same receipt, full stage |
| Joined Node source/tool/browser-fixture selection | 529/529, 18 files, concurrency two; zero cancellation/skip/todo | `.artifacts/model-context-bootstrap-20261115-r1/final.tap` |
| New cross-fork route tests | 66 cases, including actual route parsing, delayed responses, malformed values and bilingual messages | Included in joined Node |
| Full candidate TypeScript | 2,891 root files / 3,652 checked source files; zero diagnostics | `.artifacts/frontend-source-types/2026-11-15T07-35-00.908Z-OXytc0/report.json` |
| Vue utility source build/verifier | 208 compiled modules / 3 output files / 179 mapped source files; input/output checks passed | `.artifacts/frontend-source/2026-11-15T07-35-00.659Z-uhhkpY/report.json` |

Java includes the actual manager appdata path and production JSON
serialization, plus six new projection/principal tests. Source data/cache
I/O is controlled in those tests; there is **no new native HTTP acceptance**.
The Java build is offline, network-none, CPU/memory/process-bounded, on
private source/repository snapshots. Its compiler containers auto-removed.
Earlier r1/r2 receipts retain their intermediate source scope; r3 is current.

The first route-test fixture omitted the runtime ViewType enum and used the
wrong locale export. Those harness defects were corrected by loading the
real enum and named locale exports, not by weakening product conditions.
No full `npm test`, backend packaging/image build or shared rollout ran.

Receipt SHA-256 values:

- Java r3: `ba4e99b3fdbb7b54900b4b396043aaa5dece8a1d7243d159e910e73258024a79`
- Node final: `82a881c8720e66c127804742e5a8af742be4a4a43e49042380242d144424ff8d`
- Source build: `e1a0dc257786ea11f6e53bf94a8b8edb39cf10102d72786e001c4fd5a0f36da1`
- Full types: `6ebdd6a034c0bf907b0296c24f1496ac9ad3196a88d2dfe728450fd7a3f416bc`

## Remaining Gates

| Subtask | Status |
| --- | --- |
| Minimal native appdata projection and JSON shape | Source/unit verified only |
| Cross-fork route binding and delayed-result rejection | Controlled source verified only |
| Current-source backend package/images and complete frontend candidate | Not built in this wave |
| Ordinary-auth root-scoped appdata HTTP, own/foreign/expired/no-access, physical snapshots | Not run in a new owned stack |
| Three-view dynamic-context patch in the owned staged model | Still required; shared files unchanged |
| Intended system-details/settings READ projection and role policy | Open; generic PSSYSTEM.READ remains unchanged |
| Shell/menu root switch, disposal and full eight-editor/48-role matrix | Open |
| Same-token revocation, nested sessions, native Unicode and release gates | Remain separate canonical items |

The existing root-grant cache/session semantics were not redesigned. This
work does not close A02 same-token revocation or A03 nested-session work.

Final observed Docker inventory is private under
`.artifacts/model-context-bootstrap-20261115-r1/runtime-final/`: 12 shared
services, 18 tags / 18 image IDs, no owned/historical containers. Image-lock
verification passed. The older runtime-input manifest is not a current
Git-identity match after these new commits; mounted-byte identity is not
source/build equivalence. Release, native, full-source-closure and served-
byte acceptance remain false.
