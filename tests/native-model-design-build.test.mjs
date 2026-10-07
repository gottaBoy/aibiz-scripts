import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  CANDIDATE_MODEL_DESIGN, compareModelDesignRegistrations, inspectModelDesignSource,
  loadModelDesignRuntimeEvidence, main, modelDesignBuildVerdict, REQUESTED_MODEL_DESIGN,
  RUNTIME_MODEL_INVENTORY, RUNTIME_MODEL_PATH,
  runNativeModelDesignBuild, selectModelDesignThirdParty, summarizeModelDesignDiagnostics,
} from '../harness-native-model-design-build.mjs';
import { installedPackage } from '../harness-native-ai-code-source-deps.mjs';
import { MODEL_DESIGN_SOURCE } from '../prepare-native-model-design-inputs.mjs';
import { runRuntimeModelSourceBuild } from '../harness-runtime-model-source-build.mjs';
import {
  fakeBuild, fixture as runtimeFixture, hash, updateReport, write,
} from './helpers/runtime-model-source-build-fixture.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const tsPackage = installedPackage(join(workspace, 'modelingweb/app'), 'typescript');
const ts = createRequire(join(tsPackage.realpath, 'package.json'))(tsPackage.realpath);
const semverPackage = selectModelDesignThirdParty([
  join(workspace, 'modelingweb/app'), join(workspace, 'ibiz-app-hub'),
], 'semver', null, null);
assert.ok(semverPackage, 'Real installed semver parser is required');
const semver = createRequire(join(semverPackage.realpath, 'package.json'))(semverPackage.realpath);
const registrationSource = fs.readFileSync(join(workspace, MODEL_DESIGN_SOURCE, 'src/ui-action/index.ts'));
const files = [{ path: 'src/ui-action/index.ts', data: registrationSource }];
const surface = inspectModelDesignSource(ts, files);
const keyNames = [
  'DSL_EDIT', 'DSL_EXPORT', 'DSL_IMPORT', 'EXPORT_TO_MODEL_CLIPBOARD', 'IMPORT_FOR_MODEL_CLIPBOARD',
  'MODEL_CLONE', 'MODEL_COPY', 'MODEL_EDIT', 'MODEL_PASTE', 'OPEN_MODEL_CLIPBOARD', 'OPEN_MODEL_RUNTIME',
].map(name => `DEUIACTION_${name}`).sort();
const success = id => ({ id, exitCode: 0, signal: null, error: null });

function models(keys = keyNames) {
  return ['Central', 'ModelDesign'].map(app => ({
    app, path: `${app}.json`,
    model: { getAllPSAppPFPluginRefs: keys.map(key => ({
      rTObjectRepo: REQUESTED_MODEL_DESIGN, pluginType: 'DEUIACTION',
      pluginCode: key.slice('DEUIACTION_'.length), rTObjectName: key.slice('DEUIACTION_'.length),
      refMode: 'UIACTION',
    })) },
  }));
}

function verdict(options = {}) {
  return modelDesignBuildVerdict({
    commands: [success('typecheck'), success('bundle'),
      { ...success('declarations'), role: 'declared-build-second-step' }],
    mapping: { registrationNamesCovered: true },
    runtime: { sourceRecovered: false, sourceBuildInputsComplete: false },
    resourceCopies: ['dist', 'es', 'lib'].map(output => ({ output, verified: true })),
    artifacts: { runtimeLoaderDelivered: false },
    ...options,
  });
}

test('mapping preserves requested alpha.90 and actual alpha.122 identities', () => {
  assert.equal(REQUESTED_MODEL_DESIGN, '@ibiz-template-plugin/model-design@0.0.3-alpha.90');
  assert.equal(CANDIDATE_MODEL_DESIGN, '@ibiz-template-plugin/model-design@0.0.3-alpha.122');
  assert.deepEqual(surface.keys, keyNames);
  assert.deepEqual(surface.registrations.map(item => item.path),
    Array(11).fill('src/ui-action/index.ts'));
  assert.equal(RUNTIME_MODEL_INVENTORY.files, 7);
  assert.equal(RUNTIME_MODEL_INVENTORY.bytes, 278671);
  assert.equal(Object.isFrozen(RUNTIME_MODEL_INVENTORY), true);
});

