import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { loadMigrationContract, WORKSPACE } from '../harness-modeling-core-audit.mjs';
import { runAiCodeSourceDepsHarness } from '../harness-native-ai-code-source-deps.mjs';
import { fingerprint, readTree } from '../native-candidate-files.mjs';
import { prepareNativeAiCodeDeployment } from '../prepare-native-ai-code-deployment.mjs';
import { readFileBase64Replacement } from '../prepare-native-file-base64-replacement.mjs';
import { readGlobalUtilReplacement } from '../prepare-native-global-util-replacement.mjs';
import { readStudioThemeReplacements } from '../prepare-native-studio-theme-replacement.mjs';
import { readDesignIndexReplacement } from '../prepare-native-design-index-replacement.mjs';
import { readConsoleLayoutReplacements } from '../prepare-native-console-layout-replacements.mjs';
import { rewritePluginReferences } from '../prepare-native-model-candidate.mjs';
import {
  prepareNativeAiCodeRuntimeAssets, runtimeAssetNginx, runtimeImportMap,
  verifyNativeAiCodeRuntimeAssets,
} from '../prepare-native-ai-code-runtime-assets.mjs';
import {
  cliSourceFixture, deploymentFixture, fixtureSnapshot,
} from './helpers/native-ai-code-source-deps-fixture.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const repo = '@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
const requested = '@ibiz-template-plugin/ai-code@0.0.3-alpha.92';
const sibling = '@ibiz-template-plm/list-tree@0.0.3-alpha.225';
const globalUtilRequested = '@ibiz-template-plugin/global-util-design@0.0.3-alpha.87';
const globalUtilRepo = '@aibiz/global-util@0.1.0';
const globalUtilSource = 'modelingweb/local-plugins/global-util';
const importMapPath = 'modelingweb/app/dist/extras/json/system-import.json';
const applications = ['Central', 'ModelDesign'];
const modelFiles = ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json'];
const write = (path, bytes) => {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, bytes);
};
const json = (path, value) => write(path, `${JSON.stringify(value, null, 2)}\n`);

function fixture(t, source = deploymentFixture(t)) {
  const { workspace } = source;
  // Keep the fixture compiler/bin evidence intact while exposing the real bundler API.
  const rollup = source.toolDirs.rollup;
  const rollupManifest = JSON.parse(fs.readFileSync(join(rollup, 'package.json')));
  json(join(rollup, 'package.json'), { ...rollupManifest, main: 'runtime-api.cjs' });
  write(join(rollup, 'runtime-api.cjs'),
    `module.exports = require(${JSON.stringify(join(WORKSPACE, 'ibiz-app-hub/node_modules/rollup'))});\n`);
  fs.mkdirSync(join(workspace, 'ibiz-app-hub/node_modules/@rollup'), { recursive: true });
  fs.symlinkSync(join(WORKSPACE, 'ibiz-app-hub/node_modules/@rollup/plugin-node-resolve'),
    join(workspace, 'ibiz-app-hub/node_modules/@rollup/plugin-node-resolve'), 'dir');
  const build = runAiCodeSourceDepsHarness(source);
  assert.equal(build.exitCode, 2, build.report.errors.join('\n'));
  const deploymentRoot = join(workspace, '.artifacts/native-ai-code-deployment/candidate');
  const deployment = prepareNativeAiCodeDeployment({
    workspace, output: deploymentRoot, sourceReport: build.reportPath,
    ...(source.cliSourcePins ? { cliSourcePins: source.cliSourcePins } : {}),
  });
  const deploymentReceipt = join(deploymentRoot, 'receipt.json');
  const candidate = join(workspace, '.artifacts/native-model-migration/candidate');
  const output = join(workspace, '.artifacts/native-ai-code-runtime-assets/output');
  const loaderSource = join(workspace, 'third-party/loader');
  const monacoSource = join(workspace, 'third-party/monaco');
  json(join(loaderSource, 'package.json'),
    { name: '@monaco-editor/loader', version: '1.7.0', type: 'module' });
  write(join(loaderSource, 'lib/es/index.js'),
    'export default {init() {return Promise.resolve("synthetic-monaco");}};\n');
  write(join(loaderSource, 'LICENSE'), 'Synthetic third-party fixture\n');
  json(join(monacoSource, 'package.json'), { name: 'monaco-editor', version: '0.52.2' });
  write(join(monacoSource, 'LICENSE'), 'Synthetic third-party fixture\n');
  write(join(monacoSource, 'ThirdPartyNotices.txt'), 'Synthetic notices\n');
  write(join(monacoSource, 'min/vs/editor/editor.main.js'), [
    'define("vs/editor/contrib/wordHighlighter/browser/wordHighlighter",',
    '["exports","vs/base/common/errors"], function(exports, errors) {',
    'exports.WordHighlighterContribution = class {',
    'constructor(delayer) { this.runDelayer = delayer; }',
    'cursor() { return this.runDelayer.trigger(() => 1); }',
    'focus() { return this.runDelayer.trigger(() => 2); }',
    '}; });',
  ].join('\n'));
  write(join(monacoSource, 'min/vs/loader.js'), 'synthetic monaco loader\n');
  fs.mkdirSync(join(candidate, 'plugins/@ibiz-template-plugin'), { recursive: true });
  fs.cpSync(join(workspace, deployment.deployment.path), join(candidate, 'plugins', repo),
    { recursive: true });
  json(join(candidate, 'plugins', sibling, 'package.json'),
    { name: '@ibiz-template-plm/list-tree', version: '0.0.3-alpha.225' });
  write(join(candidate, 'plugins', sibling, 'dist/index.system.min.js'), 'synthetic sibling bundle\n');
  write(join(candidate, 'plugins', sibling, 'dist/assets/style.css'), '.sibling {color: red}\n');
  const siblingFiles = readTree(join(candidate, 'plugins', sibling), { jsonOnly: false });
  const sourceModelRoot = 'original-models';
  const modelEvidence = {};
  for (const application of applications) {
    modelEvidence[application] = { files: modelFiles.map(name => {
      const path = `PSSYSAPPS/${application}/${name}`;
      const original = { application, name, rTObjectRepo: requested, note: 'Synthetic model' };
      json(join(workspace, sourceModelRoot, path), original);
      json(join(candidate, 'model', path), { ...original, rTObjectRepo: repo });
      return {
        path, inputSha256: hash(fs.readFileSync(join(workspace, sourceModelRoot, path))),
        outputSha256: hash(fs.readFileSync(join(candidate, 'model', path))),
        changes: [{ location: '/rTObjectRepo', from: requested, to: repo }], unresolved: [],
      };
    }) };
  }
  const nginxSource = 'server {\n    location /nativeappcode/ {\n    }\n}\n';
  write(join(workspace, 'modelingweb/nginx-native.conf'), nginxSource);
  const nginx = [
    'server {',
    '    location ^~ /nativeappcode/plugins/ {',
    '        alias /opt/aibiz/native-candidate-plugins/;',
    '    }',
    '}',
    '',
  ].join('\n');
  write(join(candidate, 'nginx-native.conf'), nginx);
  json(join(candidate, 'receipt.json'), {
    schemaVersion: 1,
    contract: 'native-modeling-source-backed-candidate', status: 'prepared-not-accepted',
    acceptedForProduction: false, sourceModelRoot, applications: modelEvidence,
    plugins: [
      {
        from: '@ibiz-template-plm/list-tree@0.0.2-dev.145', to: sibling,
        outputFingerprint: siblingFiles.fingerprint, compatibility: 'not-verified',
        acceptedForProduction: false,
      },
      {
        from: requested, to: repo, sourcePath: deployment.source.path,
        sourceStatus: 'published-source-with-recorded-local-fixes',
        sourceFingerprint: deployment.source.fingerprint,
        buildOutputFingerprint: deployment.build.outputFingerprint,
        outputFingerprint: deployment.deployment.fingerprint, buildCommand: deployment.build.command,
        deploymentReceipt: {
          path: relative(workspace, deploymentReceipt),
          sha256: hash(fs.readFileSync(deploymentReceipt)),
        },
        sourceDependencies: deployment.dependencies.sourceBuildEvidence,
        ibizDependencySourceBuildsVerified: true,
        toolchainSourceBuildsVerified: deployment.dependencies.toolchainSourceBuildsVerified,
        originalRepositoryAuthenticated: false, compatibility: 'not-verified',
        acceptedForProduction: false,
      },
    ],
    nginx: { inputSha256: hash(nginxSource), outputSha256: hash(nginx) },
    note: 'Synthetic fixture verified against fixture build evidence, not production acceptance',
  });
  json(join(workspace, 'modelingweb/app/public/extras/json/system-import.json'), {
    imports: { vue: '../js/vue/3.3.8/vue.js?cache=public', '@ibiz-template/runtime': '../js/public-runtime.js' },
  });
  json(join(workspace, importMapPath), {
    imports: {
      vue: '../js/vue/3.5.17/vue.js?cache=dist',
      '@ibiz-template/core': '../js/core.js?version=kept',
      '@ibiz-template/runtime': '../js/runtime.js?cache=dist',
    },
    styles: { existing: '../js/existing.css' }, scopes: { '/example': { vue: '/vue.js' } },
  });
  return {
    workspace, candidate, output, loaderSource, monacoSource, source, build,
    deployment, deploymentRoot, deploymentReceipt, reportPath: build.reportPath,
    sourceModelRoot: join(workspace, sourceModelRoot),
    ...(source.cliSourcePins ? { cliSourcePins: source.cliSourcePins } : {}),
  };
}

