import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import {
  fingerprintDirectory, loadMigrationContract, validateBuildReceipt, validateMigrationMapping, WORKSPACE,
} from '../harness-modeling-core-audit.mjs';

const candidates = JSON.parse(readFileSync(new URL(
  '../fixtures/modeling-core-source-candidates.json', import.meta.url,
), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(join(WORKSPACE, path));

test('accepted native mapping receipts bind the actual complete source and target file sets', () => {
  const contract = loadMigrationContract();
  for (const mapping of contract.migrationMappings) {
    if (mapping.build.status !== 'verified') continue;
    const receipt = mapping.build.receipt;
    const source = fingerprintDirectory(WORKSPACE, mapping.source.path);
    const target = fingerprintDirectory(WORKSPACE, mapping.target.artifact.path);
    assert.equal(validateBuildReceipt(receipt).valid, true, mapping.from);
    assert.equal(receipt.sourceFingerprint, source.fingerprint, mapping.from);
    assert.equal(receipt.outputFingerprint, target.fingerprint, mapping.from);
    assert.deepEqual(receipt.inputs, source.entries, mapping.from);
    assert.deepEqual(receipt.outputs, target.entries, mapping.from);
    assert.equal(receipt.package.gitHead, mapping.source.packageGitHead, mapping.from);
  }
});

test('published source candidates remain observations rather than authenticated original source', () => {
  assert.equal(candidates.schemaVersion, 1);
  assert.equal(candidates.contract, 'ibizmodeling-core-source-observations');
  assert.equal(candidates.policy, 'observations-only-not-migration-acceptance');
  const contract = loadMigrationContract();
  for (const candidate of candidates.candidates) {
    const mapping = contract.migrationMappings.find(item => item.from === candidate.from);
    assert.ok(mapping, candidate.from);
    assert.equal(candidate.repo, mapping.target.repo);
    assert.equal(candidate.originalRepositoryAuthenticated, false);
    const manifestBytes = read(`${candidate.path}/package.json`);
    const manifest = JSON.parse(manifestBytes);
    const published = JSON.parse(read(`${candidate.publishedPath}/package.json`));
    assert.equal(`${manifest.name}@${manifest.version}`, candidate.repo);
    assert.equal(manifest.gitHead, candidate.packageGitHead);
    assert.equal(published.gitHead, candidate.packageGitHead);
    assert.equal(hash(manifestBytes), candidate.manifestSha256);
    assert.equal(mapping.compatibility.basis.find(item => item.kind === 'editable-source').status, 'observed');
    assert.ok(mapping.source.reason.includes(candidate.path));
    assert.equal(mapping.source.status, 'missing');
    assert.equal(mapping.build.status, 'missing-receipt');
    assert.equal(mapping.status, 'blocked');
  }
});

for (const candidate of candidates.candidates) {
  test(`${candidate.repo} candidate source fingerprint and published differences are current`, () => {
    const source = fingerprintDirectory(WORKSPACE, `${candidate.path}/src`);
    const published = fingerprintDirectory(WORKSPACE, `${candidate.publishedPath}/src`);
    assert.equal(candidate.sourceTree.fingerprintKind, 'src-relative-file-set');
    assert.equal(source.fingerprint, candidate.sourceTree.fingerprint);
    assert.equal(source.files, candidate.sourceTree.files);
    assert.equal(source.bytes, candidate.sourceTree.bytes);
    assert.equal(published.fingerprint, candidate.sourceTree.publishedFingerprint);
    assert.equal(source.entries.filter(entry =>
      /\.[jt]sx?$/.test(entry.path) && !/\.d\.ts$/.test(entry.path),
    ).length, candidate.sourceTree.implementationFiles);
    assert.deepEqual(source.entries.map(entry => entry.path), published.entries.map(entry => entry.path));
    const upstream = new Map(published.entries.map(entry => [entry.path, entry.sha256]));
    assert.deepEqual(source.entries.filter(entry => upstream.get(entry.path) !== entry.sha256)
      .map(entry => entry.path), candidate.sourceTree.publishedDifferences);
  });
}

test('ai-code standalone receipt verifies without rebuilding and differs from the mapping deployment', () => {
  const candidate = candidates.candidates.find(item =>
    item.repo === '@ibiz-template-plugin/ai-code@0.0.3-alpha.141');
  const receipt = JSON.parse(read(candidate.build.receiptPath));
  assert.equal(candidate.build.status, 'candidate-receipt-passed');
  assert.equal(validateBuildReceipt(receipt).valid, true);
  assert.equal(receipt.sourceFingerprint, candidate.build.sourceFingerprint);
  assert.equal(receipt.outputFingerprint, candidate.build.outputFingerprint);
  assert.equal(receipt.inputs.length, candidate.build.inputs);
  assert.equal(receipt.outputs.length, candidate.build.outputs);
  assert.match(execFileSync(process.execPath, ['record-build.mjs', '--verify'], {
    cwd: join(WORKSPACE, candidate.path), encoding: 'utf8', timeout: 30_000,
  }), /Verified @ibiz-template-plugin\/ai-code@0\.0\.3-alpha\.141:/);
  const mapping = loadMigrationContract().migrationMappings.find(item => item.from === candidate.from);
  const target = mapping.target.artifact.path;
  const missing = receipt.outputs.filter(entry => !existsSync(join(WORKSPACE, target, entry.path)));
  const changed = receipt.outputs.filter(entry =>
    existsSync(join(WORKSPACE, target, entry.path)) && hash(read(`${target}/${entry.path}`)) !== entry.sha256);
  assert.equal(receipt.outputs.length, candidate.build.targetComparison.comparedOutputs);
  assert.equal(missing.length, candidate.build.targetComparison.missingOutputs);
  assert.deepEqual(changed.map(entry => entry.path), candidate.build.targetComparison.changedOutputs);
});

test('model-design records its runtime-model source dependency instead of a fabricated build receipt', () => {
  const candidate = candidates.candidates.find(item =>
    item.repo === '@ibiz-template-plugin/model-design@0.0.3-alpha.122');
  const manifest = JSON.parse(read(`${candidate.path}/package.json`));
  const dependency = '@ibiz-template-plugin/runtime-model';
  assert.equal(`${dependency}@${manifest.dependencies[dependency]}`, candidate.build.requiredSourceDependency);
  assert.match(read(`${candidate.path}/src/index.ts`).toString(), /@ibiz-template-plugin\/runtime-model\/loader/);
  assert.equal(candidate.build.status, 'missing-receipt');
  assert.equal(candidate.build.receiptPath, null);
});

test('model-design build-path documentation matches declared tooling and missing local inputs', () => {
  const candidate = candidates.candidates.find(item =>
    item.repo === '@ibiz-template-plugin/model-design@0.0.3-alpha.122');
  const manifest = JSON.parse(read(`${candidate.path}/package.json`));
  const config = createRequire(import.meta.url)(join(WORKSPACE, candidate.path, 'ibiz.config.cjs'));
  const document = read('scripts/docs/NATIVE-PLUGIN-SOURCE-AUDIT.md').toString();
  for (const script of ['typecheck', 'build']) {
    assert.ok(document.includes(`\`${manifest.scripts[script]}\``), script);
  }
  assert.ok(document.includes(`\`@ibiz-template/cli@${manifest.devDependencies['@ibiz-template/cli']}\``));
  for (const tool of ['typescript', 'vue-tsc']) {
    assert.ok(document.includes(`\`${tool}\` range \`${manifest.devDependencies[tool]}\``), tool);
  }
  assert.equal(config.external('@ibiz-template-plugin/runtime-model/loader'), true);
  assert.equal(config.bundles[0].output[0].format, 'system');
  assert.equal(config.bundles[0].output[0].dir, 'dist');
  assert.equal(config.bundles[0].output[0].entryFileNames, '[name].system.min.js');
  for (const input of [
    'node_modules', 'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'src/assets',
  ]) {
    assert.equal(existsSync(join(WORKSPACE, candidate.path, input)), false, input);
  }
  for (const [name, path] of [
    ['@ibiz-template/core', 'ibiz-app-hub/packages/core'],
    ['@ibiz-template/model-helper', 'ibiz-app-hub/packages/model-helper'],
    ['@ibiz-template/runtime', 'ibiz-app-hub/packages/runtime'],
    ['@ibiz-template/vue3-util', 'ibiz-app-hub/packages/vue3-util'],
    ['@ibiz/model-core', 'ibiz-app-hub/models/model-core'],
  ]) {
    const local = JSON.parse(read(`${path}/package.json`));
    assert.equal(local.name, name, path);
    assert.ok(document.includes(
      `| \`${name}\` | \`${manifest.dependencies[name]}\` | \`${local.version}\` |`,
    ), name);
  }
});

test('candidate handoff preserves pinned original model inputs without accepting a migration', () => {
  const contract = loadMigrationContract();
  const document = read('scripts/docs/NATIVE-PLUGIN-SOURCE-AUDIT.md').toString();
  assert.equal(contract.migrationPolicy.statusForUse, 'verified-only');
  assert.equal(contract.migrationMappings.length, 11);
  assert.ok(document.includes('proposed handoff checklist, not an implemented or tested'));
  assert.ok(document.includes('`verified-only`'));
  for (const [app, evidence] of Object.entries(contract.evidence.applications)) {
    const bytes = read(`${contract.evidence.modelRoot}/PSSYSAPPS/${app}/PSSYSAPP.json`);
    const model = JSON.parse(bytes);
    assert.equal(hash(bytes), evidence.inputSha256, app);
    assert.equal(bytes.length, evidence.bytes, app);
    assert.ok(document.includes(`| ${app} | \`${evidence.inputSha256}\` | ${evidence.bytes} |`), app);
    for (const reference of evidence.references) {
      for (const location of reference.locations) {
        const actual = location.split('/').slice(1).reduce((node, key) =>
          node[key.replace(/~1/g, '/').replace(/~0/g, '~')], model);
        assert.equal(actual, reference.repo, `${app}:${location}`);
      }
    }
  }
  for (const mapping of contract.migrationMappings) {
    const checked = validateMigrationMapping(mapping);
    assert.equal(checked.valid, true, `${mapping.from}: ${checked.blockers.join(', ')}`);
    assert.equal(checked.ready, false, mapping.from);
    assert.equal(mapping.status, 'blocked', mapping.from);
  }
});

test('both version maps match local model API versions and retain runtime-model blockers', () => {
  for (const path of [
    'plm-web/docs/ibiz-local-version-map.md', 'modelingweb/docs/ibiz-local-version-map.md',
  ]) {
    const document = read(path).toString();
    for (const folder of ['model-core', 'rt-model-api']) {
      const manifest = JSON.parse(read(`ibiz-app-hub/models/${folder}/package.json`));
      const row = document.split('\n').find(line => line.startsWith(`| \`${manifest.name}\` |`));
      assert.ok(row, `${path}: ${manifest.name}`);
      assert.ok(row.includes(`\`${manifest.version}\``), `${path}: ${manifest.name}`);
      assert.ok(row.includes(`ibiz-app-hub/models/${folder}`), `${path}: ${manifest.name}`);
    }
    assert.ok(document.includes('`@ibiz-template-plugin/runtime-model@0.2.2`'), path);
    assert.ok(document.includes('17 个 JSON'), path);
    assert.ok(document.includes('不代表资源或原生功能验收通过'), path);
    assert.ok(document.includes('独立候选版本迁移生成器'), path);
  }
});

test('embedded runtime-model evidence is compiled output, not complete source or accepted migration evidence', () => {
  const candidate = candidates.candidates.find(item =>
    item.repo === '@ibiz-template-plugin/model-design@0.0.3-alpha.122');
  const mapping = loadMigrationContract().migrationMappings.find(item => item.from === candidate.from);
  const path = `${mapping.target.artifact.path}/es/node_modules/.pnpm/` +
    '@ibiz-template-plugin_runtime-model@0.2.2_@stencil_store@2.0.16/node_modules/' +
    '@ibiz-template-plugin/runtime-model';
  const runtime = fingerprintDirectory(WORKSPACE, path);
  assert.deepEqual(runtime.entries.map(entry => entry.path), [
    'dist/esm/ibiz-model-runtime_4.entry.mjs',
    'dist/esm/index-729ab4d0.mjs',
    'dist/esm/loader.mjs',
    'dist/esm/polyfills/core-js.mjs',
    'dist/esm/polyfills/dom.mjs',
    'dist/esm/polyfills/index.mjs',
    'loader/index.mjs',
  ]);
  assert.equal(runtime.bytes, 278671);
  assert.equal(runtime.fingerprint, 'b8e6ea99941967181c723b693d56f64a00db3777ffd2b521fa1692a00973eae3');
  for (const input of ['package.json', 'src', 'stencil.config.ts', 'tsconfig.json']) {
    assert.equal(existsSync(join(WORKSPACE, path, input)), false, input);
  }
  assert.equal(mapping.source.status, 'missing');
  assert.equal(mapping.build.status, 'missing-receipt');
  assert.equal(mapping.runtime.status, 'not-verified');
  assert.equal(mapping.status, 'blocked');
  const document = read('scripts/docs/NATIVE-PLUGIN-SOURCE-AUDIT.md').toString();
  assert.ok(document.includes(path));
  assert.ok(document.includes(runtime.fingerprint));
});

test('model-design runtime snapshots retain the 17 recorded parse blockers and missing candidate inputs', () => {
  const candidate = candidates.candidates.find(item =>
    item.repo === '@ibiz-template-plugin/model-design@0.0.3-alpha.122');
  const mapping = loadMigrationContract().migrationMappings.find(item => item.from === candidate.from);
  const expectedInvalid = [
    'IPSAPPDATAENTITY.json',
    'IPSAPPVIEW.json',
    'IPSAPPVIEWBASE.json',
    'IPSCODEPUBLISHERCONTEXT.json',
    'IPSDBPORTLETPART.json',
    'IPSDEACTION.json',
    'IPSDEFIELD.json',
    'IPSDEFORM.json',
    'IPSDEFORMDETAIL.json',
    'IPSDELOGICNODEPARAM.json',
    'IPSDER1NDEFIELDMAP.json',
    'IPSLISTITEM.json',
    'IPSPANELITEM.json',
    'IPSPANELLOGICNODEPARAM.json',
    'IPSSUBSYSSERVICEAPIMETHOD.json',
    'IPSSYSTEMSETTING.json',
    'IPSUIACTION.json',
  ];
  const document = read('scripts/docs/NATIVE-PLUGIN-SOURCE-AUDIT.md').toString();
  const snapshots = ['dist', 'es'].map(format => {
    const path = `${mapping.target.artifact.path}/${format}/assets/json/runtime-model`;
    const snapshot = fingerprintDirectory(WORKSPACE, path);
    assert.equal(snapshot.files, 1414, path);
    assert.equal(snapshot.bytes, 1634535, path);
    assert.equal(snapshot.fingerprint, '138c8f08d260037c0687cf2c255d85f27a2d02a82f234d2c9414ba2356155797');
    const invalid = [];
    for (const entry of snapshot.entries) {
      assert.ok(entry.path.endsWith('.json'), entry.path);
      try {
        JSON.parse(read(`${path}/${entry.path}`));
      } catch (error) {
        assert.ok(error instanceof SyntaxError, entry.path);
        invalid.push(entry.path);
      }
    }
    assert.deepEqual(invalid, expectedInvalid, path);
    assert.equal(snapshot.files - invalid.length, 1397, path);
    assert.ok(document.includes(path));
    assert.ok(document.includes(snapshot.fingerprint));
    return snapshot;
  });
  for (const path of expectedInvalid) assert.ok(document.includes(`\`${path}\``), path);
  assert.ok(document.includes('`17/1414`'));
  assert.deepEqual(snapshots[0].entries, snapshots[1].entries);
  assert.equal(existsSync(join(WORKSPACE, candidate.path, 'src/assets')), false);
  assert.equal(mapping.status, 'blocked');
  assert.equal(mapping.runtime.status, 'not-verified');
});

test('the 17 malformed runtime resources have only 46 quoted raw LF defects per snapshot', () => {
  const candidate = candidates.candidates.find(item =>
    item.repo === '@ibiz-template-plugin/model-design@0.0.3-alpha.122');
  const mapping = loadMigrationContract().migrationMappings.find(item => item.from === candidate.from);
  const expectedCounts = {
    'IPSAPPDATAENTITY.json': 2,
    'IPSAPPVIEW.json': 2,
    'IPSAPPVIEWBASE.json': 2,
    'IPSCODEPUBLISHERCONTEXT.json': 2,
    'IPSDBPORTLETPART.json': 2,
    'IPSDEACTION.json': 2,
    'IPSDEFIELD.json': 2,
    'IPSDEFORM.json': 4,
    'IPSDEFORMDETAIL.json': 4,
    'IPSDELOGICNODEPARAM.json': 2,
    'IPSDER1NDEFIELDMAP.json': 2,
    'IPSLISTITEM.json': 2,
    'IPSPANELITEM.json': 6,
    'IPSPANELLOGICNODEPARAM.json': 2,
    'IPSSUBSYSSERVICEAPIMETHOD.json': 2,
    'IPSSYSTEMSETTING.json': 6,
    'IPSUIACTION.json': 2,
  };
  const document = read('scripts/docs/NATIVE-PLUGIN-SOURCE-AUDIT.md').toString();
  for (const [file, count] of Object.entries(expectedCounts)) {
    assert.ok(document.includes(`| \`${file}\` | ${count} |`), file);
  }
  for (const format of ['dist', 'es']) {
    const path = `${mapping.target.artifact.path}/${format}/assets/json/runtime-model`;
    const before = fingerprintDirectory(WORKSPACE, path);
    let total = 0;
    for (const entry of before.entries) {
      const text = read(`${path}/${entry.path}`).toString('utf8');
      const controls = [];
      let quoted = false;
      let escaped = false;
      // Locate controls lexically; JSON.parse remains the syntax validator.
      for (let offset = 0; offset < text.length; offset++) {
        const character = text[offset];
        if (quoted && escaped) {
          escaped = false;
          continue;
        }
        if (quoted && character === '\\') {
          escaped = true;
          continue;
        }
        if (character === '"') quoted = !quoted;
        else if (quoted && text.charCodeAt(offset) < 32) {
          assert.equal(character, '\n', `${format}/${entry.path}:${offset}`);
          controls.push(offset);
        }
      }
      assert.equal(controls.length, expectedCounts[entry.path] ?? 0, `${format}/${entry.path}`);
      total += controls.length;
      if (controls.length) {
        assert.throws(() => JSON.parse(text), SyntaxError, entry.path);
        if (entry.path === 'IPSAPPDATAENTITY.json') assert.equal(controls[0], 9549);
      }
      let diagnostic = text;
      for (const offset of [...controls].reverse()) {
        diagnostic = `${diagnostic.slice(0, offset)}\\n${diagnostic.slice(offset + 1)}`;
      }
      assert.doesNotThrow(() => JSON.parse(diagnostic), `${format}/${entry.path}`);
    }
    assert.equal(total, 46, format);
    assert.deepEqual(fingerprintDirectory(WORKSPACE, path), before, format);
  }
  assert.equal(mapping.source.status, 'missing');
  assert.equal(mapping.build.status, 'missing-receipt');
  assert.equal(mapping.runtime.status, 'not-verified');
  assert.equal(mapping.status, 'blocked');
});

test('native source audit documents the checked mapping versions and current fingerprints', () => {
  const document = read('scripts/docs/NATIVE-PLUGIN-SOURCE-AUDIT.md').toString();
  const contract = loadMigrationContract();
  for (const mapping of contract.migrationMappings) {
    assert.ok(document.includes(`\`${mapping.from}\``), mapping.from);
    if (mapping.target.repo) assert.ok(document.includes(`\`${mapping.target.repo}\``), mapping.target.repo);
    if (mapping.source.fingerprint) assert.ok(document.includes(mapping.source.fingerprint), mapping.from);
    if (mapping.target.artifact) assert.ok(document.includes(mapping.target.artifact.fingerprint), mapping.from);
  }
  for (const candidate of candidates.candidates) {
    assert.ok(document.includes(candidate.sourceTree.fingerprint));
    assert.ok(document.includes(candidate.packageGitHead));
    if (candidate.build.sourceFingerprint) {
      assert.ok(document.includes(candidate.build.sourceFingerprint));
      assert.ok(document.includes(candidate.build.outputFingerprint));
    }
  }
});
