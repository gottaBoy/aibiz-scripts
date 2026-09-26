import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LINK_STATE_BY_PACKAGE,
  formatPlan,
  hubInstallCommand,
  installedLinkState,
  linkDecision,
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
