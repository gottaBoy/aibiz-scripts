import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  COMPILED_LAYOUT,
  LINK_STATE_BY_PACKAGE,
  bundleDrift,
  collectCompiledFiles,
  differingPaths,
  formatPlan,
  hubInstallCommand,
  inlinedPackages,
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

test('a package with upstream debt is never proposed for linking', () => {
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
    // The gate compares built browser bundles, so a fixture that expects a link
    // has to provide one on both sides.
    write(`ibiz-app-hub/packages/${short}/dist/index.system.min.js`, 'bundle');
    write(`plm-web/node_modules/@ibiz-template/${short}/dist/index.system.min.js`, 'bundle');
  }
  const plan = planLocalization(root);
  // Derived from the table rather than a snapshot list, because clearing a
  // package's upstream debt is the goal of the porting work and must not read
  // as a broken test.
  const indebted = BASE_PACKAGES.filter(
    name => LINK_STATE_BY_PACKAGE[name].missingUpstream > 0,
  );
  assert.ok(indebted.length, 'this fixture assumes at least one package is held');
  const proposed = safeLinkTargets(plan).map(entry => entry.name);
  for (const name of indebted) {
    const entry = plan.find(item => item.name === name);
    assert.equal(entry.safeToLink, false, name);
    assert.match(entry.reason, /upstream fixes/, name);
    assert.ok(!proposed.includes(name), `${name} must not be proposed`);
  }
  // Everything the table says is debt-free must be proposed once bundles agree.
  for (const entry of plan) {
    if (entry.missingUpstream === 0)
      assert.ok(entry.safeToLink, `${entry.name} has no reason to be held`);
  }
});

test('a declared divergence only counts while the file really differs', () => {
  const hub = new Map([['a.js', 'hub'], ['b.js', 'same']]);
  const installed = new Map([['a.js', 'pub'], ['b.js', 'same']]);
  const cut = new Map([['a.js', 'cut'], ['b.js', 'same']]);
  const base = { hubFiles: hub, installedFiles: installed, cutFiles: cut };

  // Without a declaration a.js is upstream debt, which holds the link.
  assert.equal(measureCounts(base).missingUpstream, 1);

  const honoured = measureCounts({ ...base, declared: ['a.js'] });
  assert.equal(honoured.missingUpstream, 0);
  assert.deepEqual(honoured.intentional, ['a.js']);
  assert.deepEqual(honoured.expiredDeclarations, []);

  // A declaration for a file that no longer differs must be reported rather
  // than left to exempt whatever path it happens to name.
  const expired = measureCounts({ ...base, declared: ['gone.js'] });
  assert.deepEqual(expired.expiredDeclarations, ['gone.js']);
  assert.deepEqual(expired.intentional, []);
  assert.equal(expired.missingUpstream, 1, 'an expired declaration exempts nothing');
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
  write('ibiz-app-hub/packages/core/dist/index.system.min.js', 'bundle');
  write('plm-web/node_modules/@ibiz-template/core/dist/index.system.min.js', 'bundle');
  const text = formatPlan(planLocalization(root));
  assert.match(text, /safe to link only when missing-upstream is 0 and vendor-drift/);
  assert.match(text, /^core\s+1\.0\.0\s+published\s+0\s+0\s+-\s+link$/m);
  // A package the fixture never installed still reports its measured cost, and
  // a debt-free but unbuilt one says why it is held rather than implying the
  // counts agreed. Both are derived from the table, so finishing a port cannot
  // leave a stale package name behind.
  const installed = ['core'];
  const rows = BASE_PACKAGES.map(name => ({
    short: name.replace('@ibiz-template/', ''),
    ...LINK_STATE_BY_PACKAGE[name],
  })).filter(row => !installed.includes(row.short));
  const indebted = rows.filter(row => row.missingUpstream > 0);
  assert.ok(indebted.length, 'the table should still hold something back');
  for (const row of indebted)
    assert.match(
      text,
      new RegExp(
        `^${row.short}\\s+-\\s+absent\\s+${row.hubToInstalledDiff - row.missingUpstream}\\s+` +
          `${row.missingUpstream}\\s+\\?\\s+hold: linking would drop`,
        'm',
      ),
      row.short,
    );
  for (const row of rows.filter(item => item.missingUpstream === 0))
    assert.match(
      text,
      new RegExp(
        `^${row.short}\\s+-\\s+absent\\s+\\d+\\s+0\\s+\\?\\s+hold: no built`,
        'm',
      ),
      row.short,
    );
});

test('inlined vendor packages gate a link that out/ parity would allow', () => {
  assert.deepEqual(
    inlinedPackages(
      'x node_modules/.pnpm/dingtalk-jsapi@3.1.0/node_modules/dingtalk-jsapi/lib/a.js y',
    ),
    ['dingtalk-jsapi@3.1.0'],
  );
  const hub = 'node_modules/.pnpm/dingtalk-jsapi@3.1.0/node_modules/dingtalk-jsapi/a.js';
  const served = 'node_modules/.pnpm/dingtalk-jsapi@3.2.0/node_modules/dingtalk-jsapi/a.js';
  const drift = bundleDrift(hub, served);
  assert.deepEqual(drift.drift, ['dingtalk-jsapi@3.1.0', 'dingtalk-jsapi@3.2.0']);
  assert.deepEqual(bundleDrift(hub, hub).drift, []);
  // No bundle on one side is no evidence, which must not read as agreement.
  assert.equal(bundleDrift(null, hub).checked, false);

  const { root, write } = fixture();
  write('plm-web/node_modules/@ibiz-template/core/package.json', { version: '1.0.0' });
  write('ibiz-app-hub/packages/core/package.json', {
    name: '@ibiz-template/core',
    version: '1.0.0',
  });
  write('ibiz-app-hub/packages/core/dist/index.system.min.js', hub);
  write('plm-web/node_modules/@ibiz-template/core/dist/index.system.min.js', served);
  const plan = planLocalization(root);
  const core = plan.find(entry => entry.shortName === 'core');
  // Upstream parity is perfect here; the vendor swap alone must hold it.
  assert.equal(core.missingUpstream, 0);
  assert.equal(core.safeToLink, false);
  assert.match(core.reason, /inlined vendor code/);

  // A package with no built bundle at all is held for the same reason.
  const bare = fixture();
  bare.write('plm-web/node_modules/@ibiz-template/core/package.json', { version: '1.0.0' });
  bare.write('ibiz-app-hub/packages/core/package.json', {
    name: '@ibiz-template/core',
    version: '1.0.0',
  });
  const unbuilt = planLocalization(bare.root).find(entry => entry.shortName === 'core');
  assert.equal(unbuilt.safeToLink, false);
  assert.match(unbuilt.reason, /no built browser bundle/);
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