test('actual UIAction install registers all 11 keys and preserves provider factories', () => {
  const registrations = new Map();
  const constructors = new Map();
  const exports = {};
  const compiled = ts.transpileModule(registrationSource.toString(), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const imports = [
    ['ModelExportProvider', './model-export-provider'], ['ModelImportProvider', './model-import-provider'],
    ['ModelEditProvider', './model-edit-provider'], ['ModelCopyProvider', './model-copy-provider'],
    ['ModelPasteProvider', './model-paste-provider'], ['ModelCloneProvider', './model-clone-provider'],
    ['OpenModelRuntimeProvider', './open-model-runtime'], ['DSLModelExportProvider', './dsl-model-export-provider'],
    ['DSLModelImportProvider', './dsl-model-import-provider'], ['DSLModelEditProvider', './dsl-model-edit-provider'],
    ['OpenModelClipboardProvider', './open-model-clipboard-provider'],
  ];
  for (const [name, path] of imports) constructors.set(path, { [name]: class Provider {} });
  vm.runInNewContext(compiled, {
    exports, require: name => {
      if (name === '@ibiz-template/runtime') return {
        registerUIActionProvider(key, factory) {
          assert.equal(registrations.has(key), false);
          registrations.set(key, factory);
        },
      };
      assert.ok(constructors.has(name), `Unexpected provider import ${name}`);
      return constructors.get(name);
    },
  }, { timeout: 1000 });
  exports.default.install();
  assert.deepEqual([...registrations.keys()].sort(), keyNames);
  for (const factory of registrations.values()) {
    assert.equal(typeof factory, 'function');
    assert.equal(factory(), factory());
  }
});

test('AST follows register import aliases, ignores unrelated calls and captures runtime loader API', () => {
  const parsed = inspectModelDesignSource(ts, [{ path: 'src/probe.ts', data: Buffer.from(`
    import { registerUIActionProvider as register } from '@ibiz-template/runtime';
    import { applyPolyfills, defineCustomElements } from '@ibiz-template-plugin/runtime-model/loader';
    register('DEUIACTION_MODEL_EDIT', () => ({}));
    notRegister('DEUIACTION_FAKE', () => ({}));
    ibiz.overlay.createDrawer({});
    service.exec('ImportModelV2', {}, {});
    service.exec(action, {}, {});
    service.exec();
  `) }]);
  assert.deepEqual(parsed.keys, ['DEUIACTION_MODEL_EDIT']);
  assert.deepEqual(parsed.ibizGlobals, ['overlay']);
  assert.deepEqual(parsed.imports[1].names.map(name => name.exported),
    ['applyPolyfills', 'defineCustomElements']);
  assert.deepEqual(parsed.serviceCalls.map(call => call.firstArgumentLiteral), [true, false, false]);
  assert.deepEqual(parsed.serviceCalls.map(call => call.action), ['ImportModelV2', null, null]);
});

test('AST rejects dynamic and duplicate registrations rather than manufacture coverage', () => {
  const parse = code => inspectModelDesignSource(ts, [{
    path: 'src/probe.ts', data: Buffer.from(
      `import { registerUIActionProvider } from '@ibiz-template/runtime';\n${code}`),
  }]);
  assert.throws(() => parse('registerUIActionProvider(variable, () => ({}));'), /Nonliteral/);
  assert.throws(() => parse(`
    registerUIActionProvider('DEUIACTION_MODEL_EDIT', () => ({}));
    registerUIActionProvider('DEUIACTION_MODEL_EDIT', () => ({}));
  `), /Duplicate/);
});

test('registration coverage cannot upgrade to strict compatibility or exact reproduction', () => {
  const mapping = compareModelDesignRegistrations(models(), surface.keys);
  assert.equal(mapping.registrationNamesCovered, true);
  assert.equal(mapping.strictCompatibilityVerified, false);
  assert.equal(mapping.exactVersionReproductionVerified, false);
  assert.equal(mapping.compatibility, 'registration-names-only-not-accepted');
  assert.equal(mapping.apps.length, 2);
  assert.deepEqual(mapping.extra, []);
  assert.equal(mapping.apps.every(app => app.references.length === 11), true);
});

test('missing registration remains a failed gate with the precise key and app', () => {
  const mapping = compareModelDesignRegistrations(models(), keyNames.filter(key => key !== 'DEUIACTION_MODEL_EDIT'));
  assert.equal(mapping.registrationNamesCovered, false);
  assert.deepEqual(mapping.apps.map(app => app.missing), [
    ['DEUIACTION_MODEL_EDIT'], ['DEUIACTION_MODEL_EDIT'],
  ]);
});

test('registration contract rejects absent alpha.90 refs and mismatched runtime names', () => {
  assert.throws(() => compareModelDesignRegistrations(models([]), keyNames), /No alpha.90/);
  const changed = models();
  changed[0].model.getAllPSAppPFPluginRefs[0].rTObjectName = 'OTHER';
  assert.throws(() => compareModelDesignRegistrations(changed, keyNames), /Unexpected alpha.90/);
});

test('successful commands do not recover runtime-model source or accept the candidate', () => {
  const report = verdict();
  assert.equal(report.fullDeclaredBuildSucceeded, true);
  assert.equal(report.typecheckSucceeded, true);
  for (const key of ['runtimeModelSourceRecovered', 'strictCompatibilityVerified',
    'exactVersionReproductionVerified', 'nativeAccepted', 'acceptedForProduction', 'fullLocalization']) {
    assert.equal(report[key], false, key);
  }
  assert.equal(report.exitCode, 2);
  assert.ok(report.blockers.includes('runtime-model-0.2.2-authentic-source-inputs-missing'));
  assert.ok(report.blockers.includes('runtime-model-loader-not-delivered'));
});

test('controlled reconstructed runtime receipt clears the build blocker, never native acceptance', t => {
  const f = runtimeFixture(t);
  const calls = fakeBuild(t);
  const result = runRuntimeModelSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(calls.length, 4, 'Only controlled build commands were invoked');
  const runtime = loadModelDesignRuntimeEvidence({
    workspace: f.workspace, sourceReport: result.reportPath,
  });
  assert.equal(runtime.sourceKind, 'reconstructed');
  assert.equal(runtime.requested, '@ibiz-template-plugin/runtime-model@0.2.2');
  assert.equal(runtime.candidate, '@ibiz-template-plugin/runtime-model@0.2.2-local.1');
  assert.equal(runtime.sourceRecovered, false);
  assert.equal(runtime.manifestRecovered, false);
  assert.equal(runtime.packageLicenseAuthenticated, false);
  assert.equal(runtime.sourceBuildInputsComplete, true);
  assert.equal(runtime.sourceBuildExecuted, true);
  assert.equal(runtime.sourceBuildVerified, true);
  assert.equal(runtime.reproducibleBuildVerified, true);
  assert.equal(runtime.nativeAccepted, false);
  assert.equal(runtime.acceptedForProduction, false);
  assert.deepEqual(runtime.missingInputs, []);
  assert.equal(runtime.sourceBuildEvidence.reportPath, result.reportPath);
  assert.equal(runtime.sourceBuildEvidence.reportSha256,
    hash(fs.readFileSync(result.reportPath)));
  assert.equal(runtime.sourceBuildEvidence.sourceFingerprint,
    result.report.inputs.files.fingerprint);
  assert.equal(runtime.sourceBuildEvidence.outputFingerprint,
    result.report.outputs.fingerprint);
  const report = verdict({ runtime });
  assert.equal(report.typecheckSucceeded, true);
  assert.equal(report.fullDeclaredBuildSucceeded, true);
  assert.equal(report.runtimeModelSourceRecovered, false);
  assert.equal(report.nativeAccepted, false);
  assert.equal(report.strictCompatibilityVerified, false);
  assert.equal(report.exitCode, 2);
  assert.ok(!report.blockers.includes('runtime-model-0.2.2-authentic-source-inputs-missing'));
  assert.ok(!report.blockers.includes('runtime-model-reconstructed-source-build-unverified'));
  assert.ok(report.blockers.includes('runtime-model-loader-not-delivered'));
  assert.ok(report.blockers.includes('browser-editor-save-reload-not-verified'));
});

test('incomplete reconstructed runtime claims retain the source-build blocker', () => {
  for (const runtime of [
    { sourceKind: 'reconstructed', sourceBuildInputsComplete: true, sourceBuildVerified: false },
    { sourceKind: 'reconstructed', sourceBuildInputsComplete: true, sourceBuildVerified: true,
      reproducibleBuildVerified: false },
  ]) {
    const report = verdict({ runtime });
    assert.ok(report.blockers.includes('runtime-model-reconstructed-source-build-unverified'));
    assert.equal(report.nativeAccepted, false);
  }
});

test('runtime input rejects failed or stale receipts and direct compiled observations', t => {
  const f = runtimeFixture(t);
  fakeBuild(t);
  const result = runRuntimeModelSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  updateReport(result, report => { report.status = 'failed'; });
  assert.throws(() => loadModelDesignRuntimeEvidence({
    workspace: f.workspace, sourceReport: result.reportPath,
  }), /source-build-complete-not-accepted/);
  updateReport(result, report => { report.status = 'source-build-complete-not-accepted'; });
  write(join(f.packageRoot, 'src/index.ts'), 'export {};\n');
  assert.throws(() => loadModelDesignRuntimeEvidence({
    workspace: f.workspace, sourceReport: result.reportPath,
  }), /Source input or dependency drift detected/);
  assert.throws(() => loadModelDesignRuntimeEvidence({
    workspace, sourceReport: `${RUNTIME_MODEL_PATH}/loader/index.mjs`,
  }), /Expected a runtime source-build report.json/);
  assert.throws(() => loadModelDesignRuntimeEvidence({
    workspace, sourceReport: '../outside/report.json',
  }), /child of the workspace/);
});

test('runtime input rejects symlinked report files and ancestors before source-build verification', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'model-design-runtime-symlink-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = join(root, 'runtime');
  fs.mkdirSync(run);
  const target = join(root, 'target-report.json');
  fs.writeFileSync(target, '{}\n');
  fs.symlinkSync(target, join(run, 'report.json'));
  assert.throws(() => loadModelDesignRuntimeEvidence({
    workspace: root, sourceReport: 'runtime/report.json',
  }), /Symlink resource rejected/);
  fs.symlinkSync(run, join(root, 'linked'), 'dir');
  assert.throws(() => loadModelDesignRuntimeEvidence({
    workspace: root, sourceReport: 'linked/report.json',
  }), /Symlink directory rejected/);
  assert.deepEqual(fs.readdirSync(root).sort(), ['linked', 'runtime', 'target-report.json']);
});

