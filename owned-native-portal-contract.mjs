export const NATIVE_PORTAL_CONTRACT_VERSION = '2026-11-15-source-v1';
export const NATIVE_PORTAL_APPLICATION = 'ibizmodeling__modeldesign';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const member of Object.values(value)) freeze(member);
    Object.freeze(value);
  }
  return value;
}

export const NATIVE_PORTAL_CONTRACTS = freeze({
  markOpenData: {
    publishedMethods: ['GET', 'POST'],
    actions: ['VIEW', 'EDIT', 'UPDATE', 'CLOSE'],
    access: 'authenticated-user-and-employee-context-not-record-root-authorization',
    effects: ['cache-read', 'cache-set', 'cache-reset', 'optional-cross-session-notification'],
    reason: 'OPEN-DATA-CACHE-AND-NOTIFICATION-CONTRACT-UNVERIFIED',
    requiredGates: [
      'owned-employee-and-mqtt-topic-binding',
      'entity-key-root-read-authorization',
      'exact-cache-before-after-and-timeout-observation',
      'notification-audience-isolation',
      'cleanup-contract-not-close-assumption',
    ],
  },
  dynamicDashboard: {
    publishedMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    access: 'generic-entity-role-gate-not-default-model-instance-grant',
    table: 'T_DYNADASHBOARD',
    physicalFields: [
      'DYNADASHBOARDID', 'DYNADASHBOARDNAME', 'TYPE', 'APPID', 'MODELID', 'USERID',
      'CREATEMAN', 'CREATEDATE', 'UPDATEMAN', 'UPDATEDATE', 'MODEL',
    ],
    rootField: { name: 'PSDEVSLNSYSID', physical: false, uiAssist: true },
    reason: 'DASHBOARD-ROOT-USER-AND-DATASOURCE-BINDING-UNVERIFIED',
    requiredGates: [
      'candidate-published-model-and-runtime-override-binding',
      'actual-table-schema-and-owned-record-preflight',
      'server-enforced-user-and-root-record-authorization',
      'read-response-owned-identity-and-model-validation',
      'write-snapshot-audit-and-owned-cleanup-contract',
    ],
  },
  systemOverviewCount: {
    publishedMethods: ['POST'],
    dataAccessAction: 'READ',
    declaredReturn: 'VOID',
    logicalSystemBinding: 'hardcoded-template-id-in-reviewed-source',
    queriedEntities: ['PSSysApp', 'PSDataEntity', 'PSSysServiceAPI', 'PSSysPFPlugin', 'PSSysSFPlugin'],
    effects: ['five-cur-sys-dataset-reads', 'in-memory-counter-assignment'],
    reason: 'OVERVIEW-HARDCODED-SYSTEM-AND-RETURN-CONTRACT-UNVERIFIED',
    requiredGates: [
      'source-authorized-logical-system-binding',
      'native-action-and-five-dataset-role-enforcement',
      'response-serialization-and-nonempty-counter-correctness',
      'full-physical-and-cache-readonly-comparison',
    ],
  },
});

const valueOf = (object, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError('Expected an own data property');
  }
  return descriptor.value;
};

function decision(kind, reason, extra = {}) {
  return freeze({
    allowed: false,
    recognized: kind !== null,
    kind,
    reason,
    contractVersion: NATIVE_PORTAL_CONTRACT_VERSION,
    ...extra,
  });
}

