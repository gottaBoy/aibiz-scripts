#!/usr/bin/env node

// Localize the @ibiz-template base packages that ibiz-app-hub can serve today.
//
// Linking is only safe where the hub tree compiles to what plm-web already
// runs. That holds for core and model-helper and not for the other three,
// which carry published commits the hub does not have; linking those would
// drop behaviour silently, because the import map resolves one file per
// specifier and nothing checks versions at runtime. This module separates the
// decision (pure, tested) from the commands (applied only with --apply).

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  BASE_PACKAGES,
  buildHubIndex,
  lockfileVersions,
  parseSemver,
  workspaceRoot,
} from './version-ledger.mjs';

const scriptPath = fileURLToPath(import.meta.url);
export const PNPM_VERSION = '8.15.9';
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

// Which directory holds the compiled files to compare, and with what suffix.
// Packages built by esbuild/tsc publish out/*.js; the Vue libraries publish
// es/*.mjs. Comparing the wrong pair silently counts zero differences.
export const COMPILED_LAYOUT = Object.freeze({
  out: ['.js'],
  es: ['.mjs'],
  // The stylesheet package ships SCSS rather than a compiled bundle, so its
  // "compiled" tree is the source itself and parity is byte equality of the
  // stylesheets the app @imports.
  style: ['.scss', '.css'],
});

// Re-measure with --measure after any hub sync; these are snapshots. The
// porting pass that took runtime from 38 differing files to 9 ran on exactly
// that loop, one commit per verified file.
//   hubToInstalledDiff  every file that differs. This is the only comparison
//                       that matters: it is what the browser would run.
//   missingUpstream     the subset that upstream changed between the version
//                       the hub tree was cut from and the version in use, and
//                       that the hub still does not have. Linking drops these.
//   ourChanges          the remainder, i.e. what ibiz-app-hub adds on purpose.
// Safe to link means missingUpstream is zero; ourChanges is not a reason to
// hold, it is the point of localizing. The import map cannot hide a dropped
// fix, because it resolves one file per specifier and checks no version at
// runtime.
export const LINK_STATE_BY_PACKAGE = Object.freeze({
  '@ibiz-template/core': {
    cutVersion: '0.7.41-alpha.63',
    compiledDir: 'out',
    hubToInstalledDiff: 0,
    missingUpstream: 0,
  },
  '@ibiz-template/model-helper': {
    cutVersion: '0.7.41-alpha.77',
    compiledDir: 'out',
    hubToInstalledDiff: 2,
    missingUpstream: 0,
  },
  '@ibiz-template/runtime': {
    cutVersion: '0.7.41-alpha.77',
    compiledDir: 'out',
    hubToInstalledDiff: 10,
    missingUpstream: 0,
    // Where the hub diverges from the published artifact on purpose, so the
    // measure must not read the difference as dropped upstream work. Each entry
    // still has to actually differ: a declaration that stops matching is
    // reported rather than quietly exempting whatever it points at.
    intentional: ['platform/provider/platform-provider-base.js'],
  },
  '@ibiz-template/vue3-util': {
    cutVersion: '0.7.41-alpha.77',
    compiledDir: 'es',
    hubToInstalledDiff: 1,
    missingUpstream: 0,
    // The hub caches the rendered vnode per route rather than the component
    // type and props pair, so a re-activation rebuilds the node with the
    // current attrs. Upstream never touched this file between the two
    // versions, so the difference is ours alone.
    intentional: ['common/router-view/router-view.mjs'],
  },
  '@ibiz-template/vue3-components': {
    cutVersion: '0.7.41-alpha.70',
    compiledDir: 'es',
    hubToInstalledDiff: 18,
    missingUpstream: 0,
    // Upstream's alpha.70 -> alpha.78 additions to both locale files are
    // ported; what remains is the prompt block this workspace adds for its own
    // language switcher, which the published artifact has never carried.
    // The grid carries upstream's column tooltip work now, and diverges from
    // the artifact in one statement: this workspace returns null rather than
    // undefined from a render that is not yet created.
    intentional: [
      'locale/en/index.mjs',
      'locale/zh-CN/index.mjs',
      'control/grid/grid/grid.mjs',
    ],
  },
  '@ibiz-template/devtool': {
    cutVersion: '0.0.14',
    compiledDir: 'es',
    hubToInstalledDiff: 17,
    missingUpstream: 0,
  },
  // These four carry no separate cut version: the hub tree already names the
  // version plm-web declares, so there is no upstream range to be behind. The
  // evidence a link is safe is the direct hub-vs-installed comparison, which
  // has to say the two compiled trees are the same bytes.
  '@ibiz/model-core': {
    cutVersion: '0.1.84',
    // The published artifact carries no browser bundle and no vendored tree, so
    // there is no third-party code for a link to swap and nothing to compare.
    vendorSurface: 'none',
    compiledDir: 'out',
    hubToInstalledDiff: 0,
    missingUpstream: 0,
  },
  '@ibiz/rt-model-api': {
    cutVersion: '0.2.82',
    // The published artifact carries no browser bundle and no vendored tree, so
    // there is no third-party code for a link to swap and nothing to compare.
    vendorSurface: 'none',
    compiledDir: 'es',
    hubToInstalledDiff: 0,
    missingUpstream: 0,
  },
  '@ibiz-template/theme': {
    cutVersion: '0.7.39',
    // The published artifact carries no browser bundle and no vendored tree, so
    // there is no third-party code for a link to swap and nothing to compare.
    vendorSurface: 'none',
    compiledDir: 'style',
    hubToInstalledDiff: 0,
    missingUpstream: 0,
  },
  '@ibiz-template/web-theme': {
    cutVersion: '3.11.0',
    compiledDir: 'es',
    hubToInstalledDiff: 0,
    missingUpstream: 0,
  },
});

