#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { collectPluginReferences } from './harness-plugin-audit.mjs';
import { directoryCandidate, validateCandidate } from './harness-modeling-core-audit.mjs';
import { parseSystemInserts } from './harness-modeling-extension-inventory.mjs';

const workspaceDefault = resolve(import.meta.dirname, '..');
const inventoryPath = 'scripts/docs/MARKETPLACE-SOURCE-INVENTORY-20261103.json';
const catalogPath = 'modelingweb/app/src/modeling-plugins/catalog.json';
const sqlPath = 'modelingservice/sql/init.sql';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function childPath(workspace, path) {
  const absolute = resolve(workspace, path);
  const child = relative(workspace, absolute);
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'));
  return absolute;
}

export function planOwnedMarketplaceOffline({
  workspace = workspaceDefault, catalogId, runtimePackageDirectories = [],
} = {}) {
  workspace = resolve(workspace);
  assert.equal(typeof catalogId, 'string');
  assert.ok(Array.isArray(runtimePackageDirectories));
  const directories = new PinnedDirectories();
  const inputs = [];
  const read = path => {
    const absolute = childPath(workspace, path);
    const bytes = readPinnedFile(directories, directories.open(dirname(absolute)), basename(absolute)).data;
    inputs.push({ path: relative(workspace, absolute), bytes: bytes.length, sha256: hash(bytes) });
    return bytes;
  };
  try {
    const inventory = JSON.parse(read(inventoryPath));
    assert.equal(inventory.contract, 'marketplace-local-source-observations-v1');
    assert.equal(inventory.entries.length, 23);
    const entry = inventory.entries.find(row => row.catalogId === catalogId);
    assert.ok(entry, 'Unknown official catalog ID');
    const localCatalog = JSON.parse(read(catalogPath));
    assert.equal(localCatalog.length, 23);
    const products = parseSystemInserts(read(sqlPath).toString('utf8'));
    const productsForSource = products.filter(product => product.repository === entry.repository);
    assert.ok(productsForSource.length <= 1, 'Ambiguous catalog source repository');
    const product = productsForSource[0];
    const hostPlugin = product
      ? localCatalog.find(plugin => plugin.upstreamProductId === product.productId) : null;
    const sourceRoot = childPath(workspace, entry.localPath);
    directories.open(sourceRoot);
    const git = args => execFileSync('git', ['-C', sourceRoot, ...args],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 }).trim();
    assert.equal(resolve(git(['rev-parse', '--show-toplevel'])), sourceRoot,
      'Source directory must be its own exact repository');
    const revision = git(['rev-parse', 'HEAD']);
    assert.match(revision, /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
    const tracked = git(['ls-tree', '-rz', '--name-only', 'HEAD']).split('\0').filter(Boolean);
    const clean = git(['status', '--porcelain=v1', '--untracked-files=all']) === '';
    const boundTrackedFile = path => {
      const bytes = read(join(entry.localPath, path));
      const committed = execFileSync('git', ['-C', sourceRoot, 'show', `${revision}:${path}`],
        { timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
      assert.deepEqual(bytes, committed, 'Source candidate file differs from its exact local revision');
      return { path: join(entry.localPath, path), bytes: bytes.length, sha256: hash(bytes), data: bytes };
    };
    const files = {};
    for (const [role, pattern] of [
      ['license', /^(?:LICENSE|LICENSE\.md|LICENSE\.txt)$/i],
      ['readme', /^README\.md$/i],
      ['changelog', /^(?:CHANGELOG|CHANGES)(?:\.md|\.txt)?$/i],
    ]) {
      const path = tracked.find(path => pattern.test(path));
      files[role] = path ? boundTrackedFile(path) : null;
    }
    const appModels = tracked.filter(path => /(?:^|\/)PSSYSAPPS\/[^/]+\/PSSYSAPP\.json$/.test(path))
      .map(path => {
        const file = boundTrackedFile(path);
        const references = collectPluginReferences(JSON.parse(file.data));
        assert.deepEqual(references.invalidReferences, [], 'Invalid exact runtime package reference');
        return { path: file.path, sha256: file.sha256, bytes: file.bytes, references: references.packages };
      });
    const wanted = [...new Map(appModels.flatMap(model => model.references)
      .map(ref => [ref.repo, ref])).values()].sort((a, b) => a.repo.localeCompare(b.repo));
    for (const supplied of runtimePackageDirectories) {
      assert.ok(supplied && Object.keys(supplied).sort().join(',') === 'path,repo'
        && typeof supplied.path === 'string' && wanted.some(ref => ref.repo === supplied.repo),
      'Only explicitly referenced exact runtime package inputs are accepted');
    }
    const runtimePackages = wanted.map(reference => {
      const provided = runtimePackageDirectories.filter(row => row.repo === reference.repo);
      assert.ok(provided.length <= 1, 'Duplicate exact runtime package input');
      if (!provided.length) return { repo: reference.repo, status: 'missing-explicit-local-package-input' };
      const path = childPath(workspace, provided[0].path);
      readTree(path, { jsonOnly: false });
      const checked = validateCandidate(reference, directoryCandidate(path));
      return { repo: reference.repo, path: relative(workspace, path),
        status: checked.evidence.packageComplete ? 'exact-files-bound-source-unaccepted' : 'blocked-incomplete-package',
        evidence: checked.evidence };
    });
    const blockers = [];
    if (!clean) blockers.push('Source checkout has changes and is not a clean revision input.');
    if (!product || !hostPlugin) blockers.push('Official catalog, SQL product and host plugin identity are not completely linked.');
    if (!appModels.length) blockers.push('No tracked native application model is present in the source candidate.');
    for (const role of ['license', 'readme', 'changelog']) {
      if (!files[role]) blockers.push(`No tracked ${role} file is present in the selected source revision.`);
    }
    blockers.push('No exact local catalog icon binding has been supplied; a source screenshot is not a catalog icon.');
    if (runtimePackages.some(pkg => pkg.status !== 'exact-files-bound-source-unaccepted')) {
      blockers.push('One or more exact runtime package file sets have not been provided and verified.');
    }
    blockers.push('Original repository authenticity, transitive licenses/dependencies, build and installed-version binding remain unaccepted.');
    return {
      contract: 'owned-marketplace-offline-input-plan-v1', status: 'blocked-local-inputs-incomplete',
      catalogId, catalogEntries: inventory.entries.length, hostCatalogEntries: localCatalog.length,
      source: { path: entry.localPath, repository: entry.repository, revision,
        recordedRevision: entry.gitCommit ?? null, recordedRevisionMatches: revision === entry.gitCommit,
        clean, authenticityVerified: false, licenseReviewAccepted: false },
      product: product ? { productId: product.productId, sourceSystemId: product.id,
        type: product.type, hostPluginId: hostPlugin?.id ?? null } : null,
      candidateFiles: Object.fromEntries(Object.entries(files).map(([role, file]) => [role, file
        ? { path: file.path, bytes: file.bytes, sha256: file.sha256 } : null])),
      appModels, runtimePackages, inputs, blockers,
      bundleCreated: false, installExecuted: false, nativeMarketplaceAcceptance: false,
      sourceClosureVerified: false, all23CatalogsAccepted: false,
    };
  } finally { directories.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, allowPositionals: false, options: {
    'catalog-id': { type: 'string' },
  } });
  console.log(`${JSON.stringify(planOwnedMarketplaceOffline({ catalogId: values['catalog-id'] }), null, 2)}\n`);
}
