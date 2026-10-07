import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { loadMigrationContract, WORKSPACE } from '../harness-modeling-core-audit.mjs';
import { runAiCodeSourceDepsHarness } from '../harness-native-ai-code-source-deps.mjs';
import { readTree } from '../native-candidate-files.mjs';
import { prepareNativeAiCodeDeployment } from '../prepare-native-ai-code-deployment.mjs';
import { prepareNativeModelCandidate } from '../prepare-native-model-candidate.mjs';
import {
  deploymentFixture, fixtureSnapshot, hash, json,
} from './helpers/native-ai-code-source-deps-fixture.mjs';

const requested = '@ibiz-template-plugin/ai-code@0.0.3-alpha.92';
const candidate = '@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
const applications = ['Central', 'ModelDesign'];
const modelFiles = ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json'];
const tree = root => readTree(root, { jsonOnly: false });
const snapshots = roots => roots.map(fixtureSnapshot);
const effectiveMode = path => fs.lstatSync(path).mode & 0o7777;

function integrationFixture(t) {
  const source = deploymentFixture(t);
  const originalRoots = [source.hub, source.source, source.published];
  const originalsBefore = snapshots(originalRoots);
  const build = runAiCodeSourceDepsHarness(source);
  assert.equal(build.exitCode, 2, build.report.errors.join('\n'));
  assert.equal(build.report.runtimeSourceBuildsVerified, true);
  assert.equal(build.report.aiCodeSourceBuildVerified, true);
  assert.equal(build.report.toolchainSourceVerified, false);
  assert.equal(build.report.sourceRepositoryAuthenticityVerified, false);
  assert.equal(build.report.originalVersionReproductionVerified, false);
  assert.equal(build.report.acceptedForProduction, false);
  const deploymentOutput = join(source.workspace, '.artifacts/native-ai-code-deployment/candidate');
  const deployment = prepareNativeAiCodeDeployment({
    workspace: source.workspace, output: deploymentOutput, sourceReport: build.reportPath,
  });

  const originalContract = loadMigrationContract(WORKSPACE);
  const contract = structuredClone(originalContract);
  // Missing evidence avoids importing any real published target into this fixture.
  const missingMapping = contract.migrationMappings.find(mapping =>
    mapping.from.startsWith('@ibiz-template-plugin/console-terminal@'));
  const missingPlugin = contract.plugins.find(plugin =>
    plugin.repo.startsWith('@ibiz-template-plugin/console-terminal@'));
  assert.ok(missingMapping && missingPlugin);
  contract.migrationMappings = [{ ...structuredClone(missingMapping), from: requested }];
  contract.plugins = [{ ...structuredClone(missingPlugin), repo: requested }];
  assert.equal(contract.migrationMappings[0].target.status, 'missing');
  assert.equal(contract.migrationMappings[0].target.repo, null);
  assert.equal(contract.migrationMappings[0].target.artifact, null);

  const modelRoot = join(source.workspace, contract.evidence.modelRoot);
  const originals = [];
  for (const application of applications) {
    for (const name of modelFiles) {
      const path = `PSSYSAPPS/${application}/${name}`;
      const model = {
        codeName: application,
        dynaModelFilePath: path,
        getAllPSAppPFPluginRefs: [{
          id: 'ai-code', rTObjectRepo: requested, note: requested,
        }],
        cache: { fixture: true, requestedIdentity: requested },
        note: `Synthetic ${application} ${name}`,
      };
      json(join(modelRoot, path), model);
      const bytes = fs.readFileSync(join(modelRoot, path));
      originals.push({ application, path, model, bytes });
      if (name === 'PSSYSAPP.json') {
        contract.evidence.applications[application] = {
          ...contract.evidence.applications[application],
          inputSha256: hash(bytes), bytes: bytes.length,
          references: [{
            repo: requested, locations: ['/getAllPSAppPFPluginRefs/0/rTObjectRepo'],
          }],
        };
      }
    }
  }
  const contractPath = join(source.workspace, 'scripts/fixtures/modeling-core-migration-contract.json');
  json(contractPath, contract);
  assert.deepEqual(contract.migrationPolicy, originalContract.migrationPolicy);
  assert.deepEqual(loadMigrationContract(source.workspace), contract);
  const nginxPath = join(source.workspace, 'modelingweb/nginx-native.conf');
  fs.mkdirSync(dirname(nginxPath), { recursive: true });
  fs.copyFileSync(join(WORKSPACE, 'modelingweb/nginx-native.conf'), nginxPath);
  const output = join(source.workspace, '.artifacts/native-model-migration/integrated');
  fs.mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const protectedRoots = [modelRoot, contractPath, nginxPath, build.destination, deploymentOutput];
  return {
    source, build, deployment, deploymentOutput, contract, contractPath, modelRoot, nginxPath,
    output, originals, originalRoots, originalsBefore,
    protectedRoots, protectedBefore: snapshots(protectedRoots),
    options: {
      workspace: source.workspace, output,
      aiCodeDeploymentReceipt: join(deploymentOutput, 'receipt.json'),
      aiCodeSourceDepsReport: build.reportPath,
    },
  };
}

