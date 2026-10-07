import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { runRuntimeModelSourceBuild } from '../harness-runtime-model-source-build.mjs';
import {
  implementation, loaderEntryEvidence, loaderRelativePath, originalRoot, runtimeModelResourceResponse,
  sha256, sourceBuildEvidence, sourceFiles, sourceRoot, verifyRuntimeModelLoadedResources, workspace,
} from './runtime-model-test-support.mjs';

const packagePath = 'modelingweb/local-plugins/runtime-model';
const realPackage = join(workspace, packagePath);
const tags = ['ibiz-model-runtime', 'ibiz-model-runtime-list', 'loading-mask', 'loading-panel'];
const members = {
  'ibiz-model-runtime': {
    url: [8], headers: [8], parentKey: [1, 'parent-key'],
    configBaseUrl: [1, 'config-base-url'], breadcrumbHoverIndex: [32],
  },
  'loading-mask': { visible: [32], show: [64], hide: [64] },
  'ibiz-model-runtime-list': {
    controller: [16], items: [16], index: [2], parent: [8], list: [32],
  },
  'loading-panel': {
    defaultShow: [4, 'default-show'], visible: [32], message: [32], show: [64], hide: [64],
  },
};

function write(path, value) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, value);
}

function fakeOutputs(root, revision) {
  const bundles = [['ibiz-model-runtime_4', tags.map(tag => [0, tag,
    revision === 'fixed' && tag === 'ibiz-model-runtime-list'
      ? { ...members[tag], activeData: [32] } : members[tag]])]];
  write(join(root, 'dist/esm/loader.js'),
    `import { bootstrapLazy } from './runtime.js';\n` +
    `export const defineCustomElements = () => bootstrapLazy(${JSON.stringify(bundles)});\n`);
  write(join(root, 'dist/esm/runtime.js'),
    "import './runtime-base.js';\nexport const bootstrapLazy = () => {};\n");
  write(join(root, 'dist/esm/runtime-base.js'), 'export const runtimeFixture = true;\n');
  write(join(root, 'loader/index.js'),
    "export * from '../dist/esm/polyfills/index.js';\nexport * from '../dist/esm/loader.js';\n");
  write(join(root, 'dist/esm/polyfills/index.js'), 'export function applyPolyfills() {}\n');
  write(join(root, 'loader/index.d.ts'), 'export declare function defineCustomElements(): void;\n');
  write(join(root, 'loader/package.json'), JSON.stringify({ module: './index.js', typings: './index.d.ts' }));
  write(join(root, 'dist/esm/ibiz-model-runtime_4.entry.js'),
    "export * from './component-implementation.js';\n");
  write(join(root, 'dist/esm/component-implementation.js'), 'export const fixture = true;\n');
  write(join(root, 'dist/types/components.d.ts'), 'export interface Components {}\n');
  for (const tag of tags) {
    write(join(root, `dist/types/components/${tag}/${tag}.d.ts`), 'export class Component {}\n');
    write(join(root, `dist/collection/components/${tag}/${tag}.css`), `${tag} { display: block; }\n`);
  }
}

