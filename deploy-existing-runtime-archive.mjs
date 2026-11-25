#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const profiles = {
  portal: {
    container: 'a1d148c646a44416cd5d8d0003ee128e83e192e83c8a95517d8fcce218f3c2f3',
    image: 'sha256:0823e8b5dd2b48f900253ccfc27dbafb4d4ca1b9217881249b58b07c3f203a90',
    name: '/ibiz-ebsx-allinone', target: '/ibiz-ebsx-allinone-rt.jar',
    candidate: 'allinone-local-portal-candidate-20261124-r5',
    contract: 'existing-allinone-local-portal-candidate-v1',
    originalSha256: '45655061236257781f4482a80d0e54d9e023d214d34b03fcd170e18814f2ad64',
    module: 'BOOT-INF/lib/ibiz-plugin-cloud-8.1.0.584.1.jar',
    existingEntries: ['net/ibizsys/central/plugin/cloud/sysutil/SysCloudClientUtilRuntimeBase.class',
      ...[1, 2, 3].map(index =>
        `net/ibizsys/central/plugin/cloud/sysutil/SysCloudClientUtilRuntimeBase$${index}.class`)],
    addedEntries: ['net/ibizsys/central/plugin/cloud/service/client/LocalCloudPortalClient.class'],
    readyUrl: 'http://127.0.0.1:30000/uaa/publickey', readyStatus: 200,
  },
  notfound: {
    container: 'e2b9db6202c28d519ff0080e67a1cdb4a635bb48793a4c33e5a9267cf0b64546',
    image: 'sha256:3988b0d18f23538b7961bea5e8cb1055c2c9f13d258875c99b34ae8a42758329',
    name: '/plmservice', target: '/app/plm-provider.jar',
    candidate: 'plm-notfound-provider-candidate-20261124-r2',
    contract: 'existing-plm-notfound-provider-candidate-v1',
    originalSha256: '2b4d9064212bca8465f2351e5c34dcbf8b6ce27986e2b4edfa67ad223952fc38',
    module: 'BOOT-INF/lib/ibiz-cloud-core-8.1.0.584.1.jar',
    existingEntries: ['net/ibizsys/central/cloud/core/service/util/ResponseExceptionHandler.class'],
    addedEntries: [],
    readyUrl: 'http://127.0.0.1:30251/ibizservicerunner/serviceapi/ideas/owned-nonexistent-readiness',
    readyStatus: 401,
  },
  viewthemes: {
    container: 'a1d148c646a44416cd5d8d0003ee128e83e192e83c8a95517d8fcce218f3c2f3',
    image: 'sha256:0823e8b5dd2b48f900253ccfc27dbafb4d4ca1b9217881249b58b07c3f203a90',
    name: '/ibiz-ebsx-allinone', target: '/ibiz-ebsx-allinone-rt.jar',
    candidate: 'allinone-view-theme-candidate-20261124-r2',
    contract: 'existing-allinone-view-theme-access-candidate-v1',
    originalSha256: '563824e4fd2cb378c1cc6db86b9a023554b1f513631e510cf440f96631d82ad4',
    modules: ['BOOT-INF/lib/ibiz-cloud-saas-extension-8.1.0.584.1.jar',
      'BOOT-INF/lib/ibiz-cloud-core-8.1.0.584.1.jar'],
    existingEntries: [
      'net/ibizsys/central/cloud/saas/extension/runtime/dataentity/security/DataEntityAccessManager.class',
      'sysmodel/saas-extension/PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme.json',
    ],
    addedEntries: [
      'sysmodel/saas-extension/PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme/PSDEUSERROLES/SystemRead.json',
    ],
    readyUrl: 'http://127.0.0.1:30000/uaa/publickey', readyStatus: 200,
  },
  viewthemesave: {
    container: 'a1d148c646a44416cd5d8d0003ee128e83e192e83c8a95517d8fcce218f3c2f3',
    image: 'sha256:0823e8b5dd2b48f900253ccfc27dbafb4d4ca1b9217881249b58b07c3f203a90',
    name: '/ibiz-ebsx-allinone', target: '/ibiz-ebsx-allinone-rt.jar',
    candidate: 'allinone-view-theme-save-candidate-20261124-r1',
    contract: 'existing-allinone-view-theme-save-candidate-v1',
    originalSha256: '2764f965f5b49a7b491fe38170112fa40f13d5be9320cb940f288038031277e8',
    module: 'BOOT-INF/lib/ibiz-cloud-saas-extension-8.1.0.584.1.jar',
    existingEntries: [
      'sysmodel/saas-extension/PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme.json',
      'sysmodel/saas-extension/PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme/PSDEACTIONS/Save.json',
      'sysmodel/saas-extension/PSSYSSERVICEAPIS/api.json',
      'sysmodel/saas-extension/PSSYSSERVICEAPIS/core.json',
    ],
    addedEntries: [],
    readyUrl: 'http://127.0.0.1:30000/uaa/publickey', readyStatus: 200,
  },
};

