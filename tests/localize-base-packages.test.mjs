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
  canonicalizeBasePackageImports,
  differingPaths,
  formatPlan,
  hubInstallCommand,
  inlinedPackages,
  installedLinkState,
  linkDecision,
  measureCounts,
  planLocalization,
  safeLinkTargets,
  onlyIn,
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

test('the plan proposes exactly the packages with no upstream debt', () => {
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
  // Asserted as a rule over every row rather than against a list of held
  // packages: finishing a port removes rows from that list, and the test would
  // otherwise fail because the work succeeded.
  for (const entry of plan) {
    assert.equal(
      entry.missingUpstream,
      LINK_STATE_BY_PACKAGE[entry.name].missingUpstream,
      entry.name,
    );
    assert.equal(entry.safeToLink, entry.missingUpstream === 0, entry.name);
    if (entry.missingUpstream > 0)
      assert.match(entry.reason, /upstream fixes/, entry.name);
  }
  const proposed = safeLinkTargets(plan).map(entry => entry.name);
  assert.deepEqual(
    proposed.sort(),
    plan
      .filter(entry => entry.missingUpstream === 0 && entry.linkState !== 'linked')
      .map(entry => entry.name)
      .sort(),
  );
});

test('a held package is never proposed even when its bundles agree', () => {
  // safeLinkTargets is the only thing standing between the table and a pnpm
  // link, so the debt case needs its own coverage rather than a row borrowed
  // from a table that is meant to empty out.
  const plan = [
    { name: '@ibiz-template/clean', safeToLink: true, linkState: 'published' },
    { name: '@ibiz-template/owing', safeToLink: false, linkState: 'published' },
    { name: '@ibiz-template/done', safeToLink: true, linkState: 'linked' },
  ];
  assert.deepEqual(
    safeLinkTargets(plan).map(entry => entry.name),
    ['@ibiz-template/clean'],
  );
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
  // The one package this fixture installed is debt-free and has matching
  // bundles, so the report must offer to link it.
  assert.match(text, /^core\s+1\.0\.0\s+published\s+0\s+0\s+-\s+link$/m);
  // Every other package is absent from the fixture, so the report has to state
  // its measured cost and why it is still held. Derived per row from the table,
  // so the wording for both branches is checked whichever way a row sits, and
  // clearing a package's debt cannot leave an untested assertion behind.
  for (const name of BASE_PACKAGES) {
    const short = name.replace('@ibiz-template/', '');
    if (short === 'core') continue;
    const row = LINK_STATE_BY_PACKAGE[name];
    const ours = row.hubToInstalledDiff - row.missingUpstream;
    if (row.missingUpstream > 0) {
      assert.match(
        text,
        new RegExp(
          `^${short}\\s+-\\s+absent\\s+${ours}\\s+${row.missingUpstream}\\s+\\?\\s+` +
            `hold: linking would drop ${row.missingUpstream} file\\(s\\) of upstream fixes$`,
          'm',
        ),
        short,
      );
    } else {
      // Debt-free but with nothing built to compare, so it must say so rather
      // than let a clean pair of counts imply the evidence agreed.
      assert.match(
        text,
        new RegExp(
          `^${short}\\s+-\\s+absent\\s+${ours}\\s+0\\s+\\?\\s+` +
            `hold: no built browser bundle to compare; build the hub package first$`,
          'm',
        ),
        short,
      );
    }
  }
});

