# R08 Third-Party Integration And Release Gates

Date: 2026-11-16, America/Mexico_City.

This is a source-level contract and backlog record. It does not claim that
DingTalk, WeCom, MQTT, offline update, shared rollout or rollback is complete.
The contract test is intentionally read-only and uses no external credentials,
broker, database, Docker service or simulated delivery.

## Current Source Boundary

### Third-party identity

The maintained Hub and Modeling runtime sources expose separate `DINGTALK`,
`WXWORK` and `OAUTH` authorization paths. The PLM model carries DingTalk and
WeCom identity fields, and the user form exposes an explicit WeCom-to-PLM
binding. This is source evidence only.

The external integration status vocabulary is:

| Stable state | 中文含义 | Meaning |
| --- | --- | --- |
| `not-configured` | 未配置 | No external application or access settings are bound. |
| `configured-pending-validation` | 已配置待验证 | Configuration is saved but sync and delivery are not verified. |
| `sync-failed` | 同步失败 | The provider sync failed; diagnostics and retry remain visible. |
| `sync-succeeded-unbound` | 同步成功但未绑定 PLM 用户 | External identities exist but no PLM user mapping is accepted. |
| `notification-verified` | 通知验证通过 | A real target account received and acknowledged a real message. |

The last state requires real credentials, provider-side allowlists/trusted
domains, an explicit user mapping, a real target account, and a redacted
delivery receipt. Saving a form, returning a simulated success payload, or
creating an external user record does not constitute real delivery.

### MQTT

The current Modeling deployment deliberately sets `ENABLEMQTT=false`. The
console source exposes bilingual disabled, missing-topic, unavailable-host and
subscription-denied states. Existing controlled tests cover topic isolation,
reconnect bookkeeping, disposal and localized labels.

This does not establish a real MQTT broker, WebSocket or proxy path, token
authentication, topic ACL, publish/subscribe delivery, or disconnect recovery.
Those gates must remain open until a controlled broker and real authenticated
application data are verified. Enabling a flag or hiding the disabled notice
would not be an acceptance result.

### Release and rollback

The current version lock and candidate reports bind source, served bytes,
images and mounts, but are not a release approval. Offline update/recovery
(`K03`) and reviewed shared deployment with rollback (`O03`) remain open.
Rollback must include:

1. An immutable candidate and the previous served-byte/input receipt.
2. A durable backup and a restore decision for model, database and credentials.
3. Failure injection during update, followed by guarded recovery.
4. Fresh multi-role and bilingual smoke checks after both rollout and rollback.
5. Exact cleanup of only the owned temporary resources.

Git push, a newer image tag, a saved configuration form, a controlled fixture,
or a page that loads does not close these gates.

## Source-Level TODO

1. Provide reviewed DingTalk and WeCom application inputs without committing
   secrets; verify sync failure, phone matching/manual binding, wrong mapping,
   notification delivery, revoke and cross-organization rejection.
2. Run the MQTT broker/WebSocket/ACL/authentication/publish/reconnect matrix with
   real authenticated appdata and retain redacted request/response evidence.
3. Define the admin UI/API status transitions above in both languages, including
   retry and revoke failures; do not collapse all states into “configured”.
4. Execute offline package install/update, failed-update recovery and rollback
   in an owned environment with durable backup and served-byte verification.
5. Review one shared rollout window only after the prior gates pass; keep the
   current shared deployment and historical receipts unchanged until then.

## Contract Test

```sh
node --test tests/r08-integration-release-contract.test.mjs
```

The test verifies source routes, localized error keys, explicit identity
mapping, disabled MQTT capability states and fail-closed release documentation.
It does not perform real third-party delivery or MQTT connectivity.
