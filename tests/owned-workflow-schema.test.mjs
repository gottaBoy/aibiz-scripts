import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  readOwnedWorkflowConfiguration, verifyWorkflowGrants, verifyWorkflowProbe,
  workflowGrantSQL, workflowIdentity, workflowProbeCommand,
} from '../bootstrap-owned-workflow-schema.mjs';
import { sourceBuildInputs } from '../source-build-identity.mjs';

const runId = '123456789abc';
const identity = workflowIdentity(runId);

test('workflow identities are separate from UAA/metadata/model schemas and reject foreign identifiers', () => {
  assert.equal(identity.schema, `nf_${runId}_workflow`);
  assert.equal(identity.runtimeUser, `nf_${runId}_wf_app`);
  assert.notEqual(identity.runtimeUser, identity.bootstrapUser);
  assert.ok(identity.url.startsWith(`jdbc:mysql://nf-${runId}-mysql:3306/${identity.schema}?`));
  for (const run of ['shared', '123456789abC', '../../mysql', '', undefined]) {
    assert.throws(() => workflowIdentity(run));
  }
});

test('runtime grants allow only CRUD and migration privileges belong to a different scoped principal', () => {
  for (const bootstrap of [false, true]) {
    const user = bootstrap ? identity.bootstrapUser : identity.runtimeUser;
    const grant = workflowGrantSQL(identity, user, bootstrap);
    const observed = `GRANT USAGE ON *.* TO '${user}'@'%'\n${grant.slice(0, -1)}`;
    verifyWorkflowGrants(identity, user, observed, bootstrap);
    assert.ok(grant.includes(identity.schema.replaceAll('_', '\\_')));
    assert.equal(/CREATE|ALTER|DROP|INDEX/.test(grant), bootstrap);
    assert.equal(grant.includes('REFERENCES'), bootstrap);
    assert.throws(() => verifyWorkflowGrants(identity, user, `${observed}\nGRANT ALL PRIVILEGES ON *.* TO '${user}'@'%'`, bootstrap));
    assert.throws(() => verifyWorkflowGrants(identity, user, observed.replaceAll('\\_', '_'), bootstrap));
  }
  assert.throws(() => workflowGrantSQL(identity, 'root'));
  assert.throws(() => workflowGrantSQL({ ...identity, schema: 'shared' }, identity.runtimeUser));
});

