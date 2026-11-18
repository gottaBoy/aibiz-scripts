# L03 DTO Source Follow-Up

Checkpoint: 2026-11-18, Asia/Singapore.

Scope: source generation only. No model, Java/Groovy DTO, database, shared
deployment or runtime API was changed. The two missing method field
declarations are still missing and are not marked resolved.

## Implementation

The generator now follows an entity DTO's explicit `getSrcPSSysMethodDTO`
reference into `PSSYSTEM.json/getAllPSSysMethodDTOs`. System DTO identifiers
retain the explicit `id` when present, otherwise the model name. Fields
come only from `getPSSysMethodDTOFields`; an explicit empty local DTO field
array stays empty and is not replaced by inherited fields. Nested source
references join the existing bounded reference graph.

The system model uses the same bounded regular-file reads, symlink/hardlink
rejection, input hashes and final metadata/content verification as entity
models. Missing model, missing source DTO and absent source fields remain
distinct provenance diagnostics. No whole-entity fallback was added.

## Actual Gaps

`idea_def_group_common_dto` has no field list in the entity or web/mobile
application models. Its corresponding `IdeaDefGroupCommonDTO.groovy` class
also has no declared members, and `DEFGroup_common` has no listed fields.

The published `get_customer_score` return explicitly references that DTO,
but its action/logic chain returns the `result` parameter after setting
`customer_score` and `customer_score_precent`. A separate bilingual
**Logic-Defined Response Fields (Not DTO Declarations)** table now records
those two exact keys for its independent and relationship methods. Their
types and nullable rules are unspecified. The spelling `precent` is
preserved.

This table requires the exact published action-to-DTO/logic binding, the
reviewed five-node execution chain, the END node returning `result`, its
entity binding and the complete reviewed Groovy node SHA-256. Changed
scripts, graph links or return parameters remove the observation instead
of guessing new fields. The dedicated logic file and helper are included
in generation inputs and final revalidation. No script is evaluated.

`view_theme_setting_usr1014979662dto` references the actual system DTO
`Usr1014979662DTO`, whose `DYNAMODEL` definition also has no fields.
`PSSYSDYNAMODELS/Usr1014979662.json` is a named `searchcond` model without
attributes, and `ViewThemeSettingUsr1014979662DTO.groovy` has no members.
The reference page now shows that explicit system source and the precise
`system-dto-fields-not-declared` reason.

## Evidence Boundary

The actual in-memory generation still has 7,829 DTO method references,
7,827 field-resolved references, two unresolved method references and one
unresolved nested reference. The new logic observation has two method
references and two unique observed keys; it does not increase DTO coverage.
Output remains 365 files.

Targeted regression:

```sh
node --test scripts/tests/plm-api-reference-generator.test.mjs scripts/tests/localized-api-documentation.test.mjs
```

Current run: 38 passed, zero failed/skipped. Tests cover explicit source
fields, missing/empty sources, system identifiers, nested cycles,
authority links/hashes, real customer-score return-chain drift and both
documentation integrations.

Parent integration additionally passed all four actual local Docsify
Chinese/English desktop/mobile cells, including source diagnostics and
logic-output table rendering, reload and stable method navigation. Mobile
tables now preserve complete words and scroll internally. A prior body-ready
wait failure is preserved separately, not rewritten as a passing run.
An independent export of 184 committed Git inputs also regenerated 365
files with the same declaration gaps and two separately observed output
keys, without copying unrelated dirty model/locale work.

Runtime serialization, response types, per-operation validation and
authorization remain unaccepted. Completing the two DTO declarations
requires an authoritative model definition, not documentation-side
inference from an open Groovy DTO.