function changeReceipt(data, mutate) {
  const path = join(data.candidate, 'receipt.json');
  const receipt = JSON.parse(fs.readFileSync(path));
  mutate(receipt, receipt.plugins.find(plugin => plugin.to === repo));
  json(path, receipt);
}

function includeFileEditor(options) {
  const source = 'modelingweb/local-plugins/file-to-base64';
  fs.mkdirSync(join(options.workspace, source), { recursive: true });
  fs.cpSync(join(WORKSPACE, source), join(options.workspace, source), { recursive: true });
  const contract = structuredClone(loadMigrationContract());
  const requested = '@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165';
  contract.migrationMappings = contract.migrationMappings.filter(mapping => mapping.from === requested);
  contract.plugins = contract.plugins.filter(plugin => plugin.repo === requested);
  for (const application of applications) {
    contract.evidence.applications[application].references =
      contract.evidence.applications[application].references.filter(reference => reference.repo === requested);
  }
  json(join(options.workspace, 'scripts/fixtures/modeling-core-migration-contract.json'), contract);
  const verified = readFileBase64Replacement({ workspace: options.workspace, contract });
  for (const file of verified.files.contents) {
    write(join(options.candidate, 'plugins', verified.plugin.to, file.path), file.data);
  }
  changeReceipt(options, receipt => {
    receipt.plugins.push(verified.plugin);
    receipt.independentReplacementMappings = [{
      from: verified.plugin.from, to: verified.plugin.to,
      originalSourceRecovered: false, nativeCompatibilityVerified: false,
      originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
    }];
  });
  return verified;
}

function includeGlobalUtil(options, { withFileEditor = false } = {}) {
  if (withFileEditor) includeFileEditor(options);
  fs.mkdirSync(dirname(join(options.workspace, globalUtilSource)), { recursive: true });
  fs.cpSync(join(WORKSPACE, globalUtilSource), join(options.workspace, globalUtilSource),
    { recursive: true });
  const contract = structuredClone(loadMigrationContract());
  const identities = [
    globalUtilRequested,
    ...(withFileEditor ? ['@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165'] : []),
  ];
  contract.migrationMappings = contract.migrationMappings.filter(mapping => identities.includes(mapping.from));
  contract.plugins = contract.plugins.filter(plugin => identities.includes(plugin.repo));
  for (const application of applications) {
    contract.evidence.applications[application].references =
      contract.evidence.applications[application].references.filter(reference => identities.includes(reference.repo));
  }
  json(join(options.workspace, 'scripts/fixtures/modeling-core-migration-contract.json'), contract);
  const verified = readGlobalUtilReplacement({ workspace: options.workspace, contract });
  for (const file of verified.files.contents) {
    write(join(options.candidate, 'plugins', verified.plugin.to, file.path), file.data);
  }
  changeReceipt(options, receipt => {
    receipt.plugins.push(verified.plugin);
    receipt.independentReplacementMappings = [
      ...(receipt.independentReplacementMappings ?? []),
      {
        from: verified.plugin.from, to: verified.plugin.to,
        originalSourceRecovered: false, nativeCompatibilityVerified: false,
        originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
      },
    ];
  });
  return verified;
}

function includeThemes(options) {
  const path = 'modelingweb/local-plugins/studio-theme';
  fs.mkdirSync(dirname(join(options.workspace, path)), { recursive: true });
  fs.cpSync(join(WORKSPACE, path), join(options.workspace, path), { recursive: true });
  const contract = loadMigrationContract(options.workspace);
  const replacements = readStudioThemeReplacements({ workspace: options.workspace, contract });
  for (const { files, plugin } of replacements) {
    for (const file of files.contents) write(join(options.candidate, 'plugins', plugin.to, file.path), file.data);
  }
  changeReceipt(options, receipt => {
    receipt.plugins.push(...replacements.map(item => item.plugin));
    receipt.independentReplacementMappings.push(...replacements.map(({ plugin }) => ({
      from: plugin.from, to: plugin.to,
      originalSourceRecovered: false, nativeCompatibilityVerified: false,
      originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
    })));
  });
  return replacements;
}

function includeDesignIndex(options) {
  const source = 'modelingweb/local-plugins/design-index';
  fs.mkdirSync(dirname(join(options.workspace, source)), { recursive: true });
  fs.cpSync(join(WORKSPACE, source), join(options.workspace, source), { recursive: true });
  const contract = structuredClone(loadMigrationContract());
  const requested = '@ibiz-template-plugin/layout-design@0.0.3-alpha.90';
  const contractPath = join(options.workspace, 'scripts/fixtures/modeling-core-migration-contract.json');
  const identities = new Set([requested]);
  if (fs.existsSync(contractPath)) {
    const existing = JSON.parse(fs.readFileSync(contractPath));
    for (const plugin of existing.plugins) identities.add(plugin.repo);
  }
  contract.migrationMappings = contract.migrationMappings.filter(mapping => identities.has(mapping.from));
  contract.plugins = contract.plugins.filter(plugin => identities.has(plugin.repo));
  for (const application of applications) {
    contract.evidence.applications[application].references =
      contract.evidence.applications[application].references.filter(reference => identities.has(reference.repo));
  }
  json(contractPath, contract);
  const verified = readDesignIndexReplacement({ workspace: options.workspace, contract });
  for (const file of verified.files.contents) {
    write(join(options.candidate, 'plugins', verified.plugin.to, file.path), file.data);
  }
  changeReceipt(options, receipt => {
    receipt.plugins.push(verified.plugin);
    receipt.independentReplacementMappings = [
      ...(receipt.independentReplacementMappings ?? []),
      {
        from: verified.plugin.from, to: verified.plugin.to,
        originalSourceRecovered: false, nativeCompatibilityVerified: false,
        originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
      },
    ];
  });
  return verified;
}

function includeConsoleLayout(options) {
  const source = 'modelingweb/local-plugins/console-layout';
  fs.mkdirSync(dirname(join(options.workspace, source)), { recursive: true });
  fs.cpSync(join(WORKSPACE, source), join(options.workspace, source), { recursive: true });
  const appModules = join(options.workspace, 'modelingweb/app/node_modules');
  fs.mkdirSync(dirname(appModules), { recursive: true });
  fs.symlinkSync(join(WORKSPACE, 'modelingweb/app/node_modules'), appModules, 'dir');
  const contract = structuredClone(loadMigrationContract());
  const contractPath = join(options.workspace, 'scripts/fixtures/modeling-core-migration-contract.json');
  const identities = new Set([
    '@ibiz-template-plugin/console-terminal@0.0.3-alpha.87',
    '@ibiz-template-plugin/layout-design@0.0.3-alpha.90',
  ]);
  if (fs.existsSync(contractPath)) {
    for (const plugin of JSON.parse(fs.readFileSync(contractPath)).plugins) identities.add(plugin.repo);
  }
  contract.migrationMappings = contract.migrationMappings.filter(mapping => identities.has(mapping.from));
  contract.plugins = contract.plugins.filter(plugin => identities.has(plugin.repo));
  for (const application of applications) {
    contract.evidence.applications[application].references =
      contract.evidence.applications[application].references.filter(reference => identities.has(reference.repo));
  }
  json(contractPath, contract);
  const replacements = readConsoleLayoutReplacements({ workspace: options.workspace, contract });
  for (const { files, plugin } of replacements) {
    for (const file of files.contents) write(join(options.candidate, 'plugins', plugin.to, file.path), file.data);
  }
  changeReceipt(options, receipt => {
    receipt.nativeAccepted = false;
    receipt.plugins.push(...replacements.map(item => item.plugin));
    receipt.independentReplacementMappings = [
      ...(receipt.independentReplacementMappings ?? []),
      ...replacements.map(({ plugin }) => ({
        from: plugin.from, to: plugin.to, originalSourceRecovered: false, nativeCompatibilityVerified: false,
        originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
      })),
    ];
    const scoped = receipt.plugins.filter(plugin => plugin.partialReplacement);
    const full = new Map(receipt.plugins.filter(plugin => !plugin.partialReplacement)
      .map(plugin => [plugin.from, plugin.to]));
    for (const evidence of Object.values(receipt.applications)) {
      for (const file of evidence.files) {
        const originalPath = join(options.sourceModelRoot, file.path);
        const original = JSON.parse(fs.readFileSync(originalPath));
        original.providers = scoped.map(plugin => ({
          rTObjectRepo: plugin.from, pluginType: plugin.pluginType, pluginCode: plugin.pluginCode,
        }));
        json(originalPath, original);
        const rewritten = rewritePluginReferences(original, full, scoped);
        json(join(options.candidate, 'model', file.path), rewritten.model);
        file.inputSha256 = hash(fs.readFileSync(originalPath));
        file.outputSha256 = hash(fs.readFileSync(join(options.candidate, 'model', file.path)));
        file.changes = rewritten.changes;
      }
    }
  });
  return replacements;
}

