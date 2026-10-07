# Native Source Acquisition Investigation

Date: 2026-10-05. Network observations: 23:33-23:59 Asia/Shanghai
(`2026-10-05T15:33Z` through `2026-10-05T15:59Z`).

This is a read-only acquisition investigation, not a migration approval.
The only workspace file created by this task is this document. No application,
nginx, runtime-auth, native browser, mapping, receipt or existing audit document
was changed. No credentials, private authorization material, registry login,
package installation, build or browser acceptance was used.

## Baseline And Result

Read first:

- [Exact acquisition plan](core-exact-acquisition-plan.md).
- [Native plugin source audit](NATIVE-PLUGIN-SOURCE-AUDIT.md).

The plan's existing npmjs/npmmirror "no package" observations were not repeated
or upgraded into a new finding. The private registry mentioned there was not
contacted. Instead, this task examined public upstreams, public release/history
pages, local Git objects, and package/source caches, including ignored artifacts.

**Complete source acquired for these four packages: 0 of 4.**
No exact package or same-package source candidate was recovered. Source license,
source-tree fingerprint and source-build receipt therefore remain unavailable
for all four. This does not establish that the sources do not exist elsewhere.
The baseline audit read for this task records 11 blocked native mappings.
This investigation adds no original-source evidence for these four packages
and does not recertify or change the current migration ledger. Independently
owned source-bearing candidate migrations and build evidence are outside this
task; this report does not approve or invalidate that separate work.

| Exact requested package | Real model contract | Acquisition result |
|---|---|---|
| `@ibiz-template-plugin/global-util-design@0.0.3-alpha.87` | Reference 5: `CUSTOM`, `GlobalAppUtil`, `GLOBAL_APP_UTIL`, application injection | No complete source found |
| `@ibiz-template-plugin/console-terminal@0.0.3-alpha.87` | Reference 9: `VIEW_CUSTOM`, `CONSOLE_VIEW`, `DECUSTOMVIEW` | No complete source found |
| `@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165` | Reference 11: `EDITOR_CUSTOMSTYLE`, `FileToBase64`, `EDITORSTYPE` | No complete source found |
| `@ibiz-template-plugin/layout-design@0.0.3-alpha.90` | References 8 and 25: `SWAGGER_PREVIEW_VIEW` / `DECUSTOMVIEW`, and `iBizDesignIndexView` / `APPINDEXVIEW` | No complete source found; both providers are required |

The full `file-to-base64` version is **0.1.8-alpha.165**, not
`0.0.3-alpha.165`. Provider names above are model runtime contracts, not a claim
about an unavailable source package's JavaScript export shape.

Model evidence, relative to the workspace:

```text
vendor-upstream/ibizmodeling-standard
  commit: 96e9e54e5a20c0eea7f9ada21bdd1a38177caf9f
  file: modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSAPPS/ModelDesign/PSSYSAPP.json
  file SHA-256: 8b8ae26b2dbf50e6f0a793a820b29aabcf57f50cc076e8d40e3071f1d4a389f5
```

## Public Acquisition Paths

### Official Hub

The official organization pages link to
`https://github.com/ibizlab-cloud/ibiz-app-hub` and
`https://gitee.com/ibizlab-cloud/ibiz-app-hub`.
The reachable GitHub snapshot was pinned to:

```text
master / HEAD: e4b98800266e22ed1fe36af4a2ff708cfa39e5e5
anonymous git ls-remote exit: 0
advertised heads: master only
advertised tags: none in the observed ls-remote response
```

Read the seven top-level workspace directories listed in
`pnpm-workspace.yaml`: `models`, `packages`, `components`, `plugins`, `apps`,
`examples`, and `extensions`. GitHub's embedded directory JSON was parsed,
including its item counts. All 39 immediate child `package.json` paths were
requested through `raw.githubusercontent.com`: 38 returned HTTP 200 with valid
package identities; `examples/images/package.json` returned HTTP 404.
None of the 38 manifests identifies any of the four requested packages.

The five actual `plugins` manifests are:

| Directory | Manifest identity | Version |
|---|---|---|
| `plugins/ibiz-ai-chat` | `@ibiz-template-plugin/ai-chat` | `0.0.60` |
| `plugins/ibiz-bi-report` | `@ibiz-template-plugin/bi-report` | `0.0.32` |
| `plugins/ibiz-data-view` | `@ibiz-template-plugin/data-view` | `0.0.6` |
| `plugins/ibiz-gantt` | `@ibiz-template-plugin/gantt` | `0.1.8-alpha.378` |
| `plugins/ibiz-template-devtools` | `@ibiz-template/devtool` | `0.0.14` |

