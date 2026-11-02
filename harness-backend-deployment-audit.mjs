#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  inspectBackendArchive, verifyBackendSourcePackage,
} from './harness-backend-source-package.mjs';
import { PinnedDirectories } from './native-candidate-files.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEPLOYED_BACKENDS = Object.freeze([
  Object.freeze({
    container: 'ibiz-ebsx-allinone',
    archive: 'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar',
  }),
  Object.freeze({
    container: 'ibiz-ebsx-gateway',
    archive: 'ibiz-ebsx-gateway/ibiz-ebsx-gateway.jar',
  }),
  Object.freeze({
    container: 'modelingservice',
    archive: 'ibiz-service-runner/ibizservicerunner-provider.jar',
  }),
]);
const protectedContainers = [
  'mysql', 'ibizlab-uaa-api', 'plmservice', 'plmweb',
  ...DEPLOYED_BACKENDS.map(spec => spec.container),
];
const inspectFormat = [
  '{"id":{{json .Id}},"imageId":{{json .Image}},',
  '"image":{{json .Config.Image}},"status":{{json .State.Status}},',
  '"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},',
  '"mounts":{{json .Mounts}}}',
].join('');

export function parseDeployedHash(bytes, path) {
  assert.match(path, /^\/[A-Za-z0-9_.-]+\.jar$/);
  const match = /^([a-f0-9]{64}) [ *]([^\0]+)\0$/.exec(bytes.toString('utf8'));
  assert.ok(match && match[2] === path, 'Unexpected deployed hash output');
  return match[1];
}

export function compareArchiveInventories(deployed, candidate) {
  const inventory = archive => {
    const items = new Map();
    for (const item of archive.entries) {
      assert.equal(typeof item.path, 'string');
      assert.ok(!items.has(item.path), 'Duplicate archive entry');
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0);
      items.set(item.path, item);
    }
    assert.ok(items.size, 'Empty archive inventory');
    return items;
  };
  const active = inventory(deployed);
  const expected = inventory(candidate);
  const changes = [];
  let unchanged = 0;
  for (const path of [...new Set([...active.keys(), ...expected.keys()])].sort()) {
    const before = active.get(path);
    const after = expected.get(path);
    if (before && after && before.sha256 === after.sha256 && before.bytes === after.bytes) {
      unchanged++;
      continue;
    }
    changes.push({
      path,
      status: !before ? 'candidate-only' : !after ? 'deployed-only' : 'changed',
      kind: path.startsWith('BOOT-INF/lib/') && path.endsWith('.jar')
        ? 'dependency-archive' : path.endsWith('.class') ? 'class' : 'resource',
      deployed: before ? { bytes: before.bytes, sha256: before.sha256 } : null,
      candidate: after ? { bytes: after.bytes, sha256: after.sha256 } : null,
    });
  }
  return {
    sameArchiveBytes: deployed.sha256 === candidate.sha256,
    sameEntryBytes: changes.length === 0,
    manifestMatches: JSON.stringify(deployed.manifest) === JSON.stringify(candidate.manifest),
    unchangedEntries: unchanged,
    changes,
  };
}

export function requireUnchangedDeployment(before, after) {
  const normalize = containers => containers.map(container => ({
    ...container,
    mounts: [...container.mounts].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))),
  })).sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(normalize(after), normalize(before),
    'Protected deployment changed during read-only audit');
}

