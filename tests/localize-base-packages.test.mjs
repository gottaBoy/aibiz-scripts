import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  COMPILED_LAYOUT,
  LINK_STATE_BY_PACKAGE,
  collectCompiledFiles,
  differingPaths,
  formatPlan,
  hubInstallCommand,
  installedLinkState,
  linkDecision,
  measureCounts,
  planLocalization,
  safeLinkTargets,
} from '../localize-base-packages.mjs';
import { BASE_PACKAGES } from '../version-ledger.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'localize-base-'));
  const write = (path, content) => {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
  };
  write('plm-web/package.json', { name: 'plm-web', dependencies: {} });
  write('plm-web/pnpm-lock.yaml', '');
  return { root, write };
}

test('every base package carries an explicit link decision', () => {
  assert.deepEqual(
    Object.keys(LINK_STATE_BY_PACKAGE).sort(),
    [...BASE_PACKAGES].sort(),
    'the table must cover every package the ledger tracks',
  );
  for (const [name, measured] of Object.entries(LINK_STATE_BY_PACKAGE)) {
    const decision = linkDecision(measured);
    assert.equal(decision.safe, measured.missingUpstream === 0, name);
    // The two counts must partition the diff, or the table was copied wrong.
    assert.equal(
      decision.ourChanges + measured.missingUpstream,
      measured.hubToInstalledDiff,
      name,
    );
    if (!decision.safe) assert.match(decision.reason, /drop \d+ file/);
  }
});

test('a measurement that does not add up is never treated as safe', () => {
  assert.equal(linkDecision({ hubToInstalledDiff: 3, missingUpstream: 5 }).safe, false);
  assert.equal(linkDecision(undefined).safe, false);
  // Our own changes alone never hold a package.
  assert.equal(linkDecision({ hubToInstalledDiff: 20, missingUpstream: 0 }).safe, true);
  assert.equal(linkDecision({ hubToInstalledDiff: 20, missingUpstream: 0 }).ourChanges, 20);
});

test('only packages that miss nothing upstream are proposed for linking', () => {
  const { root, write } = fixture();
  for (const name of BASE_PACKAGES) {
    const short = name.replace('@ibiz-template/', '');
    write(`plm-web/node_modules/@ibiz-template/${short}/package.json`, {
      name,
      version: '0.7.41-alpha.86',
    });
    write(`ibiz-app-hub/packages/${short}/package.json`, {
      name,
      version: '0.7.41-alpha.86',
    });
  }
  const plan = planLocalization(root);
  assert.deepEqual(
    safeLinkTargets(plan).map(entry => entry.shortName),
    ['core', 'model-helper'],
  );
  // The held rows must say what a link would cost.
  const runtime = plan.find(entry => entry.shortName === 'runtime');
  assert.equal(runtime.safeToLink, false);
  assert.equal(runtime.missingUpstream, 29);
});

test('link state separates linked, published and absent', () => {
  const { root, write } = fixture();
  const hubDir = join(root, 'ibiz-app-hub/packages/core');
  mkdirSync(hubDir, { recursive: true });
  const name = '@ibiz-template/core';

  assert.equal(installedLinkState(root, name, hubDir).state, 'absent');

  write(`plm-web/node_modules/${name}/package.json`, { version: '0.7.41-alpha.78' });
  assert.equal(installedLinkState(root, name, hubDir).state, 'published');

  // pnpm link leaves a symlink in node_modules pointing at the hub tree.
  rmSync(installedPath(root, name), { recursive: true, force: true });
  symlinkSync(hubDir, installedPath(root, name), 'dir');
  assert.equal(installedLinkState(root, name, hubDir).state, 'linked');
  // Without a hub directory to compare against, a symlink is still an install.
  assert.equal(installedLinkState(root, name, null).state, 'published');
});

test('the report states the rule instead of leaving it to be inferred', () => {
  const { root, write } = fixture();
  write('plm-web/node_modules/@ibiz-template/core/package.json', { version: '1.0.0' });
  write('ibiz-app-hub/packages/core/package.json', {
    name: '@ibiz-template/core',
    version: '1.0.0',
  });
  const text = formatPlan(planLocalization(root));
  assert.match(text, /safe to link only when missing-upstream is 0/);
  assert.match(text, /^core\s+1\.0\.0\s+published\s+0\s+0\s+link$/m);
  // Packages the fixture never installed still report their measured cost.
  assert.match(text, /^runtime\s+-\s+absent\s+9\s+29\s+hold: linking would drop 29/m);
});

