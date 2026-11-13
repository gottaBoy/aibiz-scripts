# Historical PLM Runtime Replay Retired

Date: 2026-11-14, Asia/Singapore.

`harness-plm-backend-runtime-regression.mjs` is now a fail-closed compatibility
entrypoint. Its exported function rejects; its normal CLI exits 1 before any
process, network, file, container or database operation. `--help` explains the
status without executing anything. The npm command remains visible and fails
explicitly rather than reporting a skipped or fabricated successful regression.

## Why Execution Was Removed

The historical implementation was not a disposable, run-owned fixture:

- It inherited the shared PLM service environment and used a shared Docker
  network and authentication endpoint.
- It forcibly removed fixed-name containers before proving their ownership.
- Its database cleanup deleted every matching historical identifier prefix,
  not just the exact IDs created by one invocation.
- It mounted the entire workspace read-write into a networked Maven container
  with mutable image tags and no bounded CPU/memory policy.
- Default argument evaluation inspected/ran runtime images before the function
  could validate caller intent.

None of those operations was executed during this audit. The replacement
stub removes the embedded credentials and dangerous implementation instead of
adding an opt-in flag around it. The old code remains in Git history for
auditing, not as an execution fallback.

Historical reports describe their original run only; this retirement does
not rewrite or relabel them as current evidence. It also does not complete
D01, O02, O03 or PLM business workflow acceptance.

## Replacement Requirements

A future PLM lifecycle runner must bind one explicitly owned environment:
unique run/resource identities, immutable existing images, isolated schema
and credentials, reviewed model/source bytes, ordinary roles, loopback-only
frontends and bounded resource limits. It must refuse shared-service fallback.

Record created IDs durably before follow-up operations. Cleanup must match
those exact IDs and current ownership, preserve all pre-existing rows/volumes,
and run after failure as well as success. Never use a broad identifier prefix
or guessed container name as deletion authority.

The native modeling A01 runner is a separate reviewed lane, documented in
[AUTHORIZATION-A01-20261114.md](AUTHORIZATION-A01-20261114.md); it does not
provide a replacement PLM business fixture.

Current Java authorization verification used one network-none, nonroot,
read-only-root compiler with a fresh worktree, 2 CPUs, 3 GiB memory and
automatic removal. That is not permission to resurrect historical shared
runtime replay.

## Verification

```sh
node --test tests/plm-runtime-retirement.test.mjs
node harness-plm-backend-runtime-regression.mjs --help
```

The tests verify imported-call rejection, the real CLI with historical
environment overrides, absence of execution dependencies/embedded credentials,
and refusal of execution flags. They start no containers or services.
