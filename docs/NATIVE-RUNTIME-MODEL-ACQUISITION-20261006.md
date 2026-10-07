# Native runtime-model Public Source Acquisition

Requested package: **`@ibiz-template-plugin/runtime-model@0.2.2`**.
Workspace: `/home/my/workspace/ainfra/aibiz`.
Investigation date: **2026-10-06, Asia/Shanghai (+08:00)**.

Network window: `2026-10-06T02:23:43.890+08:00` through
`2026-10-06T02:27:22.880+08:00`, equivalently
`2026-10-05T18:23:43.890Z` through `2026-10-05T18:27:22.880Z`.
The UTC date is October 5; the workstation date and directory suffix are October 6.

## Result

**No authentic public runtime-model package archive or complete original source
was acquired from the bounded routes checked.**

- Official npm package metadata, exact-version metadata and standard exact-version
  tarball endpoints returned HTTP 404.
- Inspected public Git trees/history provide only the already-known compiled
  runtime subtree: 7 MJS files, 278671 bytes. No runtime `package.json`, `src`,
  `stencil.config.*`, `tsconfig.json`, source maps or package LICENSE was found there.
- Public repository root LICENSE files identify MIT. The license of the
  separately published `runtime-model@0.2.2` package remains unauthenticated.
- No runtime source, original manifest, source-build inputs or build receipt
  has been recovered. This report does not clear the existing source/build gate.

These observations do **not** prove that the package was never publicly
published, that no renamed repository exists, or that all historical blobs
and unadvertised refs lack its source. Compiled output is not original source;
the pnpm directory's version label is not authenticated package identity.

## Scope And Preserved Inputs

Read first:

- `scripts/docs/NATIVE-PLUGIN-SOURCE-AUDIT.md`.
- `scripts/fixtures/modeling-core-source-candidates.json`.

The requested `fixtures/modeling-core-source-candidates.json` is actually under
`scripts/fixtures/`; no root-level fixture was created. The workspace root is
not a Git checkout; `scripts/` is a checkout with pre-existing changes.

Candidate, inspected read-only:

```text
vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/model-design@0.0.3-alpha.122
```

Its manifest declares the exact runtime dependency `0.2.2`; its `src/index.ts`
imports `@ibiz-template-plugin/runtime-model/loader`. The candidate's private
publish registry was **not contacted**.

The previous workspace/npm-cache finding of only compiled output was accepted
as the baseline, not repeated as a new workspace/cache investigation. No queries
for the four previously missing plugins were issued.

Only this new document and
`.artifacts/native-runtime-model-acquisition-20261006/` were created.
No dependency installation, package scripts, typecheck, build, application,
candidate, model, public output, mapping, receipt, registry login, credential
search or commit was performed or modified by this task.

## Official npm Endpoints

All four requests below finished between `18:23:43.890Z` and
`18:25:12.933Z` on October 5 (October 6 locally), with curl exit 0.
HTTP failure is recorded separately from curl transport success.

| Evidence request ID | HTTPS endpoint | HTTP | Response |
|---|---|---:|---|
| `npm-packument` | `https://registry.npmjs.org/%40ibiz-template-plugin%2Fruntime-model` | 404 | 21-byte JSON error |
| `npm-packument-canonical` | `https://registry.npmjs.org/@ibiz-template-plugin%2Fruntime-model` | 404 | Same JSON error |
| `npm-exact` | `https://registry.npmjs.org/%40ibiz-template-plugin%2Fruntime-model/0.2.2` | 404 | 11-byte JSON string |
| `npm-exact-tarball` | `https://registry.npmjs.org/@ibiz-template-plugin/runtime-model/-/runtime-model-0.2.2.tgz` | 404 | 21-byte JSON error, **not a tarball** |

Response-body SHA-256:

```text
21-byte {"error":"Not found"}:
c8d3eae160a892e32837db3dcae515e843e5383fef52b8141940c8bcf8b6d59f

11-byte "Not Found":
57aefd8046010e86f09187427e21bad3376b25a2f9a46ce20452ac7d5448298d
```

No packument/version history, `dist.integrity`, `dist.shasum`, package manifest,
license field or source-bearing tarball could be read from those responses.
The standard tarball path was explicitly a probe, not a URL advertised by a
successfully retrieved packument.

`https://registry.npmjs.org/-/v1/search?text=%40ibiz-template-plugin%2Fruntime-model&size=20`
returned HTTP 200. None of the 20 returned package names was the exact target.
This is broad token search, not an exhaustive zero-package result; its reported
`total` was 677120. No mirror or private registry was used.

## Public Upstream Trees

Metadata and refs were fetched anonymously before inspecting fixed Git trees.
The official Hub exposed only `master`; both PLM repositories exposed `main`
and `vue`. No tag refs appeared in these ref responses. Public organization
metadata listed 3 repositories for `ibizlab-cloud` and 9 for `iBizLab`.

Recursive tree request pattern:

