import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  analyzePlugins,
  baseFindings,
  collectBasePackages,
  compareSemver,
  formatLedger,
  importMapContracts,
  lockfileVersions,
  parseSemver,
  pluginFindings,
  pluginRefsFromModel,
  resolveImportTarget,
  satisfiesRange,
} from '../version-ledger.mjs';

export const LEDGER_PATHS = {
  appManifest: 'plm-web/package.json',
  lockfile: 'plm-web/pnpm-lock.yaml',
  nodeModules: 'plm-web/node_modules',
  builtBundles: 'plm-web/dist/extras/js/@ibiz-template',
  hubRoots: ['ibiz-app-hub'],
  modelApp: 'model.json',
  plugins: 'plm-web/public/plugins',
  importMap: 'plm-web/public/extras/json/system-import.json',
};

function workspace(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'version-ledger-'));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

test('semver ordering ranks prerelease below its release and compares identifiers', () => {
  assert.equal(compareSemver('0.7.41-alpha.86', '0.7.41-alpha.78'), 1);
  assert.equal(compareSemver('0.7.41-alpha.9', '0.7.41-alpha.10'), -1);
  assert.equal(compareSemver('0.7.41', '0.7.41-alpha.1'), 1);
  assert.equal(compareSemver('0.8.0', '0.7.41'), 1);
  assert.equal(parseSemver('not-a-version'), null);
});

test('caret ranges keep prereleases out of a different release tuple', () => {
  assert.equal(satisfiesRange('^0.7.41-alpha.18', '0.7.41-alpha.86').status, 'satisfied');
  // 0.7.41-alpha.18 is a prerelease of a tuple the range never names, so npm
  // excludes it even though the numbers sort inside the window.
  assert.equal(satisfiesRange('^0.7.40', '0.7.41-alpha.18').status, 'prerelease-excluded');
  assert.equal(satisfiesRange('^0.7.40', '0.7.41').status, 'satisfied');
  assert.equal(satisfiesRange('^0.7.40', '0.8.0').status, 'outside');
  assert.equal(satisfiesRange('^0.7.41-alpha.18', '0.7.42-alpha.1').status, 'prerelease-excluded');
  assert.equal(satisfiesRange('0.7.41-alpha.78', '0.7.41-alpha.78').status, 'satisfied');
  assert.equal(satisfiesRange('0.7.41-alpha.78', '0.7.41-alpha.86').status, 'outside');
  // Anything the parser does not model must surface as unsupported, never as a
  // silent pass, so a real mismatch cannot hide behind a guess.
  assert.equal(satisfiesRange('>=0.7.0', '0.7.41-alpha.78').status, 'unsupported');
});

test('pnpm v6 lockfile entries are keyed by package and stripped of peers', () => {
  const lock = [
    'lockfileVersion: "6.0"',
    'packages:',
    '  /@ibiz-template/core@0.7.41-alpha.78(axios@1.13.2)(qs@6.11.2):',
    '    resolution: {integrity: sha512-x}',
    '  /@ibiz-template/runtime@0.7.41-alpha.86(@ibiz-template/core@0.7.41-alpha.78):',
    '    resolution: {integrity: sha512-y}',
    '  /@ibiz-template/runtime@0.6.18(@ibiz-template/core@0.7.41-alpha.78):',
    '    resolution: {integrity: sha512-z}',
    '  /vite@4.5.0:',
    '    resolution: {integrity: sha512-w}',
  ].join('\n');
  assert.deepEqual(lockfileVersions(lock, '@ibiz-template/'), {
    '@ibiz-template/core': ['0.7.41-alpha.78'],
    '@ibiz-template/runtime': ['0.6.18', '0.7.41-alpha.86'],
  });
});

test('the model pins plugins and only plugin references are collected', () => {
  const refs = pluginRefsFromModel({
    name: 'plmweb',
    cache: {
      list: [
        '@ibiz-template-plm/list-tree@0.0.3-alpha.225',
        '@ibiz-template-plugins/cron-editor@0.0.1-dev.4',
        'not-a-package',
        './relative/path',
      ],
    },
  });
  assert.deepEqual(refs, [
    '@ibiz-template-plm/list-tree@0.0.3-alpha.225',
    '@ibiz-template-plugins/cron-editor@0.0.1-dev.4',
  ]);
});

