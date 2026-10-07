#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fingerprintDirectory,
  validateBuildReceipt,
  validateMigrationMapping,
  WORKSPACE,
} from './harness-modeling-core-audit.mjs';

const repo = '@ibiz-template-plugin/logic-tree-design@0.0.3-alpha.56';
const sourcePath = 'plm-web/plugin-src/@ibiz-template-plugin/logic-tree-design';
const targetPath = `plm-web/public/plugins/${repo}`;
const contractPath = join(WORKSPACE, 'scripts/fixtures/modeling-core-migration-contract.json');
const command = `node tools/build-plugins.mjs build:one ${repo}`;

if (process.argv.length !== 2) {
  throw new Error('Usage: node scripts/record-logic-tree-source-build.mjs');
}

const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const mapping = contract.migrationMappings.find(item => item.from === repo);
const plugin = contract.plugins.find(item => item.repo === repo);
if (!mapping || !plugin || mapping.target.repo !== repo) {
  throw new Error('Exact plugin mapping is missing');
}

if (mapping.source.status === 'missing') {
  const original = fingerprintDirectory(WORKSPACE, `${targetPath}/src`);
  const sourceTree = fingerprintDirectory(WORKSPACE, `${sourcePath}/src`);
  if (original.fingerprint !== sourceTree.fingerprint) {
    throw new Error('Editable source differs from the published exact-version source');
  }
} else if (mapping.source.status !== 'verified' || mapping.source.path !== sourcePath) {
  throw new Error('Existing source provenance is not verified');
}

const sourcePackage = JSON.parse(readFileSync(join(WORKSPACE, sourcePath, 'package.json'), 'utf8'));
const publishedPackage = JSON.parse(readFileSync(join(WORKSPACE, targetPath, 'package.json'), 'utf8'));
if (`${sourcePackage.name}@${sourcePackage.version}` !== repo ||
  sourcePackage.gitHead !== publishedPackage.gitHead) {
  throw new Error('Source package identity or upstream gitHead does not match');
}

execFileSync(process.execPath, ['tools/build-plugins.mjs', 'build:one', repo], {
  cwd: join(WORKSPACE, 'plm-web'),
  stdio: 'inherit',
});

const source = fingerprintDirectory(WORKSPACE, sourcePath);
const output = fingerprintDirectory(WORKSPACE, targetPath);
const receipt = {
  schemaVersion: 1,
  status: 'passed',
  command,
  exitCode: 0,
  package: {
    name: sourcePackage.name,
    version: sourcePackage.version,
    repo,
    gitHead: sourcePackage.gitHead,
  },
  source: {
    path: sourcePath,
    fingerprintKind: 'source-file-set',
    files: source.files,
    bytes: source.bytes,
  },
  output: {
    path: targetPath,
    fingerprintKind: 'target-file-set',
    files: output.files,
    bytes: output.bytes,
  },
  sourceFingerprint: source.fingerprint,
  outputFingerprint: output.fingerprint,
  inputs: source.entries,
  outputs: output.entries,
};
if (!validateBuildReceipt(receipt).valid) throw new Error('Invalid build receipt');

mapping.target.artifact = {
  status: 'observed',
  path: targetPath,
  fingerprintKind: 'target-file-set',
  fingerprint: output.fingerprint,
  files: output.files,
  bytes: output.bytes,
};
mapping.source = {
  status: 'verified',
  path: sourcePath,
  fingerprintKind: 'source-file-set',
  fingerprint: source.fingerprint,
  files: source.files,
  bytes: source.bytes,
  packageGitHead: sourcePackage.gitHead,
};
mapping.build = {
  status: 'verified',
  fingerprintKind: 'source-build-receipt',
  sourceFingerprint: source.fingerprint,
  outputFingerprint: output.fingerprint,
  receipt,
};
const editable = mapping.compatibility.basis.find(item => item.kind === 'editable-source');
editable.status = 'verified';
editable.evidence = 'Published exact-version TS/TSX source matches the independent editable plugin-src tree.';
mapping.compatibility.requiredProof = [
  'Central and ModelDesign browser verification must pass with zero plugin asset 404s and zero unexplained errors.',
];
mapping.compatibility.rationale =
  'The exact-version source and independent local build are verified; native browser integration is still unverified.';
mapping.blockers = ['runtime-not-verified', 'compatibility-not-verified'];

plugin.packageEvidence = {
  status: 'observed',
  sourcePath: targetPath,
  files: output.files,
  fingerprintKind: 'package-file-set',
  fingerprint: output.fingerprint,
};
plugin.build = {
  status: 'verified',
  fingerprintKind: 'source-build-receipt',
  receipt,
};

const checked = validateMigrationMapping(mapping);
if (!checked.valid || checked.ready) {
  throw new Error(`Migration mapping invalid: ${checked.blockers.join(',')}`);
}
writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
console.log(`Recorded ${repo}: source ${source.fingerprint}, output ${output.fingerprint}`);