test('runtime assets bind distinct same-layout selectors beside index without claiming native acceptance', async t => {
  const options = fixture(t);
  includeDesignIndex(options);
  const replacements = includeConsoleLayout(options);
  const roots = [options.candidate, join(options.workspace, 'modelingweb/local-plugins'), options.sourceModelRoot];
  const before = roots.map(fixtureSnapshot);
  const result = await prepareNativeAiCodeRuntimeAssets(options);
  assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt, result.receipt);
  assert.deepEqual(roots.map(fixtureSnapshot), before);
  for (const { plugin, files } of replacements) {
    assert.deepEqual(readTree(join(options.candidate, 'plugins', plugin.to),
      { jsonOnly: false }).entries, files.entries);
    assert.equal(plugin.partialReplacement, true);
    assert.equal(plugin.nativeCompatibilityVerified, false);
  }
  assert.equal(result.receipt.acceptedForProduction, false);
});

for (const [name, mutate, expected] of [
  ['whole-package claim', plugin => { plugin.partialReplacement = false; }, /Conflicting full\/scoped/],
  ['wrong selector', plugin => { plugin.pluginCode = 'OTHER'; }, /identity must match/],
  ['duplicate selector', plugin => { plugin.pluginCode = 'DESIGN_INDEX_VIEW'; }, /Duplicate scoped/],
  ['native claim', plugin => { plugin.nativeCompatibilityVerified = true; }, /evidence differs/],
  ['original-source claim', plugin => { plugin.originalSourceRecovered = true; }, /evidence differs/],
  ['receipt hash', plugin => { plugin.buildReceipt.sha256 = '0'.repeat(64); }, /evidence differs/],
  ['missing contract', plugin => { delete plugin.contract; }, /declarations require/],
]) {
  test(`runtime rejects console/layout ${name} before writing and during verification`, async t => {
    const options = fixture(t);
    includeDesignIndex(options);
    includeConsoleLayout(options);
    await prepareNativeAiCodeRuntimeAssets(options);
    changeReceipt(options, receipt => mutate(
      receipt.plugins.find(plugin => plugin.to === '@aibiz/swagger-preview@0.1.0')));
    const before = fixtureSnapshot(options.candidate);
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), expected);
    const rejected = join(dirname(options.output), 'rejected-console-layout');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output: rejected }), expected);
    assert.equal(fs.existsSync(rejected), false);
    assert.deepEqual(fixtureSnapshot(options.candidate), before);
  });
}

for (const path of ['src/console.ts', 'dist/console/index.system.js', 'dist/swagger/style.css']) {
  test(`runtime rejects console/layout source/build drift in ${path}`, async t => {
    const options = fixture(t);
    includeConsoleLayout(options);
    await prepareNativeAiCodeRuntimeAssets(options);
    fs.appendFileSync(join(options.workspace, 'modelingweb/local-plugins/console-layout', path), '\n');
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /hashes differ/);
    const rejected = join(dirname(options.output), 'rejected-console-layout');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output: rejected }), /hashes differ/);
    assert.equal(fs.existsSync(rejected), false);
  });
}

for (const changesOnly of [false, true]) {
  test(`runtime rejects forged scoped ${changesOnly ? 'change evidence' : 'model bytes'} even with refreshed hashes`, async t => {
    const options = fixture(t);
    includeDesignIndex(options);
    includeConsoleLayout(options);
    await prepareNativeAiCodeRuntimeAssets(options);
    changeReceipt(options, receipt => {
      const file = receipt.applications.ModelDesign.files[0];
      if (changesOnly) file.changes.pop();
      else {
        const path = join(options.candidate, 'model', file.path);
        const model = JSON.parse(fs.readFileSync(path));
        model.providers.find(plugin => plugin.pluginCode === 'DESIGN_INDEX_VIEW').rTObjectRepo =
          '@aibiz/swagger-preview@0.1.0';
        json(path, model);
        file.outputSha256 = hash(fs.readFileSync(path));
      }
    });
    const expected = changesOnly ? /transformation receipt differs/ : /verified source transformation/;
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), expected);
    const rejected = join(dirname(options.output), 'rejected-console-layout');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output: rejected }), expected);
    assert.equal(fs.existsSync(rejected), false);
  });
}

test('runtime assets bind the scoped index to its source/build beside themes, utility and file editor', async t => {
  const options = fixture(t);
  includeGlobalUtil(options, { withFileEditor: true });
  includeThemes(options);
  const verified = includeDesignIndex(options);
  const roots = [options.candidate, join(options.workspace, 'modelingweb/local-plugins')];
  const before = roots.map(fixtureSnapshot);
  const result = await prepareNativeAiCodeRuntimeAssets(options);
  assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt, result.receipt);
  assert.deepEqual(roots.map(fixtureSnapshot), before);
  assert.deepEqual(readTree(join(options.candidate, 'plugins', verified.plugin.to),
    { jsonOnly: false }).entries, verified.files.entries);
  assert.equal(verified.plugin.partialReplacement, true);
  assert.deepEqual(verified.plugin.supportedPluginCodes, ['DESIGN_INDEX_VIEW']);
  assert.equal(result.receipt.acceptedForProduction, false);
});

for (const [name, mutate, expected] of [
  ['whole-package claim', plugin => { plugin.partialReplacement = false; }, /evidence differs/],
  ['Swagger support claim', plugin => { plugin.supportedPluginCodes.push('SWAGGER_PREVIEW_VIEW'); },
    /evidence differs/],
  ['original-source claim', plugin => { plugin.originalSourceRecovered = true; }, /evidence differs/],
  ['native-compatibility claim', plugin => { plugin.nativeCompatibilityVerified = true; }, /evidence differs/],
  ['missing contract', plugin => { delete plugin.contract; }, /declarations require/],
  ['build receipt hash', plugin => { plugin.buildReceipt.sha256 = '0'.repeat(64); }, /evidence differs/],
]) {
  test(`runtime rejects design index ${name} during preparation and fresh verification`, async t => {
    const options = fixture(t);
    includeDesignIndex(options);
    await prepareNativeAiCodeRuntimeAssets(options);
    changeReceipt(options, receipt => mutate(
      receipt.plugins.find(plugin => plugin.to === '@aibiz/design-index@0.1.0')));
    const before = fixtureSnapshot(options.candidate);
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), expected);
    const rejected = join(dirname(options.output), 'rejected-design-index');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output: rejected }), expected);
    assert.equal(fs.existsSync(rejected), false);
    assert.deepEqual(fixtureSnapshot(options.candidate), before);
  });
}

for (const path of ['build.mjs', 'dist/index.mjs', 'dist/index.system.js', 'dist/style.css']) {
  test(`runtime rejects design index drift in ${path} during preparation and verification`, async t => {
    const options = fixture(t);
    includeDesignIndex(options);
    await prepareNativeAiCodeRuntimeAssets(options);
    fs.appendFileSync(join(options.workspace, 'modelingweb/local-plugins/design-index', path), '\n');
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /input hashes|output hashes/);
    const rejected = join(dirname(options.output), 'rejected-design-index');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output: rejected }),
      /input hashes|output hashes/);
    assert.equal(fs.existsSync(rejected), false);
  });
}

const verification = options => ({
  workspace: options.workspace, assets: options.output,
  ...(options.cliSourcePins ? { cliSourcePins: options.cliSourcePins } : {}),
});