test('import map targets are classified as committed or build-only', () => {
  const root = workspace();
  const mapFile = join(root, 'public/extras/json/system-import.json');
  mkdirSync(join(root, 'public/extras/json'), { recursive: true });
  mkdirSync(join(root, 'public/extras/js/pinned'), { recursive: true });
  writeFileSync(join(root, 'public/extras/js/pinned/index.system.min.js'), 'ok');
  mkdirSync(join(root, 'dist/extras/js/copy'), { recursive: true });
  writeFileSync(join(root, 'dist/extras/js/copy/index.system.min.js'), 'ok');

  const committed = resolveImportTarget({
    mapFile,
    target: '../js/pinned/index.system.min.js',
    distRoot: join(root, 'dist'),
  });
  assert.equal(committed.source, 'committed');

  const built = resolveImportTarget({
    mapFile,
    target: '../js/copy/index.system.min.js?time=1',
    distRoot: join(root, 'dist'),
  });
  assert.equal(built.source, 'build-only');

  const missing = resolveImportTarget({
    mapFile,
    target: '../js/absent/index.system.min.js',
    distRoot: join(root, 'dist'),
  });
  assert.equal(missing.source, null);
});

test('base package drift between declaration, lockfile and source is reported', () => {
  const root = workspace({
    'plm-web/package.json': {
      dependencies: {
        '@ibiz-template/core': '0.7.41-alpha.78',
        '@ibiz-template/runtime': '0.7.41-alpha.86',
        '@ibiz-template/vue3-util': '0.7.41-alpha.86',
        '@ibiz-template/vue3-components': '0.7.41-alpha.78',
        '@ibiz-template/model-helper': '0.7.41-alpha.86',
        unrelated: '1.0.0',
      },
    },
    'plm-web/pnpm-lock.yaml':
      '  /@ibiz-template/core@0.7.41-alpha.78(axios@1.13.2):\n' +
      '  /@ibiz-template/runtime@0.7.41-alpha.86():\n',
    'plm-web/node_modules/@ibiz-template/core/package.json': {
      name: '@ibiz-template/core',
      version: '0.7.41-alpha.77',
    },
    'plm-web/node_modules/@ibiz-template/runtime/package.json': {
      name: '@ibiz-template/runtime',
      version: '0.7.41-alpha.86',
    },
    // The hub is a pnpm workspace and its directory names do not track the
    // package names, so the ledger has to read the declared name.
    'ibiz-app-hub/packages/runtime/package.json': {
      name: '@ibiz-template/runtime',
      version: '0.7.41-alpha.77',
    },
    'ibiz-app-hub/components/ibiz-next-vue3/package.json': {
      name: '@ibiz-template/vue3-components',
      version: '0.7.41-alpha.70',
    },
  });
  const base = collectBasePackages(root, LEDGER_PATHS);
  const findings = baseFindings(base);
  const text = findings.map(item => `${item.level} ${item.component} ${item.issue}`).join('\n');

  // Manifest says .78, disk holds .77: that is a hard failure.
  assert.match(text, /FAIL @ibiz-template\/core .*asks 0\.7\.41-alpha\.78 but 0\.7\.41-alpha\.77/);
  assert.match(
    text,
    /WARN @ibiz-template\/runtime .*ibiz-app-hub source is 0\.7\.41-alpha\.77 while 0\.7\.41-alpha\.86/,
  );
  // A package found under a directory with a different name still resolves.
  const components = base.find(entry => entry.name === '@ibiz-template/vue3-components');
  assert.equal(components.hubSource, '0.7.41-alpha.70');
  assert.equal(components.hubDirectory, join('ibiz-app-hub', 'components', 'ibiz-next-vue3'));
  // No hub source at all must read as absent rather than as version zero.
  assert.equal(base.find(entry => entry.name === '@ibiz-template/core').hubSource, null);
  assert.doesNotMatch(text, /unrelated/);
  // Nothing is installed for these, so the ledger must say so rather than pass.
  assert.match(text, /FAIL @ibiz-template\/vue3-components not installed/);
});