`extensions/global-plugin/package.json` instead identifies
`@ibiz-plugin-template/global-plugin@0.0.10`. Its manifest SHA-256 is
`1cbd7410162acd0b979d9d833ceb7b0c00f7e9e20bd71e51a9f503f3419b9490`.
It is a different package, not recovered `global-util-design` source.
The extension templates and the ordinary PLM plugins must not be renamed to
pass an exact native source gate.

The root `LICENSE` returned HTTP 200, identifies MIT, and has SHA-256
`7dfec9759ee0f36a6287a0b0f15a1e1162d1f6d86d429821aa8b0f917799261b`.
This licenses the inspected Hub snapshot; it does **not** prove the licenses
of the four missing packages. The workspace YAML SHA-256 is
`368e2d16331b18c32eb790ae909d28c6915f78f98b2c5ce7fc4a5547570d64bf`.
These are file fingerprints, not complete native source-tree fingerprints.

The public `plugins` history page exposed four commits. Each corresponding
directory tree returned HTTP 200 and listed the same five directories:

```text
be2b45adafd82d568aa0af65668b51623ff8c40a
4f4d417ea60434b79ca9f8c55e879350ea56cdd8
6124dc53aecdbf17d53e38b09f14c803f110fc49
a3b10c9d3611b1cb4730bf811f917146e95563c6
```

This covers the displayed history entries and current workspace manifests,
not every historical blob or unadvertised ref of the upstream repository.

### PLM And Modeling Repositories

Public `https://github.com/iBizLab/plm-web.git` advertised:

```text
main / HEAD: 333955af1191dbb42cc69924e7817bdb9bac17f7
vue:         52c8eae6015f506cce3e65b16af4ba9f6af703bb
tags:        none in the observed ls-remote response
```

Both refs are already present in the inspected local upstream clone.
Its public `main/.gitmodules` still points `plugins` at
`https://github.com/ibizplm-open/plm-web-plugins`. The fetched file SHA-256 is
`296c9dcd3e93d10a6daf4e20ad7d58c7322637f7f04b1f71c533cca90868132e`.
That submodule page is HTTP 404 to an anonymous client, and its Git discovery
endpoint returns HTTP 401, `Repository not found.` No login was attempted.
These responses cannot distinguish a removed/renamed repository from a
non-public repository. This is a concrete upstream ownership/path question,
not evidence that credentials should be searched for.

`https://github.com/gottaBoy/modeling-web.git` is publicly discoverable at
`a19c033cd4c86f78988d3f8cb854666d0b5611ad`, already present in local history.
No target package paths or manifest/lockfile references were found in the
inspected reachable history.

The public Gitee `ibizlab-appstore/ibizmodeling-standard` page and raw README
are readable. Its local model describes the four exact references above,
but the inspected source snapshots do not provide those frontend package
manifests. A platform model reference is not a source distribution.

## Actual Network Results

All requests were anonymous. Curl used `-q`, verified TLS, bounded connection
and total timeouts, and no Authorization header. Git disabled credential
helpers, askpass, terminal prompts and global/system configuration for public
`ls-remote` probes. No upstream issue was posted.

| Public endpoint or group | Actual result | Interpretation |
|---|---|---|
| `https://api.github.com/repos/{gottaBoy/modeling-web,gottaBoy/plm-web,ibizlab/plm-web,ibizlab/ibiz-app-hub}` | HTTP 403; curl exit 0; JSON says `API rate limit exceeded` | API discovery blocked by anonymous rate limit, not package absence |
| `https://github.com/ibizlab-cloud/ibiz-app-hub` | HTTP 200; anonymous `git ls-remote` exit 0 | Fixed-commit tree and raw-file reads remain usable despite API limit |
| Official Hub's seven workspace directory pages and 38 valid manifests | HTTP 200 | Current immediate workspace identities inspected; no target identity |
| `https://github.com/ibizlab-cloud/ibiz-app-hub/commits/master/plugins` | HTTP 200 | Four displayed plugin-history trees inspected |
| `https://github.com/ibizlab-cloud/ibiz-app-hub/releases` and `/tags` | HTTP 200; page reports no releases; Git advertises no tags | No release asset or advertised tag acquisition path found here |
| `https://github.com/gottaBoy/{modeling-web,plm-web}/releases` | HTTP 200; pages report no releases | No downloadable release source located on these pages |
| `https://github.com/iBizLab/plm-web.git` | `git ls-remote` exit 0 | Existing local `main` and `vue` refs match advertised upstream refs |
| `https://github.com/ibizplm-open/plm-web-plugins` | Page HTTP 404; Git discovery HTTP 401; `ls-remote` exit 128 | Not anonymously accessible; repository ownership/path needs clarification |
| `https://gitee.com/ibizlab-cloud/ibiz-app-hub` | Page HTTP 200; `/tree/master/plugins` HTTP 405; Git discovery HTTP 401; `ls-remote` exit 128 | Page availability is not anonymous Git/source-download availability |
| `https://gitee.com/ibizlab-appstore/ibizmodeling-standard` | Page and raw README HTTP 200; Git discovery HTTP 401; `ls-remote` exit 128 | Readable metadata/model route, but Git transport unavailable anonymously |
| `https://github.com/search?q=%22global-util-design%22&type=code` | HTTP 200; page requires sign-in for code search | Not an actual zero-result source search; no sign-in attempted |
| GitHub repository metadata searches for each of the four quoted names plus `ibiz` | HTTP 200; curl exit 0; parsed `result_count: 0` and `results: []` for all four | Zero repository metadata matches, not an exhaustive source/code search |
| Sourcegraph public streaming searches for each complete scoped package identity, including forks and archives | HTTP 200; curl exit 0; parsed final `done: true`, `matchCount: 0`, `skipped: []` for all four | Zero matches in the searched public index, not proof that all public or historical source was indexed |
| Official Hub fixed-commit codeload archive | Curl exit 63 after 67108864 bytes, due to explicit 64 MiB ceiling | Intentionally incomplete download; no complete archive hash or negative source conclusion awarded |

