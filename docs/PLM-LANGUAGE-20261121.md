# PLM Pre-Login Language Switch

Checkpoint: 2026-11-21 (evidence timestamp; Asia/Tokyo).

Status: **PASSED-PRIVATE-PRELOGIN-LANGUAGE-SWITCH-ONLY**.

This is a bounded source-candidate check for the PLM login page. It is not
authenticated business acceptance, complete localization acceptance, or a
shared deployment.

## Scope

The real candidate was exercised in four cells:

| Initial language | Viewport | Result |
| --- | --- | --- |
| `zh-CN` | desktop | passed |
| `zh-CN` | mobile | passed |
| `en` | desktop | passed |
| `en` | mobile | passed |

Each cell:

- reached the actual login view from the requested deep link;
- opened the normal language menu and selected the other language;
- accepted the normal confirmation dialog;
- verified the document language and visible language label after reload;
- explicitly refreshed and verified the selected language persisted;
- switched back and repeated the same confirmation and persistence checks;
- recorded zero console errors, page errors, HTTP failures, failed requests and
  external requests;
- dispatched zero pre-login API requests and performed no business writes.

The confirmation dialog is part of the product flow. The retained first
attempt in `plm-language-browser-20261121-r1` timed out because the harness
did not click that dialog; it is preserved as a failed attempt. The corrected
runner now uses ordinary menu and confirmation-button clicks and does not
inject controllers, force clicks, fabricate responses or filter errors.

## Source And Output Binding

- Application candidate: `.artifacts/plm-language-app-20261121-r1`
- Combined candidate: `.artifacts/plm-language-combined-20261121-r1`
- Browser receipt:
  `.artifacts/plm-language-browser-20261121-r2/report.private.json`
- Browser receipt SHA-256:
  `c37e1030b8723fe295f6c879291f348e3d869a1178a0642afe522e64055fd37d`
- Combined source-build receipt SHA-256:
  `8b0a1a74f62b8d7ea3412f9495d438e5468ade8f92385b5953ef4c647ffe6555`
- Runner SHA-256:
  `814bf3ebc851baa76810cd661ec6e43b55a549fae5854b0ab16a11d1d126d08e`
- Candidate source files: `4,565`; actual `plm-web/src` comparison: exact,
  including bytes and SHA-256 for every file.
- Candidate output files: `38,185`.

The application build includes preserved existing worktree inputs. It is not a
clean-index reconstruction and does not establish complete dependency/source
closure.

## Repair

`src/components/language-switch/language-switch.tsx` now narrows the generic
view state before reading `isCollapse`. This removes the `IViewState` property
error without widening the interface, using `any`, or suppressing the type
checker.

Focused component and PLM startup contracts pass. Current-worktree
`tsc --noEmit` and `vue-tsc --noEmit` both pass; that result is separate from
clean-index/source-closure acceptance.

## Remaining Gates

This evidence does not close the canonical remaining items. Authenticated
dashboard and business workflows, R05 model/DTO/count acceptance, role and
permission matrices, native Modeling IDE CRUD, third-party integrations,
MQTT/live logs, shared `30250` rollout/rollback, and full localization remain
separate gates. The canonical matrix remains **25 top-level items not fully
accepted**.
