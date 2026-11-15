export const NATIVE_SYSTEM_CONTRACT_VERSION = '2026-11-15-source-v1';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const member of Object.values(value)) freeze(member);
    Object.freeze(value);
  }
  return value;
}

export const NATIVE_SYSTEM_FIELDS = freeze({
  routingContext: ['psdevslnsys', 'pssystemid'],
  proposedSummary: [
    'psdevslnsys', 'pssystemid', 'pssystemname', 'psdevslnsysname', 'codename', 'logicname',
  ],
  observedSettingsInfo: [
    'enablemultilan', 'pslanguagename', 'defsortmode', 'deexpmaxrowcnt',
    'serviceapiflag', 'accctrlarch', 'enableopnamemodel', 'saasmode',
    'enabledynasys', 'initdedefault', 'demsactionlogicflag', 'ssdemsactionlogicflag',
    'pubdbmodelflag', 'noviewmode', 'enabledbvaluemode', 'enablederfkey',
    'defsfitemwidth', 'piautoshowcaption', 'clemptytext', 'clemptytextpslanresname',
    'modelv2expmode', 'bugfixs',
  ],
  observedSettingsEditorExtra: [
    'dtoformat', 'scriptengine', 'codenamemode', 'enablepql', 'pssysenginecfgname',
    'pslanguageid', 'clemptytextpslanresid',
  ],
  observedRootInfo: [
    'psdevslnsysname', 'logicname', 'codename', 'pssfname', 'sysver', 'systype',
    'psdcmodeltemplname', 'systag', 'systag2', 'dbtypes', 'memo',
  ],
  settingsIdentityAndConcurrency: ['pssystemid', 'pssystemname', 'updatedate'],
  notSummarySystemFields: [
    'dsl', 'data', 'userparams', 'sysfolder', 'sysrowkey', 'defpssysdeployid',
    'pssysenginecfgid', 'pssysenginecfgname', 'srcpssystemid', 'srcpssystemname',
    'pssfid', 'pssfname', 'templengine', 'scriptengine',
  ],
  notSummaryRootFields: [
    'connstr', 'dbname', 'pssysmodelinstid', 'pssysmodelinstname', 'modelinstver',
    'psdevslnid', 'psdevcenterid', 'deploysysid', 'deploysystag', 'deploysystag2',
    'deploysystype', 'psdevcentersvnid', 'ropsdevcentersvnid', 'modelpsdevcentersvnid',
  ],
});

export const NATIVE_SYSTEM_READ_CONTRACT = freeze({
  status: 'source-proposal-not-implemented-or-runtime-accepted',
  routingContext: {
    existingPath: 'GET /api/ibizmodeling__modeldesign/appdata?psdevslnsys={root}',
    sourceFields: NATIVE_SYSTEM_FIELDS.routingContext,
    purpose: 'routing-identifiers-only-not-PSSYSTEM-READ',
  },
  summary: {
    proposedPath: 'GET /api/ibizmodeling__modeldesign/psdevslnsys/{root}/systemsummary',
    published: false,
    fields: NATIVE_SYSTEM_FIELDS.proposedSummary,
    source: 'validated-current-IPSDevSysUser-fields-not-system-DTO-copy',
    roles: ['root-reader', 'root-editor'],
  },
  settingsInfo: {
    proposedPath: 'GET /api/ibizmodeling__modeldesign/psdevslnsys/{root}/systemsettings',
    published: false,
    proposedReadRoles: ['root-reader', 'root-editor'],
    fields: [
      'psdevslnsys',
      ...NATIVE_SYSTEM_FIELDS.settingsIdentityAndConcurrency,
      ...NATIVE_SYSTEM_FIELDS.observedSettingsInfo,
    ],
  },
  settingsEditor: {
    publishedNarrowWrite: false,
    rolePrerequisite: 'root-editor-with-authorized-model-write-not-generic-runtime-admin',
    reviewedWriteAllowlist: [],
    visibleFieldsAreNotWriteAuthorization: true,
  },
  existingGenericReads: {
    get: {
      path: 'GET /api/ibizmodeling__modeldesign/psdevslnsys/{root}/pssystems/{logicalSystem}',
      returnedDTO: 'PSSystemDTO',
      narrow: false,
    },
    fetchDefault: {
      path: 'POST /api/ibizmodeling__modeldesign/psdevslnsys/{root}/pssystems/fetchdefault',
      returnedDTO: 'PSSystemDTO',
      narrow: false,
    },
    rootGet: {
      path: 'GET /api/ibizmodeling__modeldesign/psdevslnsys/{root}',
      returnedDTO: 'PSDevSlnSysDTO',
      narrow: false,
    },
    getCur: {
      sourceAction: 'PSSystem.GetCur',
      enableFront: false,
      publishedInReviewedModelAPI: false,
      returnedDTO: 'PSSystemDTO',
      narrow: false,
    },
  },
  defaultAuthorization: {
    registeredModelInstanceEntity: false,
    dedicatedAccessManager: false,
    modelAccessMode: 'SELF',
    genericReadNeedsMatchingRoles: true,
    runtimePluginOverridesMustBeAudited: true,
    effectiveRoleSources: [
      'default-entity-roles',
      'all-user-system-roles',
      'systemadmin-system-roles',
      'assigned-fixed-system-roles',
      'runtime-UAADEAuthority',
      'tested-dynamic-system-roles',
    ],
    dynamicRoleCacheBoundTo: ['authentication-user', 'token', 'dcsystemid'],
  },
});

