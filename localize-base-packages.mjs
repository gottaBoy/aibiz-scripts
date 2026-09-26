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
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { BASE_PACKAGES, buildHubIndex, workspaceRoot } from './version-ledger.mjs';

const scriptPath = fileURLToPath(import.meta.url);
export const PNPM_VERSION = '8.15.9';

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
  '@ibiz-template/core': { hubToInstalledDiff: 0, missingUpstream: 0 },
  '@ibiz-template/model-helper': { hubToInstalledDiff: 0, missingUpstream: 0 },
  '@ibiz-template/runtime': { hubToInstalledDiff: 38, missingUpstream: 29 },
  '@ibiz-template/vue3-util': { hubToInstalledDiff: 25, missingUpstream: 24 },
  '@ibiz-template/vue3-components': { hubToInstalledDiff: 66, missingUpstream: 49 },
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
  --no-build     Skip rebuilding the hub packages.
  --no-app-build Skip the plm-web production build.
  --report-dir   Write base-package-links.txt after applying.
  -h, --help     Show this help.
`;

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
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