test('a lockfile that resolves two versions of one package fails the ledger', () => {
  const root = workspace({
    'plm-web/package.json': { dependencies: { '@ibiz-template/core': '0.7.41-alpha.78' } },
    'plm-web/pnpm-lock.yaml':
      '  /@ibiz-template/core@0.7.41-alpha.78():\n  /@ibiz-template/core@0.7.40():\n',
    'plm-web/node_modules/@ibiz-template/core/package.json': { version: '0.7.41-alpha.78' },
  });
  const text = baseFindings(collectBasePackages(root))
    .map(item => `${item.level} ${item.issue}`)
    .join('\n');
  assert.match(text, /WARN lockfile resolves 2 versions/);
});

test('a linked package stops counting as independent evidence', () => {
  const files = {
    'plm-web/package.json': { dependencies: { '@ibiz-template/core': '0.7.41-alpha.78' } },
    'plm-web/pnpm-lock.yaml': '',
    'ibiz-app-hub/packages/core/package.json': {
      name: '@ibiz-template/core',
      version: '0.7.41-alpha.78',
    },
  };
  const root = workspace(files);
  // pnpm link leaves a symlink in node_modules pointing at the hub tree.
  mkdirSync(join(root, 'plm-web/node_modules/@ibiz-template'), { recursive: true });
  symlinkSync(
    join(root, 'ibiz-app-hub/packages/core'),
    join(root, 'plm-web/node_modules/@ibiz-template/core'),
    'dir',
  );
  const base = collectBasePackages(root, LEDGER_PATHS);
  const core = base.find(entry => entry.name === '@ibiz-template/core');
  assert.equal(core.linked, true);
  const findings = baseFindings(base);
  const text = findings.map(item => `${item.level} ${item.component} ${item.issue}`).join('\n');
  assert.match(text, /INFO @ibiz-template\/core localized: installed resolves into/);
  assert.doesNotMatch(text, /ibiz-app-hub source is .* while .* is in use/);

  // The same versions installed for real stay two authorities, so a mismatch
  // must still warn.
  const unlinked = base.map(entry => ({ ...entry, linked: false }));
  const drift = baseFindings(
    unlinked.map(entry => ({ ...entry, installed: '0.7.41-alpha.99' })),
  )
    .map(item => `${item.level} ${item.component} ${item.issue}`)
    .join('\n');
  assert.match(
    drift,
    /WARN @ibiz-template\/core ibiz-app-hub source is 0\.7\.41-alpha\.78 while 0\.7\.41-alpha\.99 is in use/,
  );
});

test('an unrelated placeholder that resolves to another tree is not a link', () => {
  const root = workspace({
    'plm-web/package.json': { dependencies: { '@ibiz-template/core': '0.7.41-alpha.78' } },
    'plm-web/pnpm-lock.yaml': '',
    'plm-web/node_modules/@ibiz-template/core/package.json': { version: '0.7.41-alpha.78' },
    'ibiz-app-hub/packages/core/package.json': {
      name: '@ibiz-template/core',
      version: '0.7.41-alpha.78',
    },
  });
  const core = collectBasePackages(root, LEDGER_PATHS).find(
    entry => entry.name === '@ibiz-template/core',
  );
  assert.equal(core.linked, false);
});

test('a plugin the model pins but the disk lacks is a runtime failure', () => {
  const files = {
    'plm-web/package.json': { dependencies: { '@ibiz-template/core': '1.0.0' } },
    'plm-web/pnpm-lock.yaml': '',
    'model.json': { list: ['@ibiz-template-plm/stale@1.0.0', '@ibiz-template-plm/absent@2.0.0'] },
  };
  files['plm-web/public/plugins/@ibiz-template-plm/stale@1.0.0/package.json'] = {
    name: '@ibiz-template-plm/stale',
    version: '1.0.0',
  };
  const root = workspace(files);
  const analysis = analyzePlugins(root, LEDGER_PATHS);
  assert.deepEqual(
    analysis.missing.map(item => `${item.ref}:${item.reason}`),
    ['@ibiz-template-plm/absent@2.0.0:package-not-on-disk'],
  );
  const findings = pluginFindings(analysis, { problems: [], unreadable: [] });
  assert.equal(findings.filter(item => item.level === 'FAIL').length, 1);
  assert.match(findings[0].issue, /model pins it but package-not-on-disk/);
});