function includeLoaderDependency(options) {
  const manifestPath = join(options.loaderSource, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  json(manifestPath, { ...manifest, dependencies: { 'state-local': '1.0.7' } });
  write(join(options.loaderSource, 'lib/es/index.js'), [
    'import value from "./value.js";',
    'import state from "state-local";',
    'export default {init() {return Promise.resolve(value + state);}};',
  ].join('\n'));
  write(join(options.loaderSource, 'lib/es/value.js'), 'export default "synthetic-value";\n');
  const dependency = join(options.loaderSource, 'node_modules/state-local');
  json(join(dependency, 'package.json'), {
    name: 'state-local', version: '1.0.7', type: 'module', module: 'lib/es/index.js',
  });
  write(join(dependency, 'lib/es/index.js'), 'export default "synthetic-state";\n');
  return dependency;
}

function changeRuntimeReceipt(options, mutate, { refreshDelivery = false } = {}) {
  const path = join(options.output, 'receipt.json');
  const receipt = JSON.parse(fs.readFileSync(path));
  mutate(receipt);
  if (refreshDelivery) {
    const entries = readTree(options.output, { jsonOnly: false }).entries
      .filter(file => file.path !== 'receipt.json');
    receipt.delivery = { ...fingerprint(entries), entries };
  }
  json(path, receipt);
}

const metadataCases = [
  ['loader', 'package.json', 'extras/js/@monaco-editor/loader/1.7.0/package.json'],
  ['loader', 'LICENSE', 'extras/js/@monaco-editor/loader/1.7.0/LICENSE'],
  ['monaco', 'package.json', 'plugins/monaco-editor@0.52.2/package.json'],
  ['monaco', 'LICENSE', 'plugins/monaco-editor@0.52.2/LICENSE'],
  ['monaco', 'ThirdPartyNotices.txt', 'plugins/monaco-editor@0.52.2/ThirdPartyNotices.txt'],
];

test('runtime verifies the complete transitive loader build and every third-party metadata byte without writing', async t => {
  const options = fixture(t);
  const dependency = includeLoaderDependency(options);
  const sourceRoots = [options.loaderSource, options.monacoSource, options.candidate];
  const before = sourceRoots.map(fixtureSnapshot);
  const result = await prepareNativeAiCodeRuntimeAssets(options);
  assert.deepEqual(result.receipt.packages[0].inputs.map(input => input.path).sort(), [
    join(options.loaderSource, 'lib/es/index.js'), join(options.loaderSource, 'lib/es/value.js'),
    join(options.loaderSource, 'package.json'),
    join(dependency, 'lib/es/index.js'), join(dependency, 'package.json'),
  ].sort());
  for (const [index, root] of [options.loaderSource, options.monacoSource].entries()) {
    const names = metadataCases.filter(([kind]) => kind === (index ? 'monaco' : 'loader'))
      .map(([, name]) => name);
    assert.deepEqual(result.receipt.packages[index].metadataInputs, names.map(name => {
      const path = join(root, name);
      const bytes = fs.readFileSync(path);
      return { path, bytes: bytes.length, sha256: hash(bytes) };
    }));
  }
  for (const [kind, name, target] of metadataCases) {
    assert.deepEqual(fs.readFileSync(join(options.output, target)),
      fs.readFileSync(join(kind === 'loader' ? options.loaderSource : options.monacoSource, name)));
  }
  const delivery = fixtureSnapshot(options.output);
  assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt, result.receipt);
  assert.deepEqual(fixtureSnapshot(options.output), delivery);
  assert.deepEqual(sourceRoots.map(fixtureSnapshot), before);
  assert.equal(result.receipt.acceptedForProduction, false);
  assert.equal(result.receipt.status, 'prepared-not-accepted');
});

for (const path of [
  'lib/es/index.js', 'lib/es/value.js',
  'node_modules/state-local/lib/es/index.js', 'node_modules/state-local/package.json',
]) {
  test(`runtime verification rejects loader source input drift in ${path}`, async t => {
    const options = fixture(t);
    includeLoaderDependency(options);
    await prepareNativeAiCodeRuntimeAssets(options);
    fs.appendFileSync(join(options.loaderSource, path), '\n');
    const before = fixtureSnapshot(options.output);
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /Loader build inputs changed/);
    assert.deepEqual(fixtureSnapshot(options.output), before);
  });
}

for (const [kind, name, target] of metadataCases) {
  test(`runtime verification rejects original ${kind} ${name} byte drift`, async t => {
    const options = fixture(t);
    await prepareNativeAiCodeRuntimeAssets(options);
    fs.appendFileSync(join(kind === 'loader' ? options.loaderSource : options.monacoSource, name), '\n');
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /inputs changed/);
  });

  test(`runtime verification rejects forged ${kind} ${name} delivery with refreshed fingerprint`, async t => {
    const options = fixture(t);
    await prepareNativeAiCodeRuntimeAssets(options);
    const path = join(options.output, target);
    if (name === 'package.json') {
      json(path, { ...JSON.parse(fs.readFileSync(path)), version: '99.0.0' });
    } else fs.appendFileSync(path, 'forged metadata\n');
    changeRuntimeReceipt(options, () => {}, { refreshDelivery: true });
    const before = fixtureSnapshot(options.output);
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)),
      /Third-party metadata delivery differs/);
    assert.deepEqual(fixtureSnapshot(options.output), before);
  });

  test(`runtime preparation and verification reject ${kind} ${name} source symlinks`, async t => {
    const options = fixture(t);
    await prepareNativeAiCodeRuntimeAssets(options);
    symlink(join(kind === 'loader' ? options.loaderSource : options.monacoSource, name));
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /Symlink resource rejected/);
    const output = join(dirname(options.output), 'rejected-metadata-symlink');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output }), /Symlink resource rejected/);
    assert.equal(fs.existsSync(output), false);
  });
}

for (const [kind, version] of [['loader', '1.6.0'], ['monaco', '0.52.1']]) {
  test(`runtime verification rechecks the original ${kind} version`, async t => {
    const options = fixture(t);
    await prepareNativeAiCodeRuntimeAssets(options);
    const path = join(kind === 'loader' ? options.loaderSource : options.monacoSource, 'package.json');
    json(path, { ...JSON.parse(fs.readFileSync(path)), version });
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)),
      kind === 'loader' ? /1\.7\.0/ : /0\.52\.2/);
  });
}

for (const kind of ['loader', 'monaco']) {
  test(`runtime verification requires exact ${kind} manifest delivery bytes even with unchanged identity`, async t => {
    const options = fixture(t);
    await prepareNativeAiCodeRuntimeAssets(options);
    const target = metadataCases.find(([type, name]) => type === kind && name === 'package.json')[2];
    fs.appendFileSync(join(options.output, target), '\n');
    changeRuntimeReceipt(options, () => {}, { refreshDelivery: true });
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)),
      /Third-party metadata delivery differs/);
  });
}

for (const [name, mutate, expected] of [
  ['missing build', pkg => { delete pkg.build; }, /Loader build provenance differs/],
  ['another build', pkg => { pkg.build = 'published-prebuilt'; }, /Loader build provenance differs/],
  ['absolute source', (pkg, options) => { pkg.source = options.loaderSource; }, /Loader source must be/],
  ['traversing source', pkg => { pkg.source = '../loader'; }, /Loader source must be/],
  ['missing inputs', pkg => { delete pkg.inputs; }, /Loader build inputs inventory is required/],
  ['empty inputs', pkg => { pkg.inputs = []; }, /Loader build inputs inventory is required/],
  ['omitted entry', pkg => {
    pkg.inputs = pkg.inputs.filter(input => !input.path.endsWith('/loader/lib/es/index.js'));
  }, /Loader build input inventory is incomplete/],
  ['omitted original manifest', pkg => {
    pkg.inputs = pkg.inputs.filter(input => !input.path.endsWith('/loader/package.json'));
  }, /Loader build input inventory is incomplete/],
  ['omitted local module', pkg => {
    pkg.inputs = pkg.inputs.filter(input => !input.path.endsWith('/value.js'));
  }, /Loader build input inventory differs/],
  ['omitted dependency module', pkg => {
    pkg.inputs = pkg.inputs.filter(input => !input.path.endsWith('/state-local/lib/es/index.js'));
  }, /Loader build input inventory differs/],
  ['omitted dependency manifest', pkg => {
    pkg.inputs = pkg.inputs.filter(input => !input.path.endsWith('/state-local/package.json'));
  }, /Loader build input inventory differs/],
  ['duplicate inputs', pkg => { pkg.inputs.push(pkg.inputs[0]); }, /duplicate paths/],
  ['input hash tampering', pkg => { pkg.inputs[0].sha256 = '0'.repeat(64); }, /Loader build inputs changed/],
  ['input length tampering', pkg => { pkg.inputs[0].bytes++; }, /Loader build inputs changed/],
  ['unknown input fields', pkg => { pkg.inputs[0].trusted = true; }, /Loader build inputs fields differ/],
  ['relative input path', pkg => { pkg.inputs[0].path = 'third-party/loader/lib/es/index.js'; },
    /unambiguous absolute path/],
  ['traversing input path', (pkg, options) => {
    pkg.inputs[0].path = `${options.loaderSource}/lib/../lib/es/index.js`;
  }, /unambiguous absolute path/],
  ['escaping input path', pkg => { pkg.inputs[0].path = '/etc/hostname'; }, /Loader input must be/],
  ['extra unrelated input', (pkg, options) => {
    const path = join(options.loaderSource, 'LICENSE');
    const bytes = fs.readFileSync(path);
    pkg.inputs.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }, /Loader build input inventory differs/],
  ['missing metadata inventory', pkg => { delete pkg.metadataInputs; }, /metadata inputs inventory is required/],
  ['omitted license input', pkg => { pkg.metadataInputs.pop(); }, /metadata inputs inventory differs/],
  ['duplicate metadata inputs', pkg => { pkg.metadataInputs.push(pkg.metadataInputs[0]); }, /duplicate paths/],
]) {
  test(`runtime verification rejects loader ${name}`, async t => {
    const options = fixture(t);
    includeLoaderDependency(options);
    await prepareNativeAiCodeRuntimeAssets(options);
    changeRuntimeReceipt(options, receipt => mutate(receipt.packages[0], options));
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), expected);
  });
}

for (const [name, mutate, expected] of [
  ['missing source', pkg => { delete pkg.source; }, /Monaco source must be/],
  ['absolute source', (pkg, options) => { pkg.source = options.monacoSource; }, /Monaco source must be/],
  ['traversing source', pkg => { pkg.source = '../monaco'; }, /Monaco source must be/],
  ['missing metadata inventory', pkg => { delete pkg.metadataInputs; }, /metadata inputs inventory is required/],
  ['omitted notices input', pkg => { pkg.metadataInputs.pop(); }, /metadata inputs inventory differs/],
  ['metadata hash tampering', pkg => { pkg.metadataInputs[0].sha256 = '0'.repeat(64); }, /metadata inputs changed/],
]) {
  test(`runtime verification rejects Monaco ${name}`, async t => {
    const options = fixture(t);
    await prepareNativeAiCodeRuntimeAssets(options);
    changeRuntimeReceipt(options, receipt => mutate(receipt.packages[1], options));
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), expected);
  });
}

