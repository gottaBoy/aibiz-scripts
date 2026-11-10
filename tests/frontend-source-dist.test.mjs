import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import {
  frontendDistPaths, selectFrontendSourceDist, verifyFrontendSourceCandidateSync,
} from '../../modelingweb/app/scripts/frontend-source-dist.mjs';
import { verifyFrontendSourceCandidate } from '../../modelingweb/app/scripts/verify-frontend-source-candidate.mjs';
import {
  candidateHostFiles, relativeAsset, verifyCandidateImportMap,
} from '../../modelingweb/app/scripts/assemble-source-candidate.mjs';
import { sourceCompilerOptions, sourcePackages } from '../../modelingweb/app/scripts/build-source-runtime.mjs';
import { fingerprint, treeFingerprint } from '../localization-baseline.mjs';
import { isolatedLaunchInput } from '../native-model-design-isolated-launch.mjs';

const workspaceRoot = new URL('../../', import.meta.url).pathname;
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const moduleCode = 'System.register([],function(){return{setters:[],execute(){}}});\n';

function write(path, value) {
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value), { mode: 0o600 });
}

async function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'frontend-source-binding-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const local = path => relative(workspace, path);
  const file = async path => ({ path: local(path), ...(await fingerprint(path)) });
  const tree = async path => ({ path: local(path), ...(await treeFingerprint(path, { exclude: new Set() })) });
  const candidate = join(workspace, '.artifacts/frontend-candidates/unit');
  const dist = join(candidate, 'dist');
  const frameworkRoot = join(workspace, '.artifacts/frontend-source/unit');
  const typePath = join(workspace, '.artifacts/frontend-source-types/unit/report.json');
  const baseline = join(workspace, '.artifacts/localization-baseline/unit');
  const baselineDist = join(baseline, 'modelingweb-dist');
  const template = '<!doctype html><base href="/modeldesign/" /><div id="app"></div>\n';
  for (const [path, data] of [
    ['modelingweb/app/src/main.ts', 'export const controlledFixture = true;\n'],
    ['modelingweb/environment.config', 'requireOrganizationContext:REQUIRE_ORGANIZATION_CONTEXT\n'],
    ['modelingweb/app/source-candidate.html', template],
    ['modelingweb/app/source-candidate.css', '#app { display: block; }\n'],
    ['modelingweb/app/scripts/assemble-source-candidate.mjs',
      fs.readFileSync(join(workspaceRoot, 'modelingweb/app/scripts/assemble-source-candidate.mjs'))],
  ]) write(join(workspace, path), data);
  write(join(baselineDist, 'extras/json/system-import.json'), { imports: {}, styles: {} });
  const captured = await treeFingerprint(baselineDist, { exclude: new Set() });
  const capturePath = join(baseline, 'capture-verification.json');
  write(capturePath, { copies: [{ path: 'modelingweb-dist', sha256: captured.sha256 }] });
  const map = { imports: {}, styles: {} };
  const framework = { packages: [] };
  const frameworkRows = [];
  for (const name of sourcePackages) {
    const output = join(frameworkRoot, 'packages', name);
    write(join(output, 'index.system.js'), moduleCode);
    const target = join(dist, 'source-runtime', name);
    fs.cpSync(output, target, { recursive: true });
    const inventory = await tree(output);
    framework.packages.push({ name: `@ibiz-template/${name}`, sourceVersion: 'fixture-only', output: inventory });
    frameworkRows.push({ name: `@ibiz-template/${name}`, version: 'fixture-only',
      output: local(target), sourceArtifactHash: inventory.sha256 });
    map.imports[`@ibiz-template/${name}`] = relativeAsset(dist, join(target, 'index.system.js'));
  }
  const frameworkPath = join(frameworkRoot, 'report.json');
  write(frameworkPath, framework);
  write(typePath, { selectedPackages: sourcePackages, sourceTypeCheckPassed: true,
    dependencyProfile: 'candidate', diagnostics: [], inputChanges: [] });
  const types = { ...(await file(typePath)), dependencyProfile: 'candidate' };
  const dependencies = [];
  for (const [name, version] of Object.entries({
    'ai-chat': '0.0.94', gantt: '0.1.8-alpha.468', 'data-view': '0.0.8', 'bi-report': '0.0.32',
  })) {
    const fullName = `@ibiz-template-plugin/${name}`;
    const root = join(workspace, 'modelingweb/packages-latest', fullName);
    write(join(root, 'package.json'), { name: fullName, version, system: 'dist/index.system.js' });
    write(join(root, 'dist/index.system.js'), moduleCode);
    write(join(root, 'dist/style.css'), '.fixture {}\n');
    const target = join(dist, 'source-plugins', fullName, version);
    fs.cpSync(root, target, { recursive: true });
    dependencies.push({ name: fullName, version, kind: 'existing-plugin-distribution-not-original-source',
      input: await tree(root), output: await tree(target) });
    map.imports[fullName] = relativeAsset(dist, join(target, 'dist/index.system.js'));
    map.styles[fullName] = relativeAsset(dist, join(target, 'dist/style.css'));
  }
  const repacks = [
    ['interactjs', '1.10.26', 'modelingweb/source-build-deps/node_modules/interactjs', 'dist/interact.min.js'],
    ['axios', '1.13.2', 'modelingweb/app/node_modules/axios', 'index.js'],
    ['cherry-markdown', '0.8.58', 'ibiz-app-hub/node_modules/.pnpm/cherry-markdown@0.8.58/node_modules/cherry-markdown',
      'dist/cherry-markdown.esm.js'],
    ['echarts', '5.4.3', 'modelingweb/app/node_modules/echarts', 'index.js'],
    ...['minMax', 'isSameOrBefore', 'quarterOfYear', 'weekOfYear', 'isoWeek', 'customParseFormat']
      .map(name => [`dayjs/plugin/${name}`, '1.11.10', 'modelingweb/app/node_modules/dayjs', `plugin/${name}.js`]),
    ['mqtt/dist/mqtt.min', '2.18.9', 'modelingweb/app/node_modules/mqtt', 'dist/mqtt.min.js'],
  ];
  for (const [name, version, source, entry] of repacks) {
    const packageName = name.startsWith('dayjs/') ? 'dayjs' : name.startsWith('mqtt/') ? 'mqtt' : name;
    const root = join(workspace, source);
    write(join(root, 'package.json'), { name: packageName, version });
    write(join(root, entry), 'export const fixture = true;\n');
    const target = join(dist, 'source-externals', name);
    write(join(target, 'index.system.js'), moduleCode);
    if (name === 'cherry-markdown') {
      write(join(root, 'dist/cherry-markdown.min.css'), '.fixture {}\n');
      fs.cpSync(join(root, 'dist'), join(target, 'original-dist'), { recursive: true });
      map.styles[name] = relativeAsset(dist, join(target, 'original-dist/cherry-markdown.min.css'));
    }
    dependencies.push({ name, version, kind: 'repackaged-third-party-distribution-not-framework-source',
      manifest: await file(join(root, 'package.json')), input: await file(join(root, entry)), output: await tree(target) });
    map.imports[name] = relativeAsset(dist, join(target, 'index.system.js'));
  }
  write(join(dist, 'extras/json/system-import.json'), map);
  const host = candidateHostFiles(template, { nativeModeling: true });
  write(join(dist, 'index.html'), host.html);
  write(join(dist, 'source-app/environment.js'), host.environment);
  const hostTree = await treeFingerprint(join(workspace, 'modelingweb/app/src'));
  const report = {
    schemaVersion: 1, contract: 'isolated-frontend-source-candidate-v1',
    profile: 'native-modeling', status: 'assembled-not-deployed',
    productionModified: false, deployable: false, browserVerified: false,
    nativeAccepted: false, acceptedForProduction: false,
    assembler: await file(join(workspace, 'modelingweb/app/scripts/assemble-source-candidate.mjs')),
    compilerOptions: sourceCompilerOptions,
    node: { executable: process.execPath, version: process.version, ...(await fingerprint(process.execPath)) },
    toolchain: [], frameworkBuild: local(frameworkRoot), frameworkReceipt: await file(frameworkPath),
    types, framework: frameworkRows, dependencies,
    hostSource: { path: 'modelingweb/app/src', before: hostTree, after: hostTree },
    captureReceipt: await file(capturePath),
    baseline: { path: local(baselineDist), sha256: captured.sha256 },
    inputs: await Promise.all(['modelingweb/app/src/main.ts', 'modelingweb/environment.config',
      'modelingweb/app/source-candidate.html', 'modelingweb/app/source-candidate.css']
      .map(path => file(join(workspace, path)))),
    importMapAssets: await verifyCandidateImportMap(dist), output: await tree(dist),
  };
  const receipt = join(candidate, 'report.json');
  const options = { workspace, dist, receipt };
  const save = () => {
    write(receipt, report);
    options.receiptSha256 = hash(fs.readFileSync(receipt));
  };
  save();
  const calls = { framework: 0, types: 0 };
  const adapters = {
    verifyFramework: async path => {
      assert.equal(path, frameworkRoot); calls.framework++;
      return { sourceArtifactsVerified: true, failures: [] };
    },
    verifyTypes: async path => { assert.equal(path, typePath); calls.types++; return types; },
    toolchain: async () => [],
  };
  return { workspace, dist, receipt, report, options, adapters, calls, save, frameworkRoot, typePath };
}

