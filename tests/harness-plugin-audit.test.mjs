import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  auditPlugins,
  collectPluginReferences,
  DEFAULT_INPUTS,
} from '../harness-plugin-audit.mjs';

const script = fileURLToPath(new URL('../harness-plugin-audit.mjs', import.meta.url));
const repo = '@example/plugin@1.2.3';
const manifest = {
  name: '@example/plugin',
  version: '1.2.3',
  system: 'dist/index.system.js',
  styles: ['dist/style.css'],
  main: 'dist/index.cjs',
  module: 'dist/index.js',
  types: 'dist/index.d.ts',
  scripts: { build: 'test-only-build-command' },
};
const runtimeFiles = {
  'dist/index.system.js': 'System.register([], function () {});',
  'dist/style.css': '.plugin {}',
  'dist/index.cjs': 'module.exports = {};',
  'dist/index.js': 'export {};',
  'dist/index.d.ts': 'export declare const plugin: unknown;',
};

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
}

function fixture(t, model = { rTObjectRepo: repo }) {
  const root = mkdtempSync(join(tmpdir(), 'harness-plugin-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const inputs = {
    model: join(root, 'model.json'),
    plugins: join(root, 'plugins'),
    dist: join(root, 'published'),
  };
  write(inputs.model, model);
  mkdirSync(inputs.plugins);
  mkdirSync(inputs.dist);
  return {
    root,
    inputs,
    install(catalog = 'plugins', overrides = {}, files = runtimeFiles, ref = repo) {
      const directory = join(inputs[catalog], ref);
      write(join(directory, 'package.json'), { ...manifest, ...overrides });
      for (const [path, content] of Object.entries(files)) {
        write(join(directory, path), content);
      }
      return directory;
    },
    run(...args) {
      return spawnSync(process.execPath, [
        script,
        '--model', inputs.model,
        '--plugins', inputs.plugins,
        '--dist', inputs.dist,
        ...args,
      ], { cwd: root, encoding: 'utf8' });
    },
  };
}

function snapshot(root) {
  const files = {};
  const visit = path => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files[child] = readFileSync(join(root, child), 'hex');
    }
  };
  visit('');
  return files;
}

test('defaults resolve from the script workspace, not the caller cwd', () => {
  const root = resolve(dirname(script), '..');
  assert.deepEqual(DEFAULT_INPUTS, {
    model: join(root, 'plm/model/PSSYSAPPS/plmweb/PSSYSAPP.simple.json'),
    plugins: join(root, 'plm-web/public/plugins'),
    dist: join(root, 'modelingweb/app/dist/plugins'),
  });
});

test('recurses through arrays and objects, accepts case aliases and deduplicates', () => {
  const refs = collectPluginReferences({
    rTObjectRepo: repo,
    nested: [{ RTOBJECTREPO: repo }, { deeper: { rtobjectrepo: 'plain@2.0.0' } }],
    'a/b~c': { rtObjectRepo: repo },
    description: `rtobjectrepo: ${repo}`,
    ignored: null,
  });
  assert.equal(refs.referenceCount, 4);
  assert.equal(refs.packages.length, 2);
  assert.deepEqual(refs.packages[0].locations, [
    '/rTObjectRepo', '/nested/0/RTOBJECTREPO', '/a~1b~0c/rtObjectRepo',
  ]);
  assert.equal(refs.packages[1].name, 'plain');
  assert.deepEqual(refs.invalidReferences, []);
});

