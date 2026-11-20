# PLM Pre-Login Startup

Checkpoint: 2026-11-21, Asia/Tokyo.
Status: **VERIFIED-PRIVATE-PRELOGIN-ONLY-NOT-DEPLOYED**.
The canonical matrix still has 25 top-level items not fully accepted.

## Failure And Repair

The first real source-candidate replay reached the login form in all four
zh-CN/en x desktop/mobile cells, but each cell retained an unauthenticated
organization GET returning 401 and a navigation-aborted console error.
No Promise-as-URL error was observed.

Rebuilding the current `vue3-components` source alone did not repair this:
PLM selects a custom `StaticAuthGuard`, and the host intentionally did not
apply its default redirect policy to custom guards.

- `ibiz-app-hub@a69afa9c` adds an explicit optional `getLoginRedirect`
  callback. Custom guards without it retain their previous behavior.
- `plm-web@4d637768` delegates that callback to the same custom guard
  constructed after host initialization. Its standard token, remembered
  refresh, anonymous and alternate-login decisions remain guard-owned.
- The PLM candidate proxy no longer treats all GETs or arbitrary
  `fetch_*` POSTs as read-only. Only exact bootstrap/authentication requests
  are enabled by default; business reads require an explicit path/method
  list. Portal, uploads, unknown actions, changed methods and normalized-path
  bypasses are rejected before upstream.

No request was replaced with a fabricated 200, and no error strings were
filtered out to accept the final startup.

## Actual Evidence

The final replay uses fresh private application and framework builds.
All four requested language/viewport cells passed:

- Ordinary deep-link navigation redirects to the actual login view.
- No pre-login API request was dispatched.
- Actual HTML, application legacy bundle and rebuilt framework entry match
  their output hashes.
- Console errors, uncaught errors, HTTP failures, failed requests and
  attempted external requests are all empty.
- Each browser context, browser and temporary loopback server closed.
- Desktop/mobile screenshots were inspected; this is not a full layout audit.

Private receipts:

```text
.artifacts/plm-source-startup-20261121-r1/report.private.json (failed)
.artifacts/plm-source-startup-20261121-r2/report.private.json (failed)
.artifacts/plm-source-startup-20261121-r3/report.private.json (bounded pass)
.artifacts/plm-source-startup-20261121-r4/report.private.json (final bounded pass)
.artifacts/plm-login-app-20261121-r3/source-build.json
.artifacts/plm-login-runtime-20261121-r3/source-build.json
.artifacts/plm-login-combined-20261121-r2/source-build.json
```

The first runner did not recognize the directory URL as `index.html` for its
identity check. That independent checker defect was fixed; the original
401/navigation failures and first receipt remain intact.

Focused contracts: 46/46 host routing, browser fixtures, preparation, startup
and manual checks; 13/13 PLM proxy/bootstrap/layout checks. These overlap with
smaller individual runs and are not distinct business capabilities.
Both changed entry files pass ESLint. Full PLM TypeScript still reports the
existing `language-switch.tsx:22` `IViewState.isCollapse` error.

## Boundaries

The application build includes preserved existing worktree changes and
hashes those actual inputs. This is not a clean-index reconstruction or
complete dependency/source closure. Framework dependencies are existing
local pinned inputs, not newly reconstructed dependencies. Circular-import,
legacy syntax and Sass warnings remain recorded build risks.

No login was submitted; authenticated dashboard, space GET, business CRUD,
multi-role permissions, remembered-session runtime flows and R05 counters
are not accepted by this test. Shared `30250/32003/32009` services, shared
databases and persistent volumes were not replaced or migrated.

The next gate is a coherent owned authenticated application/backend replay,
then shared release preparation with served-byte and rollback verification.
