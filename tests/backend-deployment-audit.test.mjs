import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  DEPLOYED_BACKENDS, compareArchiveInventories, parseDeployedHash,
  requireUnchangedDeployment, runBackendDeploymentAudit,
} from '../harness-backend-deployment-audit.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const archive = entries => ({
  sha256: hash(JSON.stringify(entries)), bytes: 100,
  entries: entries.map(([path, data]) => ({ path, bytes: data.length, sha256: hash(data) })),
  manifest: { 'Main-Class': 'Launcher', 'Start-Class': 'App', 'Spring-Boot-Version': '2.4.0' },
});

test('deployed hash parser requires one exact NUL-terminated JAR identity', () => {
  const digest = hash('jar');
  assert.equal(parseDeployedHash(Buffer.from(`${digest}  /app.jar\0`), '/app.jar'), digest);
  for (const value of [
    `${digest}  /other.jar\0`, `${digest}  /app.jar\n`,
    `${digest}  /app.jar\0${digest}  /app.jar\0`, 'bad  /app.jar\0',
  ]) assert.throws(() => parseDeployedHash(Buffer.from(value), '/app.jar'));
});

test('ZIP timestamp differences do not become entry or behavior differences', () => {
  const before = archive([['BOOT-INF/classes/App.class', 'class']]);
  const after = { ...before, sha256: hash('different ZIP metadata') };
  const result = compareArchiveInventories(before, after);
  assert.equal(result.sameArchiveBytes, false);
  assert.equal(result.sameEntryBytes, true);
  assert.deepEqual(result.changes, []);
});

test('archive comparison separates classes, dependency archives and resources', () => {
  const result = compareArchiveInventories(archive([
    ['BOOT-INF/classes/App.class', 'old'], ['BOOT-INF/lib/core.jar', 'old'],
    ['old-resource', 'old'], ['unchanged', 'same'],
  ]), archive([
    ['BOOT-INF/classes/App.class', 'new'], ['BOOT-INF/lib/core.jar', 'new'],
    ['new-resource', 'new'], ['unchanged', 'same'],
  ]));
  assert.equal(result.sameEntryBytes, false);
  assert.equal(result.unchangedEntries, 1);
  assert.deepEqual(result.changes.map(item => [item.status, item.kind]), [
    ['changed', 'class'], ['changed', 'dependency-archive'],
    ['candidate-only', 'resource'], ['deployed-only', 'resource'],
  ]);
});

test('duplicate, empty or malformed archive inventories fail closed', () => {
  const valid = archive([['App.class', 'class']]);
  for (const entries of [
    [], [valid.entries[0], valid.entries[0]], [{ ...valid.entries[0], sha256: 'invalid' }],
  ]) assert.throws(() => compareArchiveInventories({ ...valid, entries }, valid));
});

test('deployment restarts, image replacement and mount drift cannot pass unchanged checks', () => {
  const before = [{ name: 'service', id: 'container', imageId: 'image', startedAt: 'start', mounts: [] }];
  requireUnchangedDeployment(before, structuredClone(before));
  for (const change of [
    state => state[0].id = 'other', state => state[0].imageId = 'other',
    state => state[0].startedAt = 'later', state => state[0].mounts.push({ Source: '/other' }),
  ]) {
    const after = structuredClone(before);
    change(after);
    assert.throws(() => requireUnchangedDeployment(before, after), /deployment changed/);
  }
});

test('Docker mount enumeration order is not deployment drift', () => {
  const mounts = [{ Destination: '/app', Source: '/source' }, { Destination: '/data', Source: '/volume' }];
  const before = [
    { name: 'service', mounts }, { name: 'database', mounts: [] },
  ];
  const after = [
    { name: 'database', mounts: [] }, { name: 'service', mounts: [...mounts].reverse() },
  ];
  requireUnchangedDeployment(before, after);
  assert.deepEqual(before[0].mounts, mounts);
});

function fixture(t, { failCopy = false, mutateHash = false, drift = true } = {}) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'backend-deployment-audit-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  fs.mkdirSync(join(workspace, '.artifacts'));
  const expected = archive([['BOOT-INF/classes/App.class', 'candidate']]);
  const deployed = drift ? archive([['BOOT-INF/classes/App.class', 'deployed']]) : expected;
  const reportPath = join(workspace, '.artifacts/package/report.json');
  const verified = {
    sourcePackageVerified: true, reportPath, reportSha256: hash('receipt'),
    report: { packages: { archives: DEPLOYED_BACKENDS.map(spec => ({ ...expected, path: spec.archive })) } },
  };
  const commands = [];
  let hashCalls = 0;
  const execute = (_executable, args) => {
    commands.push(args);
    if (args[0] === 'inspect') return Buffer.from(JSON.stringify({
      id: 'a'.repeat(64), imageId: `sha256:${'b'.repeat(64)}`, image: 'fixture',
      status: 'running', startedAt: 'start', restartCount: 0, mounts: [],
    }));
    if (args[0] === 'exec') {
      hashCalls++;
      const value = mutateHash && hashCalls === 2 ? hash('changed') : deployed.sha256;
      return Buffer.from(`${value}  ${args.at(-1)}\0`);
    }
    if (args[0] === 'cp') {
      if (failCopy) throw new Error('copy failed');
      return Buffer.from('');
    }
    throw new Error('Unexpected fixture command');
  };
  const options = {
    workspace, output: '.artifacts/audit', packageReport: reportPath, execute,
    verifyPackage: () => verified, inspectArchive: () => deployed,
  };
  return { options, commands, workspace };
}

test('controlled read-only audit reports drift without claiming deployment acceptance', t => {
  const f = fixture(t);
  const { report, reportPath } = runBackendDeploymentAudit(f.options);
  assert.equal(report.auditCompleted, true);
  assert.equal(report.status, 'on-disk-deployment-drift-detected');
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.acceptedForProduction, false);
  assert.equal(report.loadedJavaClassesVerified, false);
  assert.equal(report.components.length, 3);
  assert.deepEqual(report.before, report.after);
  assert.equal(JSON.parse(fs.readFileSync(reportPath)).auditCompleted, true);
  assert.ok(f.commands.every(args => ['inspect', 'exec', 'cp'].includes(args[0])));
  assert.ok(f.commands.filter(args => args[0] === 'exec')
    .every(args => args[2] === 'sha256sum'));
  assert.throws(() => runBackendDeploymentAudit(f.options));
});

test('matching archive bytes satisfy only the on-disk audit', t => {
  const f = fixture(t, { drift: false });
  const { report } = runBackendDeploymentAudit(f.options);
  assert.equal(report.status, 'on-disk-deployment-bytes-match');
  assert.equal(report.loadedJavaClassesVerified, false);
});

for (const options of [{ failCopy: true }, { mutateHash: true }]) {
  test(`failed or moving live reads retain a failing audit: ${JSON.stringify(options)}`, t => {
    const f = fixture(t, options);
    const { report } = runBackendDeploymentAudit(f.options);
    assert.equal(report.auditCompleted, false);
    assert.equal(report.status, 'failed');
    assert.equal(report.errors.length, 1);
  });
}

test('CLI help does not need Docker or package receipts', () => {
  const script = fileURLToPath(new URL('../harness-backend-deployment-audit.mjs', import.meta.url));
  const out = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /--package-report/);
});