test('reports all required manifest fields in local and published catalogs', t => {
  const f = fixture(t);
  const local = f.install();
  f.install('dist');
  write(join(local, 'src/index.ts'), 'export const plugin = {};');
  const report = auditPlugins(f.inputs);
  const plugin = report.plugins[0];
  for (const catalog of [plugin.local, plugin.published]) {
    assert.equal(catalog.directory.exists, true);
    assert.equal(catalog.manifest.valid, true);
    assert.equal(catalog.dist.exists, true);
    assert.equal(catalog.runtimeComplete, true);
    assert.equal(catalog.fields.name.matches, true);
    assert.equal(catalog.fields.version.matches, true);
    for (const key of ['system', 'styles', 'main', 'module', 'types']) {
      assert.equal(catalog.fields[key].present, true, key);
      assert.equal(catalog.fields[key].complete, true, key);
      assert.ok(catalog.fields[key].files.every(file => file.exists));
    }
  }
  assert.equal(report.runtimeComplete, true);
  assert.equal(plugin.source.staticPrerequisitesMet, true);
  assert.equal(plugin.source.buildVerified, false);
  assert.equal(plugin.source.status, 'unverified');
  assert.equal(report.summary.sourceBuildCandidates, 1);
  assert.equal(report.summary.sourceBuildVerified, 0);
});

test('runtime-only packages and declaration files do not count as source', t => {
  const f = fixture(t);
  f.install();
  f.install('dist');
  const report = auditPlugins(f.inputs);
  assert.equal(report.runtimeComplete, true);
  assert.equal(report.plugins[0].local.fields.types.complete, true);
  assert.equal(report.plugins[0].source.src.exists, false);
  assert.equal(report.plugins[0].source.status, 'missing-src');
  assert.equal(report.summary.sourceBuildCandidates, 0);
});

test('src with only declarations, maps or nested dist output is not implementation', t => {
  const f = fixture(t);
  const local = f.install();
  for (const name of ['index.d.ts', 'index.d.mts', 'index.d.cts', 'UPPER.D.TS']) {
    write(join(local, 'src', name), 'export declare const plugin: unknown;');
  }
  write(join(local, 'src/index.d.ts.map'), '{}');
  write(join(local, 'src/README.md'), 'source is unavailable');
  write(join(local, 'src/dist/index.js'), 'export {};');
  const { source } = auditPlugins(f.inputs).plugins[0];
  assert.equal(source.src.exists, true);
  assert.equal(source.declarationFiles.length, 4);
  assert.deepEqual(source.implementationFiles, []);
  assert.equal(source.staticPrerequisitesMet, false);
  assert.equal(source.status, 'no-implementation-source');
});

test('source requires a build script but never executes it', t => {
  const f = fixture(t);
  const local = f.install('plugins', { scripts: {} });
  write(join(local, 'src/components/plugin.vue'), '<template><div /></template>');
  const { source } = auditPlugins(f.inputs).plugins[0];
  assert.equal(source.implementationFiles.length, 1);
  assert.equal(source.buildScript, null);
  assert.equal(source.staticPrerequisitesMet, false);
  assert.equal(source.status, 'missing-build-script');
});

test('missing packages are findings rather than fatal errors', t => {
  const f = fixture(t, [{ rTObjectRepo: repo }, { rtObjectRepo: 'missing@1.0.0' }]);
  f.install();
  const report = auditPlugins(f.inputs);
  assert.equal(report.summary.uniquePackages, 2);
  assert.equal(report.summary.missingLocalPackages, 1);
  assert.equal(report.summary.missingPublishedPackages, 2);
  assert.equal(report.summary.localRuntimeComplete, 1);
  assert.equal(report.runtimeComplete, false);
  assert.equal(report.plugins[1].local.manifest.exists, false);
  assert.equal(report.plugins[1].local.fields.name.present, false);
  assert.equal(report.plugins[1].local.fields.system.complete, false);
});

test('missing catalogs are reported without creating directories', t => {
  const f = fixture(t);
  const before = snapshot(f.root);
  const report = auditPlugins({
    ...f.inputs,
    plugins: join(f.root, 'not-present'),
    dist: join(f.root, 'also-not-present'),
  });
  assert.equal(report.summary.missingLocalPackages, 1);
  assert.equal(report.summary.missingPublishedPackages, 1);
  assert.deepEqual(snapshot(f.root), before);
});

