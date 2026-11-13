# PLM Manual Multi-Agent Checkpoint

Date: 2026-11-14, Asia/Singapore.

## Scope

The user requested study of the entire official PLM manual, corresponding
workspace `AGENTS.md`, and multi-agent division. This checkpoint is
documentation/specification work, not completion of the application backlog.

The public-share capture from November 13 at 23:56 +08:00 contains 125 pages:
root 1, product 18, project 43, test 31, knowledge 11, metrics 6,
collaboration 4, administration 10, third-party integration 1.
Every page used published content. No request failures, unresolved internal
chapter links or blank leaves were found. Extracted text contains 53,042
characters. There are 801 image references to 800 unique images.
All extracted prose, headings and tables were read; the 800 images have
not all been individually visually reviewed.

## Division And Deliverables

- Product/project agent: 61-page domain contract, source IDs, repository
  mappings, role workflows, negative checks and manual caveats.
- Test/knowledge agent: 42-page domain contract, source IDs, versions,
  reviews, execution, drafts, publication, locks and sharing boundaries.
- Administration/integration/metrics/collaboration agent: 21-page contract,
  identity mapping, role boundaries, metric formulas and real integration
  acceptance requirements.
- Primary agent: root-page coverage, exhaustive sanitized chapter index,
  workspace instructions and tracked mirror, cross-domain validation queue,
  deterministic generator and focused consistency tests.

Entry: `docs/manual/README.md`. The workspace root `AGENTS.md` is installed
outside Git; `docs/manual/WORKSPACE-AGENTS.md` is its version-controlled copy.
The workspace root is not a repository. No unrelated repository changes
are staged for these deliverables.

## Findings And Remaining Acceptance

The comparison-analysis SQL in both test-case and run logic computes a pass
rate using executed cases as denominator. The main BI and manual use all
planned cases. Consumers/naming and intended semantics must be checked before
changing either computation.

The BI estimate-error formula substitutes 1 for zero estimates; the manual
does not define a zero-estimate/empty-denominator policy. Release-cycle
formula parentheses and some test-report descriptions also need clarification.

The validation backlog defines 15 grouped manual-driven workflows. These
refine the existing task matrix, not 15 newly proven missing features or a
claim that only 15 remain. Third-party integration covers DingTalk/WeCom,
not inferred support for every external platform. Development/API Reference,
Data Model, Modeling IDE and MQTT retain independent acceptance requirements.

No B/M/A/L/D/K/O task is closed by manual reading. The previous source,
runtime, language, authorization and deployment blockers remain recorded
in `docs/ALL-TASKS-20261111.md`.

## Safety

This task does not build images, create containers, restart shared services,
write databases, alter global settings or run the full container-backed
`npm test` roster. Raw manual JSON, text, browser traces and public-session
headers remain private under `.artifacts/`. The committed index contains
only allowlisted source metadata, structure, counts and content hashes.

## Verification

- Manual-reference consistency/security tests: **10/10 passed**. They check
  the 125-page tree, exact guide ownership, all source IDs, generated index,
  relative documentation links, installed/tracked AGENTS equality and
  rejection/redaction of malformed or private metadata.
- Combined with the existing PLM Unicode source contracts: **14/14 passed**,
  using `node --test tests/plm-manual-reference.test.mjs tests/plm-utf8mb4-migration.test.mjs`
  from `scripts/`.
- Regenerating in `--check` mode exactly matches both committed index files
  against the private published capture.
- Referenced full repository paths were checked for existence; that check
  is navigation validation, not proof of their business behavior.
- `git diff --check` passed. Full `npm test` and live business acceptance
  were deliberately not run for this documentation task.

Cross-review found a potential fragment/nested-metadata leak in the new
generator before submission. It now exports only the canonical source
origin/path, validates version/timestamp scalar formats, and has regression
tests for fragment tokens and nested private objects. The produced public
index contains no original body text, session headers or image bytes.
