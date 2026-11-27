#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const YAML = require(path.join(workspace, 'ibiz-app-hub/node_modules/.pnpm/yaml@2.8.0/node_modules/yaml'));
const artifacts = path.join(workspace, '.artifacts');
const source = path.join(workspace, 'plm/deploy/compose/nacos-configs/deploysystem-ibizplm.txt');
const testSource = path.join(workspace, 'scripts/tests/configure-existing-plm-wiki.test.mjs');
const endpoint = 'http://127.0.0.1:8848/nacos/v1/cs/configs';
const identity = { dataId: 'deploysystem-ibizplm', group: 'ibiz_config_group' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export function assertWikiNacosInputIsActive(container) {
  assert.equal(container.Id, 'e2b9db6202c28d519ff0080e67a1cdb4a635bb48793a4c33e5a9267cf0b64546');
  const environment = Object.fromEntries(container.Config.Env.map(item => {
    const at = item.indexOf('=');
    assert.ok(at > 0);
    return [item.slice(0, at), item.slice(at + 1)];
  }));
  assert.notEqual(environment.IBIZ_SERVICEHUB_LOCALMODE?.toLowerCase(), 'true',
    'The existing provider selects local settings; Nacos deploysystem-ibizplm is not its active configuration');
  assert.equal(environment.SYSTEM_NAME, 'ibizplm', 'The running system is not the Nacos publication target');
  assert.equal(environment.IBIZ_SERVICEHUB_ID, 'ibizplm');
}

function assertActiveInput() {
  const result = spawnSync('docker', ['inspect',
    'e2b9db6202c28d519ff0080e67a1cdb4a635bb48793a4c33e5a9267cf0b64546'],
  { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0);
  const values = JSON.parse(result.stdout);
  assert.equal(values.length, 1);
  assertWikiNacosInputIsActive(values[0]);
}

export function addWikiParameter(text, origin) {
  const url = new URL(origin);
  assert.equal(url.origin, origin, 'Use an origin without a trailing slash or credentials');
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '30250');
  const document = YAML.parseDocument(text, { uniqueKeys: true });
  assert.equal(document.errors.length, 0, 'The existing configuration must parse without errors');
  const original = document.toJS();
  assert.equal(original.deploysystemid, 'ibizplm');
  assert.ok(original.settings && typeof original.settings === 'object');
  const previous = original.settings.param?.plm_wiki;
  assert.ok(previous === undefined || previous === origin, 'An existing public origin must not be overwritten');
  document.setIn(['settings', 'param', 'plm_wiki'], origin);
  const output = document.toString();
  const observed = YAML.parse(output);
  const expected = structuredClone(original);
  expected.settings.param = { ...expected.settings.param, plm_wiki: origin };
  assert.deepEqual(observed, expected, 'Only the wiki parameter may change');
  return output;
}

function privateRead(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.geteuid() && !(stat.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function outputDirectory(output) {
  assert.equal(path.dirname(output), artifacts);
  assert.match(path.basename(output), /^plm-wiki-config-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
}

function privateWrite(output, name, bytes) {
  const fd = fs.openSync(path.join(output, name),
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

async function currentConfig(request = fetch) {
  const response = await request(`${endpoint}?${new URLSearchParams(identity)}`, {
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}

function acquireConfigurationLock() {
  const filename = path.join(artifacts, '.plm-wiki-configuration-writer.lock');
  assert.equal(fs.realpathSync(path.dirname(filename)), artifacts);
  const bytes = encode({ pid: process.pid, epoch: randomUUID(), identity });
  const fd = fs.openSync(filename, fs.constants.O_CREAT | fs.constants.O_EXCL
    | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  const before = fs.fstatSync(fd);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } catch (error) {
    try {
      const current = fs.lstatSync(filename);
      if (current.dev === before.dev && current.ino === before.ino) fs.unlinkSync(filename);
    } finally { fs.closeSync(fd); }
    throw error;
  }
  const assertHeld = () => {
    const current = fs.lstatSync(filename);
    assert.equal(current.dev, before.dev);
    assert.equal(current.ino, before.ino);
    assert.equal(hash(privateRead(filename)), hash(bytes));
  };
  return { assertHeld, release() {
    try { assertHeld(); fs.unlinkSync(filename); }
    finally { fs.closeSync(fd); }
  } };
}

export async function writeWikiConfiguration({ expected, next, request = fetch }) {
  assert.ok(Buffer.isBuffer(expected) && Buffer.isBuffer(next));
  assert.equal(hash(await currentConfig(request)), hash(expected), 'Nacos input drifted');
  const report = { requestDispatched: false, expectedSha256: hash(expected),
    targetSha256: hash(next), readbackVerified: false };
  try {
    report.requestDispatched = true;
    const response = await request(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...identity, type: 'yaml', content: next.toString() }),
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.text()).trim(), 'true');
    report.observedSha256 = hash(await currentConfig(request));
    assert.equal(report.observedSha256, report.targetSha256, 'Nacos publication readback differs');
    report.readbackVerified = true;
    return report;
  } catch (error) {
    // A timed-out POST may have committed; retain its state without a speculative retry.
    try { report.observedSha256 = hash(await currentConfig(request)); } catch {}
    throw Object.assign(error, { evidence: report });
  }
}

function loadPlan(planPath, planSha256) {
  assert.equal(fs.realpathSync(path.dirname(path.dirname(planPath))), artifacts);
  assert.match(path.basename(path.dirname(planPath)), /^plm-wiki-config-[a-z0-9-]+$/);
  assert.equal(path.basename(planPath), 'prepared.private.json');
  const bytes = privateRead(planPath);
  assert.equal(hash(bytes), planSha256);
  const plan = JSON.parse(bytes);
  assert.equal(plan.contract, 'existing-plm-wiki-parameter-v1');
  assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.deepEqual(plan.identity, identity);
  assert.equal(plan.executorSha256, hash(fs.readFileSync(fileURLToPath(import.meta.url))));
  assert.equal(plan.testSha256, hash(fs.readFileSync(testSource)), 'Test input drifted');
  assert.equal(hash(privateRead(path.join(path.dirname(planPath), 'executed-configurator.private.mjs'))),
    plan.executorSha256);
  assert.equal(hash(privateRead(path.join(path.dirname(planPath), 'executed-test.private.mjs'))),
    plan.testSha256);
  const dir = path.dirname(planPath);
  const before = privateRead(path.join(dir, 'before.private.yaml'));
  const after = privateRead(path.join(dir, 'after.private.yaml'));
  const sourceBefore = privateRead(path.join(dir, 'source-before.private.yaml'));
  const sourceAfter = privateRead(path.join(dir, 'source-after.private.yaml'));
  assert.equal(hash(before), plan.beforeSha256);
  assert.equal(hash(after), plan.afterSha256);
  assert.equal(hash(sourceBefore), plan.sourceBeforeSha256);
  assert.equal(hash(sourceAfter), plan.sourceAfterSha256);
  assert.equal(addWikiParameter(before.toString(), plan.origin), after.toString());
  assert.equal(addWikiParameter(sourceBefore.toString(), plan.origin), sourceAfter.toString());
  return { plan, before, after };
}

export async function prepare(output) {
  assertActiveInput();
  outputDirectory(output);
  const before = await currentConfig();
  const sourceBefore = fs.readFileSync(source);
  const origin = 'http://127.0.0.1:30250';
  const after = Buffer.from(addWikiParameter(before.toString(), origin));
  const sourceAfter = Buffer.from(addWikiParameter(sourceBefore.toString(), origin));
  const plan = {
    contract: 'existing-plm-wiki-parameter-v1', status: 'PREPARED-NOT-APPLIED',
    identity, origin, executorSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    testSha256: hash(fs.readFileSync(testSource)),
    beforeSha256: hash(before), afterSha256: hash(after),
    sourceBeforeSha256: hash(sourceBefore), sourceAfterSha256: hash(sourceAfter),
    runtimeReload: false, databaseWrite: false, containerOperation: false,
    trustedExclusiveWriterWindowRequired: true, atomicCompareAndSwapClaimed: false,
  };
  for (const [name, bytes] of Object.entries({
    'before.private.yaml': before, 'after.private.yaml': after,
    'source-before.private.yaml': sourceBefore, 'source-after.private.yaml': sourceAfter,
    'executed-configurator.private.mjs': fs.readFileSync(fileURLToPath(import.meta.url)),
    'executed-test.private.mjs': fs.readFileSync(testSource),
    'prepared.private.json': encode(plan),
  })) privateWrite(output, name, bytes);
  assert.equal(hash(await currentConfig()), plan.beforeSha256);
  assert.equal(hash(fs.readFileSync(source)), plan.sourceBeforeSha256);
  return { status: plan.status, planSha256: hash(encode(plan)),
    effectiveParameterPreviouslyAbsent: YAML.parse(before.toString()).settings.param?.plm_wiki === undefined };
}

export async function apply({ output, planPath, planSha256, trustedExclusiveWriterWindow }) {
  assert.equal(trustedExclusiveWriterWindow, true);
  assertActiveInput();
  const { plan, before, after } = loadPlan(planPath, planSha256);
  outputDirectory(output);
  const lock = acquireConfigurationLock();
  const report = { contract: 'existing-plm-wiki-parameter-apply-v1',
    status: 'VALIDATING', planSha256, runtimeReload: false, databaseWrite: false };
  try {
    lock.assertHeld();
    assert.equal(hash(fs.readFileSync(source)), plan.sourceBeforeSha256, 'Source input drifted');
    privateWrite(output, 'intent.private.json', encode({ planSha256, beforeSha256: plan.beforeSha256 }));
    report.transition = await writeWikiConfiguration({ expected: before, next: after });
    lock.assertHeld();
    assert.equal(hash(fs.readFileSync(source)), plan.sourceBeforeSha256, 'Source drifted during publication');
    report.status = 'NACOS-APPLIED-RUNTIME-RELOAD-PENDING';
    report.sourceApplyPending = true;
  } catch (error) {
    report.status = 'FAILED-READBACK-REQUIRED';
    report.error = error.message;
    report.transition = error.evidence ?? report.transition;
    report.currentSha256 = hash(await currentConfig().catch(() => Buffer.from('unavailable')));
    throw error;
  } finally {
    try { privateWrite(output, 'report.private.json', encode(report)); }
    finally { lock.release(); }
  }
  return report;
}

export async function rollback({ output, planPath, planSha256, applyReportPath,
  applyReportSha256, trustedExclusiveWriterWindow }) {
  assert.equal(trustedExclusiveWriterWindow, true);
  const { plan, before, after } = loadPlan(planPath, planSha256);
  const appliedBytes = privateRead(applyReportPath);
  assert.equal(hash(appliedBytes), applyReportSha256);
  const applied = JSON.parse(appliedBytes);
  assert.equal(applied.contract, 'existing-plm-wiki-parameter-apply-v1');
  assert.equal(applied.planSha256, planSha256);
  assert.ok(['NACOS-APPLIED-RUNTIME-RELOAD-PENDING', 'FAILED-READBACK-REQUIRED'].includes(applied.status));
  assert.equal(applied.transition?.requestDispatched, true);
  // Source edits are reviewed separately; this command only restores the exact remote configuration.
  assert.ok([plan.sourceBeforeSha256, plan.sourceAfterSha256].includes(hash(fs.readFileSync(source))));
  outputDirectory(output);
  const lock = acquireConfigurationLock();
  const report = { contract: 'existing-plm-wiki-parameter-rollback-v1', status: 'VALIDATING',
    planSha256, applyReportSha256, runtimeReload: false, sourceRollbackExecuted: false,
    databaseWrite: false };
  try {
    lock.assertHeld();
    privateWrite(output, 'intent.private.json', encode({ planSha256,
      expectedSha256: plan.afterSha256, restoringSha256: plan.beforeSha256 }));
    report.transition = await writeWikiConfiguration({ expected: after, next: before });
    lock.assertHeld();
    report.status = 'NACOS-ROLLED-BACK-EXACT-RUNTIME-RELOAD-PENDING';
    return report;
  } catch (error) {
    report.status = 'FAILED-READBACK-REQUIRED';
    report.transition = error.evidence;
    report.error = error.message;
    throw error;
  } finally {
    try { privateWrite(output, 'report.private.json', encode(report)); }
    finally { lock.release(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, rollback: { type: 'boolean' },
    output: { type: 'string' }, 'apply-report': { type: 'string' },
    'apply-report-sha256': { type: 'string' },
    plan: { type: 'string' }, 'plan-sha256': { type: 'string' },
    'trusted-exclusive-writer-window': { type: 'boolean' },
  } });
  assert.equal([values.prepare, values.apply, values.rollback].filter(Boolean).length, 1);
  const options = {
    output: values.output, planPath: values.plan, planSha256: values['plan-sha256'],
    trustedExclusiveWriterWindow: values['trusted-exclusive-writer-window'],
    applyReportPath: values['apply-report'], applyReportSha256: values['apply-report-sha256'],
  };
  const result = values.prepare ? prepare(values.output) : values.rollback ? rollback(options) : apply(options);
  result.then(report => console.log(JSON.stringify(report))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