test('runtime verification rejects a forged loader bundle despite a refreshed delivery fingerprint', async t => {
  const options = fixture(t);
  await prepareNativeAiCodeRuntimeAssets(options);
  write(join(options.output, 'extras/js/@monaco-editor/loader/1.7.0/index.system.min.js'),
    'System.register([],function(){return{execute(){throw Error("forged");}}});\n');
  changeRuntimeReceipt(options, () => {}, { refreshDelivery: true });
  assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)),
    /Loader runtime bundle differs from the replayed build/);
});

test('runtime verification rebuilds changed loader source even when its input hashes are refreshed', async t => {
  const options = fixture(t);
  await prepareNativeAiCodeRuntimeAssets(options);
  const path = join(options.loaderSource, 'lib/es/index.js');
  write(path, 'export default {init() {return Promise.resolve("changed-source");}};\n');
  changeRuntimeReceipt(options, receipt => {
    const input = receipt.packages[0].inputs.find(input => input.path === path);
    const bytes = fs.readFileSync(path);
    input.bytes = bytes.length;
    input.sha256 = hash(bytes);
  });
  assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)),
    /Loader runtime bundle differs from the replayed build/);
});

test('runtime verification rejects extra metadata delivery even when the receipt fingerprint is refreshed', async t => {
  const options = fixture(t);
  await prepareNativeAiCodeRuntimeAssets(options);
  write(join(options.output, 'plugins/monaco-editor@0.52.2/forged.json'), '{}\n');
  changeRuntimeReceipt(options, () => {}, { refreshDelivery: true });
  assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)),
    /Unexpected runtime asset delivery files/);
});

for (const kind of ['loader', 'monaco']) {
  test(`runtime verification rejects a symlink substituted for the recorded ${kind} source root`, async t => {
    const options = fixture(t);
    await prepareNativeAiCodeRuntimeAssets(options);
    symlink(kind === 'loader' ? options.loaderSource : options.monacoSource);
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /Symlink directory rejected/);
  });
}

for (const path of [
  'lib/es/index.js', 'lib/es/value.js',
  'node_modules/state-local/lib/es/index.js', 'node_modules/state-local/package.json',
]) {
  test(`runtime preparation and verification reject loader input symlinks in ${path}`, async t => {
    const options = fixture(t);
    includeLoaderDependency(options);
    await prepareNativeAiCodeRuntimeAssets(options);
    symlink(join(options.loaderSource, path));
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /Symlink resource rejected/);
    const output = join(dirname(options.output), 'rejected-loader-symlink');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output }), /Symlink resource rejected/);
    assert.equal(fs.existsSync(output), false);
  });
}

test('runtime preparation and verification preserve both source-built theme deliveries beside Base64 and GlobalUtil', async t => {
  const options = fixture(t);
  includeGlobalUtil(options, { withFileEditor: true });
  const replacements = includeThemes(options);
  const original = fixtureSnapshot(options.candidate);
  const sources = fixtureSnapshot(join(options.workspace, 'modelingweb/local-plugins'));
  const result = await prepareNativeAiCodeRuntimeAssets(options);
  assert.equal(result.receipt.acceptedForProduction, false);
  assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt, result.receipt);
  assert.deepEqual(fixtureSnapshot(options.candidate), original);
  assert.deepEqual(fixtureSnapshot(join(options.workspace, 'modelingweb/local-plugins')), sources);
  for (const { files, plugin } of replacements) {
    assert.deepEqual(readTree(join(options.candidate, 'plugins', plugin.to), { jsonOnly: false }).entries, files.entries);
  }
});

for (const [name, mutate, expected] of [
  ['original-source claim', plugin => { plugin.originalSourceRecovered = true; }, /evidence differs/],
  ['native-compatibility claim', plugin => { plugin.nativeCompatibilityVerified = true; }, /evidence differs/],
  ['wrong original version', plugin => { plugin.from += '.other'; }, /identity must match/],
  ['missing contract', plugin => { delete plugin.contract; }, /declarations require/],
  ['build receipt hash', plugin => { plugin.buildReceipt.sha256 = '0'.repeat(64); }, /evidence differs/],
]) {
  test(`runtime rejects theme ${name} in preparation and fresh verification`, async t => {
    const options = fixture(t);
    includeGlobalUtil(options);
    includeThemes(options);
    await prepareNativeAiCodeRuntimeAssets(options);
    changeReceipt(options, receipt => mutate(receipt.plugins.find(plugin => plugin.to === '@aibiz/studio-theme@0.1.0')));
    const snapshot = fixtureSnapshot(options.candidate);
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), expected);
    const rejected = join(dirname(options.output), 'rejected-theme');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output: rejected }), expected);
    assert.equal(fs.existsSync(rejected), false);
    assert.deepEqual(fixtureSnapshot(options.candidate), snapshot);
  });
}

for (const path of ['src/color.css', 'src/icon.css', 'dist/color/style.css', 'dist/icon/index.system.js']) {
  test(`runtime rejects theme drift in ${path} during preparation and verification`, async t => {
    const options = fixture(t);
    includeGlobalUtil(options);
    includeThemes(options);
    await prepareNativeAiCodeRuntimeAssets(options);
    fs.appendFileSync(join(options.workspace, 'modelingweb/local-plugins/studio-theme', path), '\n');
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /input hashes|output hashes/);
    const rejected = join(dirname(options.output), 'rejected-theme');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output: rejected }), /input hashes|output hashes/);
    assert.equal(fs.existsSync(rejected), false);
  });
}

function symlink(path) {
  const target = `${path}-real`;
  fs.renameSync(path, target);
  fs.symlinkSync(target, path);
}

test('runtime map adds only the exact local loader and keeps nested map fields immutable', () => {
  const original = { imports: { vue: '/vue.js' }, styles: { vue: '/vue.css' }, scopes: {} };
  const result = runtimeImportMap(original);
  assert.equal(original.imports['@monaco-editor/loader'], undefined);
  assert.deepEqual(result, {
    ...original, imports: { ...original.imports,
      '@monaco-editor/loader': '../js/@monaco-editor/loader/1.7.0/index.system.min.js' },
  });
  assert.throws(() => runtimeImportMap({ imports: { '@monaco-editor/loader': '/another.js' } }),
    /another loader version/);
});

test('runtime nginx uses separate exact map/loader and more-specific Monaco routes', () => {
  const input = '    location ^~ /nativeappcode/plugins/ {';
  const result = runtimeAssetNginx(input);
  assert.ok(result.includes('location = /nativeappcode/extras/json/system-import.json'));
  assert.ok(result.includes('location ^~ /nativeappcode/plugins/monaco-editor@0.52.2/'));
  assert.ok(result.includes('location ^~ /plugins/monaco-editor@0.52.2/'));
  assert.ok(result.endsWith(input));
  assert.throws(() => runtimeAssetNginx('server {}'), /exactly one candidate plugin route/);
});

test('runtime assets compile the loader, preserve originals, bind metadata and remain not accepted', async t => {
  const options = fixture(t);
  const roots = [options.candidate, options.loaderSource, options.monacoSource,
    options.sourceModelRoot, options.deploymentRoot,
    join(options.workspace, 'modelingweb/app/public'), join(options.workspace, 'modelingweb/app/dist')];
  const original = roots.map(root => readTree(root, { jsonOnly: false }).entries);
  const result = await prepareNativeAiCodeRuntimeAssets(options);
  assert.equal(result.receipt.acceptedForProduction, false);
  assert.equal(result.receipt.status, 'prepared-not-accepted');
  assert.equal(result.receipt.sourceImportMap.path, importMapPath);
  assert.equal(result.receipt.sourceImportMap.sha256,
    hash(fs.readFileSync(join(options.workspace, importMapPath))));
  assert.equal(result.receipt.delivery.files, 10);
  assert.ok(result.receipt.packages[0].inputs.length >= 2);
  assert.equal(result.receipt.packages[1].compatibilityPatches[0].callSites, 2);
  const entry = fs.readFileSync(join(options.output,
    'extras/js/@monaco-editor/loader/1.7.0/index.system.min.js'), 'utf8');
  assert.match(entry, /System\.register\(\[\]/);
  assert.ok(entry.includes('synthetic-monaco'));
  assert.deepEqual(JSON.parse(fs.readFileSync(join(options.output, 'extras/json/system-import.json'))),
    runtimeImportMap(JSON.parse(fs.readFileSync(join(options.workspace, importMapPath)))));
  assert.equal(result.receipt.dependencySourceBuildsVerified, undefined);
  assert.ok(result.receipt.remainingAcceptance.includes('native plugin rendering'));
  assert.deepEqual(roots.map(root => readTree(root, { jsonOnly: false }).entries), original);
  assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt,
    result.receipt);
  await assert.rejects(prepareNativeAiCodeRuntimeAssets(options), /must not be overwritten/);
});

