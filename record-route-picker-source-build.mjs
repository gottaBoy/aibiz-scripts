#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  fingerprintDirectory, loadMigrationContract, validateBuildReceipt,
  validateMigrationMapping, WORKSPACE,
} from './harness-modeling-core-audit.mjs';

export const ROUTE_PICKER_FROM = '@ibiz-template-plm/route-picker@0.0.2-dev.142';
export const ROUTE_PICKER_TARGET = '@ibiz-template-plm/route-picker@0.0.3-alpha.245';
export const ROUTE_PICKER_SOURCE = 'plm-web/plugin-src/@ibiz-template-plm/route-picker';
export const ROUTE_PICKER_OUTPUT = `plm-web/public/plugins/${ROUTE_PICKER_TARGET}`;
export const ROUTE_PICKER_COMMAND =
  `node tools/build-plugins.mjs build:one ${ROUTE_PICKER_TARGET}`;
const contractFile = 'scripts/fixtures/modeling-core-migration-contract.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function assertRegularAncestors(path) {
  const absolute = resolve(path);
  for (let current = absolute; ; current = dirname(current)) {
    if (existsSync(current)) {
      const entry = lstatSync(current);
      if (entry.isSymbolicLink() ||
        (current !== absolute && !entry.isDirectory())) {
        throw new Error('route-picker-symlink-or-invalid-ancestor');
      }
    }
    if (dirname(current) === current) break;
  }
}

export function bindRoutePickerBuild(contract, receipt, root = WORKSPACE) {
  const result = structuredClone(contract);
  const mapping = result.migrationMappings.find(item => item.from === ROUTE_PICKER_FROM);
  if (!mapping || mapping.target?.repo !== ROUTE_PICKER_TARGET ||
    mapping.target.artifact?.path !== ROUTE_PICKER_OUTPUT ||
    mapping.source?.path !== ROUTE_PICKER_SOURCE ||
    mapping.source.status !== 'reconstructed' || mapping.status !== 'blocked' ||
    mapping.compatibility?.status !== 'blocked' ||
    mapping.runtime?.status !== 'not-verified' || mapping.runtime.evidence !== null ||
    !mapping.blockers?.includes('reconstructed-source-not-original')) {
    throw new Error('route-picker-provenance-or-mapping-mismatch');
  }
  const source = fingerprintDirectory(root, ROUTE_PICKER_SOURCE);
  const output = fingerprintDirectory(root, ROUTE_PICKER_OUTPUT);
  const manifest = JSON.parse(readFileSync(join(root, ROUTE_PICKER_SOURCE, 'package.json')));
  const published = JSON.parse(readFileSync(join(root, ROUTE_PICKER_OUTPUT, 'package.json')));
  if (`${manifest.name}@${manifest.version}` !== ROUTE_PICKER_TARGET ||
    manifest.name !== published.name || manifest.version !== published.version ||
    manifest.gitHead !== published.gitHead || manifest.gitHead !== mapping.source.packageGitHead) {
    throw new Error('route-picker-package-identity-mismatch');
  }
  if (!validateBuildReceipt(receipt).valid || receipt.command !== ROUTE_PICKER_COMMAND ||
    receipt.package.repo !== ROUTE_PICKER_TARGET ||
    receipt.package.gitHead !== manifest.gitHead ||
    receipt.source?.path !== ROUTE_PICKER_SOURCE ||
    receipt.output?.path !== ROUTE_PICKER_OUTPUT ||
    receipt.sourceFingerprint !== source.fingerprint ||
    receipt.outputFingerprint !== output.fingerprint ||
    !isDeepStrictEqual(receipt.inputs, source.entries) ||
    !isDeepStrictEqual(receipt.outputs, output.entries)) {
    throw new Error('route-picker-receipt-does-not-bind-current-bytes');
  }
  Object.assign(mapping.source, {
    fingerprint: source.fingerprint, files: source.files, bytes: source.bytes,
  });
  Object.assign(mapping.target.artifact, {
    fingerprint: output.fingerprint, files: output.files, bytes: output.bytes,
  });
  mapping.build = {
    status: 'verified', fingerprintKind: 'source-build-receipt',
    sourceFingerprint: source.fingerprint, outputFingerprint: output.fingerprint, receipt,
  };
  for (const item of result.migrationMappings) {
    const checked = validateMigrationMapping(item, root);
    if (!checked.valid || (item.from === ROUTE_PICKER_FROM && checked.ready)) {
      throw new Error(`route-picker-contract-invalid:${item.from}:${checked.blockers.join(',')}`);
    }
  }
  return result;
}