test('published packages are checked independently of complete local assets', t => {
  const f = fixture(t);
  f.install();
  const published = f.install('dist');
  rmSync(join(published, 'dist/index.system.js'));
  const report = auditPlugins(f.inputs);
  const plugin = report.plugins[0];
  assert.equal(plugin.local.runtimeComplete, true);
  assert.equal(plugin.published.directory.exists, true);
  assert.equal(plugin.published.dist.exists, true);
  assert.equal(plugin.published.manifest.valid, true);
  assert.equal(plugin.published.fields.system.files[0].exists, false);
  assert.equal(plugin.published.runtimeComplete, false);
  assert.equal(report.runtimeComplete, false);
  assert.equal(report.summary.missingPublishedPackages, 0);
  assert.equal(report.summary.publishedRuntimeComplete, 0);
});

test('an existing package directory without a manifest is not a valid package', t => {
  const f = fixture(t);
  const local = f.install();
  rmSync(join(local, 'package.json'));
  const { local: result } = auditPlugins(f.inputs).plugins[0];
  assert.equal(result.directory.exists, true);
  assert.equal(result.manifest.exists, false);
  assert.equal(result.manifest.valid, false);
  assert.equal(result.runtimeComplete, false);
});

test('empty styles, absent styles and single string styles are distinct and valid', async t => {
  for (const styles of [[], undefined, 'dist/style.css']) {
    await t.test(String(JSON.stringify(styles)), t => {
      const f = fixture(t);
      f.install('plugins', { styles });
      f.install('dist', { styles });
      const report = auditPlugins(f.inputs);
      const field = report.plugins[0].local.fields.styles;
      assert.equal(field.present, styles !== undefined);
      assert.equal(field.complete, true);
      assert.equal(field.files.length, typeof styles === 'string' ? 1 : 0);
      assert.equal(report.runtimeComplete, true);
    });
  }
});

test('malformed styles and missing CSS break runtime completeness', async t => {
  for (const styles of [null, '', {}, [null], [123], ['dist/missing.css']]) {
    await t.test(JSON.stringify(styles), t => {
      const f = fixture(t);
      f.install('plugins', { styles });
      const { local } = auditPlugins(f.inputs).plugins[0];
      assert.equal(local.fields.styles.complete, false);
      assert.equal(local.runtimeComplete, false);
    });
  }
});

test('accepts typings alias and checks both types aliases when both are declared', t => {
  const f = fixture(t);
  f.install('plugins', { types: undefined, typings: './dist/index.d.ts' });
  let field = auditPlugins(f.inputs).plugins[0].local.fields.types;
  assert.deepEqual(field.keys, ['typings']);
  assert.equal(field.complete, true);
  assert.equal(field.files[0].path, './dist/index.d.ts');
  f.install('plugins', { typings: 'dist/missing.d.ts' });
  field = auditPlugins(f.inputs).plugins[0].local.fields.types;
  assert.deepEqual(field.keys, ['types', 'typings']);
  assert.equal(field.complete, false);
  assert.equal(field.files.length, 2);
});

test('missing main, module and types do not imply missing SystemJS runtime', t => {
  const f = fixture(t);
  f.install('plugins', { main: 'missing.cjs', module: undefined, types: undefined });
  const { local } = auditPlugins(f.inputs).plugins[0];
  assert.equal(local.fields.main.present, true);
  assert.equal(local.fields.main.complete, false);
  assert.equal(local.fields.module.present, false);
  assert.equal(local.fields.types.present, false);
  assert.equal(local.runtimeComplete, true);
});

test('main and module do not substitute for a missing system declaration', t => {
  const f = fixture(t);
  f.install('plugins', { system: undefined });
  const { local } = auditPlugins(f.inputs).plugins[0];
  assert.equal(local.fields.main.complete, true);
  assert.equal(local.fields.module.complete, true);
  assert.equal(local.fields.system.present, false);
  assert.equal(local.fields.system.complete, false);
  assert.equal(local.runtimeComplete, false);
});

test('package name/version mismatches are not accepted as complete', async t => {
  for (const overrides of [
    { name: '@example/other' },
    { version: '1.2.4' },
    { name: undefined },
    { version: 123 },
  ]) {
    await t.test(JSON.stringify(overrides), t => {
      const f = fixture(t);
      const local = f.install('plugins', overrides);
      write(join(local, 'src/index.ts'), 'export {};');
      const plugin = auditPlugins(f.inputs).plugins[0];
      assert.equal(plugin.local.runtimeComplete, false);
      assert.equal(plugin.source.staticPrerequisitesMet, false);
    });
  }
});