// Our own localized changes are not a reason to hold a link; they are the
// point of having the source. Only files the hub is missing upstream can make
// a link unsafe, because dropping them changes what the browser runs.
export function inlinedPackages(bundleText) {
  const hits = bundleText.match(/node_modules\/\.pnpm\/[^"']+/g) || [];
  return [
    ...new Set(
      hits.map(hit =>
        hit
          .slice('node_modules/.pnpm/'.length)
          // The path continues with /node_modules/..., which itself contains
          // an underscore, so cut the tail before splitting on the peer suffix.
          .split('/')[0]
          .split('_')[0],
      ),
    ),
  ].sort();
}

// What the browser actually runs is dist/index.system.min.js, and that bundle
// inlines some vendor packages instead of importing them. The inlined copies
// come from whichever node_modules produced the build, so two source trees can
// agree file for file in out/ and still ship different vendor code. Comparing
// the inlined sets is the only way to see it: this caught dingtalk-jsapi at
// 3.1.0 in the hub against 3.2.0 in the artifact plm-web runs, and no out/ diff
// can reveal that. Byte comparison is not usable, because minifiers are not
// reproducible across the two toolchains.
export function bundleDrift(hubBundle, referenceBundle) {
  if (hubBundle === null || referenceBundle === null)
    return { checked: false, hub: [], served: [], drift: [] };
  const hub = inlinedPackages(hubBundle);
  const served = inlinedPackages(referenceBundle);
  const drift = [...new Set([...hub, ...served])].filter(
    name => !hub.includes(name) || !served.includes(name),
  );
  return { checked: true, hub, served, drift };
}

// Some packages do not inline vendor code into the browser bundle at all;
// instead their published es/ tree carries a node_modules/ directory of
// relative-import copies, and the app build bundles those files as written.
// Linking then serves the hub workspace's copies, so the vendor code the
// browser runs changes even though every iBiz source file matches. This is the
// same class of risk the dist bundle check covers for other packages, and it
// cannot be seen from out/ or es/ parity because collectCompiledFiles skips the
// vendored directories on purpose: they are not iBiz source.
//
// What is compared is which vendor packages the first-party files actually
// reach, by name and version. pnpm's patch hash suffix is dropped, since it
// records that a patch was applied rather than what ran; a peer-dependency
// suffix is kept, because it names a different resolved tree.
// A vendored copy is identified by the package it belongs to and the file
// inside it, not by the version in the directory name, because two trees that
// resolve the same dependency to different versions have to line up file for
// file before the difference is visible at all.
const vendoredKey = relative => {
  const match =
    /^\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.*)$/.exec(relative);
  if (!match) return null;
  const dir = match[1].replace(/_patch_hash_[^_]+$/, '');
  const at = dir.lastIndexOf('@');
  if (at < 1) return null;
  // pnpm spells a scoped name with an underscore and appends a
  // peer-dependency suffix after the version.
  const name = dir.slice(0, at).replace('_', '/');
  return {
    package: name,
    version: dir.slice(at + 1).split('_')[0],
    subpath: match[3],
  };
};

const collectVendored = directory => {
  const root = join(directory, 'node_modules');
  if (!existsSync(root)) return null;
  // Not collectCompiledFiles: a pnpm vendor tree nests its packages under a
  // second node_modules, which that collector skips on purpose.
  const walk = current => {
    const found = new Map();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return found;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        for (const [key, value] of walk(path)) found.set(`${entry.name}/${key}`, value);
      } else if (entry.name.endsWith('.mjs')) found.set(entry.name, readFileSync(path, 'utf8'));
    }
    return found;
  };
  const out = new Map();
  for (const [relative, text] of walk(root)) {
    const key = vendoredKey(relative);
    // iBiz base packages are vendored here too, but they are what the source
    // comparison is about; counting them again would read our own tree as
    // third-party drift.
    if (!key || key.package.startsWith('@ibiz-template/')) continue;
    out.set(`${key.package}::${key.subpath}`, { version: key.version, text });
  }
  return out;
};