export function runBackendDeploymentAudit({
  workspace = workspaceDefault, packageReport, output,
  execute = execFileSync, verifyPackage = verifyBackendSourcePackage,
  inspectArchive = inspectBackendArchive,
} = {}) {
  workspace = resolve(workspace);
  assert.equal(typeof packageReport, 'string', 'Select an explicit package receipt');
  assert.equal(typeof output, 'string', 'Select a fresh audit output directory');
  output = resolve(workspace, output);
  assert.equal(dirname(output), join(workspace, '.artifacts'));
  assert.match(basename(output), /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
  const verified = verifyPackage({ workspace, reportPath: packageReport });
  assert.equal(verified.sourcePackageVerified, true);
  assert.match(verified.reportSha256, /^[a-f0-9]{64}$/);
  const directories = new PinnedDirectories();
  const report = {
    schemaVersion: 1, contract: 'read-only-backend-deployment-audit-v1',
    startedAt: new Date().toISOString(), status: 'failed',
    nativeAcceptance: false, acceptedForProduction: false,
    loadedJavaClassesVerified: false, auditCompleted: false,
    packageReceipt: { path: verified.reportPath, sha256: verified.reportSha256 },
    before: null, after: null, components: [], commands: [], errors: [],
    boundary: [
      'Reads live container files only; does not build, deploy, restart, retag or migrate services.',
      'JAR entry differences are byte differences, not proof of behavioral differences.',
      'On-disk JARs, including bind mounts, do not prove which classes the JVM has loaded.',
    ],
  };
  let destination;
  function run(args) {
    const command = { executable: 'docker', args };
    report.commands.push(command);
    try {
      const bytes = execute('docker', args, {
        timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      command.exitCode = 0;
      command.outputSha256 = createHash('sha256').update(bytes).digest('hex');
      return bytes;
    } catch (error) {
      command.exitCode = error.status ?? null;
      throw new Error(`Docker audit command failed: ${args[0]}`);
    }
  }
  function snapshot() {
    return protectedContainers.map(name => {
      const state = JSON.parse(run(['inspect', '--format', inspectFormat, name]));
      assert.equal(state.status, 'running', `Protected container is not running: ${name}`);
      assert.match(state.id, /^[a-f0-9]{64}$/);
      assert.match(state.imageId, /^sha256:[a-f0-9]{64}$/);
      return { name, ...state };
    });
  }
  try {
    destination = directories.open(output, { create: true, exclusive: true });
    report.before = snapshot();
    const extracted = directories.open(join(output, 'deployed'), { create: true, exclusive: true });
    for (const spec of DEPLOYED_BACKENDS) {
      const container = report.before.find(item => item.name === spec.container);
      const remotePath = `/${basename(spec.archive)}`;
      const expected = verified.report.packages.archives.find(item => item.path === spec.archive);
      assert.ok(expected, 'Candidate receipt is missing a deployed backend');
      const actualHash = parseDeployedHash(
        run(['exec', container.id, 'sha256sum', '--zero', '--', remotePath]), remotePath);
      const path = join(extracted.path, `${spec.container}.jar`);
      run(['cp', `${container.id}:${remotePath}`, path]);
      const deployed = inspectArchive(path);
      assert.equal(deployed.sha256, actualHash, 'Container/copy JAR bytes changed');
      const afterHash = parseDeployedHash(
        run(['exec', container.id, 'sha256sum', '--zero', '--', remotePath]), remotePath);
      assert.equal(afterHash, actualHash, 'Container JAR changed during audit');
      report.components.push({
        container: spec.container, containerId: container.id, imageId: container.imageId,
        archive: spec.archive,
        deployed: { path, bytes: deployed.bytes, sha256: deployed.sha256 },
        candidate: { bytes: expected.bytes, sha256: expected.sha256 },
        comparison: compareArchiveInventories(deployed, expected),
      });
    }
    const finalPackage = verifyPackage({ workspace, reportPath: packageReport });
    assert.equal(finalPackage.reportSha256, verified.reportSha256, 'Package evidence changed during audit');
    report.after = snapshot();
    requireUnchangedDeployment(report.before, report.after);
    report.auditCompleted = true;
    report.status = report.components.every(item => item.comparison.sameArchiveBytes)
      ? 'on-disk-deployment-bytes-match' : 'on-disk-deployment-drift-detected';
  } catch (error) {
    if (!destination) throw error;
    report.errors.push(error.message);
  } finally {
    if (destination) {
      report.finishedAt = new Date().toISOString();
      directories.write(destination, 'report.json', `${JSON.stringify(report, null, 2)}\n`);
    }
    directories.close();
  }
  return { report, reportPath: join(output, 'report.json') };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    'package-report': { type: 'string' }, output: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/harness-backend-deployment-audit.mjs --package-report .artifacts/PACKAGE/report.json --output .artifacts/NEW-AUDIT');
    return 0;
  }
  const { report, reportPath } = runBackendDeploymentAudit({
    packageReport: values['package-report'], output: values.output,
  });
  console.log(JSON.stringify({
    reportPath, status: report.status, auditCompleted: report.auditCompleted,
    components: report.components.map(item => ({
      container: item.container, sameArchiveBytes: item.comparison.sameArchiveBytes,
      sameEntryBytes: item.comparison.sameEntryBytes, changes: item.comparison.changes.length,
    })),
    nativeAcceptance: false, acceptedForProduction: false, errors: report.errors,
  }, null, 2));
  return report.auditCompleted && report.components.every(item => item.comparison.sameArchiveBytes) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