test('a held row is reported as held whatever the table says', () => {
  // The decision wording has to survive the table emptying out, so it is
  // asserted against a row built here rather than one borrowed from disk.
  const text = formatPlan([
    {
      shortName: 'owing',
      name: '@ibiz-template/owing',
      hubVersion: '1.0.0',
      linkState: 'published',
      ourChanges: 3,
      missingUpstream: 4,
      vendorDrift: { checked: true, drift: [] },
      safeToLink: false,
      reason: 'linking would drop 4 file(s) of upstream fixes',
    },
  ]);
  assert.match(
    text,
    /^owing\s+1\.0\.0\s+published\s+3\s+4\s+-\s+hold: linking would drop 4 file\(s\) of upstream fixes$/m,
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

test('differingPaths compares content only, leaving absence to onlyIn', () => {
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
  // Absence is not a content difference, so it belongs to onlyIn. Feeding both
  // into measureCounts is what keeps a file neither side can match out of the
  // count by accident.
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

test('vendor directories are skipped without abandoning the rest of the tree', () => {
  // The collector must ignore what the bundler copied or inlined, but skipping
  // one directory has to be a skip, not a stop. Skipping with a return once
  // emptied the whole result, which the measure then read as perfect parity.
  const { root, write } = fixture();
  write('tree/keep/a.js', '1');
  write('tree/node_modules/vue/index.js', 'vendor');
  write('tree/_virtual/polyfill.js', 'inlined');
  write('tree/keep-after/b.js', '2');
  const files = collectCompiledFiles(join(root, 'tree'), ['.js']);
  assert.deepEqual([...files.keys()].sort(), ['keep-after/b.js', 'keep/a.js']);
});

test('an empty compiled tree is reported as empty, not as agreement', () => {
  // Guards the caller's assumption: a wiped build must fail the measure rather
  // than produce a zero-diff plan that green-lights a link.
  const { root, write } = fixture();
  write('present/a.js', '1');
  const populated = collectCompiledFiles(join(root, 'present'), ['.js']);
  const empty = collectCompiledFiles(join(root, 'absent'), ['.js']);
  assert.ok(populated.size > 0);
  assert.equal(empty.size, 0);
  // Absence on the hub side is debt, so it must not read as parity.
  assert.deepEqual(onlyIn(populated, empty), ['a.js']);
  const result = measureCounts({
    hubFiles: empty,
    installedFiles: populated,
    cutFiles: populated,
  });
  assert.equal(result.hubToInstalledDiff, 1);
  assert.deepEqual(result.missingPaths, ['a.js']);
});

test('a module upstream added counts as dropped even though the hub cannot differ from it', () => {
  // Content comparison alone cannot see a new file, and a link drops it just
  // the same. This is the hole that let a whole directives module read as
  // zero debt until the app build failed on an unresolved import.
  const hub = new Map([['index.js', 'unchanged']]);
  const installed = new Map([
    ['index.js', 'unchanged'],
    ['directives/index.js', 'added'],
  ]);
  const cut = new Map([['index.js', 'unchanged']]);
  const result = measureCounts({ hubFiles: hub, installedFiles: installed, cutFiles: cut });
  assert.equal(result.hubToInstalledDiff, 1);
  assert.equal(result.missingUpstream, 1);
  assert.deepEqual(result.missingPaths, ['directives/index.js']);
});

const DECLARED = { '@ibiz-template/core': '0.7.41-alpha.78' };
const PNPM_IMPORT =
  "import { defaultNamespace } from '../../node_modules/.pnpm/@ibiz-template_core@0.7.41-alpha.78_axios@1.12.2_lodash-es@4.17.21/node_modules/@ibiz-template/core/out/utils/namespace/namespace.mjs';";
const WORKSPACE_IMPORT =
  "import { defaultNamespace } from '../../packages/core/out/utils/namespace/namespace.mjs';";

test('the two ways of reaching an inlined base package compare as one import', () => {
  // A published tree imports the pnpm copy it was packed with and a hub build
  // imports the workspace copy. Neither is a source difference.
  assert.equal(
    canonicalizeBasePackageImports(PNPM_IMPORT, DECLARED),
    canonicalizeBasePackageImports(WORKSPACE_IMPORT, DECLARED),
  );
});

test('an inlined copy at a version nobody declared is left visible as drift', () => {
  // Folding on shape alone would hide a real version disagreement, which is
  // the exact class of bug the vendor-drift check exists to catch.
  const other = PNPM_IMPORT.replace('0.7.41-alpha.78', '0.7.41-alpha.99');
  assert.equal(canonicalizeBasePackageImports(other, DECLARED), other);
  assert.notEqual(
    canonicalizeBasePackageImports(other, DECLARED),
    canonicalizeBasePackageImports(WORKSPACE_IMPORT, DECLARED),
  );
});

test('folding is limited to the iBiz scope and to the subpath', () => {
  // Third-party vendor code stays visible, and the file identity survives the
  // fold so a changed module behind the specifier still reads as different.
  const vendor =
    "import * as X from '../node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.mjs';";
  assert.equal(canonicalizeBasePackageImports(vendor, DECLARED), vendor);
  const local = "import { a } from '../control/grid/grid.mjs';";
  assert.equal(canonicalizeBasePackageImports(local, DECLARED), local);
  const changed = WORKSPACE_IMPORT.replace('namespace.mjs', 'other.mjs');
  assert.notEqual(
    canonicalizeBasePackageImports(changed, DECLARED),
    canonicalizeBasePackageImports(WORKSPACE_IMPORT, DECLARED),
  );
});