test('controlled source recipe validates every current receipt/source/output while acceptance stays unclaimed', async t => {
  const s = await fixture(t);
  const binding = await verifyFrontendSourceCandidate(s.options, s.adapters);
  assert.equal(binding.contract, 'native-frontend-source-dist-binding-v1');
  assert.equal(binding.dist, s.dist);
  assert.equal(binding.receipt.sha256, s.options.receiptSha256);
  assert.ok(binding.output.files > 20);
  assert.deepEqual(s.calls, { framework: 1, types: 1 });
  assert.equal(Object.hasOwn(binding, 'nativeAccepted'), false);
});

for (const [name, mutate] of [
  ['failed assembler', s => { s.report.status = 'failed'; }],
  ['preview-only profile', s => { s.report.profile = 'candidate-preview'; }],
  ['production promotion', s => { s.report.acceptedForProduction = true; }],
  ['native promotion', s => { s.report.nativeAccepted = true; }],
  ['invented toolchain', s => { s.report.toolchain = [{ name: 'fake' }]; }],
  ['changed compiler settings', s => { s.report.compilerOptions = {}; }],
  ['missing host-source inventory', s => { delete s.report.hostSource; }],
  ['omitted environment mapping', s => { s.report.inputs = s.report.inputs.filter(row => !row.path.endsWith('environment.config')); }],
  ['omitted dependency', s => { s.report.dependencies.pop(); }],
  ['changed original host input', s => { write(join(s.workspace, 'modelingweb/app/src/main.ts'), 'changed'); }],
  ['changed artifact bytes', s => { write(join(s.dist, 'source-runtime/core/index.system.js'), 'changed'); }],
  ['changed generator', s => { write(join(s.workspace, 'modelingweb/app/scripts/assemble-source-candidate.mjs'), 'changed'); }],
  ['changed capture receipt', s => { write(join(s.workspace, s.report.captureReceipt.path), '{}'); }],
  ['rewritten runtime plugin URL', s => { write(join(s.dist, 'source-app/environment.js'), 'window.Environment.pluginBaseUrl="/shared";'); }],
]) {
  test(`source verification rejects rehashed ${name}`, async t => {
    const s = await fixture(t);
    mutate(s);
    s.save();
    await assert.rejects(() => verifyFrontendSourceCandidate(s.options, s.adapters));
  });
}

