import assert from 'node:assert/strict';
import test from 'node:test';
import { planOwnedMarketplaceOffline } from '../prepare-owned-marketplace-offline.mjs';

test('real form-design candidate binds exact source/model/package identities and keeps missing offline inputs blocked', () => {
  const value = planOwnedMarketplaceOffline({ catalogId: 'BASE.ibizmodeling.formdesign.formdesign' });
  assert.equal(value.status, 'blocked-local-inputs-incomplete');
  assert.equal(value.catalogEntries, 23);
  assert.equal(value.hostCatalogEntries, 23);
  assert.equal(value.product.productId, 'formdesign');
  assert.equal(value.product.hostPluginId, 'formdesign');
  assert.match(value.source.revision, /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
  assert.equal(value.source.authenticityVerified, false);
  assert.equal(value.source.licenseReviewAccepted, false);
  assert.ok(value.candidateFiles.license?.sha256 && value.candidateFiles.readme?.sha256);
  assert.ok(value.appModels.length > 0);
  assert.ok(value.runtimePackages.length > 0);
  assert.ok(value.runtimePackages.every(row => row.status === 'missing-explicit-local-package-input'));
  assert.ok(value.blockers.some(reason => reason.includes('catalog icon')));
  assert.equal(value.bundleCreated, false);
  assert.equal(value.installExecuted, false);
  assert.equal(value.nativeMarketplaceAcceptance, false);
  assert.equal(value.all23CatalogsAccepted, false);
});

test('unknown official catalog and duplicate runtime package declarations are rejected', () => {
  assert.throws(() => planOwnedMarketplaceOffline({ catalogId: 'unknown' }), /Unknown official catalog ID/);
  const value = planOwnedMarketplaceOffline({ catalogId: 'BASE.ibizmodeling.formdesign.formdesign' });
  assert.throws(() => planOwnedMarketplaceOffline({
    catalogId: 'BASE.ibizmodeling.formdesign.formdesign',
    runtimePackageDirectories: [
      { repo: value.runtimePackages[0].repo, path: 'one' },
      { repo: value.runtimePackages[0].repo, path: 'two' },
    ],
  }), /Duplicate exact runtime package input/);
});
