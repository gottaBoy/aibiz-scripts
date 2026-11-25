import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  modelingConfigPolicyPaths, readOwnedModelingConfigPolicy,
} from '../owned-modeling-config-policy.mjs';

const workspace = resolve(import.meta.dirname, '../..');
const sources = new Map(modelingConfigPolicyPaths.map(path =>
  [path, readFileSync(resolve(workspace, path))]));
const read = path => sources.get(path);

test('configuration plan binds the source default deny policy without claiming loaded-runtime acceptance', () => {
  const policy = readOwnedModelingConfigPolicy({ read });
  assert.equal(policy.status, 'blocked-no-reviewed-maintenance-path');
  assert.deepEqual(policy.defaultRecordActions,
    { READ: true, CREATE: false, UPDATE: false, DELETE: false });
  assert.equal(policy.administratorBypassesDefaultRecordPolicy, false);
  assert.equal(policy.searchContextActions.recordWriteAuthorization, false);
  assert.deepEqual(policy.customManagerPrecedence, ['Entity-specific SysSFPlugin',
    'onCreateDataEntityAccessManager', 'PSConfigDEAccessManager SysSFPlugin',
    'default PSConfigDEAccessManager']);
  assert.equal(policy.reviewedMaintenancePath, null);
  assert.equal(policy.sourceOnly, true);
  assert.equal(policy.loadedRuntimeVerified, false);
  assert.equal(policy.pluginOverridesVerified, false);
  assert.deepEqual(policy.inputs.map(input => input.path), modelingConfigPolicyPaths);
  assert.ok(policy.inputs.every(input => input.bytes > 0 && /^[a-f0-9]{64}$/.test(input.sha256)));
});

test('policy changes cannot silently turn metadata CREATE into an approved maintenance operation', () => {
  const manager = modelingConfigPolicyPaths[2];
  for (const replacement of [
    'return true;',
    'if ("CREATE".equals(accessAction)) return true; return "READ".equals(accessAction);',
    'return "READ".equals(accessAction) || "DELETE".equals(accessAction);',
  ]) {
    assert.throws(() => readOwnedModelingConfigPolicy({ read: path => path === manager
      ? Buffer.from(read(path).toString().replace('return "READ".equals(accessAction);', replacement))
      : read(path) }), /policy changed/);
  }
});

test('a changed registry or default selection blocks generation pending review', () => {
  const registry = modelingConfigPolicyPaths[0];
  const selector = modelingConfigPolicyPaths[1];
  for (const [path, before, after] of [
    [registry, 'registerConfig(PSPF);', 'registerModel(PSPF);'],
    [registry, 'registerConfig(PSPFSTYLE);', ''],
    [selector, 'new PSConfigDEAccessManager()', 'new OtherManager()'],
  ]) {
    assert.throws(() => readOwnedModelingConfigPolicy({ read: input => input === path
      ? Buffer.from(read(input).toString().replace(before, after)) : read(input) }));
  }
});

test('a search overload change cannot be reported as the unchanged read-only record policy', () => {
  const manager = modelingConfigPolicyPaths[2];
  assert.throws(() => readOwnedModelingConfigPolicy({ read: path => path === manager
    ? Buffer.from(read(path).toString().replace('return true;', 'return false;'))
    : read(path) }), /search policy changed/);
});
