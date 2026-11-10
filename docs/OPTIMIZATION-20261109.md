# Modeling Optimization

Date: 2026-11-09, Asia/Singapore.

The checklist remains 5 verified and 25 not fully verified engineering items.
This round implements browser-blocker fixes and refreshes their real delivery
chain; local builds and tests do not independently close M01/M02.

## Implementation

- Central's explicit service-candidate binding is preserved through isolated
  preparation, owned preparation, launch reconstruction and bridge guards.
  Its only mounted output is the reviewed Central GridView. Binding fields,
  SHA-256, sizes, exact artifact paths, unprivileged readability and source
  transformation are checked. Receipt and model drift reject before startup,
  and receipt drift is checked again by the running bridge.
- Newly generated public model files use mode 0644 so nginx can read the
  individually mounted model; the receipt remains private. Existing candidates
  and vendor models are not chmodded or rewritten.
- MQTT overrides are validated, copied and frozen; only explicit booleans can
  override model configuration. Default model behavior is preserved. Invalid
  options and custom-guard/override combinations reject before startup.
- Todo count has pending/ready/unavailable/error states. Only real numeric
  404/405 yields unavailable; authorization/server/transport/schema errors
  remain errors. No count is fabricated. Late completion after destruction
  cannot modify state or log.

## Focused Evidence

- MQTT two-origin auth/startup/AppHub tests: 206 passed.
- Native host execution and strict type contracts: 109 passed.
- Design Index package tests: 4 passed.
- Actual ESM/SystemJS controller tests: 101 passed.
- Central/owned-launch/service-contract tests: 320 passed before the final
  additional private-umask regression.

MQTT details:
`modelingweb/docs/MQTT-DEPLOYMENT-OVERRIDE-20261109.md`.

## Fresh Delivery Chain

- Framework:
  `.artifacts/frontend-source/2026-11-09T14-42-57.882Z-8GqiDO/report.json`.
- Candidate type audit:
  `.artifacts/frontend-source-types/2026-11-09T14-42-58.027Z-VahyvD/report.json`.
- Source frontend:
  `.artifacts/frontend-candidates/2026-11-09T14-45-39.091Z-UXhjaK/report.json`.
  SHA-256 `0342a83a20f885ea23467d53f59be003686ecee17bca9e2e3922aef9d2590929`.
- Model/plugin candidate:
  `.artifacts/native-model-migration/optimization-20261109-r1/receipt.json`.
- Runtime assets:
  `.artifacts/native-ai-code-runtime-assets/optimization-20261109-r1/receipt.json`.
- Readable Central query candidate:
  `.artifacts/native-service-migration/central-query-20261109-r2/receipt.json`.

Framework, type audit, native-profile assembly and runtime-asset preparation
completed. Source-stage command logs and input-stability receipts are retained
under `.artifacts/frontend-optimization-20261109-r1/`.

## Regression Integrity

The r4/r5 full failures remain recorded. Two failures were source inventory
expectations; the other tests stopped at stale source/build provenance before
their intended mutation gates. Temporarily removing frontend or Design Index
bindings from a fixture did not preserve its full preconditions. Those
removals were reversed, not promoted as acceptance.

The runtime-integrity tests now consume the complete fresh chain and include
an unmodified positive full-verification case before the existing negative
mutations. Production verification and expected negative assertions are not
weakened. Full regression r6 passed **4919/4919**, zero failures, skips,
cancellations and todos, with stable source:
`.artifacts/current-source-regression-20261109-r6/report.json`.
The complete runtime-integrity suite also passed 5/5.

## Real Browser Replay

Owned launch:
`.artifacts/owned-native-modeldesign-launch/optimization-20261109-r1/report.json`.

Chinese and English probes:

- `.artifacts/owned-native-modeldesign-browser/optimization-zh-20261109-r1/report.json`
- `.artifacts/owned-native-modeldesign-browser/optimization-en-20261109-r1/report.json`

Both apps pass actual model, plugin assets, ordinary login, home readiness,
theme and reload stages in both languages. Both full probes remain failed:
Central actually requests the revised published dataset but receives 404.
ModelDesign's clicked APPVIEW target does not mount, and several native editor
entity datasets return 403. These are not treated as empty successful flows.
Optional extension discovery 404 and real todo 404 evidence remain recorded.

Bounded MQTT/todo policy receipt:
`.artifacts/frontend-optimization-20261109-r1/browser-policy-r1/report.json`.
Both normal-language UI logins observe actual model MQTT=true, served
deployment=false and effective=false. Each five-second sample records zero
WebSocket connections. The actual todo POST returns 404, status becomes
unavailable, no count is published and index lifecycle errors stay empty.
This is not evidence of a working PLM todo service or collaborative room.

Cleanup:
`.artifacts/owned-native-modeldesign-launch/optimization-20261109-r1/cleanup-bc029611c031.json`.
Two exact owned frontend IDs and their loopback bridge processes were removed.
The eight owned backend peers remain; no shared service or 30250 was changed.

## Follow-up Review

The original query's member EXISTS is not bound to SRFPERSONID. A GridView
repair does not fix this permission boundary, so row isolation remains false.
Owned routing currently publishes only the ModelDesign root route; add a
reviewed Central route together with trusted-member filtering and negative
cases rather than simply exposing the vulnerable query.

File creation uses model 0644 and receipt 0600, but verifier mode/owner
hardening remains a release task. Bridge guards operate per TCP connection,
not per request on an existing keep-alive stream. They must not be described as
per-HTTP-request guards or as an atomic multi-file snapshot.

## Remaining Boundaries

- Central query current-user row isolation and cross-center negative cases.
- Real PLM todo service, rather than unavailable-state evidence.
- Collaborative-room transport policy, independent of AppHub MQTT opt-in.
- Actual editor workflows and multi-role browser permissions.
- No shared deployment or port 30250 promotion.
