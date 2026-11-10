import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { WORKSPACE } from '../harness-modeling-core-audit.mjs';
import { fingerprint } from '../native-candidate-files.mjs';
import { verifyNativeAiCodeRuntimeAssets } from '../prepare-native-ai-code-runtime-assets.mjs';
import { modelDesignSelection } from '../prepare-native-model-design-candidate.mjs';
import { runtimeBridgeAsset } from '../native-model-design-runtime.mjs';
const sourceAssets = join(WORKSPACE, '.artifacts/native-ai-code-runtime-assets/ide-20261110-r1');
const sourceCandidate = join(WORKSPACE, '.artifacts/native-model-migration/ide-20261110-r3');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => fs.writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

function isolatedEvidence(t) {
  const candidate = fs.mkdtempSync(join(WORKSPACE, '.artifacts/native-model-migration/test-s07-integrity-'));
  const assets = fs.mkdtempSync(join(WORKSPACE, '.artifacts/native-ai-code-runtime-assets/test-s07-integrity-'));
  t.after(() => {
    fs.rmSync(candidate, { recursive: true, force: true });
    fs.rmSync(assets, { recursive: true, force: true });
  });
  fs.cpSync(sourceCandidate, candidate, { recursive: true });
  fs.cpSync(sourceAssets, assets, { recursive: true });
  const receipt = JSON.parse(fs.readFileSync(join(candidate, 'receipt.json')));
  const runtime = JSON.parse(fs.readFileSync(join(assets, 'receipt.json')));
  const persist = () => {
    json(join(candidate, 'receipt.json'), receipt);
    runtime.candidate = {
      path: relative(WORKSPACE, candidate),
      receiptSha256: hash(fs.readFileSync(join(candidate, 'receipt.json'))),
    };
    json(join(assets, 'receipt.json'), runtime);
  };
  persist();
  return { candidate, assets, receipt, runtime, persist };
}

test('unmodified full source candidate verifies before integrity-negative mutations', () => {
  const verified = verifyNativeAiCodeRuntimeAssets({ assets: sourceAssets });
  assert.equal(verified.candidate, sourceCandidate);
  assert.equal(verified.receipt.frontend.contract, 'native-frontend-source-dist-binding-v1');
  assert.ok(verified.receipt.modelDesignRuntime);
  assert.equal(verified.receipt.nativeAccepted, false);
});

test('genuine lifecycle runtime gate rejects changed acceptance even with updated receipt hashes', t => {
  const evidence = isolatedEvidence(t);
  evidence.receipt.nativeAccepted = true;
  evidence.persist();
  assert.throws(() => verifyNativeAiCodeRuntimeAssets({ assets: evidence.assets }),
    /cannot claim native acceptance/);
});

test('genuine lifecycle runtime gate recomputes six model transformations, not only self-recorded hashes', t => {
  const evidence = isolatedEvidence(t);
  const record = evidence.receipt.applications.ModelDesign.files.find(file => file.path.endsWith('PSSYSAPP.simple.json'));
  const path = join(evidence.candidate, 'model', record.path);
  const model = JSON.parse(fs.readFileSync(path));
  model.caption = 'Unverified mutation outside scoped source transformation';
  json(path, model);
  record.outputSha256 = hash(fs.readFileSync(path));
  evidence.persist();
  assert.throws(() => verifyNativeAiCodeRuntimeAssets({ assets: evidence.assets }),
    /differs from the verified source transformation/);
});

test('genuine lifecycle runtime gate rejects missing source report without a synthetic verification flag', t => {
  const evidence = isolatedEvidence(t);
  const plugin = evidence.receipt.plugins.find(plugin => plugin.to === modelDesignSelection.to);
  plugin.sourceBuildReport.path = '.artifacts/native-model-design-local-candidate/missing/report.json';
  plugin.sourceBuildVerified = true;
  plugin.reproducibleBuildVerified = true;
  evidence.persist();
  assert.throws(() => verifyNativeAiCodeRuntimeAssets({ assets: evidence.assets }),
    /Missing|ENOENT/);
});

test('genuine runtime bridge bytes cannot be forged by rewriting their delivery and bridge hashes', t => {
  const evidence = isolatedEvidence(t);
  const path = join(evidence.assets, runtimeBridgeAsset);
  fs.appendFileSync(path, '\nthrow new Error("unverified bridge");\n');
  const bytes = fs.readFileSync(path);
  const entry = evidence.runtime.delivery.entries.find(file => file.path === runtimeBridgeAsset);
  entry.bytes = bytes.length;
  entry.sha256 = hash(bytes);
  Object.assign(evidence.runtime.delivery, fingerprint(evidence.runtime.delivery.entries));
  evidence.runtime.modelDesignRuntime.bridge.sha256 = hash(bytes);
  evidence.persist();
  assert.throws(() => verifyNativeAiCodeRuntimeAssets({ assets: evidence.assets }),
    /runtime evidence drift/);
});