// The published tree ships a node_modules directory of relative-import vendor
// copies beside its compiled output, and the app build bundles those files as
// written. Linking swaps them for the hub workspace's copies, so the browser
// can run different third-party code while every iBiz source file matches byte
// for byte. This is the same risk the bundle check covers for packages that
// inline vendor code into dist, and out/ or es/ parity cannot see it because
// collectCompiledFiles skips vendor directories on purpose.
export function vendorTreeDrift(hubDirectory, referenceDirectory) {
  const hubFiles = collectVendored(hubDirectory);
  const servedFiles = collectVendored(referenceDirectory);
  if (hubFiles === null || servedFiles === null)
    return { checked: false, hub: [], served: [], drift: [] };
  const versions = (files, pkg) =>
    [...new Set([...files.entries()].filter(([key]) => key.startsWith(`${pkg}::`)).map(([, value]) => value.version))]
      .sort()
      .join('|');
  const packages = [...new Set(
    [...hubFiles.keys(), ...servedFiles.keys()].map(key => key.split('::')[0]),
  )].sort();
  const drift = packages.filter(pkg =>
    [...hubFiles.keys(), ...servedFiles.keys()]
      .filter(key => key.split('::')[0] === pkg)
      .some(key => {
        const a = hubFiles.get(key);
        const b = servedFiles.get(key);
        return !a || !b || a.text !== b.text;
      }),
  );
  const label = pkg => `${pkg}@${versions(servedFiles, pkg) || versions(hubFiles, pkg)}`;
  return {
    checked: true,
    hub: packages.map(label),
    served: packages.map(label),
    drift: drift.map(label),
  };
}

export function linkDecision(measured) {
  const diff = measured?.hubToInstalledDiff;
  const missing = measured?.missingUpstream;
  if (typeof diff !== 'number' || typeof missing !== 'number' || missing > diff)
    return { safe: false, ourChanges: null, missingUpstream: null, reason: 'not measured' };
  return {
    safe: missing === 0,
    ourChanges: diff - missing,
    missingUpstream: missing,
    reason: missing ? `linking would drop ${missing} file(s) of upstream fixes` : null,
  };
}

export function resolveHubPackages(root) {
  const index = buildHubIndex([join(root, 'ibiz-app-hub')]);
  const out = new Map();
  for (const name of BASE_PACKAGES) {
    const entry = index.get(name);
    out.set(name, entry ? { directory: entry.directory, version: entry.version } : null);
  }
  return out;
}

// node_modules/@ibiz-template/<pkg> is a symlink to the hub tree once linked,
// and into .pnpm otherwise. realpath answers both without parsing the lockfile.
export function installedLinkState(root, name, hubDirectory) {
  const target = join(root, 'plm-web', 'node_modules', ...name.split('/'));
  if (!existsSync(target)) return { state: 'absent', realpath: null };
  const real = realpathSync(target);
  if (hubDirectory && real === hubDirectory) return { state: 'linked', realpath: real };
  return { state: 'published', realpath: real };
}

function manifestVersion(directory) {
  try {
    return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

export function collectCompiledFiles(directory, suffixes) {
  const files = new Map();
  const walk = (current, prefix) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Vendor code the bundler copied or inlined is not iBiz source, and the
      // two workspaces resolve shared caret ranges differently, so comparing it
      // reports differences no localization can settle. The browser bundle
      // comparison covers inlined vendor code instead.
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '_virtual') continue;
        walk(path, key);
      } else if (suffixes.some(suffix => entry.name.endsWith(suffix)))
        files.set(key, readFileSync(path, 'utf8'));
    }
  };
  walk(directory, '');
  return files;
}

