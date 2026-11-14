# Runtime Input Manifest

Date: 2026-11-14, Asia/Singapore. Work item: D03, still partial.

## Purpose

An image ID does not bind the host files supplied to a running container.
`runtime-input-manifest.mjs` supplements the observed image lock with the
actual bind sources and Compose/environment files from the inspected shared
aibiz runtime. It does not restart services, mutate Docker, read named-volume
contents, request business HTTP or claim release acceptance.

```sh
node scripts/runtime-input-manifest.mjs --capture --output=.artifacts/runtime-inputs-20261114-r1/report.json
node scripts/runtime-input-manifest.mjs --verify=.artifacts/runtime-inputs-20261114-r1/report.json
```

Run capture after the intended source commits and tests have stopped
changing inputs. Capture/verify are explicit operations; `--help` and invalid
arguments do not inspect Docker. Reports stay private with mode 0600 inside
an exclusive 0700 artifact directory. Existing reports are never overwritten.

## Measured Scope

- Actual shared container IDs, image IDs and normalized configuration hashes.
- Bind source contents, full permission bits, UID/GID and relative filenames, including ignored
  generated output, plugins, models, startup scripts, JARs and hidden files.
- Empty directories and every distinct mount use; identical source paths
  used by multiple containers are measured once.
- Compose configuration and environment file bytes, represented by hashes
  only. Environment values and file bodies are not exported.
- Nearest workspace Git repository commit, index hash and dirty-status hash
  for each versioned input. Non-versioned artifact inputs remain explicit.

Each source is traversed through pinned directory descriptors. Regular files
are streamed with a 1 MiB buffer and checked for identity/metadata changes.
Two complete measurements must agree, and container configuration and Git
identity must still agree at completion.

The default per-pass budget is **4 GiB and 150,000 entries**, shared across
all distinct source paths. Missing paths, budgets exceeded, symlinks,
hardlinks, special files, changed contents or out-of-workspace sources cause
refusal, not partial acceptance. Foreign sources require a separate ownership
review. A report cannot be written beneath a directory it measures.

## What Match Does Not Prove

`OBSERVED` means two read passes agreed. `MATCH` means the current measured
scope still matches that receipt, including Git identity. Both keep
`acceptedRelease`, `contentsFrozen`, `atomicSnapshot`, `fullSourceClosure`
and `servedHTTPBytesVerified` false.

This is not a filesystem snapshot, backup or lock. A later write remains
possible. A new Git commit or index/status change can invalidate the receipt
even when mounted bytes are unchanged.

The Git identity does not hash all unmounted dirty source contents.
Image-internal resources, named volumes, copies made at startup, dynamic
configuration, extended ACLs/xattrs and actual HTTP response bytes are not covered. Source-to-build
and build-to-served-output equivalence, dependency closure, installation,
backup/restore and rollout/rollback need their own evidence.

## Tests

```sh
node --test scripts/tests/runtime-input-manifest.test.mjs
```

The focused suite passes **23/23**, covering deterministic hashes, binary
streaming, deduplication, hidden and Compose inputs, content/mode/file-set
drift, Git metadata, mutable configuration, unsafe paths, budgets, forged
acceptance flags, special permission-bit drift, FIFO receipt refusal,
foreign Git environment isolation and private/exclusive CLI output. Docker inspection is
injected with controlled fixtures; these tests do not operate Docker.

The deliberate unmounted-source test demonstrates a limitation: changing
the contents of an already-dirty, unmounted file may leave Git status
unchanged and therefore still match. This behavior is documented, not
reported as full source-closure verification.

Cross-review found and fixed three initial gaps before delivery: special
mode/ownership bits were missing, FIFO receipt open could block, and inherited
`GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` could substitute repository identity.
Git subprocesses now clear inherited Git overrides, disable the fsmonitor
command and verify the actual worktree root. These fixes have specific
regressions and are not inferred from a healthy runtime.

Current live capture, if successful, is stored only in the private path
shown above. It is separate from these fixture results and does not close
D03 or O03.
