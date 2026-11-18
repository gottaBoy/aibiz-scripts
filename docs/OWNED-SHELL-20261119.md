# Owned Native Shell Checkpoint

Started: 2026-11-18; completed: 2026-11-19, Asia/Singapore.
Status: **VERIFIED-OWNED-APPINDEX-SHELL-ONLY-NOT-DEPLOYED**.
Record: [aibiz-owned-shell-20261119.json](../records/aibiz-owned-shell-20261119.json).
The canonical matrix still has **25 top-level items not fully accepted**.

## Implemented And Actually Replayed

The new owned run `26003965df88` used the current frontend distribution,
newly assembled native model/plugin inputs and newly packaged backend
`2604bc86`. It never reused a retired container or replaced shared services.
Modeling delivery is `eefd0be9`; earlier changes in this wave are
`ec9dd1cb` and `3ca3c17f`.

Actual replay exposed gaps that the earlier controlled fixture did not:

- ModelUtil adds `appId` to nested CSS models. The shell marker incorrectly
  treated that framework metadata as custom CSS and refused the native
  layout. It now permits only the matching app identity, not arbitrary CSS.
- The real header provider is `PanelAppHeader`, not the generic
  PanelContainer used in the earlier fixture. CSS and the browser fixture
  now cover the actual component.
- The real side menu contains a separator. The observer no longer treats
  it as an actionable button; mobile CSS removes only that decorative
  separator so Settings remains in the six-command grid.
- The header reserves space for its actual 40px logo. Its mobile inner rows
  retain intrinsic width inside scroll containers, avoiding inaccessible
  negative overflow from centered content. The account control's native
  height variable is scoped to the recognized 40px header.
- A real Playwright reload/interceptor race was reproduced deterministically.
  A retained page fallback bridge prevents temporary login-route removal
  from auto-continuing a request still owned by the strict context guard.
  Route failures remain failures; no error text was filtered or retried away.
- The owned input preparer now rejects an output directory whose basename
  differs from its launch identity before expensive source verification.
  The launcher was not weakened.

## Current Runtime Evidence

All four ordinary editor/own-root cells, Chinese/English x desktop/mobile,
passed the exact shell gate after normal UI login and real appdata
projection consumption. The observer checked actual DOM/visible regions,
ordinary search-input focus without a query, the real account dropdown,
normal console opening/closing and stable overlay-free geometry.

Each final cell has zero console/page errors, HTTP errors, failed/blocked
requests, unsettled requests and verdict blockers. No static/API response,
identity, token, permission or controller was substituted.

| Viewport | Main Region After Console Close |
| --- | --- |
| 1440 x 900 | x=320, y=40, width=920, height=810 |
| 390 x 844 | x=0, y=200, width=390, height=544 |

Six actual served bootstrap/framework/index files match the final candidate,
including the rebuilt index module and stylesheet. This is not all-asset
source closure. Screenshots were visually reviewed, including the mobile
workspace after ordinary console closure.

The separate native context HTTP run passed 48 authentication observations,
12 root/projection queries and two anonymous denials, with 64 complete model
snapshot boundaries. UAA's 16 actual login/token checks passed. Neither
roster accepts native CRUD or the complete role matrix.

Complete before/after/final snapshots match across both physical model
schemas: **848 tables / 30,660 columns**. Metadata, UAA and cache whole-state
invariance is not claimed.

## Failed Attempts Remain Evidence

Browser r1 failed on the observer's separator-as-button assumption.
R2/r3 correctly failed on the missing shell marker and retained the real
mobile crop. R4 reached the restored main region and console lifecycle but
failed header-control bounds; its English desktop cell also retains
`ERR_NETWORK_CHANGED`, failed resources and an extension 404. R5 is a new
final-candidate run, not a rewrite of those reports. Host link events were
recorded privately during r5; no causal diagnosis or error exemption is
inferred from that diagnostic.

Other preflight failures are separate: the old backend package was refused
after source changed; workflow bootstrap refused a network containing UAA
peers; and a mismatched preparation output name was refused before frontend
creation. The first two UAA peers were precisely retired, schema setup was
completed, and a new UAA instance was verified. One intermediate unlaunched
asset preparation was stopped to incorporate the real separator/header
findings. Its incomplete artifacts were not promoted.

## Source Regression And New Backend Candidate

- Explicit frontend/model/bootstrap regression: **352/352**.
- Owned preparation/launch/resource contracts: **172/172**.
- Real-header controlled browser probe: **9/9**, eight language/width cells.
- Backend focused/full module stages: **151/151** and **334/334**.
- Complete backend package stage: **416/416**, including the module tests.

These overlapping rosters are not distinct business feature counts.
The source-build receipt retains three zero-test placeholders as no coverage.
The new statistics API has 14 passing unit tests and is packaged, but remains
**unbound**. The original model is still VOID; counters were not dispatched
or accepted in this shell campaign. See
[R05 Candidate](R05-OVERVIEW-CANDIDATE-20261119.md).

## Cleanup And Remaining Work

Three successive frontend pairs and their six bridges were retired before
replacements or final disposal. After final comparison, all eight backend
fixture peers and the owned private network were retired. Three exact
unreferenced run-built image tags were removed without force or global prune.
Final observation is **12 shared services / 18 tags / 18 image IDs /
zero owned or historical containers**. All twelve shared lifecycle/config
rows and 33 declared host inputs match the pre-run observation. Seven mutable
directories are included; the declared-input observations do not establish
complete host-byte freezing or deployment closure.
No shared restart/replacement, shared SQL migration, persistent-volume
deletion or unrelated-project cleanup occurred.

This is an owned iframe wrapper, not the actual PLM host. Search results,
navigation actions, nested editor/toolbars, create/save/readback/restore,
all roles, complete bilingual content, MQTT, external delivery, offline
reconstruction and shared 30250/32009 rollout/rollback remain open.
M03/M04/B04/L02/O03 are not promoted to complete by this bounded success.