The archive URL used was
`https://codeload.github.com/ibizlab-cloud/iBiz-app-hub/tar.gz/e4b98800266e22ed1fe36af4a2ff708cfa39e5e5`.
It was read into memory, not installed or unpacked into the workspace.
The fallback was bounded tree/manifest reads. Dynamic HTML response hashes
are not used as source fingerprints.

### Supplemental Public Searches

At `2026-10-05T15:59:15Z` through `2026-10-05T15:59:29Z`, anonymous
repository metadata and public indexed-code searches returned the following
parsed results. No package registry was queried.

| Package name under `@ibiz-template-plugin/` | GitHub repository metadata result count | Sourcegraph final match count | Sourcegraph final reported skips |
|---|---:|---:|---|
| `global-util-design` | 0 | 0 | `[]` |
| `console-terminal` | 0 | 0 | `[]` |
| `file-to-base64` | 0 | 0 | `[]` |
| `layout-design` | 0 | 0 | `[]` |

The GitHub request template was:

```text
https://github.com/search?q=<URL-encoded quoted package name plus ibiz>&type=repositories
embedded JSON: payload.blackbirdSearchRoute
checked fields: type=repositories, result_count=0, results=[]
```

The current embedded payload is nested under `blackbirdSearchRoute`. Reading
only `payload.results` would produce missing fields rather than a proven zero.
The counts above come from the actual nested JSON, not empty HTML extraction.
These requests search repository metadata, not repository file contents.

The Sourcegraph request template was:

```text
https://sourcegraph.com/.api/search/stream?q=<URL-encoded query>&v=V3
query: context:global "@ibiz-template-plugin/<name>" fork:yes archived:yes count:20 timeout:10s
checked final SSE event: progress, done=true, matchCount=0, skipped=[]
```

The first Sourcegraph pass at `2026-10-05T15:55Z` also returned HTTP 200
and final zero counts, but reported exclusions for 282 forked repositories
and approximately 68k archived repositories. The final queries explicitly
included both categories. An empty reported skip list still does not establish
coverage of unindexed repositories, private sources, arbitrary historical
blobs, or implementation files that do not contain the searched package name.
No sign-in, authenticated search, private API or upstream issue submission
was attempted.

## Local History And Ignored Caches

All paths below are relative to `/home/my/workspace/ainfra/aibiz` unless
absolute. `git rev-list --objects --all` was inspected for target names in
paths, and `git log --all -G` searched target package references in package
manifests and npm/pnpm/yarn lockfiles. Both searches returned zero matches in
each listed repository. Counts describe available local reachable history;
overlapping clones are not independent provenance evidence.

| Local repository | Reachable commits | Local HEAD |
|---|---:|---|
| `modelingweb` | 17 | `5bd4e9e5df83f7d491aaecdaa4e6c7e95224fc16` |
| `plm-web` | 38 | `80376e6b6f6ecbb18a72328f74f7a553b8ed0a9c` |
| `vendor-upstream/plm-web` | 25 | `333955af1191dbb42cc69924e7817bdb9bac17f7` |
| `vendor-upstream/gottaboy-plm-web` | 29 | `3a427279d29c3f84883b8c8b39467656187f1e5f` |
| `ibiz-app-hub` | 48 | `e3a0ec7fab725ebaacc6642cda38eb177b76f067` |
| `vendor-upstream/ibizmodeling-standard` | 9 | `96e9e54e5a20c0eea7f9ada21bdd1a38177caf9f` |
| `extensions/upstream/ibizmodeling-standard` | 1 | `d52797076d9a200dcf068703d94ccf7838876b2f` |