test('runtime assets bind the independent file editor to its complete current source/build evidence', async t => {
  const options = fixture(t);
  includeFileEditor(options);
  const result = await prepareNativeAiCodeRuntimeAssets(options);
  assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt, result.receipt);
  fs.appendFileSync(join(options.workspace, 'modelingweb/local-plugins/file-to-base64/src/editor.ts'), '\n');
  assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /source input hashes/);
});

for (const [name, mutate, expected] of [
  ['recovered original source', receipt => {
    receipt.plugins.find(plugin => plugin.to === '@aibiz/file-to-base64@0.1.0').originalSourceRecovered = true;
  }, /evidence differs/],
  ['claimed native compatibility', receipt => {
    receipt.independentReplacementMappings[0].nativeCompatibilityVerified = true;
  }, /cannot claim/],
  ['missing independent contract', receipt => {
    delete receipt.plugins.find(plugin => plugin.to === '@aibiz/file-to-base64@0.1.0').contract;
  }, /declarations require actual plugin evidence/],
]) {
  test(`runtime assets reject file editor ${name}`, async t => {
    const options = fixture(t);
    includeFileEditor(options);
    changeReceipt(options, mutate);
    await assert.rejects(prepareNativeAiCodeRuntimeAssets(options), expected);
    assert.equal(fs.existsSync(options.output), false);
  });
}

for (const withFileEditor of [false, true]) {
  test(`runtime assets consume exact global utility evidence${withFileEditor ? ' alongside Base64' : ''} without modifying inputs`, async t => {
    const options = fixture(t);
    const verified = includeGlobalUtil(options, { withFileEditor });
    const roots = [
      options.candidate, join(options.workspace, globalUtilSource),
      options.sourceModelRoot, options.deploymentRoot, options.build.destination,
      join(options.workspace, 'scripts/fixtures/modeling-core-migration-contract.json'),
      join(options.workspace, 'modelingweb/nginx-native.conf'), join(options.workspace, importMapPath),
      ...(withFileEditor ? [join(options.workspace, 'modelingweb/local-plugins/file-to-base64')] : []),
    ];
    const before = roots.map(fixtureSnapshot);
    const candidateReceipt = fs.readFileSync(join(options.candidate, 'receipt.json'));
    const result = await prepareNativeAiCodeRuntimeAssets(options);
    assert.deepEqual(result.receipt.candidate, {
      path: relative(options.workspace, options.candidate), receiptSha256: hash(candidateReceipt),
    });
    assert.equal(result.receipt.status, 'prepared-not-accepted');
    assert.equal(result.receipt.acceptedForProduction, false);
    assert.equal(options.deployment.dependencies.toolchainSourceBuildsVerified, false);
    assert.equal(result.receipt.delivery.files, 10);
    const persisted = JSON.parse(candidateReceipt);
    assert.deepEqual(persisted.plugins.find(plugin => plugin.to === globalUtilRepo), verified.plugin);
    assert.deepEqual(persisted.independentReplacementMappings.map(mapping => mapping.to),
      [...(withFileEditor ? ['@aibiz/file-to-base64@0.1.0'] : []), globalUtilRepo]);
    assert.deepEqual(readTree(join(options.candidate, 'plugins', globalUtilRepo),
      { jsonOnly: false }).entries, verified.files.entries);
    assert.deepEqual(verified.files.entries.map(file => file.path),
      ['dist/index.mjs', 'dist/index.system.js', 'package.json']);
    assert.deepEqual(fs.readFileSync(join(options.candidate, 'plugins', globalUtilRepo, 'package.json')),
      fs.readFileSync(join(options.workspace, globalUtilSource, 'package.json')));
    assert.equal(fs.existsSync(join(options.candidate, 'plugins', globalUtilRequested)), false);
    for (const mapping of persisted.independentReplacementMappings) {
      assert.equal(mapping.originalSourceRecovered, false);
      assert.equal(mapping.nativeCompatibilityVerified, false);
      assert.equal(mapping.originalMigrationAcceptance, 'not-satisfied-by-independent-replacement');
    }
    assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt, result.receipt);
    assert.deepEqual(roots.map(fixtureSnapshot), before);
  });
}

for (const [path, expected] of [
  ['build.mjs', /source input hashes/],
  ['package.json', /source input hashes/],
  ['src/index.ts', /source input hashes/],
  ['dist/index.mjs', /build output hashes/],
  ['dist/index.system.js', /build output hashes/],
]) {
  test(`runtime assets reject global utility drift in ${path} at preparation and verification`, async t => {
    const options = fixture(t);
    includeGlobalUtil(options, { withFileEditor: true });
    await prepareNativeAiCodeRuntimeAssets(options);
    fs.appendFileSync(join(options.workspace, globalUtilSource, path), '\n');
    const roots = [options.candidate, options.output];
    const before = roots.map(fixtureSnapshot);
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), expected);
    const rejectedOutput = join(dirname(options.output), 'rejected-global-util');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output: rejectedOutput }), expected);
    assert.equal(fs.existsSync(rejectedOutput), false);
    assert.deepEqual(roots.map(fixtureSnapshot), before);
  });
}

for (const [name, mutate, expected] of [
  ['recovered original source', (_receipt, plugin) => {
    plugin.originalSourceRecovered = true;
  }, /Independent replacement evidence differs/],
  ['authenticated original repository', (_receipt, plugin) => {
    plugin.originalRepositoryAuthenticated = true;
  }, /Independent replacement evidence differs/],
  ['claimed plugin native compatibility', (_receipt, plugin) => {
    plugin.nativeCompatibilityVerified = true;
  }, /Independent replacement evidence differs/],
  ['claimed production acceptance', (_receipt, plugin) => {
    plugin.acceptedForProduction = true;
  }, /false/],
  ['wrong original identity', (_receipt, plugin) => {
    plugin.from = '@ibiz-template-plugin/global-util-design@0.0.3-alpha.88';
  }, /Independent replacement evidence differs/],
  ['source fingerprint tampering', (_receipt, plugin) => {
    plugin.sourceFingerprint = '0'.repeat(64);
  }, /Independent replacement evidence differs/],
  ['build receipt hash tampering', (_receipt, plugin) => {
    plugin.buildReceipt.sha256 = '0'.repeat(64);
  }, /Independent replacement evidence differs/],
  ['missing independent contract', (_receipt, plugin) => {
    delete plugin.contract;
  }, /declarations require actual plugin evidence/],
  ['another recognized independent contract', (_receipt, plugin) => {
    plugin.contract = 'native-file-base64-independent-replacement';
  }, /Independent replacement evidence differs/],
  ['mapping original source claim', receipt => {
    receipt.independentReplacementMappings.find(mapping => mapping.to === globalUtilRepo)
      .originalSourceRecovered = true;
  }, /Independent replacement cannot claim/],
  ['mapping native compatibility claim', receipt => {
    receipt.independentReplacementMappings.find(mapping => mapping.to === globalUtilRepo)
      .nativeCompatibilityVerified = true;
  }, /Independent replacement cannot claim/],
  ['mapping original migration acceptance claim', receipt => {
    receipt.independentReplacementMappings.find(mapping => mapping.to === globalUtilRepo)
      .originalMigrationAcceptance = 'satisfied';
  }, /Independent replacement cannot claim/],
  ['wrong mapping original identity', receipt => {
    receipt.independentReplacementMappings.find(mapping => mapping.to === globalUtilRepo)
      .from = '@ibiz-template-plugin/global-util-design@0.0.3-alpha.88';
  }, /Independent replacement cannot claim/],
  ['missing own mapping with Base64 retained', receipt => {
    receipt.independentReplacementMappings =
      receipt.independentReplacementMappings.filter(mapping => mapping.to !== globalUtilRepo);
  }, /Independent replacement cannot claim/],
  ['duplicate own mapping', receipt => {
    receipt.independentReplacementMappings.push(
      receipt.independentReplacementMappings.find(mapping => mapping.to === globalUtilRepo));
  }, /Independent replacement cannot claim/],
  ['duplicate own plugin', (receipt, plugin) => {
    receipt.plugins.push(plugin);
  }, /Duplicate candidate plugin identity/],
]) {
  test(`runtime assets reject global utility ${name} at preparation and verification`, async t => {
    const options = fixture(t);
    includeGlobalUtil(options, { withFileEditor: true });
    await prepareNativeAiCodeRuntimeAssets(options);
    changeReceipt(options, receipt => {
      mutate(receipt, receipt.plugins.find(plugin => plugin.to === globalUtilRepo));
    });
    const roots = [options.candidate, options.output, join(options.workspace, globalUtilSource)];
    const before = roots.map(fixtureSnapshot);
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), expected);
    const rejectedOutput = join(dirname(options.output), 'rejected-global-util');
    await assert.rejects(prepareNativeAiCodeRuntimeAssets({ ...options, output: rejectedOutput }), expected);
    assert.equal(fs.existsSync(rejectedOutput), false);
    assert.deepEqual(roots.map(fixtureSnapshot), before);
  });
}

