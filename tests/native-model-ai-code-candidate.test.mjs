import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runAiCodeSourceDepsHarness } from '../harness-native-ai-code-source-deps.mjs';
import { prepareNativeAiCodeDeployment } from '../prepare-native-ai-code-deployment.mjs';
import {
  prepareNativeModelCandidate, readAiCodeModelCandidate, rewritePluginReferences,
} from '../prepare-native-model-candidate.mjs';
import {
  deploymentFixture, fixtureSnapshot, hash, json,
} from './helpers/native-ai-code-source-deps-fixture.mjs';

function fixture(t) {
  const source = deploymentFixture(t);
  const build = runAiCodeSourceDepsHarness(source);
  assert.equal(build.exitCode, 2, build.report.errors.join('\n'));
  const output = join(source.workspace, '.artifacts/native-ai-code-deployment/candidate');
  const deployment = prepareNativeAiCodeDeployment({
    workspace: source.workspace, sourceReport: build.reportPath, output,
  });
  return {
    source, build, deployment,
    options: { workspace: source.workspace, receipt: join(output, 'receipt.json'),
      sourceReport: build.reportPath },
  };
}

test('candidate reads exact fresh ai-code deployment with honest version and source evidence, read-only', t => {
  const data = fixture(t);
  const before = fixtureSnapshot(data.source.workspace);
  const candidate = readAiCodeModelCandidate(data.options);
  assert.deepEqual(candidate.files.entries, data.deployment.deployment.entries);
  assert.equal(candidate.files.fingerprint, data.deployment.deployment.fingerprint);
  assert.equal(candidate.plugin.from, '@ibiz-template-plugin/ai-code@0.0.3-alpha.92');
  assert.equal(candidate.plugin.to, '@ibiz-template-plugin/ai-code@0.0.3-alpha.141');
  assert.equal(candidate.plugin.sourceStatus, 'published-source-with-recorded-local-fixes');
  assert.equal(candidate.plugin.ibizDependencySourceBuildsVerified, true);
  assert.equal(candidate.plugin.toolchainSourceBuildsVerified, false);
  assert.equal(candidate.plugin.originalRepositoryAuthenticated, false);
  assert.equal(candidate.plugin.acceptedForProduction, false);
  assert.equal(candidate.plugin.compatibility, 'not-verified');
  assert.equal(candidate.plugin.deploymentReceipt.sha256, hash(fs.readFileSync(data.options.receipt)));
  assert.equal(candidate.plugin.sourceDependencies.reportSha256, hash(fs.readFileSync(data.build.reportPath)));
  assert.ok(candidate.files.entries.every(file => file.path === 'package.json' ||
    /^(dist|es|lib)\//.test(file.path)));
  const manifest = JSON.parse(candidate.files.contents.find(file => file.path === 'package.json').data);
  assert.equal(`${manifest.name}@${manifest.version}`, candidate.plugin.to);
  const model = { rTObjectRepo: candidate.plugin.from, note: candidate.plugin.from };
  const rewritten = rewritePluginReferences(model, new Map([[candidate.plugin.from, candidate.plugin.to]]));
  assert.equal(rewritten.model.rTObjectRepo, candidate.plugin.to);
  assert.equal(rewritten.model.note, candidate.plugin.from);
  assert.deepEqual(fixtureSnapshot(data.source.workspace), before);
});

for (const [name, mutate, pattern] of [
  ['deployment file drift', data => fs.appendFileSync(join(data.source.workspace,
    data.deployment.deployment.path, 'dist/index.system.min.js'), '// drift\n'),
  /Deployment differs/],
  ['deployment receipt alias', data => {
    const receipt = structuredClone(data.deployment);
    receipt.mapping.candidate = receipt.mapping.requested;
    json(data.options.receipt, receipt);
  }, /current audited build/],
  ['dependency output drift', data => fs.appendFileSync(join(
    data.build.report.sources.find(source => source.id === 'core').staged, 'out/index.js'), '// drift\n'),
  /Build output drift: core/],
  ['source report verification forgery', data => {
    const report = structuredClone(data.build.report);
    report.toolchainSourceVerified = true;
    json(data.build.reportPath, report);
  }, /Toolchain source verification claim changed/],
]) {
  test(`candidate refuses ${name} without changing source or evidence`, t => {
    const data = fixture(t);
    mutate(data);
    const before = fixtureSnapshot(data.source.workspace);
    assert.throws(() => readAiCodeModelCandidate(data.options), pattern);
    assert.deepEqual(fixtureSnapshot(data.source.workspace), before);
  });
}

test('candidate refuses incomplete explicit ai-code options without creating output', t => {
  const data = fixture(t);
  for (const options of [
    { receipt: data.options.receipt },
    { sourceReport: data.options.sourceReport },
    {},
  ]) {
    assert.throws(() => readAiCodeModelCandidate({
      workspace: data.source.workspace, ...options,
    }), /requires both/);
  }
});

test('model candidate rejects a one-sided ai-code option before creating its output', () => {
  const output = join(new URL('../../', import.meta.url).pathname,
    '.artifacts/native-model-migration', `test-ai-code-options-${process.pid}`);
  assert.equal(fs.existsSync(output), false);
  for (const options of [
    { aiCodeDeploymentReceipt: 'missing/receipt.json' },
    { aiCodeSourceDepsReport: 'missing/report.json' },
  ]) {
    assert.throws(() => prepareNativeModelCandidate({ output, ...options }), /requires both/);
    assert.equal(fs.existsSync(output), false);
  }
});