function assertIntegratedCandidate(data) {
  const receipt = prepareNativeModelCandidate(data.options);
  const pluginRoot = join(data.output, 'plugins', candidate);
  const copied = tree(pluginRoot);
  const staged = data.build.report.sources.find(source => source.id === 'ai-code');
  const step = data.build.report.steps.find(step => step.id === 'ai-code');
  const manifest = staged.entries.find(entry => entry.path === 'package.json');
  const expectedEntries = [...step.outputs.entries, manifest]
    .sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(copied.entries, expectedEntries);
  assert.deepEqual(copied.entries, data.deployment.deployment.entries);
  assert.equal(copied.fingerprint, data.deployment.deployment.fingerprint);
  for (const entry of expectedEntries) {
    assert.deepEqual(fs.readFileSync(join(pluginRoot, entry.path)),
      fs.readFileSync(join(staged.staged, entry.path)), entry.path);
  }
  assert.deepEqual(fs.readFileSync(join(pluginRoot, 'package.json')),
    fs.readFileSync(join(data.source.source, 'package.json')));
  const packageJson = JSON.parse(fs.readFileSync(join(pluginRoot, 'package.json')));
  assert.equal(`${packageJson.name}@${packageJson.version}`, candidate);
  assert.deepEqual(fs.readdirSync(join(data.output, 'plugins')), ['@ibiz-template-plugin']);
  assert.deepEqual(fs.readdirSync(join(data.output, 'plugins/@ibiz-template-plugin')),
    ['ai-code@0.0.3-alpha.141']);
  assert.equal(fs.existsSync(join(data.output, 'plugins', requested)), false);
  assert.equal(fs.existsSync(join(data.deploymentOutput, 'plugins', requested)), false);

  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.contract, 'native-modeling-source-backed-candidate');
  assert.equal(receipt.status, 'prepared-not-accepted');
  assert.equal(receipt.acceptedForProduction, false);
  assert.equal(receipt.sourceModelRoot, data.contract.evidence.modelRoot);
  assert.deepEqual(receipt.unresolvedMappings, []);
  assert.equal(receipt.plugins.length, 1);
  const plugin = receipt.plugins[0];
  assert.equal(plugin.from, requested);
  assert.equal(plugin.to, candidate);
  assert.equal(plugin.sourcePath, relative(data.source.workspace, data.source.source));
  assert.equal(plugin.sourceStatus, 'published-source-with-recorded-local-fixes');
  assert.equal(plugin.sourceFingerprint, data.deployment.source.fingerprint);
  assert.equal(plugin.buildOutputFingerprint, step.outputs.fingerprint);
  assert.equal(plugin.outputFingerprint, copied.fingerprint);
  assert.equal(plugin.buildCommand, data.deployment.build.command);
  assert.equal(plugin.ibizDependencySourceBuildsVerified, true);
  assert.equal(plugin.toolchainSourceBuildsVerified, false);
  assert.equal(plugin.originalRepositoryAuthenticated, false);
  assert.equal(plugin.acceptedForProduction, false);
  assert.equal(plugin.compatibility, 'not-verified');
  assert.deepEqual(plugin.sourceDependencies, data.deployment.dependencies.sourceBuildEvidence);
  assert.equal(plugin.sourceDependencies.reportSha256, hash(fs.readFileSync(data.build.reportPath)));
  assert.deepEqual(plugin.deploymentReceipt, {
    path: relative(data.source.workspace, data.options.aiCodeDeploymentReceipt),
    sha256: hash(fs.readFileSync(data.options.aiCodeDeploymentReceipt)),
  });
  assert.equal(data.deployment.acceptedForProduction, false);
  assert.equal(data.deployment.originalRepositoryAuthenticated, false);
  assert.equal(data.deployment.dependencies.ibizDependencySourceBuildsVerified, true);
  assert.equal(data.deployment.dependencies.toolchainSourceBuildsVerified, false);
  assert.ok(receipt.remainingAcceptance.includes('native plugin runtime compatibility'));
  assert.ok(receipt.remainingAcceptance.includes('native editor operations and model save'));
  assert.ok(receipt.remainingAcceptance.includes('fresh-session model readback'));

  assert.deepEqual(Object.keys(receipt.applications).sort(), [...applications].sort());
  for (const application of applications) {
    assert.equal(receipt.applications[application].files.length, modelFiles.length);
  }
  assert.equal(data.originals.length, 6);
  for (const original of data.originals) {
    const bytes = fs.readFileSync(join(data.output, 'model', original.path));
    const expected = structuredClone(original.model);
    expected.getAllPSAppPFPluginRefs[0].rTObjectRepo = candidate;
    assert.deepEqual(JSON.parse(bytes), expected, original.path);
    const file = receipt.applications[original.application].files.find(file =>
      file.path === original.path);
    assert.ok(file, original.path);
    assert.equal(file.inputSha256, hash(original.bytes));
    assert.equal(file.outputSha256, hash(bytes));
    assert.deepEqual(file.changes, [{
      location: '/getAllPSAppPFPluginRefs/0/rTObjectRepo', from: requested, to: candidate,
    }]);
    assert.deepEqual(file.unresolved, []);
    assert.deepEqual(fs.readFileSync(join(data.modelRoot, original.path)), original.bytes);
  }
  const nginx = fs.readFileSync(join(data.output, 'nginx-native.conf'));
  assert.equal(receipt.nginx.inputSha256, hash(fs.readFileSync(data.nginxPath)));
  assert.equal(receipt.nginx.outputSha256, hash(nginx));
  assert.match(nginx.toString(), /location \^~ \/nativeappcode\/plugins\/ \{/);
  assert.match(nginx.toString(), /alias \/opt\/aibiz\/native-candidate-plugins\/;/);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(data.output, 'receipt.json'))), receipt);
  const expectedFiles = [
    'nginx-native.conf', 'receipt.json',
    ...data.originals.map(original => `model/${original.path}`),
    ...expectedEntries.map(entry => `plugins/${candidate}/${entry.path}`),
  ].sort();
  assert.deepEqual(tree(data.output).entries.map(entry => entry.path).sort(), expectedFiles);
  assert.deepEqual(snapshots(data.originalRoots), data.originalsBefore);
  assert.deepEqual(snapshots(data.protectedRoots), data.protectedBefore);
}