test('runtime asset generation handles umask 0077 without relaxing original permissions', async t => {
  const mask = process.umask(0o077);
  try {
    const options = fixture(t);
    await prepareNativeAiCodeRuntimeAssets(options);
    assert.equal(fs.statSync(options.workspace).mode & 0o777, 0o700);
    assert.equal(fs.statSync(options.loaderSource).mode & 0o777, 0o700);
    assert.equal(fs.statSync(join(options.loaderSource, 'package.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(options.output).mode & 0o777, 0o755);
    for (const file of readTree(options.output, { jsonOnly: false }).entries) {
      assert.equal(fs.statSync(join(options.output, file.path)).mode & 0o777, 0o644);
    }
  } finally { process.umask(mask); }
});

for (const [label, mutate, expected] of [
  ['loader version', data => json(join(data.loaderSource, 'package.json'),
    { name: '@monaco-editor/loader', version: '1.6.0' }), /1\.7\.0/],
  ['missing Monaco entry', data => fs.unlinkSync(join(data.monacoSource, 'min/vs/editor/editor.main.js')),
    /assertion|false/i],
  ['candidate drift', data => write(join(data.candidate, 'plugins', repo, 'dist/index.system.min.js'), 'drift'),
    /Candidate ai-code files changed/],
  ['candidate nginx drift', data => write(join(data.candidate, 'nginx-native.conf'), 'drift'),
    /Candidate nginx changed/],
  ['original nginx drift', data => write(join(data.workspace, 'modelingweb/nginx-native.conf'), 'drift'),
    /Original nginx changed/],
  ['missing dist baseline despite public map', data => fs.unlinkSync(join(data.workspace, importMapPath)),
    /ENOENT/],
  ['wrong model output hash', data => changeReceipt(data, receipt => {
    receipt.applications.Central.files[0].outputSha256 = '0'.repeat(64);
  }), /Candidate model changed/],
  ['missing model record', data => changeReceipt(data, receipt => {
    receipt.applications.ModelDesign.files.pop();
  }), /all three ModelDesign models/],
  ['duplicate model record', data => changeReceipt(data, receipt => {
    receipt.applications.Central.files[1] = receipt.applications.Central.files[0];
  }), /all three Central models/],
  ['unexpected application', data => changeReceipt(data, receipt => {
    receipt.applications.Extra = { files: [] };
  }), /exactly both applications/],
  ['extra model file', data => write(join(data.candidate, 'model/PSSYSAPPS/Central/extra.json'), '{}'),
    /Unexpected candidate delivery files/],
  ['sibling nested asset drift', data => write(
    join(data.candidate, 'plugins', sibling, 'dist/assets/style.css'), 'drift'),
  /Candidate sibling plugin files changed/],
  ['missing sibling asset', data => fs.unlinkSync(
    join(data.candidate, 'plugins', sibling, 'dist/assets/style.css')),
  /Candidate sibling plugin files changed/],
  ['missing sibling tree', data => fs.rmSync(join(data.candidate, 'plugins', sibling),
    { recursive: true, force: true }), /Missing candidate plugin/],
  ['extra sibling hidden file', data => write(join(data.candidate, 'plugins', sibling, '.env'), 'extra'),
    /Candidate sibling plugin files changed/],
  ['duplicate plugin identity', data => changeReceipt(data, receipt => {
    receipt.plugins.push(receipt.plugins[0]);
  }), /Duplicate candidate plugin identity/],
  ['traversing plugin identity', data => changeReceipt(data, receipt => {
    receipt.plugins[0].to = '../outside';
  }), /Invalid candidate plugin identity/],
  ['extra plugin package', data => write(
    join(data.candidate, 'plugins/@ibiz-template-plugin/extra@1.0.0/index.js'), 'extra'),
  /Unexpected candidate delivery files/],
  ['extra empty plugin scope', data => fs.mkdirSync(join(data.candidate, 'plugins/@extra')),
    /Unexpected candidate files or directories/],
  ['extra empty sibling directory', data => fs.mkdirSync(join(data.candidate, 'plugins', sibling, 'extra')),
    /Unexpected candidate files or directories/],
  ['extra empty model directory', data => fs.mkdirSync(join(data.candidate, 'model/PSSYSAPPS/Extra')),
    /Unexpected candidate files or directories/],
  ['extra candidate root file', data => write(join(data.candidate, 'extra.js'), 'extra'),
    /Unexpected candidate delivery files/],
  ['verification flags without receipts', data => changeReceipt(data, (_receipt, plugin) => {
    delete plugin.deploymentReceipt;
    delete plugin.sourceDependencies;
    plugin.toolchainSourceBuildsVerified = true;
  }), /deployment receipt and source report evidence/],
  ['missing deployment receipt', data => fs.unlinkSync(data.deploymentReceipt), /ENOENT/],
  ['missing source report', data => fs.unlinkSync(data.reportPath), /ENOENT/],
  ['deployment receipt byte drift', data => fs.appendFileSync(data.deploymentReceipt, '\n'),
    /Deployment receipt hash changed/],
  ['source report byte drift', data => fs.appendFileSync(data.reportPath, '\n'), /Source report hash changed/],
  ['deployment receipt hash tampering', data => changeReceipt(data, (_receipt, plugin) => {
    plugin.deploymentReceipt.sha256 = '0'.repeat(64);
  }), /Deployment receipt hash changed/],
  ['source report hash tampering', data => changeReceipt(data, (_receipt, plugin) => {
    plugin.sourceDependencies.reportSha256 = '0'.repeat(64);
  }), /Source report hash changed/],
  ['escaping deployment receipt path', data => changeReceipt(data, (_receipt, plugin) => {
    plugin.deploymentReceipt.path = '../receipt.json';
  }), /Deployment receipt must be a workspace-relative path/],
  ['absolute source report path', data => changeReceipt(data, (_receipt, plugin) => {
    plugin.sourceDependencies.reportPath = data.reportPath;
  }), /Source report must be a workspace-relative path/],
  ['deployment drift with unchanged candidate', data => write(
    join(data.workspace, data.deployment.deployment.path, 'dist/index.system.min.js'), 'drift'),
  /Deployment differs from the verified source build/],
  ['source drift with unchanged candidate', data => write(join(data.source.source, 'src/index.ts'), 'drift'),
    /Staged source input drift: ai-code|Original source input drift: ai-code/],
  ['dependency build output drift', data => {
    const step = data.build.report.steps.find(step => step.id === 'runtime');
    const source = data.build.report.sources.find(source => source.id === 'runtime');
    write(join(source.staged, step.outputs.entries[0].path), 'drift');
  }, /Build output drift: runtime/],
  ['source build log drift', data => {
    const log = data.build.report.steps[0].commands[0].log;
    fs.appendFileSync(join(data.build.destination, log), 'drift');
  }, /Source build log (length|hash) changed/],
  ['forged source report with refreshed candidate hash', data => {
    const report = JSON.parse(fs.readFileSync(data.reportPath));
    report.runtimeSourceBuildsVerified = false;
    json(data.reportPath, report);
    changeReceipt(data, (_receipt, plugin) => {
      plugin.sourceDependencies.reportSha256 = hash(fs.readFileSync(data.reportPath));
    });
  }, /Source build evidence missing: runtimeSourceBuildsVerified/],
  ['source evidence metadata tampering', data => changeReceipt(data, (_receipt, plugin) => {
    plugin.sourceDependencies.sources[0].fingerprint = '0'.repeat(64);
  }), /Candidate ai-code evidence differs/],
  ['source fingerprint tampering', data => changeReceipt(data, (_receipt, plugin) => {
    plugin.sourceFingerprint = '0'.repeat(64);
  }), /Candidate ai-code evidence differs/],
  ['build output fingerprint tampering', data => changeReceipt(data, (_receipt, plugin) => {
    plugin.buildOutputFingerprint = '0'.repeat(64);
  }), /Candidate ai-code evidence differs/],
  ['claimed source-built toolchain', data => changeReceipt(data, (_receipt, plugin) => {
    plugin.toolchainSourceBuildsVerified = true;
  }), /Candidate ai-code evidence differs/],
  ['claimed plugin acceptance', data => changeReceipt(data, (_receipt, plugin) => {
    plugin.acceptedForProduction = true;
  }), /false/],
  ['copied ai-code drift with refreshed candidate fingerprint', data => {
    write(join(data.candidate, 'plugins', repo, 'dist/index.system.min.js'), 'drift');
    const tree = readTree(join(data.candidate, 'plugins', repo), { jsonOnly: false });
    changeReceipt(data, (_receipt, plugin) => { plugin.outputFingerprint = tree.fingerprint; });
  }, /Candidate ai-code evidence differs/],
  ['candidate receipt symlink', data => symlink(join(data.candidate, 'receipt.json')), /Symlink resource rejected/],
  ['candidate ancestor symlink', data => symlink(data.candidate), /Symlink directory rejected/],
  ['model ancestor symlink', data => symlink(join(data.candidate, 'model/PSSYSAPPS/Central')),
    /Symlink resource rejected/],
  ['sibling ancestor symlink', data => symlink(join(data.candidate, 'plugins/@ibiz-template-plm')),
    /Symlink resource rejected/],
  ['original model ancestor symlink', data => symlink(data.sourceModelRoot), /Symlink directory rejected/],
  ['deployment receipt symlink', data => symlink(data.deploymentReceipt), /Symlink resource rejected/],
  ['deployment ancestor symlink', data => symlink(data.deploymentRoot), /Symlink directory rejected/],
  ['source report symlink', data => symlink(data.reportPath), /Symlink resource rejected/],
  ['source report ancestor symlink', data => symlink(data.build.destination), /Symlink directory rejected/],
  ['dist import map symlink', data => symlink(join(data.workspace, importMapPath)), /Symlink resource rejected/],
  ['dist import map ancestor symlink', data => symlink(join(data.workspace, 'modelingweb/app/dist/extras')),
    /Symlink directory rejected/],
]) {
  test(`runtime preparation rejects ${label} without creating an output`, async t => {
    const options = fixture(t);
    mutate(options);
    await assert.rejects(prepareNativeAiCodeRuntimeAssets(options), expected);
    assert.equal(fs.existsSync(options.output), false);
  });
}

for (const application of applications) {
  for (const name of modelFiles) {
    const path = `PSSYSAPPS/${application}/${name}`;
    for (const mode of ['missing', 'changed', 'original changed']) {
      test(`runtime preparation rejects ${mode} ${path} without creating an output`, async t => {
        const options = fixture(t);
        if (mode === 'missing') fs.unlinkSync(join(options.candidate, 'model', path));
        else write(mode === 'changed' ? join(options.candidate, 'model', path) :
          join(options.sourceModelRoot, path), '{}');
        await assert.rejects(prepareNativeAiCodeRuntimeAssets(options),
          mode === 'missing' ? /Missing candidate model/ :
            mode === 'changed' ? /Candidate model changed/ : /Original model changed/);
        assert.equal(fs.existsSync(options.output), false);
      });
    }
  }
}

test('runtime verification rechecks models, siblings and audited evidence without writing', async t => {
  const options = fixture(t);
  await prepareNativeAiCodeRuntimeAssets(options);
  const cases = [
    [join(options.candidate, 'model/PSSYSAPPS/Central/PSSYSAPP.simple.json'), /Candidate model changed/],
    [join(options.candidate, 'plugins', sibling, 'dist/assets/style.css'), /Candidate sibling plugin files changed/],
    [options.deploymentReceipt, /Deployment receipt hash changed/],
    [options.reportPath, /Source report hash changed/],
    [join(options.workspace, importMapPath), /Original import map changed/],
    [join(options.workspace, options.deployment.deployment.path, 'dist/index.system.min.js'),
      /Deployment differs from the verified source build/],
  ];
  for (const [path, expected] of cases) {
    const before = fs.readFileSync(path);
    fs.appendFileSync(path, ' ');
    const delivery = readTree(options.output, { jsonOnly: false }).entries;
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), expected);
    assert.deepEqual(readTree(options.output, { jsonOnly: false }).entries, delivery);
    fs.writeFileSync(path, before);
  }
  assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt.acceptedForProduction, false);
});

