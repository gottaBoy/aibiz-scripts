import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PinnedDirectories } from '../native-candidate-files.mjs';
import { ownedWitnessCommand, prepareOwnedTokenWitness } from '../owned-uaa-token-witness.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { createApplicationAccounts, readApplicationAccountInput } from '../provision-run-owned-native-application-accounts.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runId = '123456789abc';
const imageId = `sha256:${'a'.repeat(64)}`;
const containerId = 'b'.repeat(64);
const redisName = `nf-${runId}-uaa-owned-check-redis`;
const token = 'eyJoZWFkZXIi.eyJjbGFpbXMi.signature';
const variant = `${token}x`;
const toolPath = 'scripts/provision-run-owned-native-application-accounts.mjs';

function temporary(t) {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'owned-uaa-input-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function accountFixture(t) {
  const root = temporary(t);
  const { manifest } = createFixture({
    runId, passwordStorageMode: 'sm3', modelVersion: 816, uaaSchemaMode: 'standalone-tables',
  });
  const base = join(root, '.artifacts/native-nonadmin-fixtures', runId);
  const directory = join(base, 'application-accounts-current');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tool = fs.readFileSync(join(workspace, toolPath));
  fs.mkdirSync(join(root, 'scripts'));
  fs.writeFileSync(join(root, toolPath), tool);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(join(base, 'manifest.json'), manifestBytes);
  const generated = createApplicationAccounts(manifest);
  const bytes = Buffer.from(JSON.stringify({
    passwords: generated.passwords, configuration: generated.configuration,
  }));
  fs.writeFileSync(join(directory, 'accounts.private.json'), bytes, { mode: 0o600 });
  const report = {
    contract: 'run-owned-native-application-accounts-v1', runId,
    status: 'passed-owned-application-account-sql-only', nativeAcceptance: false, permissionAcceptance: false,
    checks: Array.from({ length: 32 }, (_, i) => ({ name: `scoped-${i}`, status: 'passed' })),
    accounts: generated.accounts, createdUsers: generated.accounts.map(row => row.username),
    outputs: { 'accounts.private.json': { bytes: bytes.length, sha256: hash(bytes) } },
    inputs: [{ name: 'manifest.json', bytes: manifestBytes.length, sha256: hash(manifestBytes) }],
    generator: { path: toolPath, sha256: hash(tool) },
  };
  const save = () => fs.writeFileSync(join(directory, 'report.json'), JSON.stringify(report));
  save();
  return { root, base, directory, manifest, report, bytes, save };
}

test('account input selection binds the explicit label, manifest, private bytes and successful SQL receipt', t => {
  const f = accountFixture(t);
  const selected = readApplicationAccountInput({ workspace: f.root, runId, label: 'current', manifest: f.manifest });
  assert.equal(selected.binding.label, 'current');
  assert.equal(selected.binding.sha256, hash(f.bytes));
  assert.equal(selected.binding.path, join(f.directory, 'accounts.private.json'));
  assert.ok(!JSON.stringify(selected.binding).includes(selected.accounts.configuration.uaa['spring.datasource.password']));
});

for (const [name, mutate] of [
  ['failed receipt', f => { f.report.status = 'failed-owned-application-account-sql'; }],
  ['missing required checks', f => { f.report.checks.pop(); }],
  ['failed SQL check', f => { f.report.checks[0].status = 'failed'; }],
  ['foreign run', f => { f.report.runId = 'f'.repeat(12); }],
  ['changed private input', f => fs.appendFileSync(join(f.directory, 'accounts.private.json'), ' ')],
  ['changed manifest binding', f => { f.report.inputs[0].sha256 = '0'.repeat(64); }],
  ['foreign grants', f => { f.report.accounts[0].privileges = 'ALL PRIVILEGES'; }],
  ['missing account', f => { f.report.createdUsers.pop(); }],
  ['generator drift', f => fs.appendFileSync(join(f.root, toolPath), '\n')],
  ['public private file', f => fs.chmodSync(join(f.directory, 'accounts.private.json'), 0o644)],
  ['symlink private input', f => {
    fs.renameSync(join(f.directory, 'accounts.private.json'), join(f.directory, 'actual.private.json'));
    fs.symlinkSync('actual.private.json', join(f.directory, 'accounts.private.json'));
  }],
]) {
  test(`account selection rejects ${name}`, t => {
    const f = accountFixture(t);
    mutate(f);
    f.save();
    assert.throws(() => readApplicationAccountInput({ workspace: f.root, runId, label: 'current', manifest: f.manifest }));
  });
}