for (const [name, mutate] of [
  ['redirected framework import', map => {
    map.imports['@ibiz-template/core'] = map.imports['@ibiz-template/runtime'];
  }],
  ['unreviewed extra import', map => {
    map.imports['unreviewed-package'] = map.imports['@ibiz-template/core'];
  }],
  ['redirected plugin style', map => {
    map.styles['@ibiz-template-plugin/ai-chat'] = map.styles['@ibiz-template-plugin/gantt'];
  }],
]) {
  test(`complete assembly recipe rejects ${name} even after output and receipt hashes are refreshed`, async t => {
    const s = await fixture(t);
    const mapPath = join(s.dist, 'extras/json/system-import.json');
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    mutate(map);
    write(mapPath, map);
    s.report.importMapAssets = await verifyCandidateImportMap(s.dist);
    s.report.output = {
      path: relative(s.workspace, s.dist),
      ...(await treeFingerprint(s.dist, { exclude: new Set() })),
    };
    s.save();
    await assert.rejects(() => verifyFrontendSourceCandidate(s.options, s.adapters),
      /Frontend import map differs from the complete reviewed assembly recipe/);
  });
}

test('framework/type failures cannot pass through receipt flags', async t => {
  const s = await fixture(t);
  await assert.rejects(() => verifyFrontendSourceCandidate(s.options, {
    ...s.adapters, verifyFramework: async () => ({ sourceArtifactsVerified: false, failures: ['real failure'] }),
  }));
  await assert.rejects(() => verifyFrontendSourceCandidate(s.options, {
    ...s.adapters, verifyTypes: async () => { throw new Error('current type input changed'); },
  }));
});

