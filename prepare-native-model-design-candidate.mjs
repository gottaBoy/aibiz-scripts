#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyLocalModelDesignBuild } from '../modelingweb/local-plugins/model-design/build.mjs';
import { loadMigrationContract, WORKSPACE } from './harness-modeling-core-audit.mjs';
import { fingerprint, PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';

export const modelDesignSelection = Object.freeze({
  from: '@ibiz-template-plugin/model-design@0.0.3-alpha.90',
  to: '@aibiz/model-design-candidate@0.1.0',
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const modelDesignActionKeys = Object.freeze([
  'DEUIACTION_DSL_EDIT', 'DEUIACTION_DSL_EXPORT', 'DEUIACTION_DSL_IMPORT',
  'DEUIACTION_EXPORT_TO_MODEL_CLIPBOARD', 'DEUIACTION_IMPORT_FOR_MODEL_CLIPBOARD',
  'DEUIACTION_MODEL_CLONE', 'DEUIACTION_MODEL_COPY', 'DEUIACTION_MODEL_EDIT',
  'DEUIACTION_MODEL_PASTE', 'DEUIACTION_OPEN_MODEL_CLIPBOARD', 'DEUIACTION_OPEN_MODEL_RUNTIME',
]);

function inventory(contents) {
  const entries = contents.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  return { contents, entries, ...fingerprint(entries) };
}

export function verifyModelDesignReferenceSurface(model) {
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase() === 'rtobjectrepo' && child === modelDesignSelection.from) {
        assert.equal(value.pluginType, 'DEUIACTION', 'Unsupported model-design plugin type');
        assert.ok(modelDesignActionKeys.includes(`DEUIACTION_${value.pluginCode}`),
          `Unsupported model-design action: ${value.pluginCode}`);
        assert.equal(value.rTObjectName, value.pluginCode, 'Model-design runtime action identity differs');
      }
      visit(child);
    }
  };
  visit(model);
}