test('malformed manifests are reported per package without aborting the audit', async t => {
  for (const value of ['{bad json', 'null', '[]', '"string"']) {
    await t.test(value, t => {
      const f = fixture(t);
      const local = f.install();
      write(join(local, 'package.json'), value);
      const { local: result } = auditPlugins(f.inputs).plugins[0];
      assert.equal(result.manifest.exists, true);
      assert.equal(result.manifest.valid, false);
      assert.ok(result.manifest.error);
      assert.equal(result.runtimeComplete, false);
    });
  }
});

test('rejects unsafe references and invalid values before catalog access', t => {
  const values = [
    '../escape@1', '@scope/../escape@1', '/tmp/escape@1',
    'C:\\plugins\\escape@1', '\\\\server\\escape@1', 'C:escape@1',
    '@scope/plugin@1/../../escape', '@scope//plugin@1',
    '%2e%2e/escape@1', 'https://example.com/pkg@1', 'plugin@1?file=x',
    'plugin@1#hash', 'plugin@1\0', 'plugin@1\n', 'plugin@1\r',
    ' plugin@1', '', null, 12, {}, [],
  ];
  const f = fixture(t, values.map(value => ({ rTObjectRepo: value })));
  const report = auditPlugins(f.inputs);
  assert.equal(report.summary.references, values.length);
  assert.equal(report.summary.invalidReferences, values.length);
  assert.equal(report.summary.uniquePackages, 0);
  assert.equal(report.runtimeComplete, false);
});

test('rejects traversal, absolute and encoded paths in every asset field', t => {
  const f = fixture(t);
  f.install('plugins', {
    system: '../outside.js',
    styles: ['/tmp/outside.css', 'C:\\outside.css', '%2e%2e/outside.css'],
    main: 'file:///outside.js',
    module: 'dist/../../outside.js',
    types: '//host/outside.d.ts',
  });
  const { local } = auditPlugins(f.inputs).plugins[0];
  for (const key of ['system', 'styles', 'main', 'module', 'types']) {
    assert.equal(local.fields[key].complete, false);
    assert.ok(local.fields[key].files.every(file => !file.safe), key);
  }
});

test('entry points must be regular files, not directories', t => {
  const f = fixture(t);
  const local = f.install('plugins', { system: 'dist/directory.js' });
  mkdirSync(join(local, 'dist/directory.js'));
  const field = auditPlugins(f.inputs).plugins[0].local.fields.system;
  assert.equal(field.complete, false);
  assert.equal(field.files[0].error, 'not-file');
});

test('rejects scope, package, manifest and asset symlinks escaping their roots', async t => {
  for (const target of ['scope', 'package', 'manifest', 'asset']) {
    await t.test(target, t => {
      const f = fixture(t);
      const outside = join(f.root, 'outside');
      write(join(outside, 'package.json'), manifest);
      write(join(outside, 'runtime.js'), 'export {};');
      if (target === 'scope') {
        symlinkSync(outside, join(f.inputs.plugins, '@example'));
      } else if (target === 'package') {
        mkdirSync(join(f.inputs.plugins, '@example'));
        symlinkSync(outside, join(f.inputs.plugins, repo));
      } else {
        const local = f.install();
        const file = target === 'manifest' ? 'package.json' : 'dist/index.system.js';
        rmSync(join(local, file));
        symlinkSync(
          join(outside, target === 'manifest' ? 'package.json' : 'runtime.js'),
          join(local, file),
        );
      }
      const { local } = auditPlugins(f.inputs).plugins[0];
      const check = target === 'scope' || target === 'package'
        ? local.directory
        : target === 'manifest' ? local.manifest : local.fields.system.files[0];
      assert.equal(check.safe, false);
      assert.equal(check.error, 'symlink-escape');
      assert.equal(local.runtimeComplete, false);
    });
  }
});

