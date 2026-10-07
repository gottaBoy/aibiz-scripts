# Isolated Backend Source Images

This harness builds immutable candidate images from a verified backend package
receipt. It covers the three executable services:

- `ibiz-ebsx-runtime`
- `ibiz-ebsx-gateway`
- `ibiz-service-runner/ibizservicerunner-provider`

The result is image/artifact identity evidence only. It does not claim UAA
protocol compatibility, native model permissions, PLM workflows, persistence,
source closure of every Maven dependency, or production acceptance.

## Run

First create a fresh package receipt:

```sh
node scripts/harness-backend-source-package.mjs \
  --permission-report .artifacts/modeling-permission-eight-suite-20261006-final/report.json \
  --output .artifacts/backend-source-package-20261006-rN
```

Build the three candidate images from that receipt:

```sh
node scripts/harness-backend-source-images.mjs \
  --package-report .artifacts/backend-source-package-20261006-rN/report.json \
  --output .artifacts/backend-source-images-20261006-rN
```

Replay the image receipt independently:

```sh
node scripts/harness-backend-source-images.mjs \
  --verify .artifacts/backend-source-images-20261006-rN/report.json
```

The output directory must be a new direct child of `.artifacts`. Failed runs
are retained and cannot be overwritten.

## Identity Contract

The base image is pinned to:

```text
eclipse-temurin@sha256:bc033b57e11b773c3043babfd664e7a5ef110805548b921cbfc3e8c67a0725d6
```

Each build uses `--network=none`, `--pull=false`, an explicit Linux platform,
and labels the image with the package receipt SHA-256 and source-input
fingerprint. The executable JAR in each context is taken from the verified
Spring Boot deployment archive, not a thin `target/*-version.jar`.

The provider image additionally records the two wait/entrypoint scripts. A
readonly, capability-free probe reads the immutable image ID and checks exact
SHA-256 bytes for every context file. The verifier rechecks the package
receipt, source recipe inputs, context inventory, base image digest, candidate
image labels/layers and probe output.

All boundary flags remain false:

```json
{
  "nativeAcceptance": false,
  "sourceClosure": false,
  "acceptedForProduction": false
}
```

Run the focused contract tests with:

```sh
npm run test:backend-source --prefix scripts
```