// Compare two compiled trees given as path -> content maps and return the
// paths whose content differs.
export function differingPaths(before, after) {
  const out = new Set();
  for (const [path, content] of before) {
    if (!after.has(path)) continue;
    if (after.get(path) !== content) out.add(path);
  }
  return out;
}

// Paths the reference tree has and the other tree does not. A file upstream
// added shows up only here, never as a content difference, and a link drops it
// all the same. Ignoring this once let a whole new directives module read as
// zero debt; the build then failed on an import that no longer resolved.
export function onlyIn(reference, other) {
  return [...reference.keys()].filter(path => !other.has(path)).sort();
}

// A path the installed tree has and the hub build cannot produce at all. This
// is debt even when upstream never touched it, because only the hub can be at
// fault: either upstream added the module and the hub never had it, or the hub
// build is incomplete. A deliberate removal belongs in `intentional`, exactly
// like a deliberate divergence, so the default has to fail closed.

// Two builds of the same source reach an inlined sibling base package by
// different routes. A published tree imports the pnpm copy it was packed with,
//   ../../node_modules/.pnpm/@ibiz-template_core@0.7.41-alpha.78_.../node_modules/@ibiz-template/core/out/x.mjs
// and a hub build imports the workspace copy,
//   ../../packages/core/out/x.mjs
// The spelling is not something a source port can change, so counting it as
// debt would hold a link over a difference that is not a difference.
//
// Folding is allowed only for the @ibiz-template scope, only down to the
// subpath, and only when the inlined copy names the version plm-web declares
// for that package. A copy at some other version is real drift, and a changed
// file behind either specifier still differs on the line that reads it.
const INLINED_BASE_PACKAGE_IMPORT =
  /(from\s+|import\s+)['"](?:\.\.?\/)*node_modules\/\.pnpm\/@ibiz-template[+_]([^@_/]+)@([^_/'"]+)[^/']*?\/node_modules\/@ibiz-template\/[^/']+\/([^'"]+?)['"]/g;
const WORKSPACE_BASE_PACKAGE_IMPORT =
  /(from\s+|import\s+)['"](?:\.\.?\/)*packages\/([^/']+?)\/([^'"]+?)['"]/g;

export function canonicalizeBasePackageImports(text, declaredVersions = {}) {
  return text
    .replace(INLINED_BASE_PACKAGE_IMPORT, (whole, keyword, name, version, subpath) => {
      const wanted = declaredVersions[`@ibiz-template/${name}`];
      if (!wanted || wanted !== version) return whole;
      return `${keyword}'@ibiz-template/${name}/${subpath}'`;
    })
    .replace(WORKSPACE_BASE_PACKAGE_IMPORT, (_all, keyword, name, subpath) =>
      `${keyword}'@ibiz-template/${name}/${subpath}'`,
    );
}

// The counts in LINK_STATE_BY_PACKAGE. hubToInstalledDiff is every file the
// hub build cannot reproduce byte for byte from what is installed, whether
// because its content differs or because it is absent; missingUpstream is the
// subset of that upstream itself changed or added between the version the hub
// tree was cut from and the installed version.
export function measureCounts({ hubFiles, installedFiles, cutFiles, declared = [] }) {
  const hubToInstalled = differingPaths(hubFiles, installedFiles);
  const installedOnly = new Set(onlyIn(installedFiles, hubFiles));
  for (const path of installedOnly) hubToInstalled.add(path);
  const upstreamChanged = differingPaths(cutFiles, installedFiles);
  for (const path of onlyIn(installedFiles, cutFiles)) upstreamChanged.add(path);
  // A declared divergence exempts a file from upstream debt only while it
  // really is one. A declaration that stops matching is reported as expired
  // rather than quietly exempting whatever path it happens to name.
  const honoured = declared.filter(path => hubToInstalled.has(path));
  const expired = declared.filter(path => !hubToInstalled.has(path));
  const missingUpstream = [...hubToInstalled].filter(
    path =>
      (upstreamChanged.has(path) || installedOnly.has(path)) &&
      !honoured.includes(path),
  );
  return {
    hubToInstalledDiff: hubToInstalled.size,
    missingUpstream: missingUpstream.length,
    intentional: honoured,
    expiredDeclarations: expired,
    paths: [...hubToInstalled].sort(),
    missingPaths: missingUpstream.sort(),
  };
}

// Rebuild the hub tree and re-measure it. The published tarball for the cut
// version is fetched into a cache because upstream TypeScript is unreachable:
// the tarballs ship compiled output only, so that output is the only witness
// of what the hub tree is missing.
export function measurePackage(root, name, options = {}) {
  const entry = LINK_STATE_BY_PACKAGE[name];
  if (!entry) throw new Error(`${name} has no frozen row to measure against`);
  const hub = resolveHubPackages(root).get(name);
  if (!hub) throw new Error(`${name} is not present in the hub tree`);

  const suffixes = COMPILED_LAYOUT[entry.compiledDir];
  const hubDir = join(hub.directory, entry.compiledDir);
  if (!existsSync(hubDir))
    throw new Error(`${hubDir} is missing; build the hub package before measuring`);
  // Once a package is linked, node_modules *is* the hub tree, so comparing
  // against it reports perfect agreement no matter what the source holds. Use
  // the published artifact for the version plm-web declares instead, which is
  // the object it ran before the link and stays fixed afterwards.
  const slug = name.replace('@', '').replace('/', '-');
  const cache = join(options.cacheDir || '/tmp/ibiz-cut-packages', slug);
  const appManifest = JSON.parse(
    readFileSync(join(root, 'plm-web', 'package.json'), 'utf8'),
  );
  // The manifest is what the app asked for, which for some packages is a range
  // (`^0.1.84`); npm pack takes a version, not a range, so ask the lockfile
  // what that range resolved to. Fall back to the manifest only when it is
  // already concrete.
  const declared = (appManifest.dependencies || {})[name];
  if (!declared)
    throw new Error(`plm-web does not declare ${name}; nothing to measure against`);
  const resolved = lockfileVersions(
    readFileSync(join(root, 'plm-web', 'pnpm-lock.yaml'), 'utf8'),
    name,
  )[name];
  const referenceVersion = parseSemver(declared)
    ? declared
    : resolved && resolved.length === 1
      ? resolved[0]
      : null;
  if (!referenceVersion)
    throw new Error(
      `${name} is declared as ${declared}` +
        (resolved && resolved.length
          ? `, which the lockfile resolves to ${resolved.join(', ')}, so the published artifact to compare against is ambiguous`
          : ', and the lockfile does not say which version is installed'),
    );
  const referenceDir = join(cache, referenceVersion, 'package', entry.compiledDir);
  if (!existsSync(referenceDir)) {
    mkdirSync(join(cache, referenceVersion), { recursive: true });
    execFileSync(
      'npm',
      [
        'pack',
        `${name}@${referenceVersion}`,
        `--pack-destination=${join(cache, referenceVersion)}`,
        `--registry=${options.registry || DEFAULT_REGISTRY}`,
      ],
      { stdio: 'pipe' },
    );
    const tarball = join(cache, referenceVersion, `${slug}-${referenceVersion}.tgz`);
    if (!existsSync(tarball))
      throw new Error(`npm pack produced no tarball for ${name}@${referenceVersion}`);
    execFileSync('tar', ['xzf', tarball, '-C', join(cache, referenceVersion)], { stdio: 'pipe' });
  }
  if (!existsSync(referenceDir))
    throw new Error(`no ${entry.compiledDir} tree for ${name}@${referenceVersion} under ${cache}`);
  // The cut version is the published artifact plm-web actually runs, which is
  // what decides whether a link drops upstream fixes.
  const cutDir = join(cache, entry.cutVersion, 'package', entry.compiledDir);
  if (!existsSync(cutDir) && entry.cutVersion !== referenceVersion) {
    mkdirSync(join(cache, entry.cutVersion), { recursive: true });
    execFileSync(
      'npm',
      [
        'pack',
        `${name}@${entry.cutVersion}`,
        `--pack-destination=${join(cache, entry.cutVersion)}`,
        `--registry=${options.registry || DEFAULT_REGISTRY}`,
      ],
      { stdio: 'pipe' },
    );
    execFileSync(
      'tar',
      ['xzf', join(cache, entry.cutVersion, `${slug}-${entry.cutVersion}.tgz`), '-C', join(cache, entry.cutVersion)],
      { stdio: 'pipe' },
    );
  }
  if (!existsSync(cutDir))
    throw new Error(`no ${entry.compiledDir} tree for ${name}@${entry.cutVersion} under ${cache}`);

  // The hub build and the published artifact reach the same sibling base
  // package through different specifiers, because one resolves it through the
  // workspace and the other through the pnpm copy it was packed with. Read
  // both as the same import, or that spelling alone looks like a source
  // difference no port can remove.
  const canonical = files => {
    const out = new Map();
    for (const [path, text] of files)
      out.set(path, canonicalizeBasePackageImports(text, appManifest.dependencies));
    return out;
  };
  const result = measureCounts({
    hubFiles: canonical(collectCompiledFiles(hubDir, suffixes)),
    installedFiles: canonical(collectCompiledFiles(referenceDir, suffixes)),
    cutFiles: canonical(collectCompiledFiles(cutDir, suffixes)),
    declared: entry.intentional || [],
  });
  const stale =
    result.hubToInstalledDiff !== entry.hubToInstalledDiff ||
    result.missingUpstream !== entry.missingUpstream;
  return { name, referenceVersion, ...result, stale };
}

export function planLocalization(root = workspaceRoot) {
  const hubs = resolveHubPackages(root);
  return BASE_PACKAGES.map(name => {
    const hub = hubs.get(name);
    const link = installedLinkState(root, name, hub?.directory || null);
    const state = LINK_STATE_BY_PACKAGE[name];
    const decision = linkDecision(state);
    const bundle = hub ? join(hub.directory, 'dist', 'index.system.min.js') : null;
    // The installed bundle, not dist: dist is what a build produces, so for a
    // linked package it is the hub's own file and the comparison is vacuous.
    const installedDirectory = join(
      root,
      'plm-web',
      'node_modules',
      ...name.split('/'),
    );
    const installedBundle = join(installedDirectory, 'dist/index.system.min.js');
    // Read from the row rather than from node_modules: once a package is linked
    // the installed path is the hub tree, so an installed-side probe would stop
    // saying anything about the artifact a link replaces. 'declared' covers the
    // case where the row says nothing, which is held to need evidence.
    const drift = bundleDrift(
      bundle && existsSync(bundle) ? readFileSync(bundle, 'utf8') : null,
      existsSync(installedBundle) ? readFileSync(installedBundle, 'utf8') : null,
    );
    // The compiled tree this package publishes, on both sides. A package whose
    // vendored copies live here rather than in the bundle needs this check or
    // the vendor half of the decision has no evidence at all.
    const treeDrift = hub
      ? vendorTreeDrift(
          join(hub.directory, state.compiledDir),
          join(
            root,
            'plm-web',
            'node_modules',
            ...name.split('/'),
            state.compiledDir,
          ),
        )
      : { checked: false, hub: [], served: [], drift: [] };
    // Two ways a package can ship vendor code to the browser: inlined into the
    // bundle, or as a node_modules tree beside its compiled output. A package
    // that does neither has nothing to check, so it passes; one that reaches
    // vendor code by either route has to be clean on every route it uses.
    const vendorSources = [drift, treeDrift].filter(source => source.checked);
    const vendorEvidence = vendorSources.length
      ? {
          checked: true,
          hub: [...new Set(vendorSources.flatMap(s => s.hub))].sort(),
          served: [...new Set(vendorSources.flatMap(s => s.served))].sort(),
          drift: [...new Set(vendorSources.flatMap(s => s.drift))].sort(),
        }
      : // Nothing to compare on either route. A package the app has installed
        // but that publishes no browser bundle and no vendored tree genuinely
        // has no vendor code for a link to swap, which is a pass. Anything
        // else - nothing installed, or a bundle the hub has not built - is a
        // gap in the evidence and has to hold the link.
        state.vendorSurface === 'none' && !!hub
          ? { checked: true, hub: [], served: [], drift: [] }
        : {
            checked: false,
            hub: [],
            served: [],
            drift: [],
            note: 'no built browser bundle to compare; build the hub package first',
          };
    return {
      name,
      shortName: name.replace('@ibiz-template/', ''),
      hubDirectory: hub?.directory || null,
      hubVersion: hub?.version || null,
      installedVersion: manifestVersion(join(root, 'plm-web', 'node_modules', ...name.split('/'))),
      linkState: link.state,
      // Fail closed: without both bundles there is no evidence about inlined
      // vendor code, and out/ parity alone has already proved insufficient.
      safeToLink:
        decision.safe &&
        vendorEvidence.checked &&
        vendorEvidence.drift.length === 0,
      reason:
        decision.reason ||
        (vendorEvidence.drift.length
          ? `linking would swap inlined vendor code: ${vendorEvidence.drift.join(', ')}`
          : !vendorEvidence.checked
            ? vendorEvidence.note
            : null),
      vendorDrift: vendorEvidence,
      ourChanges: decision.ourChanges,
      missingUpstream: decision.missingUpstream,
      bundleBuilt: !!bundle && existsSync(bundle),
      referenceHasBundle: existsSync(installedBundle),
      // Relative to plm-web, which is where pnpm link resolves it from.
      linkArgument: hub ? relative(join(root, 'plm-web'), hub.directory) : null,
    };
  });
}

export function safeLinkTargets(plan) {
  return plan.filter(entry => entry.safeToLink && entry.linkState !== 'linked');
}

export function formatPlan(plan) {
  const lines = ['Base package localization plan', ''];
  lines.push(
    [
      'package'.padEnd(18),
      'hub-version'.padEnd(16),
      'link'.padEnd(11),
      'ours'.padEnd(6),
      'missing-upstream'.padEnd(17),
      'vendor-drift'.padEnd(14),
      'decision',
    ].join(' '),
  );
  for (const entry of plan) {
    const decision = entry.safeToLink
      ? entry.linkState === 'linked'
        ? 'linked, nothing to do'
        : 'link'
      : entry.missingUpstream
        ? `hold: linking would drop ${entry.missingUpstream} file(s) of upstream fixes`
        : `hold: ${entry.reason || 'not assessed'}`;
    lines.push(
      [
        entry.shortName.padEnd(18),
        (entry.hubVersion || '-').padEnd(16),
        entry.linkState.padEnd(11),
        // Implementation files that differ: ours against the published version
        // the hub declares, and the upstream fixes a link would drop.
        (entry.ourChanges ?? '-').toString().padEnd(6),
        (entry.missingUpstream ?? '-').toString().padEnd(17),
        (entry.vendorDrift?.checked
          ? entry.vendorDrift.drift.length || '-'
          : '?'
        ).toString().padEnd(14),
        decision,
      ].join(' '),
    );
  }
  lines.push(
    '',
    'ours              implementation files the hub adds of its own',
    'missing-upstream  upstream fixes the hub does not have, which a link drops',
    'vendor-drift      vendor packages inlined into the browser bundle that a',
    '                  link would swap, most often because the two workspaces',
    '                  resolve a shared caret range to different versions',
    'A package is safe to link only when missing-upstream is 0 and vendor-drift',
    'is -, because out/ cannot show what a bundle inlines.',
  );
  return `${lines.join('\n')}\n`;
}

function run(command, args, cwd, env = {}) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', ...env },
  });
}