test('helper commands use only the exact run network and read-only own inputs, never password arguments', () => {
  const options = {
    runId, label: 'fixture-r1', mode: 'verify', imageId: `sha256:${'a'.repeat(64)}`,
    dependencies: `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/workflow-schema-fixture-r1/dependencies`,
    classes: `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/workflow-schema-fixture-r1/helper-classes`,
  };
  const args = workflowProbeCommand(options);
  for (const flag of ['--rm', '--interactive', '--pull=never', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges']) {
    assert.ok(args.includes(flag));
  }
  assert.equal(args[args.indexOf('--network') + 1], `nf-${runId}-private`);
  assert.ok(!args.join(' ').includes('password'));
  for (const change of [
    o => { o.imageId = 'java:latest'; }, o => { o.mode = 'accept'; },
    o => { o.dependencies = '/shared'; }, o => { o.classes += ',rw'; },
    o => { o.label = 'foreign'; },
  ]) {
    const o = { ...options };
    change(o);
    assert.throws(() => workflowProbeCommand(o));
  }
});

test('exact library schema evidence requires real JDBC identity, engine boot and completed cleaned workflow', () => {
  const good = {
    mode: 'verify', engineBuilt: true, libraryVersion: '6.5.0.1', idmLibraryVersion: '6.5.0.1',
    engineOrigin: 'file:/dependencies/flowable-engine-6.4.2.jar',
    idmOrigin: 'file:/dependencies/flowable-idm-engine-6.4.2.jar',
    schema: identity.schema, sqlPrincipal: `${identity.runtimeUser}@%`,
    workflowCompleted: true, probeDeploymentRemoved: true,
  };
  verifyWorkflowProbe(good, identity, 'verify');
  for (const change of [
    r => { r.engineBuilt = false; }, r => { r.libraryVersion = '6.4.2'; },
    r => { r.schema = 'shared'; }, r => { r.sqlPrincipal = 'root@localhost'; },
    r => { r.engineOrigin = 'file:/unrelated.jar'; }, r => { delete r.workflowCompleted; },
    r => { r.probeDeploymentRemoved = false; }, r => { r.mode = 'bootstrap'; },
  ]) {
    const row = { ...good };
    change(row);
    assert.throws(() => verifyWorkflowProbe(row, identity, 'verify'));
  }
});

function workflowInputFixture(t) {
  const workspace = fs.mkdtempSync(join(os.tmpdir(), 'owned-workflow-input-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const original = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const directory = join(workspace, '.artifacts/native-nonadmin-fixtures', runId, 'workflow-schema-unit');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const hash = data => createHash('sha256').update(data).digest('hex');
  const tool = 'scripts/bootstrap-owned-workflow-schema.mjs';
  const source = 'scripts/fixtures/OwnedWorkflowSchemaProbe.java';
  for (const path of [tool, source]) {
    fs.mkdirSync(dirname(join(workspace, path)), { recursive: true });
    fs.copyFileSync(join(original, path), join(workspace, path));
  }
  for (const name of ['dependencies', 'helper-classes']) fs.mkdirSync(join(directory, name));
  fs.writeFileSync(join(directory, 'dependencies/exact.jar'), 'controlled dependency');
  fs.writeFileSync(join(directory, 'helper-classes/OwnedWorkflowSchemaProbe.class'), 'controlled helper');
  const config = { url: identity.url, username: identity.runtimeUser, schema: identity.schema,
    schemaUpdate: false, password: 'a'.repeat(36) };
  const bytes = Buffer.from(JSON.stringify(config));
  const configPath = join(directory, 'configuration.private.json');
  fs.writeFileSync(configPath, bytes, { mode: 0o600 });
  const packageReceipt = { path: join(workspace, '.artifacts/package/report.json'), sha256: 'b'.repeat(64) };
  const probe = mode => ({
    mode, engineBuilt: true, libraryVersion: '6.5.0.1', idmLibraryVersion: '6.5.0.1',
    engineOrigin: 'file:/dependencies/flowable-engine-6.4.2.jar',
    idmOrigin: 'file:/dependencies/flowable-idm-engine-6.4.2.jar', schema: identity.schema,
    sqlPrincipal: `${mode === 'verify' ? identity.runtimeUser : identity.bootstrapUser}@%`,
    ...(mode === 'verify' ? { workflowCompleted: true, probeDeploymentRemoved: true } : {}),
  });
  const report = {
    contract: 'run-owned-workflow-engine-schema-v1', runId, identity, errors: [],
    status: 'passed-owned-exact-library-workflow-schema-only', workflowSchemaVerified: true,
    droppedBootstrapUser: true, nativeAcceptance: false, permissionAcceptance: false, sourceClosure: false,
    packageReceipt: { ...packageReceipt }, generator: { path: tool, sha256: hash(fs.readFileSync(join(workspace, tool))) },
    helperSource: { path: source, sha256: hash(fs.readFileSync(join(workspace, source))) },
    bootstrap: probe('bootstrap'), verify: probe('verify'),
    dependencies: sourceBuildInputs(join(directory, 'dependencies')),
    helperClasses: sourceBuildInputs(join(directory, 'helper-classes')),
    configuration: { path: `.artifacts/native-nonadmin-fixtures/${runId}/workflow-schema-unit/configuration.private.json`,
      bytes: bytes.length, sha256: hash(bytes) },
  };
  const reportPath = join(directory, 'report.json');
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report), { mode: 0o600 });
  save();
  return { workspace, directory, configPath, report, save,
    options: { workspace, runId, reportPath, packageReceipt } };
}

test('workflow input binds exact package, private configuration, helper source/classes and library bytes', t => {
  const f = workflowInputFixture(t);
  const input = readOwnedWorkflowConfiguration(f.options);
  assert.equal(input.configuration.schema, identity.schema);
  assert.equal(input.configuration.schemaUpdate, false);
  assert.ok(!JSON.stringify(input.binding).includes('a'.repeat(36)));
});

for (const [name, mutate] of [
  ['failed schema', f => { f.report.workflowSchemaVerified = false; }],
  ['DDL principal retained', f => { f.report.droppedBootstrapUser = false; }],
  ['native promotion', f => { f.report.nativeAcceptance = true; }],
  ['package mismatch', f => { f.report.packageReceipt.sha256 = 'c'.repeat(64); }],
  ['foreign identity', f => { f.report.runId = 'f'.repeat(12); }],
  ['workflow not completed', f => { f.report.verify.workflowCompleted = false; }],
  ['undeleted deployment', f => { f.report.verify.probeDeploymentRemoved = false; }],
  ['changed private bytes', f => fs.appendFileSync(f.configPath, ' ')],
  ['public configuration', f => fs.chmodSync(f.configPath, 0o644)],
  ['changed library', f => fs.appendFileSync(join(f.directory, 'dependencies/exact.jar'), 'drift')],
  ['changed helper', f => fs.appendFileSync(join(f.directory, 'helper-classes/OwnedWorkflowSchemaProbe.class'), 'drift')],
  ['changed maintained tool', f => fs.appendFileSync(join(f.workspace, 'scripts/bootstrap-owned-workflow-schema.mjs'), '\n')],
]) {
  test(`workflow input rejects ${name}`, t => {
    const f = workflowInputFixture(t);
    mutate(f);
    f.save();
    assert.throws(() => readOwnedWorkflowConfiguration(f.options));
  });
}