for (const [name, failed] of [
  ['nonzero exit', { exitCode: 2, signal: null, error: null }],
  ['timeout', { exitCode: null, signal: 'SIGTERM', error: 'timeout' }],
  ['tool error', { exitCode: 0, signal: null, error: 'spawn failed' }],
]) {
  test(`full build preserves ${name} even when artifacts exist`, () => {
    const report = verdict({ commands: [success('typecheck'), { id: 'bundle', ...failed },
      { ...success('declarations'), role: 'diagnostic-only-after-failed-first-step' }] });
    assert.equal(report.fullDeclaredBuildSucceeded, false);
    assert.ok(report.blockers.includes('full-declared-build-failed'));
  });
}

test('diagnostic declarations cannot stand in for the declared build second step', () => {
  const report = verdict({ commands: [success('typecheck'), success('bundle'),
    { ...success('declarations'), role: 'diagnostic-only-after-failed-first-step' }] });
  assert.equal(report.fullDeclaredBuildSucceeded, false);
});

test('missing steps, registration failures and incomplete resources retain independent blockers', () => {
  const report = verdict({ commands: [], mapping: { registrationNamesCovered: false },
    resourceCopies: [{ verified: false }] });
  for (const blocker of ['plugin-typecheck-failed', 'full-declared-build-failed',
    'alpha90-registration-coverage-failed', 'built-resource-copy-incomplete']) {
    assert.ok(report.blockers.includes(blocker), blocker);
  }
});