export function hubInstallCommand(hubRoot, pnpmVersion = PNPM_VERSION) {
  // --ignore-scripts is required, not an optimisation: @parcel/watcher has no
  // prebuilt binary here and its node-gyp build fails, while esbuild, which the
  // builds do need, gets its platform binary from the explicit rebuild.
  return [
    `cd ${hubRoot}`,
    `corepack pnpm@${pnpmVersion} install --frozen-lockfile --ignore-scripts`,
    `corepack pnpm@${pnpmVersion} rebuild esbuild`,
  ].join(' && ');
}

function assertHubInstalled(hubRoot, pnpmVersion) {
  if (!existsSync(join(hubRoot, 'node_modules')))
    throw new Error(
      `ibiz-app-hub is not installed. Build it with:\n  ${hubInstallCommand(hubRoot, pnpmVersion)}`,
    );
}

export function applyPlan(root, plan, options = {}) {
  const appDir = join(root, 'plm-web');
  const hubRoot = join(root, 'ibiz-app-hub');
  // The committed lockfiles are v6, so a newer pnpm rewrites them and resolves
  // a different graph; every invocation pins the version through corepack.
  const pnpm = version => ['corepack', [`pnpm@${version || options.pnpmVersion || PNPM_VERSION}`]];
  const targets = safeLinkTargets(plan);
  if (!targets.length) {
    console.log('[localize-base-packages] nothing to link');
    return { linked: [] };
  }

  if (options.build !== false) {
    assertHubInstalled(hubRoot, options.pnpmVersion || PNPM_VERSION);
    const filters = targets.flatMap(entry => [
      '--filter',
      `./${relative(hubRoot, entry.hubDirectory)}`,
    ]);
    console.log(`[localize-base-packages] building ${targets.map(e => e.shortName).join(', ')}`);
    const [command, args] = pnpm();
    run(command, [...args, '-r', ...filters, 'run', 'build'], hubRoot);
  }

  for (const entry of targets) {
    const bundle = join(entry.hubDirectory, 'dist', 'index.system.min.js');
    // The app's import map loads this file by name, so a package whose
    // artifact ships one has to keep shipping it. Packages that never publish
    // a browser bundle are consumed through their compiled tree instead, and
    // demanding a file they have never had would refuse to link them forever.
    if (entry.referenceHasBundle && !existsSync(bundle)) {
      throw new Error(`${entry.name} produced no ${bundle}; refusing to link a package with no browser bundle`);
    }
    console.log(`[localize-base-packages] linking ${entry.name} <- ${entry.linkArgument}`);
    const [command, args] = pnpm();
    run(command, [...args, 'link', entry.linkArgument], appDir);
  }

  if (options.appBuild !== false) {
    console.log('[localize-base-packages] building plm-web');
    run('pnpm', ['build'], appDir);
  }

  if (options.reportDir) {
    mkdirSync(options.reportDir, { recursive: true });
    writeFileSync(
      join(options.reportDir, 'base-package-links.txt'),
      formatPlan(planLocalization(root)),
    );
  }
  return { linked: targets.map(entry => entry.name) };
}

