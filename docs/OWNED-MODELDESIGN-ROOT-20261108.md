# Owned ModelDesign Root Routing

Date: 2026-11-08, Asia/Singapore.

## Implemented

ModelDesign startup now reads `nativeModelingSystemId` from the deployed
environment. `modelingweb/environment.config` maps it to
`NATIVE_MODELING_SYSTEM_ID`. `app/src/native-modeling-root.ts` validates it
before the startup route is constructed.

- Absent/empty configuration keeps the existing default root.
- An explicit root preserves its exact case and value.
- Non-string, traversal, encoded, query/fragment, whitespace, control-character
  and oversized inputs are rejected, not silently remapped to the shared root.
- Existing deep links are preserved.
- Owned preparation derives the root from the validated fixture manifest and
  includes it in the ModelDesign container's explicit environment arguments.
  Central is not given an invented root override.

The preparation input's `network` metadata now agrees with the actual owned
network in its Docker arguments.

## Drift Check

Repeated live Docker inspection reproduced different orders for the same
UAA bind mounts: `/opt/uaa/config` and `/opt/uaa/witness`. The former witness
hashed enumeration order, which could reject an unchanged deployment during
the final drift check.

Mounts are now sorted by destination before hashing. No fields are discarded:
source, destination and read/write drift still changes the witness. Image,
configuration, network, source and lifecycle checks are unchanged. Sanitized
failure stages now distinguish asset, image, topology, mount and input drift;
private assertion values are not printed.

## Verification

- Root configuration unit tests: **26 passed**.
- Owned preparation/HTTP transport contracts: **112 passed**.
- Actual startup serializer harness: passed, including exact root injection.
- Production bundle startup browser checks: **5 passed**.
- Full scripts regression after these changes: **4572 passed**, zero failed,
  skipped or cancelled tests.

The browser check uses the actual built SystemJS entry and environment output
from the maintained `start.sh`. Cases include owned A/Chinese/desktop,
owned B/English/mobile, default compatibility, preserved deep link and invalid
configuration rejection. It does not inject or rewrite the root from Playwright.
All API requests are aborted; no backend requests, writes or login occur.
Screenshots show startup/loading only, not a usable home or completed business
workflow.

Evidence root: `.artifacts/native-root-routing-20261108-r1/`.
The consolidated `report.json` binds source, logs, screenshots, the fresh r9
runtime-assets receipt and the successful owned preparation. Basic shared
PLM/Central/ModelDesign HTTP probes return 200; no shared service restart
occurred.

Reproduction:

```sh
cd modelingweb/app
pnpm exec vitest run tests/native-modeling-root.test.ts
node tests/modeling-web-docker.harness.mjs
cd ../..
node scripts/tests/native-modeling-root.browser.mjs
```

## Invalidated Experiments

Earlier owned browser attempts remain failed reports. Their local static
responses for notifications, theme/configuration, `SysOperator` and the
work-item counter do not verify those services. That experimental fallback
code and its ad hoc launcher/proxy were withdrawn. No static successful
responses are added by the maintained owned nginx adapter.

Historical preparations made before the production frontend rebuild do not
certify the new distribution. The freshly generated `current-source-20261108-r9`
runtime-assets receipt binds the current generated import map; earlier
runtime-assets receipts are not rewritten or cosmetically rehashed.

## Remaining Gates

1. Launch the fresh owned input with complete source/mount/topology revalidation
   and exact-ID, ownership-checked cleanup.
2. Connect real platform notification, theme/configuration and dictionary
   services, plus the PLM-dependent counter, or explicitly report unsupported
   capabilities. Static empty successes are not acceptance.
3. Diagnose and fix the actual refresh-token HTTP 500. Keep the short-lived
   token security fixture unchanged.
4. Verify native ModelDesign home, list/detail, browser editor save,
   fresh-session readback, restore, viewer/no-access and cross-root denial.

These changes close startup root selection and a false topology-drift alarm.
They do not establish complete browser, authorization, plugin, bilingual,
marketplace, source-closure or offline-delivery acceptance.