```text
https://api.github.com/repos/<owner>/<repo>/git/trees/<commit>?recursive=1
```

All four tree responses were HTTP 200, explicitly `truncated: false`.
Tree entries include directories as well as files; these are not source counts.

| Repository / branch | Fixed commit | Entries | Observation |
|---|---|---:|---|
| `ibizlab-cloud/ibiz-app-hub`, master | `e4b98800266e22ed1fe36af4a2ff708cfa39e5e5` | 48660 | Only `runtime-model-error` name hits; no runtime-model package path or Stencil config |
| `gottaBoy/plm-web`, main | `3a427279d29c3f84883b8c8b39467656187f1e5f` | 33197 | Compiled runtime subtree and configuration JSON snapshots only |
| `iBizLab/plm-web`, main | `333955af1191dbb42cc69924e7817bdb9bac17f7` | 33196 | Same runtime Git subtree as the fork |
| `iBizLab/plm-web`, vue, also advertised by the fork | `52c8eae6015f506cce3e65b16af4ba9f6af703bb` | 14994 | No runtime-model or Stencil config name hits |

Tree response-body SHA-256, in table order:

```text
54993a9460f34ce356be3ba07026ce387e683b449149e27fd0caaed9e0410f67
ac7071dbdc9112a97c2a59a152a7ad974fe7347c1f6d1501fd801c9009593bc2
802ede88d4aa529da84faec00c89f480897d734b45c74238a285e988593d6db9
81d382271180ff2377f8b3f647ce4addb4df46d0ae674cb9d19f5c2c2230b28c
```

The five actual current Hub plugin manifests were downloaded at the fixed commit
through `raw.githubusercontent.com` and parsed as JSON. Their identities are
`@ibiz-template-plugin/ai-chat@0.0.60`, `bi-report@0.0.32`,
`data-view@0.0.6`, `gantt@0.1.8-alpha.378`, and
`@ibiz-template/devtool@0.0.14`. None is the target. Manifest response hashes are
in the evidence index; no unrelated manifest was repurposed.

The PLM runtime subtree is rooted at:

```text
public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/es/node_modules/.pnpm/@ibiz-template-plugin_runtime-model@0.2.2_@stencil_store@2.0.16/node_modules/@ibiz-template-plugin/runtime-model
```

Its Git tree object is `d5dc5ca6dfc99a10c758c963efaa59653a8bb413`.
The independently fetched recursive subtree has 11 entries: 4 directories
and exactly 7 compiled MJS blobs. Response SHA-256:
`bdced04e1c2d8c6ee6a1ccd7d42d19b700873430de3e2003d0ca3bed825e2cc8`.
The index retains filenames, sizes and Git blob IDs, not a fabricated original
source fingerprint. The MJS blobs were not downloaded again or reconstructed.
JSON resource snapshots are not the runtime package source.

## Bounded History And Releases

History endpoints:

```text
https://api.github.com/repos/ibizlab-cloud/ibiz-app-hub/commits?sha=master&path=plugins&per_page=100
https://api.github.com/repos/gottaBoy/plm-web/commits?sha=3a427279d29c3f84883b8c8b39467656187f1e5f&path=public%2Fplugins%2F%40ibiz-template-plugin%2Fmodel-design%400.0.3-alpha.122&per_page=100
```

Both returned HTTP 200 without a `Link` pagination header.
The Hub `plugins` path returned four commits, whose directory snapshots were
also requested through `/contents/plugins?ref=<commit>`:

```text
2026-05-21  be2b45adafd82d568aa0af65668b51623ff8c40a
2025-10-08  4f4d417ea60434b79ca9f8c55e879350ea56cdd8
2025-08-22  6124dc53aecdbf17d53e38b09f14c803f110fc49
2025-08-16  a3b10c9d3611b1cb4730bf811f917146e95563c6
```

Each snapshot listed the same five plugin directories, not runtime-model.
This checks path-history directory snapshots, not every historical blob or
package identity elsewhere in the Hub.

The precise PLM package path returned one commit:
`7ceb2c15a9cfd5e5c320a6dc6c6f83378cc2c3d8`,
dated `2025-12-15T12:23:10Z`.
Fetching the runtime directory at that commit returned only `dist` and `loader`.
Their Git tree IDs exactly match the current runtime subtree's two root entries;
the history snapshot therefore exposes the same compiled-only inventory.
The history-directory response SHA-256 is
`2b031f7afdf3c67518cccf00e2671d781ce011a861b47d0a91412d9258ff1740`.

`/releases?per_page=100` for the Hub, official PLM and fork each returned
HTTP 200 with `[]`; no release source asset was available in these responses.
This does not inspect arbitrary release assets of unrelated repositories.

