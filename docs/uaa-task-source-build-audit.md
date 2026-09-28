# UAA / Task Source Build Audit

Run the fail-closed audit from the workspace root:

```bash
node scripts/harness-uaa-task-readiness.mjs
```

The command writes `scripts/.artifacts/uaa-task-readiness.json` and returns
non-zero if either service is not ready.

Current evidence:

- UAA 32666: ready after a Java 8 Docker Maven build of the `ibzuaa-boot`
  reactor. The generated JAR is hash-verified in the ignored UAA artifact
  directory.
- Task 30088: blocked. Its Ant build depends on `I:/J2EE/commonlib`, has no
  WAR assembly or source Docker context, and therefore cannot claim a
  source-built image.

Prebuilt runtime images do not satisfy this gate.
