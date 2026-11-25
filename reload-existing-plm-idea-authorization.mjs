#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = 'e2b9db6202c28d519ff0080e67a1cdb4a635bb48793a4c33e5a9267cf0b64546';
const image = 'sha256:3988b0d18f23538b7961bea5e8cb1055c2c9f13d258875c99b34ae8a42758329';
const providerSha = '2b4d9064212bca8465f2351e5c34dcbf8b6ce27986e2b4edfa67ad223952fc38';
const base = 'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/idea';
const targetPaths = [`${base}/PSDEACTIONS/Create.json`, `${base}.json`,
  `${base}/PSDELOGICS/guard_create_product_access.json`];
const saveTargetPaths = [`${base}/PSDEACTIONS/Save.json`, `${base}.json`,
  `${base}/PSDELOGICS/guard_save_product_access.json`];
const updateTargetPaths = [`${base}/PSDEACTIONS/Save.json`, `${base}/PSDEACTIONS/Update.json`,
  `${base}.json`, `${base}/PSDELOGICS/guard_save_product_access.json`];
const hash = value => createHash('sha256').update(value).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const fileHash = relative => hash(fs.readFileSync(path.join(workspace, relative)));

function docker(args, timeout = 10000) {
  const result = spawnSync('docker', args, { timeout, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `Existing PLM operation failed: ${args[0]}`);
  return Buffer.from(result.stdout ?? '');
}

function runtime(requireHealthy = true) {
  const item = JSON.parse(docker(['inspect', container]))[0];
  assert.equal(item.Id, container);
  assert.equal(item.Image, image);
  if (requireHealthy) {
    assert.equal(item.State.Status, 'running');
    assert.equal(item.State.Health.Status, 'healthy');
  }
  const env = Object.fromEntries(item.Config.Env.map(value => {
    const index = value.indexOf('=');
    return [value.slice(0, index), value.slice(index + 1)];
  }));
  assert.equal(env.IBIZ_DEPLOYSYSTEMS_IBIZSERVICERUNNER_UPDATEDBSCHEMA, 'false');
  assert.equal(env.IBIZ_DEPLOYSYSTEMS_IBIZSERVICERUNNER_MODELPATH, '/app/model');
  assert.equal(env.IBIZ_SERVICEHUB_LOCALMODE, 'true');
  const mounts = item.Mounts.toSorted((a, b) => a.Destination.localeCompare(b.Destination));
  assert.ok(mounts.some(mount => mount.Source === path.join(workspace, 'plm/model')
    && mount.Destination === '/app/model' && mount.RW === false));
  return { binding: { id: item.Id, image: item.Image,
    configSha256: hash(encode({ config: item.Config, host: item.HostConfig, mounts })) },
  lifecycle: { startedAt: item.State.StartedAt, restartCount: item.RestartCount,
    status: item.State.Status, health: item.State.Health?.Status } };
}

function providerHash() {
  const output = docker(['exec', container, 'sha256sum', '/app/plm-provider.jar']).toString();
  const sha = output.split(/\s/)[0];
  assert.equal(sha, providerSha, 'The actual provider JAR must remain unchanged');
  return sha;
}

function write(output, name, bytes) {
  const fd = fs.openSync(path.join(output, name), 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function privateRead(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.geteuid() && !(stat.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

export function prepare(output, inheritBackups, saveGuard = false, updateGuard = false) {
  assert.ok(!(saveGuard && updateGuard));
  const targets = updateGuard ? updateTargetPaths : saveGuard ? saveTargetPaths : targetPaths;
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^plm-idea-create-authorization-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  const before = runtime();
  providerHash();
  let inherited;
  if (inheritBackups) {
    assert.equal(path.dirname(inheritBackups), path.join(workspace, '.artifacts'));
    const bytes = privateRead(path.join(inheritBackups, 'prepared.private.json'));
    const previous = JSON.parse(bytes);
    assert.equal(previous.contract, 'existing-plm-idea-create-model-reload-v1');
    assert.deepEqual(previous.targets, targets);
    assert.deepEqual(previous.before, before);
    assert.equal(fs.existsSync(path.join(inheritBackups, 'report.private.json')), false,
      'An already-applied plan cannot supply an untouched runtime baseline');
    inherited = { directory: inheritBackups, plan: previous, sha256: hash(bytes) };
  } else if (!updateGuard) assert.equal(fs.existsSync(path.join(workspace, targets[2])), false);
  const backups = (updateGuard ? targets : targets.slice(0, 2)).map((relative, index) => {
    const bytes = inherited
      ? privateRead(path.join(inherited.directory, inherited.plan.backups[index].backup))
      : fs.readFileSync(path.join(workspace, relative));
    if (inherited) assert.equal(hash(bytes), inherited.plan.backups[index].sha256);
    const name = `before-${index}.private.json`;
    write(output, name, bytes);
    return { path: relative, backup: name, sha256: hash(bytes) };
  });
  const plan = { contract: 'existing-plm-idea-create-model-reload-v1', status: 'PREPARED-NOT-APPLIED',
    before, providerSha256: providerSha, targets, backups, saveGuard, updateGuard,
    executorSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    ...(inherited ? { inheritedUntouchedRuntimeBackupPlanSha256: inherited.sha256 } : {}),
    testSha256: fileHash('scripts/tests/plm-idea-create-authorization.test.mjs'),
    recovery: 'Restore only these exact model inputs after comparing candidate hashes; remove only the new guard, then restart this same container once',
    maximumApplyRestarts: 1, schemaUpdate: false, imagePull: false, containerCreate: false };
  assert.deepEqual(runtime(), before);
  write(output, 'prepared.private.json', encode(plan));
  return { status: plan.status, planSha256: hash(encode(plan)) };
}

export async function apply(directory) {
  const bytes = privateRead(path.join(directory, 'prepared.private.json'));
  const plan = JSON.parse(bytes);
  const targets = plan.updateGuard ? updateTargetPaths : plan.saveGuard ? saveTargetPaths : targetPaths;
  assert.equal(plan.contract, 'existing-plm-idea-create-model-reload-v1');
  assert.equal(plan.executorSha256, hash(fs.readFileSync(fileURLToPath(import.meta.url))));
  assert.equal(plan.testSha256, fileHash('scripts/tests/plm-idea-create-authorization.test.mjs'));
  assert.deepEqual(runtime(), plan.before);
  providerHash();
  const original = plan.backups.map(item => {
    const data = privateRead(path.join(directory, item.backup));
    assert.equal(hash(data), item.sha256);
    return JSON.parse(data);
  });
  assert.deepEqual(plan.targets, targets);
  const values = targets.map(relative =>
    JSON.parse(fs.readFileSync(path.join(workspace, relative))));
  const [create, entity, guard] = plan.updateGuard ? values.slice(1) : values;
  const attachment = create.getPreparePSDEActionLogics[0];
  assert.equal(attachment.codeName, plan.updateGuard ? 'GuardUpdateProductAccess'
    : plan.saveGuard ? 'GuardSaveProductAccess' : 'GuardCreateProductAccess');
  assert.equal(attachment.attachMode, 'PREPARE');
  assert.equal(attachment.getPSDELogic.path, targets.at(-1).replace('plm/model/', ''));
  const expectedCreate = structuredClone(original[plan.updateGuard ? 1 : 0]);
  expectedCreate.getPreparePSDEActionLogics = [attachment];
  assert.deepEqual(create, expectedCreate, 'Only the early create authorization attachment may change');
  const expectedEntity = structuredClone(original[plan.updateGuard ? 2 : 1]);
  expectedEntity.getAllPSDEActions[expectedEntity.getAllPSDEActions.findIndex(item =>
    item.codeName === (plan.updateGuard ? 'Update' : plan.saveGuard ? 'Save' : 'Create'))] = create;
  if (plan.updateGuard) {
    const expectedSave = structuredClone(original[0]);
    assert.equal(expectedSave.getPreparePSDEActionLogics.length, 1);
    assert.equal(expectedSave.getPreparePSDEActionLogics[0].codeName, 'GuardSaveProductAccess');
    delete expectedSave.getPreparePSDEActionLogics;
    assert.deepEqual(values[0], expectedSave, 'Only the ineffective Save attachment may be removed');
    expectedEntity.getAllPSDEActions[expectedEntity.getAllPSDEActions.findIndex(item => item.codeName === 'Save')] = expectedSave;
    const index = expectedEntity.getAllPSDELogics.findIndex(item => item.codeName === guard.codeName);
    assert.ok(index >= 0);
    expectedEntity.getAllPSDELogics[index] = guard;
  } else expectedEntity.getAllPSDELogics.unshift(guard);
  assert.deepEqual(entity, expectedEntity, 'All other entity and role metadata must remain unchanged');
  const testResult = spawnSync(process.execPath, ['--test', 'scripts/tests/plm-idea-create-authorization.test.mjs'], {
    cwd: workspace, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024,
  });
  write(directory, 'focused-tests.private.log', `${testResult.stdout ?? ''}${testResult.stderr ?? ''}`);
  assert.equal(testResult.status, 0, 'The guard contract must pass before a runtime reload');
  const afterModels = targets.map(relative => ({ path: relative, sha256: fileHash(relative) }));
  const report = { contract: 'existing-plm-idea-create-model-reload-apply-v1',
    status: 'VALIDATING', planSha256: hash(bytes), before: plan.before, afterModels,
    providerSha256: providerSha, restartRequests: 0, imagePull: false, containerCreate: false,
    schemaUpdate: false, businessAcceptance: false };
  try {
    write(directory, 'intent.private.json', encode(report));
    assert.deepEqual(runtime(), plan.before);
    assert.deepEqual(targets.map(relative => ({ path: relative, sha256: fileHash(relative) })), afterModels);
    report.restartRequests = 1;
    docker(['restart', '--time', '20', container], 45000);
    for (let attempt = 0; attempt < 180; attempt++) {
      const observed = runtime(false);
      assert.deepEqual(observed.binding, plan.before.binding);
      if (observed.lifecycle.startedAt !== plan.before.lifecycle.startedAt &&
          observed.lifecycle.status === 'running' && observed.lifecycle.health === 'healthy') {
        providerHash();
        assert.deepEqual(targets.map(relative => ({ path: relative, sha256: fileHash(relative) })), afterModels);
        report.after = observed;
        report.status = 'APPLIED-SAME-CONTAINER-MODEL-RELOAD-HEALTHY';
        return report;
      }
      if (attempt % 20 === 0) console.log(JSON.stringify({ phase: 'waiting-existing-plm-health',
        seconds: attempt, status: observed.lifecycle.status, health: observed.lifecycle.health }));
      await delay(1000);
    }
    throw new Error('The existing PLM container did not become healthy in the bounded window');
  } catch (error) {
    report.status = 'FAILED-EXACT-MODEL-RECOVERY-REQUIRED';
    report.error = error.message;
    report.observed = runtime(false);
    throw error;
  } finally { write(directory, 'report.private.json', encode(report)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, directory: { type: 'string' },
    'inherit-backups': { type: 'string' },
    'save-guard': { type: 'boolean' },
    'update-guard': { type: 'boolean' },
  } });
  assert.equal([values.prepare, values.apply].filter(Boolean).length, 1);
  Promise.resolve(values.prepare ? prepare(values.directory, values['inherit-backups'],
    values['save-guard'], values['update-guard'])
    : apply(values.directory))
    .then(value => console.log(JSON.stringify(value))).catch(error => {
      console.error(error.message); process.exitCode = 1;
    });
}