export function validateRuntimeArchiveAudit(profile, report) {
  const spec = profiles[profile];
  assert.ok(spec);
  assert.equal(report.contract, spec.contract);
  assert.equal(report.status, 'PREPARED-NOT-DEPLOYED');
  assert.equal(report.deployed, false);
  assert.equal(report.serviceRestarted, false);
  assert.equal(report.original.sha256, spec.originalSha256);
  assert.deepEqual(report.outerAudit.entries.filter(item => item.changed).map(item => item.entry).sort(),
    [...(spec.modules ?? [spec.module])].sort());
  const changed = report.innerAudit.entries.filter(item => item.changed);
  assert.deepEqual(changed.filter(item => !item.added).map(item => item.entry).sort(),
    [...spec.existingEntries].sort());
  assert.deepEqual(changed.filter(item => item.added).map(item => item.entry).sort(),
    [...spec.addedEntries].sort());
  if (profile === 'portal') {
    assert.equal(report.dispatchProbe.status, 'PASS-LOCAL-PORTAL-DISPATCH-AND-REMOTE-FALLBACK');
    assert.equal(report.dispatchProbe.forwardedMethods, 9);
    assert.equal(report.dispatchProbe.remoteFallbackPaths, 3);
  } else if (profile === 'notfound') {
    assert.equal(report.originalProbe.rows.length, 10);
    assert.equal(report.candidateProbe.rows.length, 10);
    assert.equal(report.originalProbe.rows[0].status, 500);
    assert.equal(report.candidateProbe.rows[0].status, 404);
  } else if (profile === 'viewthemes') {
    assert.equal(report.accessProbe.status, 'PASS-VIEW-THEME-SCOPE-AND-SHARED-READ-MODEL');
    assert.equal(report.accessProbe.rows.length, 24);
    assert.equal(report.accessProbe.sharedReadOnly, true);
    assert.equal(report.accessProbe.personalRoleUnchanged, true);
    assert.equal(report.errorProbe.rows.length, 10);
    assert.equal(report.errorProbe.rows[0].status, 404);
    assert.deepEqual(report.errorAudit.entries.filter(item => item.changed).map(item => item.entry),
      ['net/ibizsys/central/cloud/core/service/util/ResponseExceptionHandler.class']);
  } else {
    assert.equal(report.saveProbe.status, 'PASS-EXPLICIT-KEYED-SAVE-CONTRACT');
    assert.equal(report.saveProbe.methods.length, 2);
    assert.ok(report.saveProbe.methods.every(item => item.resourceKeyRequired
      && item.dataAccess === 'CREATE' && item.actionAccess === 'CREATE'));
    assert.equal(report.accessProbe.status, 'PASS-VIEW-THEME-SCOPE-AND-SHARED-READ-MODEL');
    assert.equal(report.accessProbe.rows.length, 24);
    assert.equal(report.accessProbe.sharedReadOnly, true);
  }
  return spec;
}

