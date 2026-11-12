# A01 Fresh HTTP Readiness

Fixture: `25dd6a7232c7`, backend config-r6.

## Current State

The owned config-r6 deployment has actual backend startup and retained-peer
integrity evidence. Authenticated PSPF, PSPFStyle and PSAppType route reads are
HTTP 200, but all three return zero rows. Ordinary role/root HTTP reads can be
run against this deployment.

The A01 fresh HTTP gate is **BLOCKED-HARNESS-MISSING-DISPATCH**:

- `prepare-run-owned-native-nonadmin-matrix.mjs` plans `invalidRootCases`.
- `run-owned-native-permission-http.mjs` never dispatches
  `matrix.invalidRootCases`.
- Its request validator only accepts canonical `{system, organization}`
  application context headers. It cannot transport null, numeric or malformed
  `PSDEVSLNSYS` values without inventing an unreviewed header contract.

Therefore no A01 live HTTP acceptance is claimed. The existing ordinary matrix
must not be relabeled as malformed-root coverage.

## Receipt

Harness: `harness-authorization-a01-readiness.mjs`

Focused tests:

`node --test tests/authorization-a01-readiness.test.mjs`

Receipt:

`.artifacts/native-nonadmin-fixtures/25dd6a7232c7/authorization-a01-readiness-r1/report.json`