test('all three unique output roots are required before resource copy verification can pass', () => {
  for (const resourceCopies of [
    [],
    [{ output: 'dist', verified: true }],
    ['dist', 'es', 'es'].map(output => ({ output, verified: true })),
    ['dist', 'es', 'unknown'].map(output => ({ output, verified: true })),
    ['dist', 'es', 'lib', 'extra'].map(output => ({ output, verified: true })),
  ]) {
    const report = verdict({ resourceCopies });
    assert.ok(report.blockers.includes('built-resource-copy-incomplete'), JSON.stringify(resourceCopies));
    assert.equal(report.nativeAccepted, false);
  }
  const complete = verdict({
    resourceCopies: ['lib', 'dist', 'es'].map(output => ({ output, verified: true })),
  });
  assert.equal(complete.blockers.includes('built-resource-copy-incomplete'), false);
  assert.equal(complete.nativeAccepted, false);
});

test('out-of-scope output and input paths fail before any build', () => {
  assert.throws(() => runNativeModelDesignBuild({
    workspace, output: 'scripts',
  }), /direct child/);
  assert.throws(() => runNativeModelDesignBuild({
    workspace, output: '.artifacts/native-model-design-build/../outside',
  }), /direct child/);
  assert.throws(() => runNativeModelDesignBuild({
    workspace, output: '.artifacts/native-model-design-build/..',
  }), /direct child/);
  assert.throws(() => runNativeModelDesignBuild({
    workspace, output: '.artifacts/native-model-design-build/build-..',
    inputReceipt: '../outside/receipt.json',
  }), /direct child/);
});

