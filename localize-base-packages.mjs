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

import { BASE_PACKAGES, buildHubIndex, workspaceRoot } from './version-ledger.mjs';

const scriptPath = fileURLToPath(import.meta.url);
export const PNPM_VERSION = '8.15.9';
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

// Which directory holds the compiled files to compare, and with what suffix.
// Packages built by esbuild/tsc publish out/*.js; the Vue libraries publish
// es/*.mjs. Comparing the wrong pair silently counts zero differences.
export const COMPILED_LAYOUT = Object.freeze({
  out: ['.js'],
  es: ['.mjs'],
});

// Measured on 2026-09-26 by building each hub package and diffing compiled
// implementation files against the package installed in plm-web:
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
    hubToInstalledDiff: 0,
    missingUpstream: 0,
  },
  '@ibiz-template/runtime': {
    cutVersion: '0.7.41-alpha.77',
    compiledDir: 'out',
    hubToInstalledDiff: 38,
    missingUpstream: 29,
  },
  '@ibiz-template/vue3-util': {
    cutVersion: '0.7.41-alpha.77',
    compiledDir: 'es',
    hubToInstalledDiff: 25,
    missingUpstream: 24,
  },
  '@ibiz-template/vue3-components': {
    cutVersion: '0.7.41-alpha.70',
    compiledDir: 'es',
    hubToInstalledDiff: 66,
    missingUpstream: 49,
  },
});

// Our own localized changes are not a reason to hold a link; they are the
// point of having the source. Only files the hub is missing upstream can make
// a link unsafe, because dropping them changes what the browser runs.
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
      if (entry.isDirectory()) walk(path, key);
      else if (suffixes.some(suffix => entry.name.endsWith(suffix)))
        files.set(key, readFileSync(path, 'utf8'));
    }
  };
  walk(directory, '');
  return files;
}

// Compare two compiled trees given as path -> content maps and return the
// paths whose content differs. Files present on one side only are excluded,
// which matches what `diff -rq ... | grep 'and'` counts and keeps the numbers
// comparable with the measurements recorded before this existed.
export function differingPaths(before, after) {
  const out = new Set();
  for (const [path, content] of before) {
    if (!after.has(path)) continue;
    if (after.get(path) !== content) out.add(path);
  }
  return out;
}

// The two counts in LINK_STATE_BY_PACKAGE, derived the same way they were by
// hand: hubToInstalledDiff compares the hub build with what is installed, and
// missingUpstream is the subset of that which upstream itself changed between
// the version the hub tree was cut from and the installed version.
export function measureCounts({ hubFiles, installedFiles, cutFiles }) {
  const hubToInstalled = differingPaths(hubFiles, installedFiles);
  const upstreamChanged = differingPaths(cutFiles, installedFiles);
  const missingUpstream = [...hubToInstalled].filter(path => upstreamChanged.has(path));
  return {
    hubToInstalledDiff: hubToInstalled.size,
    missingUpstream: missingUpstream.length,
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
  const installedDir = join(root, 'plm-web', 'node_modules', ...name.split('/'), entry.compiledDir);
  if (!existsSync(hubDir))
    throw new Error(`${hubDir} is missing; build the hub package before measuring`);
  if (!existsSync(installedDir))
    throw new Error(`${installedDir} is missing; run pnpm install in plm-web before measuring`);

  const slug = name.replace('@', '').replace('/', '-');
  const cache = join(options.cacheDir || '/tmp/ibiz-cut-packages', slug);
  // npm always unpacks to a directory named package.
  const cutDir = join(cache, 'package', entry.compiledDir);
  if (!existsSync(cutDir)) {
    mkdirSync(cache, { recursive: true });
    execFileSync(
      'npm',
      [
        'pack',
        `${name}@${entry.cutVersion}`,
        `--pack-destination=${cache}`,
        `--registry=${options.registry || DEFAULT_REGISTRY}`,
      ],
      { stdio: 'pipe' },
    );
    const tarball = join(cache, `${slug}-${entry.cutVersion}.tgz`);
    if (!existsSync(tarball))
      throw new Error(`npm pack produced no tarball for ${name}@${entry.cutVersion}`);
    execFileSync('tar', ['xzf', tarball, '-C', cache], { stdio: 'pipe' });
  }
  if (!existsSync(cutDir))
    throw new Error(`no ${entry.compiledDir} tree for ${name}@${entry.cutVersion} under ${cache}`);

  const result = measureCounts({
    hubFiles: collectCompiledFiles(hubDir, suffixes),
    installedFiles: collectCompiledFiles(installedDir, suffixes),
    cutFiles: collectCompiledFiles(cutDir, suffixes),
  });
  return { name, ...result, stale: result.hubToInstalledDiff !== entry.hubToInstalledDiff || result.missingUpstream !== entry.missingUpstream };
}

export function planLocalization(root = workspaceRoot) {
  const hubs = resolveHubPackages(root);
  return BASE_PACKAGES.map(name => {
    const hub = hubs.get(name);
    const link = installedLinkState(root, name, hub?.directory || null);
    const decision = linkDecision(LINK_STATE_BY_PACKAGE[name]);
    const bundle = hub ? join(hub.directory, 'dist', 'index.system.min.js') : null;
    return {
      name,
      shortName: name.replace('@ibiz-template/', ''),
      hubDirectory: hub?.directory || null,
      hubVersion: hub?.version || null,
      installedVersion: manifestVersion(join(root, 'plm-web', 'node_modules', ...name.split('/'))),
      linkState: link.state,
      safeToLink: decision.safe,
      reason: decision.reason,
      ourChanges: decision.ourChanges,
      missingUpstream: decision.missingUpstream,
      bundleBuilt: !!bundle && existsSync(bundle),
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
        decision,
      ].join(' '),
    );
  }
  lines.push(
    '',
    'ours              implementation files the hub adds of its own',
    'missing-upstream  upstream fixes the hub does not have, which a link drops',
    'A package is safe to link only when missing-upstream is 0.',
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
    if (!existsSync(bundle)) {
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
      build: { type: 'boolean', default: true },
      'app-build': { type: 'boolean', default: true },
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
        build: values.build,
        appBuild: values['app-build'],
        reportDir: values['report-dir'],
      });
      console.log(`[localize-base-packages] linked: ${result.linked.join(', ') || 'none'}`);
    }
  }
}
