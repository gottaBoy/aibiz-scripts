import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const core = 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core';
export const modelingConfigPolicyPaths = Object.freeze([
  `${core}/util/PSModels.java`,
  `${core}/security/SystemAccessManagerBase.java`,
  `${core}/dataentity/security/PSConfigDEAccessManager.java`,
]);

export function readOwnedModelingConfigPolicy({ read } = {}) {
  assert.equal(typeof read, 'function');
  const inputs = [];
  const [registry, selector, manager] = modelingConfigPolicyPaths.map(path => {
    const bytes = read(path);
    assert.ok(Buffer.isBuffer(bytes), 'Configuration policy requires source bytes');
    inputs.push({ path, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') });
    return bytes.toString('utf8');
  });
  for (const entity of ['PSPF', 'PSPFSTYLE', 'PSAPPTYPE']) {
    assert.ok(registry.includes(`registerConfig(${entity});`),
      `Configuration registration changed for ${entity}`);
    assert.ok(!registry.includes(`registerModel(${entity});`),
      `Configuration entity ${entity} is also registered as a model`);
  }
  assert.ok(selector.includes('PSModels.isConfigInstDataEntity(iDataEntityRuntime.getName())')
    && selector.includes('new PSConfigDEAccessManager()'),
  'Default configuration manager selection changed');
  const recordCheck = /public boolean testDataAccessAction\([\s\S]*?String accessAction\) throws Exception \{([^{}]*)\}/.exec(manager);
  assert.equal(recordCheck?.[1].trim(), 'return "READ".equals(accessAction);',
    'Configuration record policy changed; review before emitting a maintenance plan');
  const searchCheck = /protected boolean onTestDataAccessAction\([\s\S]*?ISearchContextDTO searchContextDTO,[\s\S]*?String accessAction\) throws Exception \{([^{}]*)\}/.exec(manager);
  assert.equal(searchCheck?.[1].trim(), 'return true;',
    'Configuration search policy changed; review the source contract');
  for (const selectorContract of ['String strPluginTag = String.format("%sDEAccessManager"',
    'this.onCreateDataEntityAccessManager(iDataEntityRuntime)', 'TAG_PCONFIGDEACCESSMANAGER']) {
    assert.ok(selector.includes(selectorContract), 'Configuration override precedence changed');
  }
  return {
    contract: 'owned-modeling-config-policy-source-v1',
    status: 'blocked-no-reviewed-maintenance-path',
    entities: ['PSPF', 'PSPFStyle', 'PSAppType'],
    defaultManager: 'PSConfigDEAccessManager',
    defaultRecordActions: { READ: true, CREATE: false, UPDATE: false, DELETE: false },
    administratorBypassesDefaultRecordPolicy: false,
    searchContextActions: { implementationReturnsTrue: true,
      recordWriteAuthorization: false,
      meaning: 'The search-context overload does not authorize record CREATE/UPDATE/DELETE.' },
    customManagerPrecedence: ['Entity-specific SysSFPlugin', 'onCreateDataEntityAccessManager',
      'PSConfigDEAccessManager SysSFPlugin', 'default PSConfigDEAccessManager'],
    reviewedMaintenancePath: null,
    sourceOnly: true, loadedRuntimeVerified: false, pluginOverridesVerified: false,
    inputs,
    nextGate: 'Identify and review a legitimate configuration maintenance/import path; ordinary CREATE/DELETE remain denied and historical SQL is not an owned row receipt.',
  };
}
