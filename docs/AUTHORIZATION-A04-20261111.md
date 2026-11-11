# A04 Service OAuth, Aliases And Startup

Checkpoint: November 11, 2026.

Status: **PARTIAL**.

This is a read-only source/test receipt. It does not change JWT lifetime,
credentials, Nacos, containers, databases or shared services.

## Verified Boundaries

- The owned Nacos alias is exact: `uaa-api`, fixture group, private UAA
  endpoint, owned metadata and non-ephemeral policy.
- Alias publication requires guarded requests and healthy exact-instance
  readback. Multiple, foreign, malformed or changed instances are rejected.
- Alias cleanup deletes only the verified exact instance and requires absence
  readback.
- Backend startup checks reject delayed `ApplicationRunner`/Spring fatal
  failures after an HTTP port or `Started` line.
- ZooKeeper readiness requires an exact successful standalone status, not only a
  listening socket.
- OAuth baseline configuration uses `client_credentials`, rejects partial
  client configuration, and explicitly skips the optional check when client
  credentials are absent. Ordinary user credentials are not substituted.

## Remaining Blocker

No complete current owned service-OAuth exchange receipt binds all of:

1. client-token issuance;
2. downstream service use of that token;
3. exact `lb://uaa-api` alias resolution through the runtime;
4. stabilized application startup with no delayed fatal errors.

Therefore alias readback and startup checks are not promoted to A04
verification. Ordinary `/v7/login` or `/uaa/oauth/userinfo` checks do not
prove service OAuth.

## Receipt

Harness: `harness-authorization-a04.mjs`

Focused tests:

`node --test tests/authorization-a04.test.mjs`

Generate an immutable private receipt:

`node harness-authorization-a04.mjs --output=.artifacts/authorization-a04-20261111/report.json`