test('internal asset links are valid but source links are not proof of source', t => {
  const f = fixture(t);
  const local = f.install('plugins', { system: 'dist/linked.js' });
  symlinkSync('index.system.js', join(local, 'dist/linked.js'));
  mkdirSync(join(local, 'src'));
  symlinkSync('../dist/index.js', join(local, 'src/index.js'));
  symlinkSync('.', join(local, 'src/loop'));
  const plugin = auditPlugins(f.inputs).plugins[0];
  assert.equal(plugin.local.runtimeComplete, true);
  assert.deepEqual(plugin.source.implementationFiles, []);
  assert.equal(plugin.source.scanErrors.length, 2);
  assert.equal(plugin.source.staticPrerequisitesMet, false);
});

test('an internal src-to-dist directory link is not implementation source', t => {
  const f = fixture(t);
  const local = f.install();
  symlinkSync('dist', join(local, 'src'));
  const { source } = auditPlugins(f.inputs).plugins[0];
  assert.equal(source.src.exists, true);
  assert.deepEqual(source.implementationFiles, []);
  assert.equal(source.status, 'source-scan-incomplete');
});

test('an external src link is rejected without affecting valid runtime resources', t => {
  const f = fixture(t);
  const local = f.install();
  const outside = join(f.root, 'outside-source');
  write(join(outside, 'index.ts'), 'export {};');
  symlinkSync(outside, join(local, 'src'));
  const plugin = auditPlugins(f.inputs).plugins[0];
  assert.equal(plugin.local.runtimeComplete, true);
  assert.equal(plugin.source.src.safe, false);
  assert.equal(plugin.source.status, 'unsafe-src');
  assert.deepEqual(plugin.source.implementationFiles, []);
  assert.equal(plugin.source.staticPrerequisitesMet, false);
});

test('CLI emits repeatable JSON and leaves all input bytes unchanged', t => {
  const f = fixture(t);
  f.install();
  f.install('dist');
  const before = snapshot(f.root);
  const first = f.run();
  const second = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(JSON.parse(first.stdout).summary.sourceBuildVerified, 0);
  assert.deepEqual(snapshot(f.root), before);
  const output = join(f.root, 'reports/audit.json');
  const written = f.run('--output', output);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(readFileSync(output, 'utf8'), first.stdout);
  assert.equal(JSON.parse(written.stdout).output, output);
  assert.equal(f.run('--output', output).status, 0);
});

test('CLI writes findings even when runtime gaps cause exit code 1', t => {
  const f = fixture(t);
  const output = join(f.root, 'audit.json');
  const result = f.run('--output', output);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).runtimeComplete, false);
});

test('CLI rejects invalid arguments and malformed model JSON with exit code 2', t => {
  const f = fixture(t);
  for (const args of [['--unknown'], ['--output'], ['--model', 'other.json']]) {
    const result = f.run(...args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Plugin audit failed:/);
  }
  write(f.inputs.model, '{bad json');
  assert.equal(f.run().status, 2);
  write(f.inputs.model, 'null');
  assert.equal(f.run().status, 2);
});

test('CLI will not overwrite model or catalog assets, including linked aliases', t => {
  const f = fixture(t);
  const local = f.install();
  f.install('dist');
  const alias = join(f.root, 'catalog-alias');
  symlinkSync(f.inputs.plugins, alias);
  const modelLink = join(f.root, 'model-hardlink.json');
  linkSync(f.inputs.model, modelLink);
  const targets = [
    f.inputs.model,
    join(local, 'package.json'),
    join(f.inputs.plugins, 'new-report.json'),
    join(f.inputs.dist, 'new/report.json'),
    join(alias, repo, 'package.json'),
    modelLink,
  ];
  const before = snapshot(f.root);
  for (const output of targets) {
    const result = f.run('--output', output);
    assert.equal(result.status, 2, output);
    assert.match(result.stderr, /--output must/);
  }
  assert.deepEqual(snapshot(f.root), before);
});

test('CLI help does not access models or resources', t => {
  const f = fixture(t);
  rmSync(f.inputs.model);
  const result = f.run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /Exit codes:/);
});
