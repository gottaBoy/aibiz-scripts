import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  packageOwnedMarketplaceOffline, renderLocalDeliveryChangelog,
} from '../package-owned-marketplace-offline.mjs';
import { verifyOfflineMarketplaceBundle } from '../owned-marketplace-offline.mjs';

const workspace = resolve(import.meta.dirname, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('delivery changelog is deterministic, source-bound and explicitly local rather than upstream', () => {
  const input = { catalogId: 'EXTENSION.ibizmodeling.modelperspectivetool',
    revision: 'd0ef3450691bf8833b51c40bd97001bd2e8aff6e', tree: 'a'.repeat(40),
    committedAt: '2025-03-31T20:03:46+08:00', subject: 'exact source subject', version: '1.0.0.0-local.1' };
  const first = renderLocalDeliveryChangelog(input);
  assert.deepEqual(first, renderLocalDeliveryChangelog({ ...input }));
  assert.match(first.toString(), /not an upstream CHANGELOG/);
  assert.match(first.toString(), /local-delivery-record-v1/);
  assert.ok(first.includes(Buffer.from(input.revision)));
  assert.notEqual(hash(first), hash(renderLocalDeliveryChangelog({ ...input, version: '1.0.0.0-local.2' })));
});

test('unsafe revision, unbound icon proof and unsupported outputs fail before creating a source candidate', () => {
  const output = join(workspace, '.artifacts/owned-marketplace-packages/ffffffffffff/must-not-exist');
  assert.equal(fs.existsSync(output), false);
  const input = { workspace, catalogId: 'EXTENSION.ibizmodeling.modelperspectivetool',
    revision: 'd0ef3450691bf8833b51c40bd97001bd2e8aff6e', version: '1.0.0.0-local.test',
    iconReceiptPath: 'not-a-receipt', iconReceiptSha256: 'a'.repeat(64), outputPath: output };
  assert.throws(() => packageOwnedMarketplaceOffline({ ...input, revision: '--all' }));
  assert.throws(() => packageOwnedMarketplaceOffline({ ...input, iconReceiptSha256: 'latest' }));
  assert.throws(() => packageOwnedMarketplaceOffline({ ...input, catalogId: 'unknown' }), /official source checkout/);
  assert.equal(fs.existsSync(output), false);
});

test('an explicitly supplied real official package retains exact source/model/icon and native ZIP bindings',
  { skip: !process.env.AIBIZ_OFFICIAL_MARKETPLACE_PACKAGE }, () => {
    const root = resolve(workspace, process.env.AIBIZ_OFFICIAL_MARKETPLACE_PACKAGE);
    const report = JSON.parse(fs.readFileSync(join(root, 'package-report.private.json')));
    const value = verifyOfflineMarketplaceBundle({
      workspace, bundlePath: join(root, 'bundle'), manifestSha256: report.manifestSha256,
    });
    const provenance = JSON.parse(fs.readFileSync(join(root, 'bundle/payload/provenance.json')));
    assert.equal(value.manifest.catalogId, 'EXTENSION.ibizmodeling.modelperspectivetool');
    assert.equal(value.manifest.source.revision, 'd0ef3450691bf8833b51c40bd97001bd2e8aff6e');
    assert.equal(provenance.sourceFiles.length, 2310);
    assert.equal(provenance.modelFiles.length, 2301);
    assert.deepEqual(provenance.exactExternalRuntimeReferences, []);
    assert.equal(provenance.modelPluginReferenceInputs.length, 3);
    assert.equal(provenance.frontendHostAssetsBound, false);
    assert.equal(provenance.nativeModelZipFormatVerified, true);
    assert.equal(provenance.nativeParser.systemName, 'ModelPerspectiveTool');
    assert.deepEqual(provenance.nativeParser.applications, { ModelPerspectiveTool: 0 });
    assert.equal(provenance.nativeInstallationExecuted, false);
    assert.equal(provenance.nativeMarketplaceAcceptance, false);
    assert.equal(provenance.upstreamReleaseClaimed, false);
    assert.equal(provenance.generator.sha256,
      hash(fs.readFileSync(join(workspace, provenance.generator.path))));
    assert.equal(provenance.nativeProbeSource.sha256,
      hash(fs.readFileSync(join(workspace, provenance.nativeProbeSource.path))));
    assert.equal(provenance.icon.sha256,
      hash(fs.readFileSync(join(root, 'bundle/payload/assets/icon.png'))));
    assert.equal(report.commands.length, 3);
    assert.ok(report.commands.every(command => command.status === 0));
    assert.match(provenance.nativeConsumer.contract, /V2SystemSource\.ossfile/);
  });