function toolchainEvidence() {
  const require = createRequire(join(WORKSPACE, 'plm-web/package.json'));
  const paths = [
    'plm-web/tools/build-plugins.mjs', 'plm-web/package.json', 'plm-web/pnpm-lock.yaml',
    'scripts/record-route-picker-source-build.mjs',
  ];
  const packages = {};
  for (const name of ['typescript', 'vite', '@qx-chitanda/vite-plugin-lib-legacy']) {
    let directory = dirname(realpathSync(require.resolve(name)));
    while (!existsSync(join(directory, 'package.json'))) {
      if (dirname(directory) === directory) throw new Error(`toolchain-package-missing:${name}`);
      directory = dirname(directory);
    }
    const manifestPath = join(directory, 'package.json');
    const bytes = readFileSync(manifestPath);
    const manifest = JSON.parse(bytes);
    if (manifest.name !== name) throw new Error(`toolchain-package-identity-mismatch:${name}`);
    packages[name] = {
      version: manifest.version, manifestPath: relative(WORKSPACE, manifestPath),
      manifestSha256: hash(bytes),
    };
  }
  return {
    packages,
    inputs: paths.map(path => {
      const bytes = readFileSync(join(WORKSPACE, path));
      return { path, bytes: bytes.length, sha256: hash(bytes) };
    }),
  };
}