test('existing destination is preserved before receipts or build tools are read', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'model-design-existing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = '.artifacts/native-model-design-build/existing';
  const destination = join(root, output);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(join(destination, 'sentinel'), 'retain this candidate\n');
  assert.throws(() => runNativeModelDesignBuild({
    workspace: root, output,
  }), /Existing destination must not be overwritten/);
  assert.equal(fs.readFileSync(join(destination, 'sentinel'), 'utf8'), 'retain this candidate\n');
  assert.deepEqual(fs.readdirSync(destination), ['sentinel']);
});

test('third-party lookup uses authentic manifests and rejects incompatible direct versions', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'model-design-lookup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function fixture(owner, relativePath, version) {
    const path = join(owner, relativePath, 'sortablejs');
    fs.mkdirSync(path, { recursive: true });
    fs.writeFileSync(join(path, 'package.json'), JSON.stringify({
      name: 'sortablejs', version,
    }));
    return path;
  }
  const first = join(root, 'first');
  const second = join(root, 'second');
  fixture(first, 'node_modules', '1.14.0');
  const hoisted = fixture(first, 'node_modules/.pnpm/node_modules', '1.15.6');
  fixture(second, 'node_modules', '1.15.8');
  const pkg = selectModelDesignThirdParty([first, second], 'sortablejs', '^1.15.1', semver);
  assert.equal(pkg.version, '1.15.6');
  assert.equal(pkg.realpath, hoisted);
  assert.equal(selectModelDesignThirdParty([first, second], 'sortablejs', '^2.0.0', semver), null);
  assert.equal(selectModelDesignThirdParty([first], 'sortablejs', null, null).version, '1.14.0');
});

test('diagnostic summary retains real error locations and does not report warnings as PASS', () => {
  const parsed = summarizeModelDesignDiagnostics([
    "src/index.ts(6,8): error TS2307: Cannot find module 'runtime-model'.",
    'src/tree.tsx(150,9): error TS7053: Invalid indexed access.',
    '  No index signature was found.',
    'src/other.ts(10,2): error TS7053: Another indexed access.',
    'Rollup warning: external dependency.',
  ].join('\n'));
  assert.equal(parsed.count, 3);
  assert.deepEqual(parsed.codes, { TS2307: 1, TS7053: 2 });
  assert.deepEqual(parsed.errors[0], {
    path: 'src/index.ts', line: 6, column: 8, code: 'TS2307',
    message: "Cannot find module 'runtime-model'.",
  });
  assert.deepEqual(summarizeModelDesignDiagnostics(''), { errors: [], count: 0, codes: {} });
});

test('read-only consumer rejects build options before reading or changing an artifact', () => {
  assert.throws(() => main(['--verify-report', 'missing/report.json', '--output', 'scripts']),
    /cannot be combined/);
  assert.throws(() => main([
    '--verify-report', 'missing/report.json', '--runtime-source-report', 'missing/runtime/report.json',
  ]), /cannot be combined/);
});

test('CLI help documents retained failed candidates and never runs a build', () => {
  const original = console.log;
  const lines = [];
  console.log = line => lines.push(line);
  try { assert.equal(main(['--help']), 0); }
  finally { console.log = original; }
  assert.match(lines.join('\n'), /no installs.*deployment/);
  assert.match(lines.join('\n'), /Exit 2.*not build PASS/);
  assert.match(lines.join('\n'), /--runtime-source-report PATH/);
  assert.match(lines.join('\n'), /verified reconstructed source-built.*never recovered originals/);
});