export function readModelDesignCandidate({ workspace = WORKSPACE, contract, sourceReport } = {}) {
  workspace = resolve(workspace);
  assert.equal(workspace, WORKSPACE, 'Model-design source verifier requires the actual workspace');
  assert.equal(contract?.schemaVersion, 1, 'Expected native migration contract schema 1');
  assert.equal(contract.contract, 'ibizmodeling-core-migration', 'Expected native migration contract');
  assert.equal(contract.migrationMappings?.filter(item => item.from === modelDesignSelection.from).length, 1,
    'Requested alpha90 model-design mapping must exist exactly once');
  assert.ok(contract.plugins?.some(item => item.repo === modelDesignSelection.from),
    'Requested model-design identity is absent from the native contract');
  assert.ok(typeof sourceReport === 'string' && sourceReport, 'Explicit model-design source report required');
  const verified = verifyLocalModelDesignBuild({ sourceReport: resolve(workspace, sourceReport) });
  const { report } = verified;
  assert.deepEqual(report.builtUiActionKeys, modelDesignActionKeys, 'All eleven action registrations required');
  const root = report.packageRoot;
  const directories = new PinnedDirectories();
  try {
    const manifestFile = readPinnedFile(directories, directories.open(root), 'package.json');
    const manifest = JSON.parse(manifestFile.data);
    assert.equal(hash(manifestFile.data), report.manifestSha256, 'Candidate manifest drift');
    assert.equal(`${manifest.name}@${manifest.version}`, modelDesignSelection.to);
    assert.equal(manifest.private, true);
    assert.equal(manifest.aibiz.requestedReference, modelDesignSelection.from);
    assert.equal(manifest.aibiz.upstreamReference, '@ibiz-template-plugin/model-design@0.0.3-alpha.122');
    const outputs = inventory(['dist', 'es', 'lib'].flatMap(directory =>
      readTree(join(root, directory), { jsonOnly: false }).contents.map(file =>
        ({ ...file, path: `${directory}/${file.path}` })))
      .sort((a, b) => a.path.localeCompare(b.path)));
    assert.deepEqual(outputs.entries, report.outputs.entries, 'Model-design delivery output drift');
    for (const path of [manifest.main, manifest.module, manifest.system, ...manifest.styles]) {
      assert.ok(outputs.entries.some(file => file.path === path), `Missing model-design entry: ${path}`);
    }
    const delivery = inventory([...outputs.contents, {
      path: 'package.json', data: manifestFile.data, bytes: manifestFile.data.length,
      sha256: report.manifestSha256,
    }].sort((a, b) => a.path.localeCompare(b.path)));
    const runtimeRoot = join(root, report.consumedRuntime.snapshot);
    const runtimeManifestFile = readPinnedFile(directories, directories.open(runtimeRoot), 'package.json');
    const runtime = inventory([
      ...['dist', 'loader'].flatMap(directory => readTree(join(runtimeRoot, directory),
        { jsonOnly: false }).contents.map(file => ({ ...file, path: `${directory}/${file.path}` }))),
      { path: 'package.json', data: runtimeManifestFile.data, bytes: runtimeManifestFile.data.length,
        sha256: hash(runtimeManifestFile.data) },
    ].sort((a, b) => a.path.localeCompare(b.path)));
    assert.deepEqual(runtime.entries, report.consumedRuntime.entries, 'Consumed runtime delivery drift');
    const runtimeManifest = JSON.parse(runtime.contents.find(file => file.path === 'package.json').data);
    assert.equal(runtimeManifest.name, report.runtime.package);
    assert.equal(runtimeManifest.version, report.runtime.version);
    const pluralizeRoot = report.dependencyLock.roots.find(item => item.name === 'pluralize');
    assert.equal(pluralizeRoot?.version, '8.0.0', 'Pinned pluralize8 input required');
    const pluralizeSource = join(root, '.dependencies', pluralizeRoot.id);
    const pluralize = readTree(pluralizeSource, { jsonOnly: false });
    const lockedPluralize = report.dependencyLock.packages.find(item => item.id === pluralizeRoot.id);
    assert.deepEqual(pluralize.entries, lockedPluralize.entries.map(({ executable, ...file }) => file),
      'Locked pluralize delivery drift');
    assert.deepEqual(readPinnedFile(directories, directories.open(root), 'package.json',
      manifestFile.identity).data, manifestFile.data, 'Candidate manifest changed during reading');
    const reportFile = readPinnedFile(directories, directories.open(dirname(verified.reportPath)),
      basename(verified.reportPath));
    assert.deepEqual(JSON.parse(reportFile.data), report, 'Model-design report changed during reading');
    assert.equal(hash(reportFile.data), verified.reportSha256, 'Model-design report bytes changed');
    return {
      files: delivery, runtimeFiles: runtime, pluralizeFiles: pluralize, pluralizeSource,
      plugin: {
        schemaVersion: 1, contract: 'native-model-design-independent-replacement',
        ...modelDesignSelection, sourcePath: relative(workspace, root),
        sourceStatus: 'vendored-source-with-independent-local-fixes',
        upstreamReference: manifest.aibiz.upstreamReference,
        requestedReference: manifest.aibiz.requestedReference,
        sourceFingerprint: report.inputs.fingerprint,
        sourceInputs: report.inputs.entries,
        buildOutputFingerprint: report.outputs.fingerprint, buildOutputs: report.outputs.entries,
        outputFingerprint: delivery.fingerprint,
        sourceBuildReport: { path: relative(workspace, verified.reportPath), sha256: verified.reportSha256 },
        dependencyLockSha256: report.dependencyLockSha256,
        runtimeImports: report.systemImports, supportedActionKeys: [...modelDesignActionKeys],
        consumedRuntime: {
          package: report.runtime.package, version: report.runtime.version, sourceKind: 'reconstructed',
          reportPath: relative(workspace, report.runtime.reportPath), reportSha256: report.runtime.reportSha256,
          sourceFingerprint: report.runtime.sourceFingerprint, outputFingerprint: runtime.fingerprint,
        },
        sourceBuildVerified: true, reproducibleBuildVerified: true,
        originalSourceRecovered: false, originalRepositoryAuthenticated: false,
        exactVersionReproductionVerified: false, nativeCompatibilityVerified: false,
        nativeAccepted: false, compatibility: 'not-verified', acceptedForProduction: false,
        originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
        verificationScope: 'complete-source-build-lock-and-delivery-integrity-not-native-acceptance',
      },
    };
  } finally { directories.close(); }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    'source-report': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/prepare-native-model-design-candidate.mjs --source-report PATH');
    return 0;
  }
  console.log(JSON.stringify(readModelDesignCandidate({
    contract: loadMigrationContract(), sourceReport: values['source-report'],
  }).plugin, null, 2));
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