test('account selection rejects omitted, injected and traversing labels', t => {
  const f = accountFixture(t);
  for (const label of [undefined, '../current', 'current/r1', 'Current', 'a'.repeat(65)]) {
    assert.throws(() => readApplicationAccountInput({ workspace: f.root, runId, label, manifest: f.manifest }));
  }
});

function helperFixture(t, mutate = () => {}) {
  const output = temporary(t);
  const directories = new PinnedDirectories();
  t.after(() => directories.close());
  const calls = [];
  const docker = (args, allowFailure, input) => {
    calls.push({ args, allowFailure, input });
    if (args[0] === 'run') {
      fs.writeFileSync(join(output, 'token-witness-classes/RedisTokenStoreWitness.class'), 'compiled-fixture');
      return { status: 0, stdout: '', stderr: '' };
    }
    const request = JSON.parse(input);
    const row = {
      tokenSha256: hash(request.variant ?? request.token), stored: true,
      expiresAt: Date.now() + 60000, authenticationUsername: 'ordinary|owned',
      storeClass: 'org.springframework.security.oauth2.provider.token.store.redis.RedisTokenStore',
      storeOrigin: 'file:/opt/uaa/third-party/spring-security-oauth2-2.3.4.RELEASE.jar',
    };
    mutate(row);
    return { status: 0, stdout: JSON.stringify(row), stderr: '' };
  };
  return { output, directories, calls, helper: prepareOwnedTokenWitness({
    directories, output, workspace, imageId, runId, redisName, docker,
  }) };
}

test('real-store helper compiles offline and passes tokens only over exec stdin', t => {
  const f = helperFixture(t);
  let guards = 0;
  const store = f.helper.forContainer(containerId, () => { guards++; });
  assert.equal(store.read(token).tokenSha256, hash(token));
  assert.equal(store.storeVariant(token, variant).tokenSha256, hash(variant));
  assert.equal(store.retain(token).stored, true);
  assert.equal(guards, 6);
  const compile = f.calls[0].args;
  for (const flag of ['--network=none', '--read-only', '--pull=never', '-proc:none', '-implicit:none']) {
    assert.ok(compile.includes(flag));
  }
  assert.ok(compile.includes(imageId));
  assert.equal(f.calls.filter(row => row.args[0] === 'exec').length, 3);
  for (const row of f.calls.slice(1)) {
    assert.ok(!row.args.join(' ').includes(token));
    assert.ok(row.input.includes(token));
  }
  assert.ok(!JSON.stringify(f.helper.evidence).includes(token));
});

for (const [name, change] of [
  ['wrong token digest', row => { row.tokenSha256 = '0'.repeat(64); }],
  ['unrelated store', row => { row.storeClass = 'MockTokenStore'; }],
  ['wrong library origin', row => { row.storeOrigin = 'file:/unexpected.jar'; }],
  ['secret output field', row => { row.token = token; }],
]) {
  test(`helper rejects ${name}`, t => {
    const f = helperFixture(t, change);
    assert.throws(() => f.helper.forContainer(containerId, () => {}).read(token));
  });
}

test('helper rejects mutated classes, foreign Redis and uninspected container IDs', t => {
  const f = helperFixture(t);
  fs.appendFileSync(join(f.helper.classesPath, 'RedisTokenStoreWitness.class'), 'drift');
  assert.throws(() => f.helper.forContainer(containerId, () => {}).read(token));
  assert.throws(() => ownedWitnessCommand(containerId, 'redis'));
  assert.throws(() => ownedWitnessCommand('shared-uaa', redisName));
});

test('helper rejects changed staged implementation without executing a store operation', t => {
  const f = helperFixture(t);
  fs.appendFileSync(join(f.output, 'token-witness-source/RedisTokenStoreWitness.java'), '\n');
  assert.throws(() => f.helper.forContainer(containerId, () => {}).read(token));
  assert.equal(f.calls.length, 1);
});