test('runtime verification binds candidate receipt bytes, even when its semantic content is unchanged', async t => {
  const options = fixture(t);
  await prepareNativeAiCodeRuntimeAssets(options);
  fs.appendFileSync(join(options.candidate, 'receipt.json'), '\n');
  assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /Model candidate receipt changed/);
});

test('runtime verification rejects downgraded or forged Monaco compatibility evidence', async t => {
  const options = fixture(t);
  const result = await prepareNativeAiCodeRuntimeAssets(options);
  const receiptPath = join(options.output, 'receipt.json');
  for (const mutate of [
    pkg => { delete pkg.compatibilityPatches; },
    pkg => { pkg.delivery = 'published-third-party-min-assets'; },
    pkg => { pkg.compatibilityPatches[0].callSites = 1; },
    pkg => { pkg.compatibilityPatches[0].inputSha256 = '0'.repeat(64); },
    pkg => { pkg.compatibilityPatches[0].outputSha256 = '0'.repeat(64); },
    pkg => { pkg.compatibilityPatches[0].sourceSha256 = '0'.repeat(64); },
  ]) {
    const receipt = structuredClone(result.receipt);
    mutate(receipt.packages[1]);
    json(receiptPath, receipt);
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)),
      /Monaco (compatibility patch evidence changed|lifecycle compatibility evidence is required)/);
  }
  json(receiptPath, result.receipt);
  assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt, result.receipt);
});

test('runtime verification rederives Monaco output from unchanged third-party inputs', async t => {
  const options = fixture(t);
  await prepareNativeAiCodeRuntimeAssets(options);
  for (const path of ['vs/editor/editor.main.js', 'vs/loader.js']) {
    const input = join(options.monacoSource, 'min', path);
    const before = fs.readFileSync(input);
    fs.appendFileSync(input, '\n');
    assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)),
      /Monaco (compatibility patch evidence changed|runtime must preserve the exact source tree)/);
    fs.writeFileSync(input, before);
  }
  assert.equal(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt.acceptedForProduction, false);
});

test('runtime verification rejects runtime receipt symlink ancestors and files', async t => {
  const options = fixture(t);
  await prepareNativeAiCodeRuntimeAssets(options);
  symlink(options.output);
  assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /Symlink directory rejected/);
  const target = `${options.output}-real`;
  fs.unlinkSync(options.output);
  fs.renameSync(target, options.output);
  symlink(join(options.output, 'receipt.json'));
  assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)), /Symlink resource rejected/);
});

test('public baseline changes cannot replace or invalidate the actual dist import map', async t => {
  const options = fixture(t);
  fs.unlinkSync(join(options.workspace, 'modelingweb/app/public/extras/json/system-import.json'));
  const result = await prepareNativeAiCodeRuntimeAssets(options);
  json(join(options.workspace, 'modelingweb/app/public/extras/json/system-import.json'),
    { imports: { '@ibiz-template/runtime': '/wrong-runtime.js' } });
  assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt, result.receipt);
});

test('existing injectable CLI fixture pins verify evidence without claiming source-built toolchain acceptance', async t => {
  const source = await cliSourceFixture(t, deploymentFixture(t));
  const options = fixture(t, source);
  const result = await prepareNativeAiCodeRuntimeAssets(options);
  assert.equal(result.receipt.acceptedForProduction, false);
  assert.equal(options.deployment.dependencies.toolchainSourceBuildsVerified, false);
  assert.deepEqual(verifyNativeAiCodeRuntimeAssets(verification(options)).receipt, result.receipt);
  assert.throws(() => verifyNativeAiCodeRuntimeAssets({
    workspace: options.workspace, assets: options.output,
  }), /pin|commit|tree|revision/i);
});

test('runtime verification rejects file drift and extra delivery files', async t => {
  const options = fixture(t);
  await prepareNativeAiCodeRuntimeAssets(options);
  write(join(options.output, 'unexpected.js'), 'not in receipt');
  assert.throws(() => verifyNativeAiCodeRuntimeAssets(verification(options)),
    /Runtime asset delivery changed/);
});

test('runtime overlay changes only candidate nginx/runtime mounts and retains source platform/grid overlays', () => {
  const compose = join(WORKSPACE, 'plm/deploy/compose');
  const config = JSON.parse(execFileSync('docker', [
    'compose', '--env-file', '.dev', '-f', 'docker-compose-dev.yml',
    '-f', 'docker-compose-modeling-native.yml', '-f', 'docker-compose-modeling-native-candidate.yml',
    '-f', 'docker-compose-modeling-native-service-candidate.yml',
    '-f', 'docker-compose-modeling-native-platform-local.yml',
    '-f', 'docker-compose-modeling-native-ai-code-runtime.yml',
    '--profile', 'modeling', '--profile', 'modeling-native', '--profile', 'modeling-native-candidate',
    'config', '--format', 'json',
  ], { cwd: compose, encoding: 'utf8', env: {
    ...process.env, NATIVE_AI_CODE_RUNTIME_ROOT: '/tmp/fixture-runtime-assets',
    NATIVE_SERVICE_CANDIDATE_ROOT: '/tmp/fixture-service-candidate',
  } }));
  for (const name of ['modelingweb-native-central', 'modelingweb-native-modeldesign']) {
    assert.ok(!config.services[name].volumes.some(volume =>
      volume.source.includes('fixture-runtime-assets')));
  }
  for (const name of ['modelingweb-candidate-central', 'modelingweb-candidate-modeldesign']) {
    const service = config.services[name];
    assert.equal(service.environment.NATIVE_PLATFORM_HOST, 'ibiz-ebsx-allinone-local');
    const nginx = service.volumes.filter(volume => volume.target === '/opt/aibiz/nginx-native.conf');
    assert.equal(nginx.length, 1);
    assert.equal(nginx[0].source, '/tmp/fixture-runtime-assets/nginx-native.conf');
    assert.ok(service.volumes.find(volume =>
      volume.target === '/opt/aibiz/native-ai-code-runtime-assets').read_only);
  }
  assert.ok(config.services['modelingweb-candidate-central'].volumes.some(volume =>
    volume.target.endsWith('/PSDevSlnGridView.json') && volume.read_only));
});