function installedPath(root, name) {
  return join(root, 'plm-web', 'node_modules', ...name.split('/'));
}

test('the hub install recipe pins pnpm, keeps the lockfile, and fixes esbuild', () => {
  const command = hubInstallCommand('/work/ibiz-app-hub');
  // v6 lockfiles belong to pnpm 8; anything newer rewrites them.
  assert.match(command, /corepack pnpm@8\.15\.9/);
  assert.match(command, /install --frozen-lockfile --ignore-scripts/);
  // esbuild needs its platform binary back after scripts are skipped, and
  // @parcel/watcher is the reason scripts must be skipped.
  assert.match(command, /rebuild esbuild$/);
  assert.match(command, /^cd \/work\/ibiz-app-hub/);
});

test('the measurement core counts only files present on both sides', () => {
  const before = new Map([
    ['a.js', '1'],
    ['b.js', '2'],
    ['c.js', '3'],
  ]);
  const after = new Map([
    ['a.js', '1'],
    ['b.js', 'changed'],
    ['d.js', '4'],
  ]);
  assert.deepEqual([...differingPaths(before, after)], ['b.js']);
  // A file that only exists on one side is not a difference the import map
  // would notice, so it must not inflate the count.
  assert.deepEqual([...differingPaths(after, before)], ['b.js']);
});

test('measureCounts splits hub changes from dropped upstream fixes', () => {
  // same.js    unchanged everywhere
  // ours.js    the hub tree changed it, upstream never did
  // missing.js upstream changed it since the cut, the hub tree did not
  const hub = new Map([['same.js', 'x'], ['ours.js', 'hub'], ['missing.js', 'cut']]);
  const installed = new Map([
    ['same.js', 'x'],
    ['ours.js', 'cut'],
    ['missing.js', 'upstream'],
  ]);
  const cut = new Map([['same.js', 'x'], ['ours.js', 'cut'], ['missing.js', 'cut']]);
  const result = measureCounts({ hubFiles: hub, installedFiles: installed, cutFiles: cut });
  assert.deepEqual(result.paths, ['missing.js', 'ours.js']);
  assert.equal(result.hubToInstalledDiff, 2);
  assert.equal(result.missingUpstream, 1);
  assert.deepEqual(result.missingPaths, ['missing.js']);
});

test('a file both sides changed counts as missing, never as ours', () => {
  // Divergence in the same file is a merge, not a free localization, so the
  // conservative reading must hold the link.
  const hub = new Map([['both.js', 'hub']]);
  const installed = new Map([['both.js', 'upstream']]);
  const cut = new Map([['both.js', 'cut']]);
  const result = measureCounts({ hubFiles: hub, installedFiles: installed, cutFiles: cut });
  assert.equal(result.hubToInstalledDiff, 1);
  assert.equal(result.missingUpstream, 1);
});

test('every frozen row names a compiled layout the collector understands', () => {
  for (const [name, entry] of Object.entries(LINK_STATE_BY_PACKAGE)) {
    assert.ok(
      COMPILED_LAYOUT[entry.compiledDir],
      `${name} uses an unknown compiled directory`,
    );
    // Without the cut version the measurement cannot say what is missing
    // upstream versus what the hub added.
    assert.match(entry.cutVersion, /^\d+\.\d+\.\d+/, `${name} needs the version it was cut from`);
  }
});

test('collectCompiledFiles reads only the implementation suffixes it is given', () => {
  const { root, write } = fixture();
  write('tree/a.js', '1');
  write('tree/nested/b.js', '2');
  write('tree/nested/c.mjs', '3');
  write('tree/index.d.ts', '4');
  write('tree/index.d.ts.map', '5');
  const js = collectCompiledFiles(join(root, 'tree'), ['.js']);
  assert.deepEqual([...js.keys()].sort(), ['a.js', 'nested/b.js']);
  assert.deepEqual([...collectCompiledFiles(join(root, 'tree'), ['.mjs']).keys()], [
    'nested/c.mjs',
  ]);
  // A missing directory yields nothing rather than throwing, so callers must
  // treat an empty result as no evidence.
  assert.equal(collectCompiledFiles(join(root, 'nope'), ['.js']).size, 0);
});