function segment(value) {
  if (typeof value !== 'string' || !value || /[%/\\\s\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Invalid path segment');
  }
  return value;
}

// This is an admission decision, not a server authorization or a forwarding helper.
// Current reviewed evidence opens no route; caller-provided flags cannot override it.
export function assessOwnedNativePortalRequest(request, scope) {
  let url;
  let parts;
  let method;
  let root;
  let dashboardId;
  let openDataKey;
  try {
    if (!request || !scope || typeof request !== 'object' || typeof scope !== 'object') {
      throw new TypeError('Expected request and owned scope');
    }
    const origin = valueOf(scope, 'origin');
    const application = valueOf(scope, 'applicationId');
    root = segment(valueOf(scope, 'rootId'));
    dashboardId = segment(valueOf(scope, 'dashboardId'));
    openDataKey = segment(valueOf(scope, 'openDataKey'));
    method = valueOf(request, 'method');
    const rawUrl = valueOf(request, 'url');
    if (application !== NATIVE_PORTAL_APPLICATION || typeof rawUrl !== 'string' ||
      !/^https?:\/\//.test(rawUrl) || /[\\\s\u0000-\u001f\u007f]/.test(rawUrl) ||
      typeof origin !== 'string' || typeof method !== 'string') {
      throw new TypeError('Invalid owned request binding');
    }
    url = new URL(rawUrl);
    const boundOrigin = new URL(origin);
    if (boundOrigin.origin !== origin || boundOrigin.username || boundOrigin.password ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(boundOrigin.hostname) ||
      url.origin !== origin || url.username || url.password || url.search || url.hash ||
      !['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      throw new TypeError('Request is outside the exact owned origin');
    }
    const rawPath = rawUrl.slice(rawUrl.indexOf('/', rawUrl.indexOf('://') + 3));
    if (rawPath !== url.pathname) throw new TypeError('Noncanonical URL path');
    parts = url.pathname.split('/').slice(1).map(value => segment(decodeURIComponent(value)));
    if (parts[0] !== 'api' || parts[1] !== application) {
      return decision(null, 'OUTSIDE-REVIEWED-APPLICATION');
    }
  } catch {
    return decision(null, 'MALFORMED-OR-UNBOUND-REQUEST');
  }

  const tail = parts.slice(2);
  if (tail[0] === 'portal' && tail[1] === 'markopendata') {
    const contract = NATIVE_PORTAL_CONTRACTS.markOpenData;
    if (![4, 5].includes(tail.length) || !contract.publishedMethods.includes(method)) {
      return decision('markOpenData', 'UNREVIEWED-MARK-OPEN-DATA-METHOD-OR-SHAPE');
    }
    const action = tail[4] || 'VIEW';
    if (!contract.actions.includes(action) || tail[2] !== 'pssystem' || tail[3] !== openDataKey) {
      return decision('markOpenData', 'UNBOUND-MARK-OPEN-DATA-ENTITY-KEY-OR-ACTION');
    }
    return decision('markOpenData', contract.reason, {
      operation: action,
      effectClass: 'cache-write-and-possible-notification',
      requiredGates: contract.requiredGates,
    });
  }

  if (tail[0] !== 'psdevslnsys' || tail[1] !== root) {
    return decision(null, 'OUTSIDE-EXACT-OWNED-ROOT');
  }
  if (tail[2] === 'modelobservations' && tail[3] === 'sysoverviewcnt') {
    const contract = NATIVE_PORTAL_CONTRACTS.systemOverviewCount;
    if (tail.length !== 4 || method !== 'POST') {
      return decision('systemOverviewCount', 'UNPUBLISHED-OVERVIEW-METHOD-OR-SHAPE');
    }
    return decision('systemOverviewCount', contract.reason, {
      operation: 'SysOverviewCnt',
      effectClass: 'source-read-intent-with-unverified-root-and-runtime-effects',
      requiredGates: contract.requiredGates,
    });
  }
  if (tail[2] === 'dynadashboards') {
    const contract = NATIVE_PORTAL_CONTRACTS.dynamicDashboard;
    let operation;
    if (tail.length === 3 && method === 'POST') operation = 'create';
    if (tail.length === 4) {
      if (tail[3] === 'fetchdefault' && method === 'POST') operation = 'dataset-read';
      else if (tail[3] === 'getdraft' && method === 'GET') operation = 'draft-create-permission';
      else if (tail[3] === 'checkkey' && method === 'POST') operation = 'key-check-create-permission';
      else if (tail[3] === 'save' && method === 'POST') operation = 'save';
      else if (!['fetchdefault', 'getdraft', 'checkkey', 'save'].includes(tail[3]) &&
        tail[3] === dashboardId) {
        operation = { GET: 'record-read', PUT: 'update', DELETE: 'remove' }[method];
      }
    }
    if (!operation) return decision('dynamicDashboard', 'UNBOUND-DASHBOARD-METHOD-KEY-OR-ACTION');
    return decision('dynamicDashboard', contract.reason, {
      operation,
      effectClass: ['record-read', 'dataset-read'].includes(operation)
        ? 'source-read-intent-with-unverified-record-scope'
        : 'write-or-create-permission-not-readonly',
      requiredGates: contract.requiredGates,
    });
  }
  return decision(null, 'OUTSIDE-REVIEWED-ROUTES');
}

export function allowOwnedNativePortalRequest(request, scope) {
  return assessOwnedNativePortalRequest(request, scope).allowed;
}