Official PLM's fixed-commit `.gitmodules` still names
`https://github.com/ibizplm-open/plm-web-plugins`.
Its pinned submodule commit is `68116c61ff3a92f119ce6aa62a804fcd03073238`.
`https://api.github.com/repos/ibizplm-open/plm-web-plugins` returned HTTP 404
to this anonymous client. No private source inference or authentication followed.
The `.gitmodules` SHA-256 is
`296c9dcd3e93d10a6daf4e20ad7d58c7322637f7f04b1f71c533cca90868132e`.

## Search Limits

- `web.run` was used for exact scoped-package/version queries, runtime/Stencil
  terms and the official GitHub Hub page. It returned no usable source content
  or reference IDs. This is not counted as a proven zero-result package search.
- `https://api.github.com/search/repositories?q=runtime-model+ibiz` returned
  HTTP 200, `total_count: 0`, `incomplete_results: false`. This searches
  repository metadata, not all code or renamed repositories.
- GitHub's anonymous exact-package code-search endpoint returned HTTP 401
  `Requires authentication`. This is a search-access limit, not absence.
- Sourcegraph's exact scoped-package query, including forks and archives,
  returned HTTP 200 and final `done: true`, `matchCount: 0`, `skipped: []`.
  Its response hash is
  `244ace8e6f6cd9e1ff16394c20e3040bc3d8f6dbd2f2099ee5f76390d12054cc`.
  Public index coverage is not exhaustive historical coverage.
- A supplemental exact `ibiz-model-runtime` element query returned HTTP 200
  and `matchCount: 0`, but reported `shard-match-limit`. It is **not** treated
  as a complete negative search. Both SSE bodies and final payloads are retained.
- Gitee's official Hub landing page returned HTTP 200, while
  `https://gitee.com/ibizlab-cloud/ibiz-app-hub/tree/master/plugins` returned
  HTTP 405. Landing-page metadata does not establish downloadable source.

## License

The fixed-commit `LICENSE` was fetched separately for the official Hub, official
PLM and fork via `https://raw.githubusercontent.com/<owner>/<repo>/<commit>/LICENSE`.
All three returned HTTP 200 with the same 1085-byte MIT text,
copyright 2025 iBizLab, SHA-256:

```text
7dfec9759ee0f36a6287a0b0f15a1e1162d1f6d86d429821aa8b0f917799261b
```

Those are repository-root license observations. The candidate's own manifest
also declares MIT, but neither establishes the separate runtime package's
original license. No exact runtime manifest/LICENSE or npm license field was
obtained; package-level license verification remains open.

## Evidence And Verification

Artifact root:

```text
.artifacts/native-runtime-model-acquisition-20261006/
```

There are **44 bounded anonymous requests**: 37 HTTP 200, 5 HTTP 404,
1 HTTP 401 and 1 HTTP 405. Every curl process exited 0. Each
`requests/<id>/` retains the actual body, HTTP headers and `observation.json`
with exact endpoint, UTC start/end, HTTP/transport results, byte sizes and
separate SHA-256 hashes. Error bodies are named `body`, not disguised as packages.

`fetch-public.mjs` uses curl `-q`, verified HTTPS, no authorization/cookies/login,
15-second connection timeout, 90-second total timeout, and 64 MiB response limit.
Public hosts are allowlisted and redirects are not followed automatically.
No credentials or private registry configuration were consumed.

`summarize-evidence.mjs` verified every saved response/header size and hash,
parsed the tree/manifest/history/SSE evidence, checked the compiled-only inventory,
and rehashed four read-only baseline files against their pre-investigation hashes.
All four remained unchanged: original audit, candidate fixture, candidate
manifest and `ibiz.config.cjs`. This is a bounded check, not a claim about
concurrent changes by other workspace owners.

Generated evidence index:

```text
.artifacts/native-runtime-model-acquisition-20261006/evidence-index.json
generatedAt: 2026-10-05T18:28:36.061Z
SHA-256: f9a6e170e2013f9dcd08ac916812c6186863eb8702b322059f593331edf38588
```

The index is explicitly an acquisition observation, **not** a package manifest,
mapping update, source authentication or build receipt. No application tests were
run because this task did not change application code or install/build packages.

## Meaningful Next Paths

1. Ask the upstream owner to publicly identify or restore the runtime-model
   source repository and explain whether the PLM submodule path/pinned commit
   contains its Stencil project. Anonymous 404 does not distinguish removed,
   renamed and private repositories. Do not search for credentials.
2. Request a publicly downloadable immutable **exact `0.2.2`** source archive,
   its SHA-256/npm integrity and original manifest, LICENSE, full `src`,
   `stencil.config`, TypeScript config, toolchain/lockfile and source commit.
   Verify identity, license and original-source completeness in a fresh artifact
   directory before considering any candidate staging.
3. If the owner intentionally published compiled-only runtime artifacts, request
   the matching source release instead of upgrading these seven MJS files to
   source. A different runtime version needs an explicit compatibility decision;
   it cannot silently satisfy the pinned `0.2.2` dependency.

Until such evidence arrives, leave the runtime source/build dependency blocked.
No candidate, mapping, receipt or production acceptance state was changed here.