test('unsatisfiable import map targets collapse to one row with blast radius', () => {
  const base = {
    missing: [],
    unsatisfied: [
      { dependency: '@ibiz-template/core', candidate: '0.7.41-alpha.78', range: '^0.5.0', plugin: 'p@1' },
      { dependency: '@ibiz-template/core', candidate: '0.7.41-alpha.78', range: '^0.6.0', plugin: 'p@2' },
    ],
  };
  const contracts = {
    problems: [
      { plugin: 'a@1', specifier: '@ibiz-template/runtime', reason: 'import-map-target-missing', target: '../x' },
      { plugin: 'b@1', specifier: '@ibiz-template/runtime', reason: 'import-map-target-missing', target: '../x' },
    ],
    unreadable: [],
  };
  const findings = pluginFindings(base, contracts);
  const runtime = findings.filter(item => item.component === '@ibiz-template/runtime');
  assert.equal(runtime.length, 1, 'one broken asset must not repeat per plugin');
  assert.match(runtime[0].issue, /import-map-target-missing \(\.\.\/x\) for 2 plugin\(s\)/);
  const info = findings.filter(item => item.level === 'INFO');
  assert.equal(info.length, 1, 'peer drift is one row per package');
  assert.match(info[0].issue, /2 plugin\(s\) declare 2 unsatisfied build-time range/);
});

test('the ledger lists the enforced runtime contract and passes without failures', () => {
  const root = workspace();
  mkdirSync(join(root, 'plm-web/public/plugins/@ibiz-template-plm/one@1.0.0/dist'), { recursive: true });
  mkdirSync(join(root, 'plm-web/public/extras/json'), { recursive: true });
  mkdirSync(join(root, 'plm-web/public/extras/js/@ibiz-template/runtime'), { recursive: true });
  writeFileSync(
    join(root, 'plm-web/public/plugins/@ibiz-template-plm/one@1.0.0/dist/index.es.js'),
    'import { x } from "@ibiz-template/runtime";\n',
  );
  writeFileSync(
    join(root, 'plm-web/public/extras/json/system-import.json'),
    JSON.stringify({ imports: { '@ibiz-template/runtime': '../js/@ibiz-template/runtime/index.system.min.js' } }),
  );
  writeFileSync(join(root, 'plm-web/public/extras/js/@ibiz-template/runtime/index.system.min.js'), 'x');
  writeFileSync(join(root, 'model.json'), JSON.stringify({ list: ['@ibiz-template-plm/one@1.0.0'] }));

  const contracts = importMapContracts({
    pluginsRoot: join(root, 'plm-web/public/plugins'),
    model: JSON.parse(readFileSync(join(root, 'model.json'), 'utf8')),
    mapFile: join(root, 'plm-web/public/extras/json/system-import.json'),
    candidates: ['dist/index.es.js'],
    distRoot: join(root, 'plm-web/dist'),
  });
  assert.deepEqual(contracts.problems, []);
  assert.deepEqual(contracts.used, [
    { specifier: '@ibiz-template/runtime', plugins: 1, target: '../js/@ibiz-template/runtime/index.system.min.js', sources: ['committed'] },
  ]);

  const text = formatLedger({
    generated: 'now',
    contracts,
    plugins: { packages: [], pinnedPlugins: 1, checked: 0 },
    containers: [],
    registry: [],
    findings: [],
  });
  assert.match(text, /Runtime contract/);
  assert.match(text, /@ibiz-template\/runtime\s+used by\s+1 plugin\(s\)\s+resolved by: committed/);
  assert.match(text, /RESULT PASS/);
});