function fixture(t, revision = 'baseline') {
  const root = fs.mkdtempSync(join(tmpdir(), 'runtime-model-loader-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relativePackage = revision === 'fixed'
    ? 'modelingweb/local-plugins/runtime-model-next' : packagePath;
  const actualPackage = join(workspace, relativePackage);
  const packageRoot = join(root, relativePackage);
  fs.mkdirSync(packageRoot, { recursive: true });
  for (const name of ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'stencil.config.ts']) {
    fs.cpSync(join(actualPackage, name), join(packageRoot, name), {
      recursive: true, filter: path => !path.endsWith('/components.d.ts'),
    });
  }
  fs.symlinkSync(fs.realpathSync(join(actualPackage, 'node_modules')), join(packageRoot, 'node_modules'), 'dir');
  // Mock only the compiler process; these fixture reports are never production build evidence.
  const spawn = t.mock.method(childProcess, 'spawnSync', (executable, args, options) => {
    if (args.includes('build')) fakeOutputs(options.cwd, revision);
    return { status: 0, signal: null, stdout: 'mock compiler fixture\n', stderr: '' };
  });
  syncBuiltinESMExports();
  t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
  const result = runRuntimeModelSourceBuild({ workspace: root, revision });
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  const observedRoot = join(root, result.report.originalObservation.path);
  fs.mkdirSync(dirname(observedRoot), { recursive: true });
  fs.cpSync(originalRoot, observedRoot, { recursive: true });
  return {
    workspace: root, packageRoot, observedRoot, ...result,
    buildRoot: result.report.buildRoot,
    evidence: () => sourceBuildEvidence(result.report.buildRoot, {
      workspace: root, reportPath: result.reportPath,
    }),
  };
}

function changeReport(f, change) {
  const report = JSON.parse(fs.readFileSync(f.reportPath));
  change(report);
  write(f.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  write(join(dirname(f.reportPath), 'report.sha256'), `${sha256(fs.readFileSync(f.reportPath))}\n`);
}

test('browser provenance binds public entry, underlying loader, polyfills and every real output', t => {
  const f = fixture(t);
  const evidence = f.evidence();
  assert.equal(evidence.loaderEntryRelative, 'loader/index.js');
  assert.equal(evidence.originalLoaderEntryRelative, 'loader/index.mjs');
  assert.equal(evidence.loaderRelative, 'dist/esm/loader.js');
  assert.equal(evidence.originalLoaderRelative, 'dist/esm/loader.mjs');
  assert.equal(evidence.sourceRoot, join(f.packageRoot, 'src'));
  assert.equal(sourceBuildEvidence(f.buildRoot, {
    workspace: f.workspace, reportPath: f.reportPath, sourceRoot: join(f.packageRoot, 'src'),
  }).sourceRoot, evidence.sourceRoot);
  const receipt = f.report.builds[0].loader;
  assert.equal(evidence.loaderSha256, receipt.loaderSha256);
  assert.equal(evidence.loaderIndexSha256, receipt.loaderIndexSha256);
  assert.equal(evidence.polyfillsSha256, receipt.polyfillsSha256);
  assert.notEqual(evidence.loaderIndexSha256, evidence.loaderSha256);
  assert.equal(evidence.nativeAcceptance, false);
  assert.deepEqual(evidence.resourceManifests.recovered.requiredResources, [
    'dist/esm/component-implementation.js', 'dist/esm/ibiz-model-runtime_4.entry.js',
    'dist/esm/loader.js', 'dist/esm/polyfills/index.js',
    'dist/esm/runtime-base.js', 'dist/esm/runtime.js', 'loader/index.js',
  ]);
  assert.deepEqual(evidence.resourceManifests.recovered.entries, f.report.outputs.entries);
});

test('observed loader public named reexports are checked without inventing an original manifest', () => {
  const evidence = loaderEntryEvidence(originalRoot, ['dist/esm/ibiz-model-runtime_4.entry.mjs']);
  assert.equal(evidence.entryRelative, 'loader/index.mjs');
  assert.equal(evidence.loaderRelative, 'dist/esm/loader.mjs');
  assert.ok(evidence.requiredResources.includes('dist/esm/index-729ab4d0.mjs'));
  assert.equal(evidence.entrySha256, sha256(fs.readFileSync(join(originalRoot, 'loader/index.mjs'))));
});

for (const [name, change, expected] of [
  ['empty underlying loader', f => write(join(f.buildRoot, 'dist/esm/loader.js'), ''), /loader is empty/],
  ['ambiguous underlying loaders', f => write(join(f.buildRoot, 'dist/esm/loader.mjs'), 'export {};'),
    /Expected one real loader/],
  ['missing public entry', f => fs.rmSync(join(f.buildRoot, 'loader/index.js')), /ENOENT/],
  ['empty public entry', f => write(join(f.buildRoot, 'loader/index.js'), ''), /Public loader entry is empty/],
  ['ambiguous public entries', f => write(join(f.buildRoot, 'loader/index.mjs'), 'export {};'),
    /Ambiguous public loader entry/],
  ['wrong underlying reexport', f => write(join(f.buildRoot, 'loader/index.js'),
    "export * from '../dist/esm/polyfills/index.js';\nexport * from '../dist/esm/runtime.js';\n"),
    /Public loader reexports changed/],
  ['missing polyfill reexport', f => write(join(f.buildRoot, 'loader/index.js'),
    "export * from '../dist/esm/loader.js';\n"), /Public loader reexports changed/],
  ['empty polyfill module', f => write(join(f.buildRoot, 'dist/esm/polyfills/index.js'), ''),
    /Polyfill loader is empty/],
  ['missing imported runtime', f => fs.rmSync(join(f.buildRoot, 'dist/esm/runtime.js')), /ENOENT/],
  ['empty indirect runtime', f => write(join(f.buildRoot, 'dist/esm/runtime-base.js'), ''),
    /Loader resource is empty/],
  ['missing indirect component', f =>
    fs.rmSync(join(f.buildRoot, 'dist/esm/component-implementation.js')), /ENOENT/],
  ['escaping indirect import', f => write(join(f.buildRoot, 'dist/esm/runtime-base.js'),
    "export * from '../../../outside.js';\n"), /Loader graph import escapes package/],
  ['external indirect import', f => write(join(f.buildRoot, 'dist/esm/runtime-base.js'),
    "import 'external-module';\n"), /Loader graph import must remain package-relative/],
  ['query-bearing indirect import', f => write(join(f.buildRoot, 'dist/esm/runtime-base.js'),
    "export * from './runtime.js?different-bytes';\n"), /Ambiguous loader graph import/],
]) {
  test(`loader entry rejects ${name} without falling back to a direct loader`, t => {
    const f = fixture(t);
    change(f);
    assert.throws(() => loaderEntryEvidence(f.buildRoot,
      ['dist/esm/ibiz-model-runtime_4.entry.js']), expected);
  });
}

for (const [name, change, expected] of [
  ['workspace config drift', f => fs.appendFileSync(join(f.packageRoot, 'stencil.config.ts'), '\n// drift\n'),
    /Source input or dependency drift/],
  ['isolated config drift', f => fs.appendFileSync(join(f.buildRoot, 'stencil.config.ts'), '\n// drift\n'),
    /Isolated input drift/],
  ['public entry byte drift', f => fs.appendFileSync(join(f.buildRoot, 'loader/index.js'), '\n// drift\n'),
    /Build output drift/],
  ['forged loader metadata with refreshed report hash', f => changeReport(f, report => {
    for (const build of report.builds) build.loader.loaderSha256 = '0'.repeat(64);
  }), /Loader evidence drift/],
  ['omitted config input with refreshed report hash', f => changeReport(f, report => {
    report.inputs.files.entries = report.inputs.files.entries.filter(item => item.path !== 'stencil.config.ts');
  }), /Source input or dependency drift/],
  ['original public entry drift', f => fs.appendFileSync(join(f.observedRoot, 'loader/index.mjs'), '\n// drift\n'),
    /Original resource size drift/],
]) {
  test(`browser provenance refuses ${name}`, t => {
    const f = fixture(t);
    change(f);
    assert.throws(f.evidence, expected);
  });
}

test('browser provenance rejects a tested package different from the receipt build root', t => {
  const f = fixture(t);
  assert.throws(() => sourceBuildEvidence(f.packageRoot, {
    workspace: f.workspace, reportPath: f.reportPath,
  }), /Report and tested loader root differ/);
});

test('browser provenance cannot relabel a verified build as another source tree', t => {
  const f = fixture(t);
  assert.throws(() => sourceBuildEvidence(f.buildRoot, {
    workspace: f.workspace, reportPath: f.reportPath,
    sourceRoot: join(f.workspace, 'modelingweb/local-plugins/runtime-model-next/src'),
  }), /Report and requested source root differ/);
});

test('fixed revision provenance binds .2 source, active state metadata and exact executable graph', t => {
  const f = fixture(t, 'fixed');
  const evidence = sourceBuildEvidence(f.buildRoot, {
    workspace: f.workspace, reportPath: f.reportPath, sourceRoot: join(f.packageRoot, 'src'),
  });
  assert.equal(evidence.candidateVersion, '0.2.2-local.2');
  assert.equal(evidence.candidateRevision, 'fixed');
  assert.equal(evidence.nativeAcceptance, false);
  assert.equal(f.report.builds[0].loader.components.find(component =>
    component.tag === 'ibiz-model-runtime-list').members.activeData[0], 32);
  assert.throws(() => sourceBuildEvidence(f.buildRoot, {
    workspace: f.workspace, reportPath: f.reportPath,
    sourceRoot: join(f.workspace, packagePath, 'src'),
  }), /Report and requested source root differ/);
  const origin = 'http://127.0.0.1:32123';
  const resources = evidence.resourceManifests.recovered.requiredResources.map(path =>
    runtimeModelResourceResponse({
      sourceBuild: evidence, side: 'recovered', origin,
      url: `${origin}/packages/recovered/${path}`, status: 200,
      resourceType: 'script', bytes: fs.readFileSync(join(f.buildRoot, path)),
    }));
  assert.equal(verifyRuntimeModelLoadedResources(evidence, 'recovered', resources), true);
});

function sourceFixture(t, marker) {
  const packageRoot = fs.mkdtempSync(join(tmpdir(), 'runtime-model-source-root-'));
  t.after(() => fs.rmSync(packageRoot, { recursive: true, force: true }));
  fs.cpSync(join(realPackage, 'src'), join(packageRoot, 'src'), { recursive: true });
  fs.copyFileSync(join(realPackage, 'package.json'), join(packageRoot, 'package.json'));
  fs.symlinkSync(fs.realpathSync(join(realPackage, 'node_modules')), join(packageRoot, 'node_modules'), 'dir');
  write(join(packageRoot, 'src/core/source-root-probe.ts'),
    `export class SourceRootProbe { static readonly marker = ${JSON.stringify(marker)}; }\n`);
  return { packageRoot, sourceRoot: join(packageRoot, 'src') };
}

test('source root defaults preserve the .1 reconstruction and its real declarations', () => {
  assert.equal(sourceRoot, join(realPackage, 'src'));
  const env = implementation('recovered');
  assert.equal(env.local.sourceRoot, sourceRoot);
  assert.deepEqual(env.local.files, sourceFiles());
  assert.equal(env.local.declarations.length, 4);
});

test('unknown implementation sides cannot silently select the original observation', () => {
  for (const side of [undefined, null, '', 'reconstruct', 'next', 'Original']) {
    assert.throws(() => implementation(side), /Unknown runtime-model implementation side/);
  }
});

test('two explicit source roots execute their own source without shared declaration caches', t => {
  const first = sourceFixture(t, 'first-source-tree');
  const second = sourceFixture(t, 'second-source-tree');
  const firstEnv = implementation('recovered', { sourceRoot: first.sourceRoot });
  const secondEnv = implementation('recovered', {
    sourceRoot: relative(process.cwd(), second.sourceRoot),
  });
  assert.equal(firstEnv.exported.SourceRootProbe.marker, 'first-source-tree');
  assert.equal(secondEnv.exported.SourceRootProbe.marker, 'second-source-tree');
  for (const [env, f] of [[firstEnv, first], [secondEnv, second]]) {
    assert.equal(env.local.sourceRoot, f.sourceRoot);
    assert.ok(env.local.files.every(file => file.startsWith(`${f.sourceRoot}/`)));
    assert.ok(env.local.declarations.every(item => item.path.startsWith(`${f.sourceRoot}/`)));
    assert.deepEqual(env.local.files, sourceFiles(relative(process.cwd(), f.sourceRoot)));
  }
  assert.notEqual(firstEnv.exported.ModelRuntimeController, secondEnv.exported.ModelRuntimeController);
  assert.equal(implementation('recovered', { sourceRoot: first.sourceRoot })
    .exported.SourceRootProbe.marker, 'first-source-tree');
  assert.equal(implementation('original', { sourceRoot: join(second.packageRoot, 'absent') }).local, null);
});

test('source root environment selects source and default build roots in an isolated process', t => {
  const f = sourceFixture(t, 'environment-source-tree');
  const env = { ...process.env, RUNTIME_MODEL_SOURCE_ROOT: f.sourceRoot };
  delete env.RUNTIME_MODEL_BUILT_ROOT;
  const result = childProcess.spawnSync(process.execPath, ['--input-type=module', '-e',
    'import {sourceRoot,builtRoot,implementation} from "./scripts/tests/runtime-model-test-support.mjs";' +
    'const loaded=implementation("recovered");' +
    'console.log(JSON.stringify({sourceRoot,builtRoot,marker:loaded.exported.SourceRootProbe.marker}));',
  ], { cwd: workspace, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    sourceRoot: f.sourceRoot, builtRoot: f.packageRoot, marker: 'environment-source-tree',
  });
});

for (const [name, change, expected] of [
  ['missing source tree', f => fs.rmSync(f.sourceRoot, { recursive: true }), /ENOENT/],
  ['incomplete declarations', f => fs.rmSync(join(f.sourceRoot, 'components/loading-panel'), {
    recursive: true,
  }), /Unresolved recovered-source import \.\/components\/loading-panel\/loading-panel/],
  ['missing package manifest', f => fs.rmSync(join(f.packageRoot, 'package.json')),
    /Recovered source package manifest is missing/],
  ['missing selected dependencies', f => fs.unlinkSync(join(f.packageRoot, 'node_modules')),
    /Cannot find module/],
]) {
  test(`explicit source loading rejects ${name} instead of falling back to .1`, t => {
    const f = sourceFixture(t, 'invalid-source-tree');
    change(f);
    assert.throws(() => implementation('recovered', { sourceRoot: resolve(f.sourceRoot) }), expected);
  });
}

function responseFixture(t) {
  const f = fixture(t);
  const sourceBuild = f.evidence();
  const side = 'recovered';
  const origin = 'http://127.0.0.1:32123';
  const path = sourceBuild.loaderEntryRelative;
  const options = {
    sourceBuild, side, origin, url: `${origin}/packages/${side}/${path}`,
    status: 200, resourceType: 'script', bytes: fs.readFileSync(join(f.buildRoot, path)),
  };
  return { ...f, sourceBuild, options };
}

test('actual browser response bytes are hashed and the complete executable graph is mandatory', t => {
  const f = responseFixture(t);
  const resources = f.sourceBuild.resourceManifests.recovered.requiredResources.map(path =>
    runtimeModelResourceResponse({
      ...f.options, url: `${f.options.origin}/packages/recovered/${path}`,
      bytes: fs.readFileSync(join(f.buildRoot, path)),
    }));
  assert.equal(verifyRuntimeModelLoadedResources(f.sourceBuild, 'recovered', resources), true);
  assert.equal(resources.find(item => item.path === 'loader/index.js').sha256, f.sourceBuild.loaderIndexSha256);
  assert.ok(resources.every(item => item.bytes > 0 && item.status === 200 && item.resourceType === 'script'));
  for (const path of f.sourceBuild.resourceManifests.recovered.requiredResources) {
    assert.throws(() => verifyRuntimeModelLoadedResources(f.sourceBuild, 'recovered',
      resources.filter(item => item.path !== path)), /Browser did not load the verified loader module/);
  }
  assert.throws(() => verifyRuntimeModelLoadedResources(f.sourceBuild, 'recovered',
    resources.map(item => ({ ...item, resourceType: 'fetch' }))),
  /Browser did not load the verified loader module/);
});

for (const [name, change, expected] of [
  ['empty response body', options => { options.bytes = Buffer.alloc(0); }, /Browser resource size drift/],
  ['same-size substituted bytes', options => {
    options.bytes = Buffer.from(options.bytes);
    options.bytes[0] ^= 1;
  }, /Browser resource hash drift/],
  ['failed HTTP response', options => { options.status = 404; }, /Loader resource HTTP failure/],
  ['foreign origin', options => { options.url = options.url.replace('127.0.0.1', 'localhost'); },
    /foreign origin/],
  ['wrong side', options => { options.url = options.url.replace('/recovered/', '/original/'); },
    /another package/],
  ['unlisted module', options => { options.url = `${options.origin}/packages/recovered/injected.js`; },
    /absent from verified inventory/],
]) {
  test(`actual browser resource validation rejects ${name}`, t => {
    const f = responseFixture(t);
    change(f.options);
    assert.throws(() => runtimeModelResourceResponse(f.options), expected);
  });
}

test('nonempty dist loader hash is not confused with its public entry or an empty file', t => {
  const f = fixture(t);
  const path = loaderRelativePath(f.buildRoot);
  const bytes = fs.readFileSync(join(f.buildRoot, path));
  assert.ok(bytes.length > 0);
  assert.notEqual(sha256(bytes), sha256(Buffer.alloc(0)));
  assert.equal(sha256(bytes), f.evidence().loaderSha256);
});
