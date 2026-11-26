# L03 Documentation Rendering Follow-Up

Checkpoint: 2026-11-26, Asia/Singapore.

## Manual Requirements

The reference must preserve declared DTO fields, technical keys and Unicode
text. A model declaration, generated page or source test does not prove actual
API serialization. The two unresolved method declarations and one nested
reference remain open.

## Local Implementation Observations

The renderer used the same HTML-entity escaping for ordinary Markdown text and
Markdown code spans. Bundled Docsify displayed a declared format containing
`&` or `|` as literal entity strings such as `&amp;` and `&#124;`. Backticks in a
format also lost their literal representation. Ordinary label punctuation could
be interpreted as emphasis or a backslash escape.

The current change gives those contexts separate handling:

- Normal labels escape Markdown punctuation while retaining technical snake
  case names and all original Unicode code points.
- Simple technical literals keep their existing code-span output. Literals
  containing entity-sensitive characters, table separators, backticks or
  newlines use an HTML code element with encoded punctuation. This preserves
  the declared value without allowing the Markdown parser to reinterpret it.
- DTO field names, identifiers, paths, declaration counts and unresolved-source
  diagnostics are unchanged.

The generator's existing full-text search changes were already dirty when this
subtask began. Their exact starting bytes and diff are retained privately;
this rendering repair does not claim authorship or independent completion of
that earlier work.

## Current Version Acceptance Evidence

Executed from `scripts/`:

```sh
node --test tests/plm-api-reference-generator.test.mjs tests/localized-api-documentation.test.mjs
```

Result: 40 passed, zero failed, cancelled or skipped.

The new regression parses generated Chinese and English pages with the actual
bundled Docsify parser in the existing local Happy DOM dependency. It checks
the final nine-column DTO row, exact format and label text containing Chinese,
a supplementary-plane emoji, combining accents, quotes, backslashes, a newline,
ampersands, pipes and backticks. It also checks that label punctuation does not
become emphasis or a link. This is a local DOM/parser test, not the separate
real-browser acceptance run.

Frozen current files:

| File | SHA-256 |
| --- | --- |
| `plm/doc/tools/api-reference.mjs` | `6d3a1366b8203d557018814c1e8b97d3a1551a210e88d347223793209ff9facb` |
| `scripts/tests/plm-api-reference-generator.test.mjs` | `8c9c848b79380d80ece96abff2d23f71dd8f4520255bea347207c516a9732d5b` |

The isolated in-memory generation produced 365 files. Coverage remains 7,829
method references, 7,827 resolved method references, two unresolved method
references and one unresolved nested reference. The 398 schemas contain 5,373
declared fields; the separate two logic-observed output keys are still not
counted as DTO declarations.

Private before/after snapshots, the existing diff, this turn's incremental
patches and generation summary are under
`.artifacts/l03-documentation-20261126-r1/`. Summary SHA-256:
`33dd3df4a479112ea24dcbad719f8e6ec3ee6784362db634abd2481c1c96d50f`.
Its in-memory manifest SHA-256
`180894c52e166f45f90bfb72e82edfdd1b8d5a56c78e47f891ca112949f36496`
binds the English dictionary bytes observed at that generation time. The
parallel L01 dictionary update and B03 browser run have independent later
input bindings; this receipt is not substituted for them.

After L01 froze the dictionary at SHA-256
`b82ced0cbae34edf50d249ddd8a32913d9e9307cd8c8794bc3d633a8d2f59851`,
one final in-memory generation verified all 184 current participating input
hashes. The generator and regression-test hashes above were unchanged.
The final manifest SHA-256 is
`15090a00443f549a4874f0afd3c860a1195d513347a2bfb5447b7ac9d657a299`;
the output still has 365 files with the same DTO and logic-output coverage.
Private `final-dictionary-generation.private.json` SHA-256:
`67f8018df02160f29f091dee2e61d6ca16fe922ecf19bb11718364a079dd9a9f`.
The B03 browser receipt remains separate.

## Independent Committed-Source Replay

A later read-only comparison found that the working-tree generation also read
two pre-existing dirty model files:

- `model/PSMODULES/Wiki/PSDATAENTITIES/space.json`
- `model/PSSYSMODELGROUPS/ebsx/PSMODULES/ebsx/PSDATAENTITIES/auth_log_admin.json`

The previous working-tree manifests and B03 browser receipts retain those
original input hashes. They must not be relabeled as a committed-source replay.

An independent private export then froze all 184 participating inputs. It used
the reviewed generator and L01 dictionary bytes above; every other file came
from `plm@9b7f142a6cf8c85aeecfa60530bd573683a488b7` or
`plm-web@48d9969faf1d98d896f00fb4c8c832c2625dec74`, including the HEAD versions of
the two model files. No actual model file was edited or staged.

Running the generator from this private copy produced 365 files. All 364 files
other than the manifest are byte-identical to the working-tree output.
Entity/method counts, DTO coverage and the separate logic-output coverage are
also identical. The manifest differs because it correctly binds the two
committed model inputs rather than their dirty working-tree bytes.

Private exported sources and output:
`.artifacts/l03-committed-replay-20261126-r1/`.

| Independent Replay Evidence | SHA-256 |
| --- | --- |
| Clean generated manifest | `72dfcfd71fc72a011435a8346204221ae2a8c8908863469deae1a0e9ef727232` |
| `report.private.json` | `08e29bb7f28b4b3ec05c2391958bb6c34ab4bd22b263ad96f19396b2af1cfe25` |

All 184 exported input hashes and original working-tree source hashes were
checked after generation. This independently proves documentation-content
reproduction from the reviewed changes plus committed inputs. It does not
rewrite the original browser receipts or establish runtime API acceptance.
The 40-test suite was not repeated for this read-only export comparison.

No shared generated documentation directory, shared deployment, Docker resource,
database, model definition or runtime API was changed.

## Pending Decisions / Blockers

Authoritative fields are still absent for `idea_def_group_common_dto` and
`view_theme_setting_usr1014979662dto`. Completing those declarations requires
an authoritative model decision, not documentation inference. Runtime
serialization, response types and full host embedding remain outside this
repair. L03 is not closed by the rendering regression.