test('ai-code-only model candidate integrates the verified deployment and six models without input mutation', t => {
  assertIntegratedCandidate(integrationFixture(t));
});

test('ai-code integration under umask 0077 publishes only the candidate tree as 0755/0644', t => {
  const previousMask = process.umask(0o077);
  try {
    const data = integrationFixture(t);
    const privateParents = [
      data.source.workspace,
      join(data.source.workspace, '.artifacts'),
      dirname(data.output),
      dirname(data.build.destination),
      data.build.destination,
      dirname(data.deploymentOutput),
      data.deploymentOutput,
      data.modelRoot,
      data.source.source,
    ];
    for (const path of privateParents) assert.equal(effectiveMode(path), 0o700, path);
    const parentModes = privateParents.map(effectiveMode);
    assert.equal(effectiveMode(data.contractPath), 0o600);
    assert.equal(effectiveMode(data.build.reportPath), 0o600);
    assert.equal(effectiveMode(data.options.aiCodeDeploymentReceipt), 0o600);
    assertIntegratedCandidate(data);
    for (const entry of fixtureSnapshot(data.output)) {
      assert.equal(entry.target, undefined, entry.path);
      assert.equal(effectiveMode(join(data.output, entry.path)),
        entry.directory ? 0o755 : 0o644, entry.path || 'candidate root');
    }
    assert.deepEqual(privateParents.map(effectiveMode), parentModes);
    assert.equal(process.umask(), 0o077);
  } finally {
    process.umask(previousMask);
  }
});