export function recordRoutePickerBuild(runId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(runId ?? '')) {
    throw new Error('Usage: node scripts/record-route-picker-source-build.mjs --run-id <unique-id>');
  }
  const reportRoot = join(WORKSPACE, '.artifacts/canonical-migration-source-build', runId);
  const contractPath = join(WORKSPACE, contractFile);
  for (const path of [reportRoot, contractPath, join(WORKSPACE, ROUTE_PICKER_SOURCE),
    join(WORKSPACE, ROUTE_PICKER_OUTPUT)]) assertRegularAncestors(path);
  mkdirSync(dirname(reportRoot), { recursive: true });
  mkdirSync(reportRoot);
  const original = readFileSync(contractPath);
  const contract = JSON.parse(original);
  const source = fingerprintDirectory(WORKSPACE, ROUTE_PICKER_SOURCE);
  const oldOutput = fingerprintDirectory(WORKSPACE, ROUTE_PICKER_OUTPUT);
  const tooling = toolchainEvidence();
  writeFileSync(join(reportRoot, 'contract.before.json'), original);
  cpSync(join(WORKSPACE, ROUTE_PICKER_SOURCE), join(reportRoot, 'source.before'),
    { recursive: true, errorOnExist: true, force: false });
  cpSync(join(WORKSPACE, ROUTE_PICKER_OUTPUT), join(reportRoot, 'target.before'),
    { recursive: true, errorOnExist: true, force: false });
  const report = {
    schemaVersion: 1, status: 'failed', command: ROUTE_PICKER_COMMAND,
    sourceStatus: 'reconstructed', originalSourceRecovered: false, nativeAccepted: false,
    compatibilityVerified: false, runtimeVerified: false, declaredTypecheckExecuted: false,
    buildScope: 'vite-runtime-bundles; package metadata, images and declarations preserved',
    before: {
      contractSha256: hash(original), sourceFingerprint: source.fingerprint,
      outputFingerprint: oldOutput.fingerprint,
      mappings: contract.migrationMappings.map(item =>
        ({ from: item.from, ...validateMigrationMapping(item) })),
    },
    toolchain: tooling, builds: [],
  };
  let temporary;
  try {
    // Do not accept a provenance promotion, even when the stale source hash is expected.
    const oldMapping = contract.migrationMappings.find(item => item.from === ROUTE_PICKER_FROM);
    if (oldMapping?.source?.status !== 'reconstructed' || oldMapping.status !== 'blocked') {
      throw new Error('route-picker-provenance-or-mapping-mismatch');
    }
    let firstOutput;
    for (let index = 1; index <= 2; index++) {
      let log;
      try {
        log = execFileSync(process.execPath,
          ['tools/build-plugins.mjs', 'build:one', ROUTE_PICKER_TARGET], {
            cwd: join(WORKSPACE, 'plm-web'), encoding: 'utf8',
            timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
          });
      } catch (error) {
        writeFileSync(join(reportRoot, `build-${index}.log`),
          `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message}\n`);
        throw error;
      }
      writeFileSync(join(reportRoot, `build-${index}.log`), log);
      if (!isDeepStrictEqual(fingerprintDirectory(WORKSPACE, ROUTE_PICKER_SOURCE), source) ||
        !isDeepStrictEqual(toolchainEvidence(), tooling)) {
        throw new Error('route-picker-inputs-changed-during-build');
      }
      const output = fingerprintDirectory(WORKSPACE, ROUTE_PICKER_OUTPUT);
      if (firstOutput && !isDeepStrictEqual(firstOutput, output)) {
        throw new Error('route-picker-repeated-build-output-mismatch');
      }
      firstOutput = output;
      cpSync(join(WORKSPACE, ROUTE_PICKER_OUTPUT), join(reportRoot, `target.build-${index}`),
        { recursive: true, errorOnExist: true, force: false });
      report.builds.push({
        command: ROUTE_PICKER_COMMAND, exitCode: 0, sourceFingerprint: source.fingerprint,
        outputFingerprint: output.fingerprint, logPath: `build-${index}.log`,
      });
    }
    const output = firstOutput;
    const manifest = JSON.parse(readFileSync(join(WORKSPACE, ROUTE_PICKER_SOURCE, 'package.json')));
    const receipt = {
      schemaVersion: 1, status: 'passed', command: ROUTE_PICKER_COMMAND, exitCode: 0,
      package: {
        name: manifest.name, version: manifest.version,
        repo: ROUTE_PICKER_TARGET, gitHead: manifest.gitHead,
      },
      source: {
        path: ROUTE_PICKER_SOURCE, fingerprintKind: 'source-file-set',
        files: source.files, bytes: source.bytes,
      },
      output: {
        path: ROUTE_PICKER_OUTPUT, fingerprintKind: 'target-file-set',
        files: output.files, bytes: output.bytes,
      },
      sourceFingerprint: source.fingerprint, outputFingerprint: output.fingerprint,
      inputs: source.entries, outputs: output.entries,
    };
    const rebound = bindRoutePickerBuild(contract, receipt);
    if (!readFileSync(contractPath).equals(original)) {
      throw new Error('route-picker-contract-concurrently-changed');
    }
    const bytes = Buffer.from(json(rebound));
    temporary = `${contractPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, bytes, { flag: 'wx', mode: lstatSync(contractPath).mode & 0o777 });
    renameSync(temporary, contractPath);
    temporary = undefined;
    const validated = loadMigrationContract();
    writeFileSync(join(reportRoot, 'contract.after.json'), bytes);
    writeFileSync(join(reportRoot, 'receipt.json'), json(receipt));
    report.status = 'passed-source-build-binding-not-native-acceptance';
    report.reproducibleRuntimeBundleBuildVerified = true;
    report.after = {
      contractSha256: hash(bytes), sourceFingerprint: source.fingerprint,
      outputFingerprint: output.fingerprint,
      mappings: validated.migrationMappings.map(item =>
        ({ from: item.from, ...validateMigrationMapping(item) })),
    };
    return reportRoot;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    writeFileSync(join(reportRoot, 'report.json'), json(report));
    if (temporary) console.error(`Uninstalled contract retained at ${temporary}`);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--run-id') {
    console.error('Usage: node scripts/record-route-picker-source-build.mjs --run-id <unique-id>');
    process.exitCode = 1;
  } else {
    try {
      console.log(recordRoutePickerBuild(process.argv[3]));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
