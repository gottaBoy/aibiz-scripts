# English And Marketplace Current State

Checkpoint: November 6, 2026.

This is a current inventory, not a claim of complete English coverage or
offline marketplace delivery.

## English Scan

Current static model audit:

- 3,162 model files.
- 50,781 display-property/declared managed-picker label occurrences.
- 43,723 occurrences mapped by the current dictionary.
- 4,661 distinct labels, 1,243 mapped.
- 92 PLM plugin source files contain Chinese characters.

The remaining 3,418 distinct model labels are not all user-visible. A fresh
audit still reports candidates such as `最后同步时间`, `api密钥`, `Bearer令牌`,
`报告总结` and `测试用例配置`. The previously listed internal captions
`容器`, `文本(动态)`, `常规条件`, `工具栏`, `面板容器`, `页面标题` and `图片`
are now mapped. Remaining labels must be classified by actual browser
visibility; bulk replacement would alter technical metadata and business data
incorrectly.

The current parser also counts the exact managed-picker `toplabel`/`lastlabel`
metadata now handled by the runtime. The denominator therefore differs from
the earlier audit; none of these counts is an end-user coverage percentage.

The November 6 model-label batch added 80 labels and 563 occurrences. It covers
AI credentials/prompts, review/workflow operations, ticket navigation,
portfolio/insight views and report controls. The source receipt lists the
first model path and line for every added label; actual model execution tests
preserve code values, IDs, scripts, SVG metadata and navigation targets.

This pass also localized six high-frequency runtime plugin controls in source
and rebuilt their ESM/SystemJS outputs:

- Checkbox grid: `Select All`.
- Show-mode toolbar: `Tree` / `Grid`.
- Track tree grid: `Expand All` / `Collapse All`.
- Search-bar filter conditions: English operators and `And` / `Or`.
- Route picker: `No Data`.
- Auto-rules editor: English transition labels.

All six `plugins:build:one` invocations passed output validation. The plugin
type harness also passed its current diagnostic policy. Comments, debug logs,
SVG metadata, user data and README text were not changed.

The PLM production build was rerun after the dictionary and plugin changes:
`plm-build-after-locale.log` ends with a successful Vite build. The build emits
large-chunk warnings but no errors; no deployment or shared frontend restart
was performed in this pass.

A second production build after the next model-label batch also succeeded:
`plm-build-after-locale-v2.log`. The latest locale/model tests remain 23 passed,
and the localization/plugin contract run remains 135 passed.

Existing locale contracts remain green:

- Localization baseline checks: 4 passed.
- Localization/plugin contract checks: 131 passed.
- Current cold-restore-focused localization contracts: 131 passed.
- Current locale/plugin focused run: 135 passed.

The remaining work is to add browser-visible labels and plugin controls to the
shared locale dictionary, then rebuild both ESM and SystemJS outputs. Source
comments, logs, model IDs, scripts and business data are not UI translation
targets.

## Four-Plugin Candidate Follow-Up

A separate, unpublished candidate localizes shared password/expired-link UI,
avatar upload/crop UI, identifier-copy feedback and managed-picker defaults.
Scoped responsive styles also fix shared-link overflow, the fixed-width
avatar dialog and clipped slider endpoints.

The complete PLM frontend contract run is now 144 passed with zero skips.
Four fresh ESM/SystemJS candidate builds passed. Controlled browser checks
cover four plugins in Chinese/English across desktop, 390px mobile and 320px
narrow viewports: 24 combinations passed, with 29 served file hashes matched.
Avatar checks use the actual crop controller, verify zoom/rotation and
nonblank crop pixels, and receive real PNG bytes at a loopback-only fixture
upload endpoint.

Candidate builds leave the shared bind-mounted `public/plugins` unchanged.
No shared application build, service restart or deployment occurred in this
follow-up. The evidence retains `nativeAcceptance: false`: controlled password,
clipboard and runtime services do not prove real backend authorization or
native full-host integration.

The scoped implementation, reproducible tooling and remaining gates are in
`plm-web/docs/PLUGIN-LOCALE-VERIFICATION-20261106.md`. Candidate evidence is
under `.artifacts/plm-plugin-english-20261106-r3/`, separate from cold recovery
history. The final successful browser receipt is
`browser-evTsbI/browser-report.json`; earlier failed attempts remain retained.

## Native Host Follow-Up

The complete frontend is now built and assembled outside the shared
bind-mounted paths. SystemJS host sharing awaits asynchronous resolution,
managed-picker model labels and account/login labels are localized, and the
framework handles a legitimate null active record without hiding missing-data
errors. Managed-picker action controls also have a separate responsive row.

Current local gates are 165 PLM frontend tests and 15 focused framework tests,
all passed. Fresh plugin candidates retain 24 controlled browser combinations
and 29 matching served file hashes. The complete native host passed 18
read-only workflows across Chinese/English and desktop/mobile/narrow
viewports, with 31 matching plugin/framework file hashes and no unexpected
console errors or business mutation requests. Native host evidence is
separate from those controlled fixtures and from storage recovery history.

Implementation, safe source builds, reproduction commands and acceptance
boundaries are in `plm-web/docs/NATIVE-PLUGIN-LOCALE-20261106.md`.
The final complete host is under
`.artifacts/plm-plugin-native-host-20261106-r7/`.
The final strict report is `native-browser-Mr3eR9/native-report.json`, with 27
native-host screenshots.
No shared frontend deployment or service restart occurred. Real password
authorization, upload/save persistence, non-admin authorization and marketplace
offline delivery are not promoted by this frontend work.

## Marketplace Inventory

The retained catalog inventory has 23 applications:

- 20 installed.
- 1 disabled.
- 2 not installed.

Current source inventory still reports 20 complete local worktrees, one
Git-object-only repository with case collisions, and two missing expected
directories. Every catalog entry still has remote repository/icon references.
No installed revision is bound to a local commit, and no complete offline
install/update/rollback receipt exists.

The 23 marketplace applications and PLM's 73 runtime frontend plugins are
different inventories. The 73 runtime plugins have local editable inputs and
delivery directories, but most are bundle-level reconstructions rather than
authenticated original source.

Current offline surface scan retains remote market endpoints and repository,
README/changelog and icon references under:

`.artifacts/native-mysql-cold-restore-20261106-r2/marketplace-offline-surface.txt`

The required next gate is a per-catalog-ID manifest binding:

1. Catalog identity and installed revision.
2. Repository commit, license and local source directory.
3. Model/frontend/backend artifact hashes and runtime dependencies.
4. Mirrored package, icon, README and changelog bytes.
5. Isolated offline install, update, rollback and restart behavior.

Unknown or missing source remains a blocking result; same-name local folders or
remote URLs must not be promoted as proof of localization.

## Current Evidence

Latest cold MySQL recovery and cleanup evidence remains under:

`.artifacts/native-mysql-cold-restore-20261106-r2/`

The cold recovery closeout reports 376 native HTTP checks, four restores, 4,558
full scripts and 215 focused checks. Those green storage results do not promote
English, marketplace, original-source or release acceptance.