function privateRead(filename) {
  assert.equal(fs.realpathSync(path.dirname(filename)), path.dirname(filename));
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && stat.nlink === 1 && !(stat.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function docker(args, input, timeout = 15000) {
  const result = spawnSync('docker', args, { input, timeout, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `Existing runtime operation failed: ${args[0]}`);
  return Buffer.from(result.stdout ?? '');
}

function runtime(spec, healthy = true) {
  const item = JSON.parse(docker(['inspect', spec.container]))[0];
  assert.equal(item.Id, spec.container);
  assert.equal(item.Image, spec.image);
  assert.equal(item.Name, spec.name);
  assert.ok(!item.Mounts.some(mount => spec.target === mount.Destination
    || spec.target.startsWith(`${mount.Destination}/`)), 'The archive target must not be a mounted resource');
  if (healthy) {
    assert.equal(item.State.Status, 'running');
    assert.equal(item.State.Health?.Status, 'healthy');
  }
  return { binding: { container: item.Id, image: item.Image,
    configurationSha256: hash(encode({ config: item.Config, host: item.HostConfig,
      mounts: item.Mounts.toSorted((a, b) => a.Destination.localeCompare(b.Destination)) })) },
  lifecycle: { status: item.State.Status, health: item.State.Health?.Status,
    startedAt: item.State.StartedAt, restartCount: item.RestartCount } };
}

function archiveMetadata(spec, filename = spec.target) {
  assert.ok(filename === spec.target
    || new RegExp(`^${spec.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.aibiz-[a-f0-9-]+(?:-restore)?\\.pending$`).test(filename));
  const raw = docker(['exec', '--user', '0', spec.container, 'sh', '-c', `set -eu
if test ! -e '${filename}' && test ! -L '${filename}'; then printf 'ABSENT\\n'; exit 0; fi
test -f '${filename}' && test ! -L '${filename}'
stat -c '%u:%g:%a:%d:%i:%h:%s' '${filename}'
sha256sum '${filename}'`]).toString().trim();
  if (raw === 'ABSENT') return { exists: false };
  const [metadata, checksum] = raw.split('\n');
  const [uid, gid, mode, dev, ino, nlink, bytes] = metadata.split(':');
  assert.equal(nlink, '1');
  return { exists: true, uid, gid, mode, dev, ino, nlink, bytes: Number(bytes), sha256: checksum.split(/\s/)[0] };
}

function sourceManifest() {
  const paths = ['scripts/deploy-existing-runtime-archive.mjs',
    'scripts/tests/deploy-existing-runtime-archive.test.mjs'];
  return paths.map(relative => ({ path: relative, sha256: hash(fs.readFileSync(path.join(workspace, relative))) }));
}

function loadCandidate(profile) {
  const spec = profiles[profile];
  assert.ok(spec);
  const directory = path.join(artifacts, spec.candidate);
  const bytes = privateRead(path.join(directory, 'report.private.json'));
  const report = JSON.parse(bytes);
  validateRuntimeArchiveAudit(profile, report);
  const verify = () => {
    assert.equal(hash(privateRead(path.join(directory, 'report.private.json'))), hash(bytes));
    assert.equal(hash(privateRead(report.original.path)), spec.originalSha256);
    assert.equal(hash(privateRead(report.candidate.path)), report.candidate.sha256);
    assert.equal(hash(fs.readFileSync(report.preparer.path)), report.preparer.sha256);
    assert.equal(hash(fs.readFileSync(path.join(workspace, report.helper.path))), report.helper.sha256);
    for (const item of report.sources) {
      assert.equal(hash(fs.readFileSync(path.join(workspace, item.path))), item.sha256);
    }
  };
  verify();
  return { spec, report, verify, receiptSha256: hash(bytes) };
}

function journal(output) {
  assert.equal(path.dirname(output), artifacts);
  assert.match(path.basename(output), /^existing-runtime-(?:prepare|apply|rollback)-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  let sequence = 0;
  const write = (name, bytes) => {
    const fd = fs.openSync(path.join(output, name), 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const dir = fs.openSync(output, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  };
  return { write, event: (stage, data) => write(`event-${String(++sequence).padStart(3, '0')}-${stage}.private.json`,
    encode({ stage, ...data, at: new Date().toISOString() })) };
}

function lock() {
  const filename = path.join(artifacts, '.existing-runtime-archive-writer.lock');
  const content = encode({ pid: process.pid, epoch: randomUUID() });
  const fd = fs.openSync(filename, fs.constants.O_CREAT | fs.constants.O_EXCL
    | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  fs.writeFileSync(fd, content); fs.fsyncSync(fd);
  const held = fs.fstatSync(fd);
  const assertHeld = () => {
    const current = fs.lstatSync(filename);
    assert.equal(current.dev, held.dev); assert.equal(current.ino, held.ino);
    assert.equal(hash(privateRead(filename)), hash(content));
  };
  return { assertHeld, release() {
    try { assertHeld(); fs.unlinkSync(filename); } finally { fs.closeSync(fd); }
  } };
}

export function prepare(profile, output, writer) {
  const candidate = loadCandidate(profile);
  const { spec, report, verify } = candidate;
  const log = journal(output);
  const before = runtime(spec);
  const original = archiveMetadata(spec);
  assert.equal(original.sha256, spec.originalSha256);
  const epoch = randomUUID();
  const pending = `${spec.target}.aibiz-${epoch}.pending`;
  const restorePending = `${spec.target}.aibiz-${epoch}-restore.pending`;
  assert.equal(archiveMetadata(spec, pending).exists, false);
  assert.equal(archiveMetadata(spec, restorePending).exists, false);
  log.write('original.private.jar', privateRead(report.original.path));
  log.write('candidate.private.jar', privateRead(report.candidate.path));
  for (const item of sourceManifest()) {
    log.write(`executed-${path.basename(item.path)}`, fs.readFileSync(path.join(workspace, item.path)));
  }
  writer.assertHeld();
  assert.deepEqual(runtime(spec), before);
  assert.deepEqual(archiveMetadata(spec), original);
  verify();
  const plan = { contract: 'existing-runtime-archive-plan-v1', status: 'PREPARED-NOT-APPLIED',
    profile, epoch, spec, before, original, candidate: report.candidate,
    candidateReceiptSha256: candidate.receiptSha256, sourceSeal: sourceManifest(),
    pending, restorePending, containerCreate: false, imagePull: false, unrelatedResources: false,
    maximumApplyRestarts: 1, maximumRecoveryRestarts: 1,
    trustedExclusiveWriterWindowRequired: true, atomicCompareAndSwapClaimed: false };
  log.write('prepared.private.json', encode(plan));
  return { status: plan.status, epoch, planSha256: hash(encode(plan)) };
}

export async function apply({ planPath, expectedSha256, output, writer, rollback = false, appliedReportPath }) {
  const planBytes = privateRead(planPath);
  assert.equal(hash(planBytes), expectedSha256);
  const plan = JSON.parse(planBytes);
  assert.equal(plan.contract, 'existing-runtime-archive-plan-v1');
  assert.deepEqual(plan.sourceSeal, sourceManifest());
  const candidate = loadCandidate(plan.profile);
  const { spec } = candidate;
  assert.deepEqual(spec, plan.spec);
  assert.equal(candidate.receiptSha256, plan.candidateReceiptSha256);
  const originalBytes = privateRead(path.join(path.dirname(planPath), 'original.private.jar'));
  const candidateBytes = privateRead(path.join(path.dirname(planPath), 'candidate.private.jar'));
  assert.equal(hash(originalBytes), spec.originalSha256);
  assert.equal(hash(candidateBytes), plan.candidate.sha256);
  const log = journal(output);
  let baseline = plan.before;
  let expected = plan.original;
  if (rollback) {
    const applied = JSON.parse(privateRead(appliedReportPath));
    assert.equal(applied.planSha256, expectedSha256);
    assert.equal(applied.status, 'APPLIED-SAME-CONTAINER-HEALTHY-BUSINESS-PENDING');
    baseline = applied.after;
    expected = applied.committed;
  }
  const result = { contract: 'existing-runtime-archive-apply-v1', profile: plan.profile,
    epoch: plan.epoch, planSha256: expectedSha256, status: 'VALIDATING', rollback,
    before: baseline, restartRequests: 0, recoveryRestartRequests: 0,
    containerCreate: false, imagePull: false, businessAcceptance: false };
  const guard = () => {
    writer.assertHeld();
    assert.deepEqual(sourceManifest(), plan.sourceSeal);
    candidate.verify();
    assert.deepEqual(runtime(spec, false), baseline);
  };
  const install = (bytes, current, stage) => {
    guard();
    assert.deepEqual(archiveMetadata(spec), current, 'The actual archive identity drifted');
    assert.equal(archiveMetadata(spec, stage).exists, false);
    log.event('stage-intent', { stage, before: current, sha256: hash(bytes), bytes: bytes.length });
    docker(['exec', '-i', '--user', '0', spec.container, 'sh', '-c', `set -eu
umask 077
set -C
exec 3>'${stage}'
dd conv=fsync status=none >&3
chown '${plan.original.uid}:${plan.original.gid}' /proc/$$/fd/3
chmod '${plan.original.mode}' /proc/$$/fd/3
exec 3>&-
sync '${stage}'`], bytes, 120000);
    const staged = archiveMetadata(spec, stage);
    assert.equal(staged.sha256, hash(bytes)); assert.equal(staged.bytes, bytes.length);
    assert.equal(staged.uid, plan.original.uid); assert.equal(staged.gid, plan.original.gid);
    assert.equal(staged.mode, plan.original.mode);
    log.event('stage-verified', { staged });
    guard();
    assert.deepEqual(archiveMetadata(spec), current);
    log.event('publish-intent', { stage, current, staged });
    docker(['exec', '--user', '0', spec.container, 'mv', '-T', stage, spec.target]);
    const actual = archiveMetadata(spec);
    assert.deepEqual(actual, staged);
    log.event('published', { actual });
    return actual;
  };
  const restartAndReady = async () => {
    log.event('restart-intent', { container: spec.container });
    docker(['restart', '--time', '20', spec.container], undefined, 45000);
    for (let attempt = 0; attempt < 150; attempt++) {
      const observed = runtime(spec, false);
      assert.deepEqual(observed.binding, baseline.binding);
      if (observed.lifecycle.status === 'running' && observed.lifecycle.health === 'healthy'
          && observed.lifecycle.startedAt !== baseline.lifecycle.startedAt) {
        let ready = false;
        try {
          const response = await fetch(spec.readyUrl, { signal: AbortSignal.timeout(3000), redirect: 'error' });
          ready = response.status === spec.readyStatus;
          await response.arrayBuffer();
        } catch {}
        if (ready) return observed;
      }
      if (attempt % 15 === 0) console.log(JSON.stringify({ phase: 'waiting-existing-runtime',
        profile: plan.profile, seconds: attempt, status: observed.lifecycle.status, health: observed.lifecycle.health }));
      await delay(1000);
    }
    throw new Error('The same container did not become ready in the bounded window');
  };
  try {
    guard();
    log.event('apply-intent', { planSha256: expectedSha256, baseline, expected });
    result.committed = install(rollback ? originalBytes : candidateBytes, expected,
      rollback ? plan.restorePending : plan.pending);
    result.restartRequests = 1;
    result.after = await restartAndReady();
    assert.deepEqual(archiveMetadata(spec), result.committed);
    candidate.verify();
    result.status = rollback ? 'ROLLED-BACK-SAME-CONTAINER-HEALTHY'
      : 'APPLIED-SAME-CONTAINER-HEALTHY-BUSINESS-PENDING';
    return result;
  } catch (error) {
    result.status = 'FAILED-RETAINED-FOR-REVIEW';
    result.error = error.message;
    const observed = runtime(spec, false);
    result.observed = observed;
    const actual = archiveMetadata(spec);
    result.actual = actual;
    if (!rollback && result.committed && actual.sha256 === plan.candidate.sha256
        && actual.ino === result.committed.ino && actual.dev === result.committed.dev
        && observed.lifecycle.status === 'running') {
      try {
        baseline = observed;
        result.recoveryCommitted = install(originalBytes, actual, plan.restorePending);
        result.recoveryRestartRequests = 1;
        result.recovered = await restartAndReady();
        result.recoveryStatus = 'RESTORED-EXACT-ORIGINAL-SAME-CONTAINER';
      } catch (recoveryError) { result.recoveryError = recoveryError.message; }
    }
    throw error;
  } finally { log.write('report.private.json', encode(result)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, rollback: { type: 'boolean' },
    profile: { type: 'string' }, output: { type: 'string' }, plan: { type: 'string' },
    'plan-sha256': { type: 'string' }, 'applied-report': { type: 'string' },
    'trusted-exclusive-writer-window': { type: 'boolean' },
  } });
  assert.equal([values.prepare, values.apply, values.rollback].filter(Boolean).length, 1);
  const writer = lock();
  try {
    if (!values.prepare) assert.equal(values['trusted-exclusive-writer-window'], true);
    const result = values.prepare ? prepare(values.profile, values.output, writer)
      : await apply({ planPath: values.plan, expectedSha256: values['plan-sha256'],
        output: values.output, writer, rollback: Boolean(values.rollback),
        appliedReportPath: values['applied-report'] });
    console.log(JSON.stringify({ status: result.status, profile: values.profile ?? result.profile,
      epoch: result.epoch, planSha256: result.planSha256,
      restartRequests: result.restartRequests, recoveryStatus: result.recoveryStatus }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { writer.release(); }
}