test('explicit selector is default-compatible but refuses partial options, arbitrary paths and receipt replay', async t => {
  const s = await fixture(t);
  assert.equal(selectFrontendSourceDist({ workspace: s.workspace }), undefined);
  for (const partial of [
    { frontendDist: s.dist }, { frontendReceipt: s.receipt },
    { frontendReceiptSha256: s.options.receiptSha256 },
    { frontendDist: s.dist, frontendReceipt: s.receipt },
  ]) assert.throws(() => selectFrontendSourceDist({ workspace: s.workspace, ...partial }));
  assert.throws(() => frontendDistPaths({ ...s.options, dist: join(s.workspace, 'arbitrary/dist') }));
  assert.throws(() => frontendDistPaths({ ...s.options, receipt: join(s.workspace, 'other/report.json') }));
  await assert.rejects(() => verifyFrontendSourceCandidate({ ...s.options, receiptSha256: '0'.repeat(64) }, s.adapters));
});

test('sync verifier uses one fixed read-only Node entrypoint and cannot accept another returned binding', async t => {
  const s = await fixture(t);
  const binding = await verifyFrontendSourceCandidate(s.options, s.adapters);
  let executions = 0;
  const execute = (command, args, options) => {
    executions++;
    assert.equal(command, process.execPath);
    assert.equal(args[1], '--dist');
    assert.equal(args[2], s.dist);
    assert.equal(args[3], '--receipt');
    assert.equal(args[4], s.receipt);
    assert.ok(args[0].endsWith('/verify-frontend-source-candidate.mjs'));
    assert.equal(options.env.NODE_OPTIONS, undefined);
    assert.equal(options.env.NODE_PATH, undefined);
    return json(binding);
  };
  assert.deepEqual(verifyFrontendSourceCandidateSync(s.options, { execute }), binding);
  assert.equal(executions, 1);
  assert.throws(() => verifyFrontendSourceCandidateSync(s.options, {
    execute: () => json({ ...binding, dist: '/foreign/dist' }),
  }));
});

test('isolated launch plans mount the bound independent distribution and keep the legacy default unchanged', async t => {
  const s = await fixture(t);
  const binding = await verifyFrontendSourceCandidate(s.options, s.adapters);
  const options = { workspace: s.workspace, candidate: join(s.workspace, '.artifacts/model-candidate'),
    assets: join(s.workspace, '.artifacts/runtime-assets'), name: 'frontend-binding-unit' };
  const ordinary = isolatedLaunchInput(options);
  assert.equal(Object.hasOwn(ordinary, 'frontend'), false);
  assert.equal(ordinary.mounts.find(row => row.target === '/opt/aibiz/local-dist').source,
    join(s.workspace, 'modelingweb/app/dist'));
  const selected = isolatedLaunchInput({ ...options, frontend: binding });
  assert.deepEqual(selected.frontend, binding);
  assert.equal(selected.mounts.find(row => row.target === '/opt/aibiz/local-dist').source, s.dist);
  assert.ok(selected.applications.every(row => row.args.includes(
    `type=bind,src=${s.dist},dst=/opt/aibiz/local-dist,readonly`)));
});

test('native host generation preserves explicit deployment plugin URLs and supports both application bases', () => {
  const template = '<html><base href="/modeldesign/" /></html>';
  const preview = candidateHostFiles(template);
  assert.equal(preview.html, template);
  assert.match(preview.environment, /pluginBaseUrl: '\/modeldesign\/plugins'/);
  const native = candidateHostFiles(template, { nativeModeling: true });
  assert.match(native.html, /base href="\.\/"/);
  assert.ok(!native.environment.includes('Object.assign'));
  assert.throws(() => candidateHostFiles('<html></html>', { nativeModeling: true }));
  assert.throws(() => candidateHostFiles(template + template, { nativeModeling: true }));
  assert.throws(() => candidateHostFiles(template, { nativeModeling: 'true' }));
});
