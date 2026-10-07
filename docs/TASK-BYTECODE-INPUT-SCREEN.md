# Task Bytecode Input Screen

Task/UAA lane ownership: this sidecar and its tests are separate from
`harness-uaa-task-readiness.mjs`, `harness-required-source-gates.mjs`, their tests,
and the main plan/package. Mencius owns shared-gate integration; this change
does not alter their contracts or promote the new evidence to S06/D01 acceptance.
It also leaves the already-dirty canonical Task builder and Dockerfile alone.

```sh
node --test scripts/tests/task-bytecode-inputs.test.mjs
node scripts/audit-task-bytecode-inputs.mjs
node scripts/audit-task-bytecode-inputs.mjs --verify .artifacts/task-bytecode-input-audit/audit-UUID/report.json
```

The audit uses the existing pinned file/directory and source identity helpers.
It records complete before/after input inventories and parses the canonical
Ant descriptor with Python's standard-library XML parser. Its recorded
classpath/copy declarations expose where resource bytecode can enter a build.
All JAR, WAR and ZIP inputs are parsed with `zipfile`, regardless of filename.
Nested archives are inspected without extraction or execution. Every class
entry has its actual byte count and SHA-256; nested entries retain their full
archive chain and nested-archive hashes.

All loose `.class` inputs are unproven and block the screen. Archive classes
under `SA/`, `net/ibizsys/` or `cn/ibizlab/`, or matching a captured editable Java
filename, are reported as known own-bytecode inputs. Anonymous/inner classes,
WAR/Boot layouts and multi-release entries are included. Source candidates are
path-based diagnostics, not Java package parsing or proof of compilation.
Unknown relocated namespaces cannot be conclusively classified; this is not
an exhaustive dependency ownership/source-closure verifier.

Invalid archives/XML, DTDs, unsafe/duplicate/symlink ZIP entries, empty classes,
missing source/Ant targets, parser failures and input drift fail closed.
Bounded archive depth/count/uncompressed size prevents unbounded expansion.
Reports are created exclusively, retain blocked evidence and are replayed
against all current inputs. Replays reject tampered counts, hashes, promotions,
missing inventories and source/dependency/report drift. A blocked but complete
audit remains blocked on replay. Incomplete evidence cannot be verified.

Exit 0 means only `passed-input-screen-only`; exit 1 retains findings/errors.
`sourceClosureVerified`, `compilerBuildInDockerVerified` and `nativeAcceptance`
are always false. No Docker commands, compiler runs, service operations or
database access occur. Linux/procfs, Node >=20 and Python 3 are required.

## Remaining Closure Work

The inspected October 6, 2026 `task7/.artifacts/source-build/source-build.json`
claims `ready` but contains no numeric compiler exit or before/after input
inventories. It cannot be repaired by attaching today's hashes after the fact.
A fresh canonical build is needed, with actual retained compiler/image evidence;
the currently dirty tree must not be described as clean committed source.

Ant includes `SAPAAS/resources/classes` on its compiler classpath and copies it
into the WAR. Three loose own inputs remain:

- `net/ibizsys/psts/web/HttpModule_MySQL.class`
- `net/ibizsys/psts/web/WebDBCallerHelper_MySQL.class`
- `net/ibizsys/psts/web/WebContext.class`

Removing those without recovering compatible editable implementations can
break compilation/runtime. This lane does not delete or substitute them.
`EAIAppIntFormActionHelper.java` still throws
`IllegalStateException("Decompilation failed")` in `Complie`; compile success
cannot prove that method's functional completeness.

Standalone UAA still needs its actual `sys_person` `/auths/login` editable
implementation, effective runtime password-encoder proof, protocol/join/fine
grant validation, and source-to-running-byte binding. Legacy IBZUSER sources
are not replacements. Shared gates remain blocked until independently reviewed
source closure and real compiler-in-Docker evidence exist.