Tracked and ignored workspace file paths were searched, including
`node_modules`, `public`, `dist`, `plugin-src`, `vendor-upstream`,
`extensions/upstream`, and `.artifacts`. Workspace `package.json` files and
pnpm package indexes were also searched for the four scoped package identities.
No matching package was found. Browser trace archives and authentication
reports were deliberately not opened.

| Cache/archive root | Inspected evidence | Target matches |
|---|---|---:|
| `/home/my/.npm/_cacache/index-v5` | 1416 index files | 0 |
| `/home/my/.npm/_cacache/content-v2` | 1455 content files; 708 gzip files; 673 recognizable npm package archives, checked via their manifests; 35 other gzip objects | 0 target package manifests |
| `/home/my/.local/share/pnpm/store` | 271416 files inventoried; 3210 package/index JSON files searched | 0 |
| `/home/my/.cache/pnpm` | 4157 files; 1997 valid JSON objects inspected; no gzip objects detected | 0 |
| `.artifacts/frontend-source-npm-cache/_cacache` | 3 indexes and 3 package archives, manifests checked | 0 |
| `.artifacts/modeling-upstream` | 44 `.tar` files, 22 distinct SHA-256 values; archive paths checked; no `package.json` entries in any distinct archive | 0 target paths |

These cache/archive checks reported zero scan errors. GNU tar warnings about
legacy extended header fields did not prevent manifest reads. Archives were
listed/read to stdout only, not extracted onto disk.
The pnpm scan is an index/metadata scan, not an exhaustive analysis of every
unreferenced content blob. Local Git scans cover reachable objects, not
unreachable/dangling objects or unknown remote refs. No missing-source gate
is closed by these negative observations.

## Minimum Actionable Repair

There is no justified local code fix that creates these original sources.
The minimum dependency to resolve is a legitimate source publication or a
maintainer-provided public repository/version mapping.

1. Ask the Modeling package owner, via the public
   `ibizlab-appstore/ibizmodeling-standard` project, for the source repository,
   exact commit/tag or source-bearing archive for the four identities above.
   Ask the public PLM upstream separately whether the inaccessible
   `ibizplm-open/plm-web-plugins` URL was moved and whether its replacement
   actually contains these Modeling packages. The stale URL alone does not
   prove that it does.
2. Obtain a publicly licensed source publication for each package. Require
   exact manifest name/version, complete implementation and assets, entry
   registration for the listed providers, build/toolchain configuration,
   locked dependencies or a reproducible dependency contract, and license
   terms. A registry tarball is sufficient for the source gate only if it
   includes all required editable source/build inputs. Dist files, `.d.ts`
   files, source-map hints or model JSON alone are insufficient.
3. Before changing a mapping or main-thread code, report the public origin,
   pinned version/commit, license, archive SHA-256, and the complete relative
   source file-set fingerprint using the audit's existing fingerprint
   convention. For a different same-package version, label it a candidate;
   do not overwrite the requested version or declare compatibility.
4. Only after provenance/input review, use a separately owned isolated build
   to record real input/dependency/output hashes. Main-thread native
   load/edit/save/reload/integration acceptance remains a separate gate.
   Keep `missing` / `blocked` status until the required evidence exists.

Public source request content, ready for an owner to post; **not posted by
this task**:

```text
Please publish or identify the licensed, complete editable source and
reproducible build inputs for these ModelDesign plugin references:

@ibiz-template-plugin/global-util-design@0.0.3-alpha.87
@ibiz-template-plugin/console-terminal@0.0.3-alpha.87
@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165
@ibiz-template-plugin/layout-design@0.0.3-alpha.90

Please include source repository/ref or a publicly downloadable source
archive, exact package manifests, licenses, assets and dependency/build pins.
layout-design must contain both SWAGGER_PREVIEW_VIEW and iBizDesignIndexView
provider implementations. Please clarify any moved public plugin repository.
Please do not send credentials, registry tokens or private authorization files.
```

If no licensed source can be publicly supplied, original-source localization
remains blocked. Renaming a template, replacing a native package with a generic
editor/terminal, or assigning the Hub's MIT license to missing code would not
resolve this acquisition gap.

## Verification And Boundaries

This task ran read-only filesystem, Git, JSON/manifest, archive and anonymous
network checks described above. It did not modify code, rerun `npm test`,
run native browser acceptance, rebuild containers, change model references,
or update the source/migration ledger.
The investigation is complete within this scope; original source acquisition
for the four packages is still unresolved. Main-thread candidate migration,
build and runtime work was not modified or evaluated by this task.