const requiredGates = freeze([
  'current-authenticated-actor-and-developer-center-binding',
  'positive-unexpired-root-grant-and-server-resolved-logical-system',
  'explicit-typed-projection-not-DTO-or-entity-bag-serialization',
  'candidate-published-route-and-view-service-binding',
  'source-datasource-and-record-binding-before-settings-read-or-write',
  'real-reader-editor-no-access-foreign-root-and-expiry-HTTP-validation',
  'physical-cache-and-serialization-side-effect-comparison',
]);

// Policy design only. No role string or apparent response grants a real request.
export function describeNativeSystemAccess(profile, role, operation = 'read') {
  const knownRoles = ['root-reader', 'root-editor'];
  const knownProfiles = ['routingContext', 'summary', 'settingsInfo', 'settingsEditor'];
  if (!knownProfiles.includes(profile) || !knownRoles.includes(role) ||
    !['read', 'update'].includes(operation)) {
    return freeze({
      allowed: false, roleEligibleForProposal: false, reason: 'UNREVIEWED-PROFILE-ROLE-OR-OPERATION',
      requiredGates,
    });
  }
  const write = operation === 'update';
  const eligible = !write || (role === 'root-editor' && profile === 'settingsEditor');
  return freeze({
    allowed: false,
    roleEligibleForProposal: eligible,
    reason: write
      ? (eligible ? 'NARROW-WRITE-AND-PER-FIELD-POLICY-NOT-IMPLEMENTED' : 'ROLE-OR-PROFILE-CANNOT-WRITE')
      : (profile === 'routingContext'
        ? 'EXISTING-SOURCE-ROUTING-PROJECTION-NOT-DETAIL-OR-RUNTIME-ACCEPTANCE'
        : 'NARROW-DETAIL-ENDPOINT-NOT-IMPLEMENTED'),
    profile,
    role,
    operation,
    fields: write ? [] : (NATIVE_SYSTEM_READ_CONTRACT[profile].fields ||
      NATIVE_SYSTEM_READ_CONTRACT[profile].sourceFields || []),
    requiredGates,
  });
}

const ownValue = (value, field) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError('Projection fields must be own data properties');
  }
  return descriptor.value;
};

const validIdentifier = value => typeof value === 'string' && value.length > 0 &&
  !/[\s\u0000-\u001f\u007f]/.test(value);

// A future response-schema assertion, never authentication or a production DTO filter.
export function validateProposedNativeSystemSummary(record, binding) {
  if (!record || !binding || typeof record !== 'object' || typeof binding !== 'object' ||
    Array.isArray(record) || Array.isArray(binding)) {
    throw new TypeError('Expected summary and server-derived binding objects');
  }
  const fields = Reflect.ownKeys(record);
  if (fields.length !== NATIVE_SYSTEM_FIELDS.proposedSummary.length ||
    fields.some(field => !NATIVE_SYSTEM_FIELDS.proposedSummary.includes(field))) {
    throw new TypeError('Summary must contain exactly the reviewed projection fields');
  }
  const root = ownValue(binding, 'rootId');
  const logical = ownValue(binding, 'logicalSystemId');
  if (!validIdentifier(root) || !validIdentifier(logical) ||
    ownValue(record, 'psdevslnsys') !== root || ownValue(record, 'pssystemid') !== logical) {
    throw new TypeError('Summary identifiers differ from the server-derived root binding');
  }
  for (const field of NATIVE_SYSTEM_FIELDS.proposedSummary.slice(2)) {
    const value = ownValue(record, field);
    if (value !== null && typeof value !== 'string') {
      throw new TypeError('Summary labels must be plain text or null');
    }
  }
  return true;
}