const USAGE = `Usage: localize-base-packages.mjs [options]

Reports which @ibiz-template base packages ibiz-app-hub can serve as source,
and links the safe ones into plm-web.

Options:
  --apply        Perform the build and link. Default: report only.
  --measure      Re-measure the hub against the published cut versions instead
                 of trusting the frozen table. Needs plm-web/node_modules and
                 built hub packages; downloads to /tmp/ibiz-cut-packages.
  --no-build     Skip rebuilding the hub packages.
  --no-app-build Skip the plm-web production build.
  --report-dir   Write base-package-links.txt after applying.
  --only NAME    Restrict --measure to one short package name, e.g. runtime.
  -h, --help     Show this help.
`;

export function formatMeasurement(name, result) {
  const lines = [
    `${name}: hub-vs-installed ${result.hubToInstalledDiff} file(s), ` +
      `missing upstream ${result.missingUpstream}, ` +
      `ours ${result.hubToInstalledDiff - result.missingUpstream}`,
  ];
  if (result.missingPaths.length) {
    lines.push('  files a link would drop:');
    for (const path of result.missingPaths) lines.push(`    ${path}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      measure: { type: 'boolean', default: false },
      only: { type: 'string' },
      // The negative spellings have to be declared. allowNegative does not add
      // a `--no-x` alias; it only permits `--no-x` for an option *named*
      // `no-x`, so `--no-build` against a `build` option throws as an unknown
      // option and the documented flag never worked.
      build: { type: 'boolean', default: true },
      'no-build': { type: 'boolean', default: false },
      'app-build': { type: 'boolean', default: true },
      'no-app-build': { type: 'boolean', default: false },
      'report-dir': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (values.measure) {
    const wanted = values.only ? [values.only] : null;
    let drifted = false;
    for (const name of BASE_PACKAGES) {
      const short = name.replace('@ibiz-template/', '');
      if (wanted && !wanted.includes(short)) continue;
      try {
        const result = measurePackage(workspaceRoot, name);
        process.stdout.write(`${formatMeasurement(name, result)}\n`);
        if (result.stale) {
          drifted = true;
          process.stdout.write(
            `  frozen row says ${LINK_STATE_BY_PACKAGE[name].hubToInstalledDiff}/` +
              `${LINK_STATE_BY_PACKAGE[name].missingUpstream}; update LINK_STATE_BY_PACKAGE\n`,
          );
        }
      } catch (error) {
        process.stdout.write(`${name}: ${error.message}\n`);
        drifted = true;
      }
    }
    // Drift is not a failure: the table is a snapshot, and measuring is how it
    // gets refreshed. Exit stays 0 so this can run inside a porting loop.
    process.exitCode = 0;
    if (drifted) console.log('[localize-base-packages] frozen table no longer matches disk');
  } else {
    const plan = planLocalization();
    process.stdout.write(formatPlan(plan));
    if (values.apply) {
      const result = applyPlan(workspaceRoot, plan, {
        build: values.build && !values['no-build'],
        appBuild: values['app-build'] && !values['no-app-build'],
        reportDir: values['report-dir'],
      });
      console.log(`[localize-base-packages] linked: ${result.linked.join(', ') || 'none'}`);
    }
  }
}
