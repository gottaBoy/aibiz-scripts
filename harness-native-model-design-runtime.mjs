#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WORKSPACE } from './harness-modeling-core-audit.mjs';
import { captureRuntimeIdentity, localRuntimeEntry, runtimeEntries, verifyRuntimeIdentity } from './harness-native-ai-code-runtime.mjs';
import { PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { modelDesignActionKeys, modelDesignSelection } from './prepare-native-model-design-candidate.mjs';
import { runtimeLoaderImport, runtimeModelRepo } from './native-model-design-runtime.mjs';
import { verifyNativeAiCodeRuntimeAssets } from './prepare-native-ai-code-runtime-assets.mjs';
import {
  captureNativeLogin, expectedAuthenticationEvent,
} from '../modelingweb/app/tests/native-model-contract.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stages = [
  'http-delivery', 'factory-registration', 'native-esm-lazy-chunk', 'pluralize',
  'editor-render-and-worker', 'edit-prop-sync', 'readonly-toggle', 'unmount-cleanup',
];
const components = [
  'IBizModelClipboard', 'IBizModelClipboardItem', 'IBizModelClipboardImportView',
  'IBizModelClipboardPasteView', 'IBizDesignCodeEditor', 'IBizModelEditView',
  'IBizModelTree', 'IBizModelRuntime', 'IBizModelClone', 'IBizDSLModelClipboard',
  'IBizDSLModelClipboardImportView', 'IBizDSLModelEditView',
];
const modelFileNames = ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json'];
const querySource = 'ibiz-app-hub/packages/runtime/src/service/service/internal-message/internal-message.service.ts';
const queryModel = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/PSModule.json';
const routeModel = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnSysGridView.json';
const routeSources = [
  'ibiz-app-hub/components/ibiz-next-vue3/src/web-app/router/index.ts',
  'ibiz-app-hub/components/ibiz-next-vue3/src/util/app-util/app-util.ts',
  'ibiz-app-hub/packages/runtime/src/service/utils/res-path/res-path.ts',
];
const routeTemplate = '${context.modeldesignpath}psdevslnsys=${context.psdevslnsys}/modelingindex/-';

function verifyModelDesignRoot(root) {
  assert.equal(typeof root, 'string', 'ModelDesign root must be an explicit identifier');
  assert.match(root, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'Invalid ModelDesign root identifier');
  return root;
}

function modelDesignRootReadPath(root) {
  return `/api/ibizmodeling__modeldesign/psdevslnsys/${verifyModelDesignRoot(root)}/psmodules/fetchcursys`;
}

export function readModelDesignAuthentication({
  workspace = WORKSPACE, authenticate = false, modelDesignRoot, localDefaultRoot = false,
  nonAdminFixture, nonAdminUser, environment = process.env,
} = {}) {
  assert.equal(typeof authenticate, 'boolean', 'Authentication selection must be boolean');
  assert.equal(typeof localDefaultRoot, 'boolean', 'Local-default-root selection must be boolean');
  const fixtureSelected = nonAdminFixture !== undefined || nonAdminUser !== undefined;
  if (!authenticate) {
    assert.ok(!fixtureSelected, 'Owned fixture authentication requires --authenticate');
    assert.equal(localDefaultRoot, false, 'Local-default-root authentication requires --authenticate');
    return { evidence: { required: false, source: 'not-selected', permissionAcceptance: false } };
  }
  assert.ok(!(localDefaultRoot && fixtureSelected),
    'Local-default-root authentication cannot use a run-owned fixture');
  if (!fixtureSelected) {
    assert.ok(localDefaultRoot || modelDesignRoot === undefined,
      'Selected-root authentication requires an owned nonadmin fixture or --local-default-root');
    const username = environment.MODEL_DESIGN_USER;
    const password = environment.MODEL_DESIGN_PASSWORD;
    assert.ok(typeof username === 'string' && /^[A-Za-z0-9._@-]{1,128}$/.test(username),
      'Explicit MODEL_DESIGN_USER is required; there is no shared-account fallback');
    assert.ok(typeof password === 'string' && password.length > 0 && password.length <= 1024 &&
      !/[\x00-\x1f\x7f]/.test(password), 'Explicit MODEL_DESIGN_PASSWORD is required');
    return {
      credentials: { username, password },
      evidence: { required: true, source: 'explicit-environment', account: username,
        localDefaultRoot, nonAdminIdentityVerified: false, permissionAcceptance: false,
        ...(localDefaultRoot ? {
          boundary: 'Local-default-root route semantics only; no nonadmin or permission acceptance',
        } : undefined) },
    };
  }
  assert.equal(localDefaultRoot, false,
    'Run-owned selected-root authentication requires --modeldesign-root without --local-default-root');
  assert.ok(typeof nonAdminFixture === 'string' && typeof nonAdminUser === 'string',
    'Both --nonadmin-fixture and --nonadmin-user are required');
  verifyModelDesignRoot(modelDesignRoot);
  const directory = resolve(workspace, nonAdminFixture);
  const runId = relative(join(resolve(workspace), '.artifacts/native-nonadmin-fixtures'), directory);
  assert.match(runId, /^[a-f0-9]{12}$/, 'Expected an exact run-owned fixture directory');
  const directories = new PinnedDirectories();
  try {
    const parent = directories.open(directory);
    const manifestFile = readPinnedFile(directories, parent, 'manifest.json');
    const privateFile = readPinnedFile(directories, parent, 'credentials.private.json');
    assert.ok(privateFile.identity.uid === process.geteuid() &&
      (privateFile.identity.mode & 0o077) === 0, 'Fixture credentials must be private to the current owner');
    let manifest, privateData;
    try {
      manifest = JSON.parse(manifestFile.data);
      privateData = JSON.parse(privateFile.data);
    } catch { throw new Error('Invalid fixture JSON; private values suppressed'); }
    assert.equal(manifest.contract, 'run-owned-native-nonadmin-fixture-candidate-v1');
    assert.equal(manifest.runId, runId, 'Fixture run identity differs from its directory');
    assert.equal(manifest.ownership?.label, 'aibiz.native-fixture.run');
    assert.equal(manifest.ownership.value, runId);
    assert.equal(manifest.ownership.mysqlContainer, `nf-${runId}-mysql`);
    assert.equal(manifest.ownership.network, `nf-${runId}-private`);
    assert.equal(manifest.ownership.privateInternalNetworkRequired, true);
    assert.equal(manifest.ownership.publishedMysqlPortsAllowed, false);
    assert.equal(manifest.ownership.bindMountsAllowed, false);
    assert.equal(manifest.ownership.exclusiveOwnedSchemasRequired, true);
    assert.ok(Array.isArray(manifest.users) && Array.isArray(manifest.roots), 'Missing fixture identities');
    const users = manifest.users.filter(user => user?.loginname === nonAdminUser);
    assert.equal(users.length, 1, 'Expected one exact owned fixture user');
    const user = users[0];
    assert.equal(user.administrator, false, 'Administrative fixtures cannot establish nonadmin evidence');
    const suffix = { editor: 'e', viewer: 'v', 'no-access': 'n' }[user.role];
    assert.ok(suffix, 'Unknown fixture role');
    assert.equal(user.accessMode, { editor: 3, viewer: 1, 'no-access': null }[user.role]);
    const roots = manifest.roots.filter(root => root?.rootId === modelDesignRoot);
    assert.equal(roots.length, 1, 'Expected one exact owned fixture root');
    const root = roots[0];
    assert.ok(['a', 'b'].includes(root.side), 'Unknown fixture root side');
    const prefix = `nf_${runId}`;
    assert.equal(root.rootId, `${prefix}_root_${root.side}`);
    assert.equal(root.schemeId, `${prefix}_scheme_${root.side}`);
    assert.equal(root.modelInstanceId, `${prefix}_inst_${root.side}`);
    assert.equal(root.database, `${prefix}_model_${root.side}`);
    assert.equal(root.logicalSystemId, `${prefix}_system`);
    assert.equal(root.sentinelId, `${prefix}_module`);
    assert.ok(root.centerId === `${prefix}_center_a` || root.centerId === `${prefix}_center_b`,
      'Foreign fixture center');
    assert.equal(user.loginname, `${prefix}_${root.side}_${suffix}`);
    assert.equal(user.personId, `${prefix}_person_${root.side}_${suffix}`);
    assert.equal(user.id, user.personId);
    assert.equal(user.developerId, user.personId);
    assert.equal(user.userObjectId, user.personId);
    assert.equal(user.rootId, root.rootId);
    assert.equal(user.schemeId, root.schemeId);
    assert.equal(user.centerId, root.centerId);
    const password = privateData?.users?.[user.loginname];
    assert.ok(typeof password === 'string' && /^[a-f0-9]{36}$/.test(password),
      'Missing or invalid owned fixture credential; private values suppressed');
    return {
      credentials: { username: user.loginname, password },
      privateInputFingerprint: hash(Buffer.concat([manifestFile.data, privateFile.data])),
      evidence: {
        required: true, source: 'run-owned-native-nonadmin-fixture',
        runId, account: user.loginname, personId: user.personId, centerId: user.centerId,
        role: user.role, requestedRoot: root.rootId, systemId: root.logicalSystemId,
        modelInstanceId: root.modelInstanceId, modelRecordId: root.sentinelId,
        manifest: { path: relative(resolve(workspace), join(directory, 'manifest.json')),
          sha256: hash(manifestFile.data) },
        credentialsIncludedInEvidence: false, nonAdminIdentityVerified: false,
        permissionAcceptance: false,
        boundary: 'Run-owned identity input only; actual appdata identity and permissions are not yet verified',
      },
    };
  } finally { directories.close(); }
}

function verifyOwnedAccountBinding(expected) {
  assert.equal(expected?.source, 'run-owned-native-nonadmin-fixture', 'Expected an owned account input');
  assert.match(expected.runId ?? '', /^[a-f0-9]{12}$/, 'Invalid owned account run identity');
  const prefix = `nf_${expected.runId}`;
  const person = typeof expected.personId === 'string' &&
    expected.personId.match(new RegExp(`^${prefix}_person_([ab])_([evn])$`));
  assert.ok(person, 'Invalid owned person identity');
  const [, side, suffix] = person;
  assert.equal(expected.required, true);
  assert.equal({ editor: 'e', viewer: 'v', 'no-access': 'n' }[expected.role], suffix);
  assert.equal(expected.account, `${prefix}_${side}_${suffix}`);
  assert.equal(expected.requestedRoot, `${prefix}_root_${side}`);
  assert.equal(expected.modelInstanceId, `${prefix}_inst_${side}`);
  assert.equal(expected.systemId, `${prefix}_system`);
  assert.equal(expected.modelRecordId, `${prefix}_module`);
  assert.ok([`${prefix}_center_a`, `${prefix}_center_b`].includes(expected.centerId),
    'Invalid owned center identity');
  assert.equal(expected.credentialsIncludedInEvidence, false);
  assert.equal(expected.nonAdminIdentityVerified, false);
  assert.equal(expected.permissionAcceptance, false);
}

export function inspectModelDesignAccountIdentity(response, hostContext, expected, entry) {
  verifyOwnedAccountBinding(expected);
  const origin = new URL(entry).origin;
  assert.equal(response?.origin, origin, 'Identity evidence requires the native application origin');
  assert.equal(response.path, `/api/ibizmodeling__${new URL(entry).pathname.slice(1, -1)}/appdata`);
  assert.equal(response.method, 'GET');
  assert.equal(response.status, 200);
  assert.match(response.contentType ?? '', /^application\/json(?:\s*;|$)/i);
  assert.equal(response.responseMocked, false);
  let payload;
  try { payload = JSON.parse(response.body); }
  catch { throw new Error('Invalid appdata identity JSON; private values suppressed'); }
  const context = payload?.context;
  for (const current of [context, hostContext]) {
    assert.ok(current?.srfpersonid === expected.personId, 'Native identity does not match the owned person');
    assert.ok(current?.srfuserid === expected.personId, 'Native identity does not match the owned user');
    assert.ok(current?.srfdcid === expected.centerId, 'Native identity does not match the owned center');
  }
  return {
    status: 'PASS', source: 'actual-native-appdata-and-host-context',
    origin, path: response.path, method: response.method, httpStatus: response.status,
    contentType: response.contentType, responseSha256: hash(Buffer.from(response.body)),
    responseMocked: false, personId: expected.personId, centerId: expected.centerId,
    identityBindingVerified: true, nonAdminDeclaredByFixture: true,
    permissionAcceptance: false,
  };
}

export function nativeModelDesignPluginBaseUrl(entry) {
  const base = new URL(localRuntimeEntry(entry));
  assert.ok(['/central/', '/modeldesign/'].includes(base.pathname),
    'Expected a native application root, not a nested asset path');
  const pluginBase = new URL('plugins', base);
  assert.equal(pluginBase.origin, base.origin, 'Plugin assets must remain same-origin');
  return pluginBase.href.replace(/\/$/, '');
}

export function nativeModelDesignRootEntry(entry, root) {
  nativeModelDesignPluginBaseUrl(entry);
  const target = new URL(entry);
  assert.equal(target.pathname, '/modeldesign/', 'A root route is only valid for ModelDesign');
  if (root !== undefined) target.hash = `/psdevslnsys=${verifyModelDesignRoot(root)}/modelingindex/-`;
  return target.href;
}

function verifySelectedRootEvidence(app, root) {
  const target = new URL(nativeModelDesignRootEntry(app.entry, root));
  assert.equal(app.rootRoute?.requestedRoot, root);
  assert.equal(app.rootRoute.targetUrl, target.href);
  const targetRootPrefix = `#/psdevslnsys=${root}/modelingindex/`;
  assert.ok(typeof app.rootRoute.actualHash === 'string' &&
    app.rootRoute.actualHash.startsWith(targetRootPrefix),
    `Native route must stay under the selected root (expected prefix ${targetRootPrefix}, got ${app.rootRoute.actualHash})`);
  assert.equal(app.rootRoute.hostContextRoot, root);
  assert.equal(app.rootRoute.source, 'original-native-route-template');
  assert.equal(app.rootRoute.navigation, 'direct-route');
  assert.equal(app.rootRoute.centralOpenDesignActionExecuted, false);
  assert.equal(app.rootRoute.harnessContextOverrides, false);
  assert.ok(app.readQueries.some(query =>
    isModelDesignReadQuery(app.entry, query, { modelDesignRoot: root }) &&
    new URL(query.url).pathname === modelDesignRootReadPath(root) &&
    query.status === 200 && /^application\/json(?:\s*;|$)/i.test(query.contentType) &&
    query.responseMocked === false), 'No actual successful selected-root module query');
}

export function modelDesignWorkflowCoverage(app, { modelDesignRoot } = {}) {
  const factory = app.stages?.['factory-registration'];
  const registrations = Array.isArray(factory?.evidence?.registrations) ?
    factory.evidence.registrations : [];
  let rootStatus = 'NOT-RUN';
  if (modelDesignRoot !== undefined) {
    rootStatus = 'FAIL';
    try {
      verifySelectedRootEvidence(app, modelDesignRoot);
      assert.equal(app.authentication?.status, 'PASS');
      rootStatus = 'PASS';
    } catch {}
  }
  return {
    contract: 'isolated-model-design-workflow-coverage',
    nativeWorkflowExecuted: false,
    rootSelection: {
      status: rootStatus, requestedRoot: modelDesignRoot ?? null,
      centralOpenDesignActionExecuted: false,
      ...(modelDesignRoot === undefined ? { reason: 'No explicit root was selected' } :
        { navigation: 'direct-route' }),
    },
    componentEditing: {
      status: app.stages?.['edit-prop-sync']?.status === 'PASS' ? 'PASS' :
        app.stages?.['edit-prop-sync']?.status === 'FAIL' ? 'FAIL' : 'NOT-RUN',
      nativeView: false, persisted: false,
    },
    save: { status: 'NOT-RUN', reason: 'This read-only harness does not submit ImportModelV2' },
    refresh: { status: 'NOT-RUN', reason: 'No model save or native action refresh was executed' },
    freshSessionReadback: {
      status: 'NOT-RUN', reason: 'No saved model was read after a new authenticated browser session',
    },
    actions: modelDesignActionKeys.map(key => ({
      key,
      registration: factory?.status === 'PASS' && registrations.filter(item =>
        item?.key === key && typeof item.constructor === 'string' && item.constructor.length > 0 &&
        item.execActionCallable === true).length === 1 ? 'PASS' : 'NOT-VERIFIED',
      execution: 'NOT-RUN', nativeBehaviorVerified: false,
    })),
  };
}

export function isModelDesignReadQuery(entry, { method, url } = {}, { modelDesignRoot } = {}) {
  nativeModelDesignPluginBaseUrl(entry);
  if (modelDesignRoot !== undefined) verifyModelDesignRoot(modelDesignRoot);
  if (method !== 'POST') return false;
  const base = new URL(entry);
  let target;
  try { target = new URL(url); } catch { return false; }
  if (target.origin !== base.origin || target.username || target.password ||
      target.search || target.hash) return false;
  const app = base.pathname.slice(1, -1);
  return target.pathname === `/api/ibizmodeling__${app}/extension/internal_messages/fetch_cur_receiver` ||
    (app === 'modeldesign' && target.pathname === (modelDesignRoot === undefined ?
      '/api/ibizmodeling__modeldesign/psmodules/fetchcursys' : modelDesignRootReadPath(modelDesignRoot)));
}

function readQueryPolicy(workspace, modelDesignRoot) {
  if (modelDesignRoot !== undefined) verifyModelDesignRoot(modelDesignRoot);
  const inputs = [querySource, queryModel, routeModel, ...routeSources].map(path => {
    const bytes = fs.readFileSync(join(workspace, path));
    return { path, sha256: hash(bytes) };
  });
  const model = JSON.parse(fs.readFileSync(join(workspace, queryModel)));
  const method = model.getAllPSAppDEMethods.find(item => item.codeName === 'FetchCurSys');
  assert.equal(method.methodType, 'FETCH');
  assert.equal(method.requestMethod, 'POST');
  assert.equal(method.requestPath, '/fetchcursys');
  assert.equal(method.getPSAppDEMethodReturn.type, 'PAGE');
  assert.ok(method.getADPSDEDQConditions.some(condition =>
    condition.fieldName === 'PSSYSTEMID' && condition.condValue === 'pssystemid' &&
    condition.getPSVARTypeId === 'DATACONTEXT'));
  assert.ok(model.getMinorPSAppDERSs.some(relation =>
    relation.majorDECodeName === 'PSDevSlnSys' && relation.rSMode === 2));
  const actions = [];
  const pending = [JSON.parse(fs.readFileSync(join(workspace, routeModel)))];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.fullCodeName === 'PSDevSlnSys_OpenDesignIndex_Central') actions.push(node);
    pending.push(...Object.values(node));
  }
  assert.ok(actions.length > 0, 'Missing native OpenDesignIndex action');
  for (const action of actions) {
    assert.equal(action.frontProcessType, 'OPENHTMLPAGE');
    assert.equal(action.htmlPageUrl, routeTemplate);
    assert.ok(action.getPSNavigateContexts.some(context =>
      context.key === 'PSDEVSLNSYS' && context.value === 'psdevslnsysid' && context.rawValue === false));
  }
  return { contract: 'exact-same-origin-native-read-queries', inputs,
    modelDesignRoot: modelDesignRoot ?? null, routeTemplate,
    rootlessModelDesignQueryAllowed: modelDesignRoot === undefined,
    mutationEndpointsAllowed: false, responsesMocked: false };
}

export async function verifyModelDesignHttp(entry, pluginEntries, assetsEntries, { application, modelEntries } = {}) {
  const base = localRuntimeEntry(entry);
  assert.ok(['Central', 'ModelDesign'].includes(application), 'Expected a native application');
  assert.equal(new URL(base).pathname, `/${application.toLowerCase()}/`, 'Native model entry identity differs');
  const models = modelFileNames.map(name => {
    const path = `PSSYSAPPS/${application}/${name}`;
    const file = modelEntries?.find(item => item.path === path);
    assert.ok(file, `Missing candidate model: ${path}`);
    return { ...file, endpoint: name };
  });
  models.push({ ...models[0], endpoint: 'PSSYSAPP.hub.json' });
  const files = [
    ...pluginEntries.map(file => ({ ...file, path: `plugins/${modelDesignSelection.to}/${file.path}` })),
    ...assetsEntries.filter(file => file.path !== 'nginx-native.conf'),
    ...assetsEntries.filter(file => file.path.startsWith('plugins/monaco-editor@0.52.2/min/'))
      .map(file => ({ ...file, path: '/' + file.path })),
  ];
  const checks = new Array(files.length);
  let next = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      const url = new URL(file.path, base);
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      checks[index] = { path: url.pathname, status: response.status, bytes: bytes.length, sha256: hash(bytes) };
      assert.equal(response.status, 200, `HTTP status: ${url.pathname}`);
      assert.equal(bytes.length, file.bytes, `HTTP bytes: ${url.pathname}`);
      assert.equal(hash(bytes), file.sha256, `HTTP hash: ${url.pathname}`);
    }
  }));
  const missing = [];
  for (const path of [
    `plugins/${modelDesignSelection.from}/package.json`,
    `plugins/${modelDesignSelection.to}/missing.js`,
    'plugins/@ibiz-template-plugin/runtime-model@0.2.2/package.json',
  ]) {
    const response = await fetch(new URL(path, base), {
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 404, `Original/missing identity must not be aliased: ${path}`);
    missing.push({ path, status: response.status });
  }
  const modelChecks = [];
  for (const file of models) {
    const url = new URL(`/api/ibizmodeling__${application.toLowerCase()}/remotemodel/${file.endpoint}`, base);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200, `Native model HTTP status: ${url.pathname}`);
    assert.equal(bytes.length, file.bytes, `Native model HTTP bytes: ${url.pathname}`);
    assert.equal(hash(bytes), file.sha256, `Native model HTTP hash: ${url.pathname}`);
    modelChecks.push({
      source: file.path, path: url.pathname, status: response.status, bytes: bytes.length, sha256: hash(bytes),
    });
  }
  return { files: checks.length, checks, missing, modelChecks };
}

export function summarizeModelDesignRuntime(applications, expectedFiles, {
  authenticationRequired = false, modelDesignRoot, localDefaultRoot = false, authenticationBinding,
} = {}) {
  let passed = false;
  let runtimeFailure = { application: null, gate: 'application-topology' };
  try {
    assert.deepEqual(Object.keys(applications).sort(), ['Central', 'ModelDesign']);
    runtimeEntries(applications.Central.entry, applications.ModelDesign.entry);
    runtimeFailure = { application: null, gate: 'authentication-policy' };
    if (authenticationBinding !== undefined) {
      assert.ok(['not-selected', 'explicit-environment', 'run-owned-native-nonadmin-fixture']
        .includes(authenticationBinding?.source), 'Unknown authentication policy');
      assert.equal(authenticationBinding.required, authenticationRequired);
      assert.equal(authenticationBinding.source !== 'not-selected', authenticationRequired);
      assert.equal(authenticationBinding.permissionAcceptance, false);
      if (authenticationBinding.source === 'explicit-environment') {
        assert.equal(authenticationBinding.localDefaultRoot ?? false, localDefaultRoot,
          'Local-default-root evidence must match the selected mode');
        assert.ok(modelDesignRoot === undefined || localDefaultRoot,
          'Selected-root login cannot use environment credentials without the local-default-root mode');
        assert.equal(authenticationBinding.nonAdminIdentityVerified, false);
      }
    }
    for (const [application, app] of Object.entries(applications)) {
      runtimeFailure = { application, gate: 'application-identity' };
      verifyRuntimeIdentity(application, app.identity);
      runtimeFailure = { application, gate: 'runtime-errors' };
      assert.deepEqual(app.runtimeErrors, []);
      runtimeFailure = { application, gate: 'boot-errors' };
      assert.deepEqual(app.bootErrors, []);
      runtimeFailure = { application, gate: 'mutation-guard' };
      assert.deepEqual(app.blockedMutations, []);
      runtimeFailure = { application, gate: 'read-queries' };
      assert.ok(Array.isArray(app.readQueries));
      const queryOptions = application === 'ModelDesign' ? { modelDesignRoot } : {};
      for (const query of app.readQueries) {
        assert.equal(isModelDesignReadQuery(app.entry, query, queryOptions), true);
        assert.equal(query.status, 200, 'Native read query failed');
        assert.match(query.contentType, /^application\/json(?:\s*;|$)/i);
        assert.equal(query.responseMocked, false);
      }
      runtimeFailure = { application, gate: 'selected-root-route' };
      if (application === 'ModelDesign' && modelDesignRoot !== undefined) {
        verifySelectedRootEvidence(app, modelDesignRoot);
      } else {
        assert.equal(app.rootRoute, undefined, 'Root-route evidence requires an explicit root selection');
      }
      runtimeFailure = { application, gate: 'authentication' };
      if (authenticationRequired) {
        const login = app.authentication;
        assert.equal(login?.status, 'PASS');
        assert.equal(login.evidence.origin, new URL(app.entry).origin);
        assert.equal(login.evidence.path, `/api/ibizmodeling__${application.toLowerCase()}/v7/login`);
        assert.equal(login.evidence.method, 'POST');
        assert.equal(login.evidence.status, 200);
        assert.match(login.evidence.contentType, /^application\/json(?:\s*;|$)/i);
        assert.equal(login.evidence.tokenIssued, true);
        assert.equal(login.evidence.tokenPersisted, true);
        assert.ok(Array.isArray(app.expectedAuthEvents));
        assert.ok(app.expectedAuthEvents.every(event =>
          event.authenticated === false && expectedAuthenticationEvent(
            event, `ibizmodeling__${application.toLowerCase()}`)));
      } else {
        assert.deepEqual(app.expectedAuthEvents ?? [], []);
      }
      runtimeFailure = { application, gate: 'owned-account-identity' };
      if (authenticationBinding?.source === 'run-owned-native-nonadmin-fixture') {
        verifyOwnedAccountBinding(authenticationBinding);
        assert.equal(authenticationRequired, true);
        assert.equal(authenticationBinding.requestedRoot, modelDesignRoot);
        verifyModelDesignRoot(modelDesignRoot);
        const identity = app.accountIdentity;
        assert.equal(identity?.status, 'PASS');
        assert.equal(identity.source, 'actual-native-appdata-and-host-context');
        assert.equal(identity.origin, new URL(app.entry).origin);
        assert.equal(identity.path, `/api/ibizmodeling__${application.toLowerCase()}/appdata`);
        assert.equal(identity.method, 'GET');
        assert.equal(identity.httpStatus, 200);
        assert.match(identity.contentType, /^application\/json(?:\s*;|$)/i);
        assert.match(identity.responseSha256, /^[a-f0-9]{64}$/);
        assert.equal(identity.responseMocked, false);
        assert.equal(identity.personId, authenticationBinding.personId);
        assert.equal(identity.centerId, authenticationBinding.centerId);
        assert.equal(identity.identityBindingVerified, true);
        assert.equal(identity.nonAdminDeclaredByFixture, true);
        assert.equal(identity.permissionAcceptance, false);
      } else {
        assert.equal(app.accountIdentity, undefined, 'Owned-account evidence requires its authentication binding');
      }
      runtimeFailure = { application, gate: 'native-runtime-configuration' };
      assert.equal(app.runtimeConfiguration.pluginBaseUrl, nativeModelDesignPluginBaseUrl(app.entry));
      assert.equal(app.runtimeConfiguration.source, 'native-host-environment');
      assert.equal(app.runtimeConfiguration.harnessOverrides, false);
      runtimeFailure = { application, gate: 'required-component-stages' };
      assert.deepEqual(Object.keys(app.stages).sort(), [...stages].sort());
      for (const name of stages) assert.equal(app.stages[name].status, 'PASS');
      runtimeFailure = { application, gate: 'http-delivery' };
      const http = app.stages['http-delivery'].evidence;
      assert.ok(Number.isInteger(expectedFiles) && expectedFiles > 0);
      assert.equal(http.files, expectedFiles);
      assert.equal(http.checks.length, expectedFiles);
      assert.equal(new Set(http.checks.map(check => check.path)).size, expectedFiles);
      assert.ok(http.checks.every(check => check.status === 200 && check.bytes > 0 &&
        /^[a-f0-9]{64}$/.test(check.sha256)));
      assert.equal(http.missing.length, 3);
      assert.ok(http.missing.every(check => check.status === 404));
      const modelEndpoints = [...modelFileNames, 'PSSYSAPP.hub.json'];
      assert.equal(http.modelChecks.length, modelEndpoints.length);
      for (const [index, endpoint] of modelEndpoints.entries()) {
        const check = http.modelChecks[index];
        assert.equal(check.path, `/api/ibizmodeling__${application.toLowerCase()}/remotemodel/${endpoint}`);
        assert.equal(check.source, `PSSYSAPPS/${application}/${modelFileNames[index] ?? modelFileNames[0]}`);
        assert.equal(check.status, 200);
        assert.ok(Number.isInteger(check.bytes) && check.bytes > 0 && /^[a-f0-9]{64}$/.test(check.sha256));
      }
      assert.equal(http.modelChecks[0].bytes, http.modelChecks[3].bytes);
      assert.equal(http.modelChecks[0].sha256, http.modelChecks[3].sha256);
      runtimeFailure = { application, gate: 'factory-registration' };
      const factory = app.stages['factory-registration'].evidence;
      assert.deepEqual(factory.actionKeys, modelDesignActionKeys);
      assert.deepEqual(factory.components, components);
      assert.ok(Array.isArray(factory.registrations));
      assert.deepEqual(factory.registrations.map(item => item.key), modelDesignActionKeys);
      assert.ok(factory.registrations.every(item =>
        typeof item.constructor === 'string' && item.constructor.length > 0 &&
        item.execActionCallable === true), 'Missing actual callable action provider evidence');
      runtimeFailure = { application, gate: 'native-esm-lazy-chunk' };
      assert.equal(app.stages['native-esm-lazy-chunk'].evidence.ready, true);
      runtimeFailure = { application, gate: 'pluralize' };
      assert.equal(app.stages.pluralize.evidence.irregular, 'people');
      runtimeFailure = { application, gate: 'editor-render-and-worker' };
      const render = app.stages['editor-render-and-worker'].evidence;
      assert.deepEqual(render.diagnostics, []);
      assert.ok(render.width > 100 && render.height > 100);
      assert.equal(render.pluginBaseUrl, app.runtimeConfiguration.pluginBaseUrl);
      assert.equal(render.container, 'host-element-plus-dialog');
      assert.equal(render.nativeView, false);
      assert.equal(render.harnessFocusTrapOverrides, false);
      runtimeFailure = { application, gate: 'edit-prop-sync' };
      assert.equal(app.stages['edit-prop-sync'].evidence.value, 'const updatedValue = 2;');
      runtimeFailure = { application, gate: 'readonly-toggle' };
      const readonly = app.stages['readonly-toggle'].evidence;
      assert.equal(readonly.readonly, true);
      assert.equal(readonly.editableAgain, true);
      assert.equal(readonly.keyboardBlocked, true);
      assert.equal(readonly.keyboardEditableAgain, true);
      assert.equal(readonly.readonlyFocusVerified, true);
      assert.equal(readonly.editableFocusVerified, true);
      assert.equal(readonly.sameEditor, true);
      assert.equal(readonly.sameModel, true);
      assert.equal(readonly.harnessCorrection, false);
      runtimeFailure = { application, gate: 'unmount-cleanup' };
      const unmount = app.stages['unmount-cleanup'].evidence;
      assert.equal(unmount.editorsRestored, true);
      assert.equal(unmount.modelsRestored, true);
      assert.equal(unmount.editorDisposed, true);
      assert.equal(unmount.modelDisposed, true);
      assert.equal(unmount.editorDisposeEvents, 1);
      assert.equal(unmount.modelDisposeEvents, 1);
      assert.equal(unmount.hostRemoved, true);
      assert.equal(unmount.harnessCorrection, false);
      assert.deepEqual(unmount.editorIds, unmount.baselineEditorIds);
      assert.deepEqual(unmount.modelUris, unmount.baselineModelUris);
    }
    passed = true;
    runtimeFailure = null;
  } catch {}
  return {
    isolatedRuntimePassed: passed, nativeAccepted: false, acceptedForProduction: false,
    fullApplicationAcceptanceRequired: true, runtimeFailure,
  };
}

export async function observeModelDesignEditor(page, checkpoint) {
  return page.evaluate(name => {
    const test = window.__modelDesignProbe;
    if (!test?.editor) return { checkpoint: name, editorMissing: true };
    const editor = test.editor;
    const node = editor.getDomNode();
    const rect = node?.getBoundingClientRect();
    const hit = rect ? document.elementFromPoint(
      rect.left + Math.min(100, rect.width / 2),
      rect.top + Math.min(100, rect.height / 2),
    ) : null;
    const describe = element => element ? {
      tag: element.tagName, className: String(element.className),
    } : null;
    return {
      checkpoint: name, propReadonly: test.state.readonly,
      optionReadonly: editor.getOption(test.monaco.editor.EditorOption.readOnly),
      value: editor.getValue(), position: editor.getPosition(),
      editorId: editor.getId(), modelUri: editor.getModel()?.uri.toString(),
      hasTextFocus: editor.hasTextFocus(),
      activeWithinEditor: !!node?.contains(document.activeElement),
      activeElement: describe(document.activeElement),
      hitWithinEditor: !!node?.contains(hit), hitElement: describe(hit),
    };
  }, checkpoint);
}

export function assertModelDesignEditorFocus(observation) {
  assert.equal(observation.hasTextFocus, true, 'Keyboard checks require actual Monaco text focus');
  assert.equal(observation.activeWithinEditor, true, 'Active DOM focus must remain inside the owned editor');
}

export async function runNativeModelDesignRuntime({
  workspace = WORKSPACE, assets, output,
  centralUrl = 'http://127.0.0.1:32118/central/',
  modeldesignUrl = 'http://127.0.0.1:32119/modeldesign/',
  executablePath = process.env.CHROME_BIN || '/usr/bin/google-chrome',
  authenticate = false,
  modelDesignRoot, localDefaultRoot = false, nonAdminFixture, nonAdminUser,
} = {}) {
  workspace = resolve(workspace);
  assert.equal(typeof authenticate, 'boolean', 'Authentication selection must be boolean');
  const entries = runtimeEntries(centralUrl, modeldesignUrl);
  const modelDesignEntry = nativeModelDesignRootEntry(entries[1], modelDesignRoot);
  const destination = resolve(workspace, output ??
    join('.artifacts/native-model-design-runtime', `browser-${randomUUID()}`));
  assert.equal(dirname(destination), join(workspace, '.artifacts/native-model-design-runtime'));
  assert.match(relative(dirname(destination), destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.ok(!fs.existsSync(destination), 'Do not overwrite previous browser evidence');
  const startedAt = new Date().toISOString();
  const harnessPath = fileURLToPath(import.meta.url);
  const harnessSha256 = hash(fs.readFileSync(harnessPath));
  let verified, authentication;
  let preflightGate = 'source-preflight';
  try {
    verified = verifyNativeAiCodeRuntimeAssets({ workspace, assets });
    assert.ok(verified.receipt.modelDesignRuntime, 'Source-built model-design runtime evidence is required');
    preflightGate = 'authentication-preflight';
    authentication = readModelDesignAuthentication({
      workspace, authenticate, modelDesignRoot, localDefaultRoot, nonAdminFixture, nonAdminUser,
    });
  } catch (error) {
    const report = {
      schemaVersion: 1, contract: 'native-model-design-isolated-browser-runtime',
      startedAt, finishedAt: new Date().toISOString(), status: 'FAIL',
      expectedFiles: 0, authenticationRequired: authenticate, localDefaultRoot,
      sourcePreflight: { status: preflightGate === 'source-preflight' ? 'FAIL' : 'PASS',
        ...(preflightGate === 'source-preflight' ? { error: String(error) } : {}) },
      authenticationPreflight: { status: preflightGate === 'authentication-preflight' ? 'FAIL' : 'NOT-RUN',
        ...(preflightGate === 'authentication-preflight' ? { error: String(error) } : {}) },
      browserExecuted: false, applications: {}, errors: [String(error)],
      harnessEvidence: { path: relative(workspace, harnessPath), sha256: harnessSha256 },
      sourceIdentityReverified: false, harnessIdentityReverified: false,
      isolatedRuntimePassed: false, nativeAccepted: false, acceptedForProduction: false,
      fullApplicationAcceptanceRequired: true,
      runtimeFailure: { application: null, gate: preflightGate },
      boundary: 'Preflight failed; no browser, host request, action execution or model mutation was attempted',
    };
    const directories = new PinnedDirectories();
    try {
      const target = directories.open(destination, { create: true, exclusive: true });
      directories.write(target, 'report.json', JSON.stringify(report, null, 2) + '\n');
    } finally { directories.close(); }
    return { destination, report };
  }
  const pluginEntries = readTree(join(verified.candidate, 'plugins', modelDesignSelection.to),
    { jsonOnly: false }).entries;
  const modelEntries = readTree(join(verified.candidate, 'model')).entries;
  const delivery = verified.receipt.delivery.entries;
  const expectedFiles = pluginEntries.length + delivery.filter(file => file.path !== 'nginx-native.conf').length +
    delivery.filter(file => file.path.startsWith('plugins/monaco-editor@0.52.2/min/')).length;
  const report = {
    schemaVersion: 1, contract: 'native-model-design-isolated-browser-runtime',
    startedAt, expectedFiles, authenticationRequired: authenticate, localDefaultRoot,
    sourcePreflight: { status: 'PASS' }, browserExecuted: false,
    authenticationPreflight: { status: 'PASS' },
    authenticationPolicy: authentication.evidence,
    applications: {}, errors: [],
    harnessEvidence: { path: relative(workspace, harnessPath), sha256: harnessSha256 },
    sourceEvidence: {
      assets: relative(workspace, verified.directory),
      runtimeReceiptSha256: hash(fs.readFileSync(join(verified.directory, 'receipt.json'))),
      candidate: relative(workspace, verified.candidate),
      candidateReceiptSha256: hash(fs.readFileSync(join(verified.candidate, 'receipt.json'))),
      modelDesignRuntime: verified.receipt.modelDesignRuntime,
    },
    readQueryPolicy: readQueryPolicy(workspace, modelDesignRoot),
    boundary: 'Actual two native hosts and plugin factory; optional real login, no action execution, save, workflow navigation or fresh-session readback',
    nativeAccepted: false, acceptedForProduction: false,
  };
  const directories = new PinnedDirectories();
  const target = directories.open(destination, { create: true, exclusive: true });
  const require = createRequire(join(workspace, 'ibiz-app-hub/package.json'));
  let browser;
  try {
    browser = await require('playwright').chromium.launch({
      executablePath, headless: true, args: ['--no-sandbox'],
    });
    report.browserExecuted = true;
    for (const [application, entry] of [['Central', entries[0]], ['ModelDesign', entries[1]]]) {
      const pageEntry = application === 'ModelDesign' ? modelDesignEntry : entry;
      const queryOptions = application === 'ModelDesign' ? { modelDesignRoot } : {};
      const app = { entry, stages: {}, bootErrors: [], runtimeErrors: [], runtimeRequests: [],
        blockedMutations: [], expectedAuthEvents: [], readQueries: [] };
      report.applications[application] = app;
      const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      let runtimeStarted = false;
      let authenticating = false;
      let authenticated = false;
      const applicationId = `ibizmodeling__${application.toLowerCase()}`;
      const readQueries = new Map();
      const accountResponses = [];
      const record = error => {
        const event = { ...error, authenticated };
        if (authenticating && !authenticated && expectedAuthenticationEvent(event, applicationId)) {
          app.expectedAuthEvents.push(event);
        } else (runtimeStarted ? app.runtimeErrors : app.bootErrors).push(event);
      };
      page.on('pageerror', error => record({ kind: 'pageerror', text: String(error) }));
      page.on('console', message => {
        if (message.type() === 'error') {
          const source = message.location().url;
          record({ kind: 'console', text: message.text(),
            path: source ? new URL(source, entry).pathname : '' });
        }
      });
      page.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (authentication.evidence.source === 'run-owned-native-nonadmin-fixture' &&
            new URL(response.url()).origin === new URL(entry).origin &&
            path === `/api/${applicationId}/appdata` &&
            response.request().method() === 'GET' && response.status() === 200) {
          accountResponses.push(response.text().then(body => ({
            origin: new URL(response.url()).origin, path, method: 'GET',
            status: response.status(), contentType: response.headers()['content-type'] ?? '',
            body, responseMocked: false,
          })).catch(() => null));
        }
        const query = readQueries.get(response.request());
        if (query) Object.assign(query, {
          status: response.status(), contentType: response.headers()['content-type'] ?? '',
          responseMocked: false,
        });
        if (runtimeStarted && /\/(plugins|extras)\//.test(path)) {
          app.runtimeRequests.push({ path, status: response.status() });
        }
        if (response.status() >= 400) record({ kind: 'response', path, status: response.status() });
      });
      page.on('requestfailed', request => record({
        kind: 'requestfailed', path: new URL(request.url()).pathname, error: request.failure()?.errorText,
      }));
      await page.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (authenticating && request.method() === 'POST' &&
            url.origin === new URL(entry).origin &&
            url.pathname === `/api/${applicationId}/v7/login` &&
            !url.search && !url.hash) return route.continue();
        if (application === 'ModelDesign' && request.method() === 'POST' &&
            url.origin === new URL(entry).origin &&
            url.pathname === '/api/ibizmodeling__modeldesign/psmodules/fetchcursys' &&
            !url.search && !url.hash) {
          return route.continue();
        }
        if (isModelDesignReadQuery(entry, { method: request.method(), url: request.url() }, queryOptions)) {
          const query = { method: request.method(), url: request.url() };
          app.readQueries.push(query);
          readQueries.set(request, query);
          return route.continue();
        }
        if (!['GET', 'HEAD'].includes(route.request().method())) {
          app.blockedMutations.push({ method: route.request().method(), path: new URL(route.request().url()).pathname });
          return route.abort();
        }
        return route.continue();
      });
      const stage = async (name, run) => {
        try { app.stages[name] = { status: 'PASS', evidence: await run() }; }
        catch (error) {
          app.stages[name] = { status: 'FAIL', error: String(error) };
          if (name === 'readonly-toggle') {
            try {
              app.readonlyObserved.snapshots.push(await observeModelDesignEditor(page, 'failure'));
            } catch {
              app.readonlyObserved.snapshotFailed = true;
            }
          }
        }
      };
      try {
        await stage('http-delivery', () => verifyModelDesignHttp(entry, pluginEntries, delivery, {
          application, modelEntries,
        }));
        await stage('factory-registration', async () => {
          if (authenticate) {
            authenticating = true;
            try {
              await page.goto(pageEntry, { waitUntil: 'networkidle', timeout: 30_000 });
              await page.locator('input[type="password"]').first().waitFor({ timeout: 20_000 });
              await page.locator('input[type="text"]').first().fill(authentication.credentials.username);
              await page.locator('input[type="password"]').first().fill(authentication.credentials.password);
              const evidence = await captureNativeLogin(page, { entry, applicationId },
                () => page.getByRole('button', { name: '\u767b\u5f55', exact: true }).click());
              authenticated = true;
              app.authentication = { status: 'PASS', evidence };
            } catch {
              app.authentication = { status: 'FAIL', error: 'Real native login failed' };
              throw new Error('Real native login failed');
            } finally { authenticating = false; }
          }
          await page.goto(pageEntry, { waitUntil: 'networkidle', timeout: 30_000 });
          await page.waitForFunction(() => !!window.ibiz?.plugin && !!window.System, undefined, { timeout: 20_000 });
          if (authentication.evidence.source === 'run-owned-native-nonadmin-fixture') {
            try {
              await page.waitForFunction(expected => {
                const context = window.ibiz?.appData?.context;
                return context?.srfpersonid === expected.personId &&
                  context?.srfuserid === expected.personId && context?.srfdcid === expected.centerId;
              }, { personId: authentication.evidence.personId, centerId: authentication.evidence.centerId },
              { timeout: 20_000 });
              const hostContext = await page.evaluate(() => {
                const context = window.ibiz?.appData?.context;
                return { srfpersonid: context?.srfpersonid, srfuserid: context?.srfuserid,
                  srfdcid: context?.srfdcid };
              });
              const responses = (await Promise.all(accountResponses)).filter(Boolean);
              assert.ok(responses.length, 'No actual owned-account appdata response');
              app.accountIdentity = inspectModelDesignAccountIdentity(responses.at(-1),
                hostContext, authentication.evidence, entry);
            } catch {
              app.accountIdentity = { status: 'FAIL', error: 'Owned-account native identity binding failed',
                permissionAcceptance: false };
              throw new Error('Owned-account native identity binding failed');
            }
          }
          if (application === 'ModelDesign' && modelDesignRoot !== undefined) {
            try {
              await page.waitForFunction(root =>
                typeof window.ibiz?.appUtil?.getAppContext === 'function' &&
                window.ibiz.appUtil.getAppContext()?.psdevslnsys === root,
              modelDesignRoot, { timeout: 20_000 });
            } finally {
              app.rootRoute = await page.evaluate(({ root, targetUrl }) => ({
                requestedRoot: root, targetUrl, actualHash: window.location.hash,
                hostContextRoot: window.ibiz?.appUtil?.getAppContext?.()?.psdevslnsys ?? null,
                source: 'original-native-route-template', navigation: 'direct-route',
                centralOpenDesignActionExecuted: false, harnessContextOverrides: false,
              }), { root: modelDesignRoot, targetUrl: pageEntry });
            }
            const targetRootPrefix = `#/psdevslnsys=${modelDesignRoot}/modelingindex/`;
            assert.ok(app.rootRoute.actualHash.startsWith(targetRootPrefix),
              'Native route left the selected root');
          }
          app.runtimeConfiguration = await page.evaluate(() => ({
            pluginBaseUrl: ibiz.env.pluginBaseUrl,
            source: 'native-host-environment', harnessOverrides: false,
          }));
          assert.equal(app.runtimeConfiguration.pluginBaseUrl, nativeModelDesignPluginBaseUrl(entry),
            'Launch the isolated host with an absolute same-origin PLUGINBASEURL; the harness must not repair it');
          app.identity = await captureRuntimeIdentity(application, page);
          runtimeStarted = true;
          return page.evaluate(async ({ repo, actionKeys, components }) => {
            const loaded = await ibiz.plugin.loadPluginRef('@aibiz/model-design-candidate', repo);
            if (!loaded) throw new Error('PluginFactory rejected model-design candidate');
            const [vue, pinia, element] = await Promise.all(
              ['vue', 'pinia', 'element-plus'].map(name => System.import(name)));
            const hostApp = vue.createApp({ render: () => null });
            ibiz.plugin.register(hostApp);
            const registrations = actionKeys.map(key => {
              const provider = ibiz.register.get('UIACTION_' + key);
              if (!provider || typeof provider.execAction !== 'function') throw new Error('Missing action provider ' + key);
              return { key, constructor: provider.constructor.name, execActionCallable: true };
            });
            for (const name of components) {
              if (!hostApp.component(name)) throw new Error('Missing real component ' + name);
            }
            for (const name of ['modelClipboard', 'modelClipboardImportView', 'modelClipboardPasteView', 'dslModelClipboardImportView']) {
              if (!ibiz[name]?.state) throw new Error('Missing clipboard controller ' + name);
            }
            window.__modelDesignProbe = {
              vue, pinia, element, component: hostApp.component('IBizDesignCodeEditor'),
              state: vue.reactive({ value: 'const initialValue = 1;', readonly: false }), changes: [],
              pluginBaseUrl: ibiz.env.pluginBaseUrl,
            };
            return { actionKeys, registrations, components };
          }, { repo: modelDesignSelection.to, actionKeys: [...modelDesignActionKeys], components });
        });
        await stage('native-esm-lazy-chunk', async () => {
          const result = await page.evaluate(async loaderImport => {
            const loader = await System.import(loaderImport);
            await loader.applyPolyfills();
            await loader.defineCustomElements(window);
            const tags = ['ibiz-model-runtime', 'ibiz-model-runtime-list', 'loading-mask', 'loading-panel'];
            await Promise.race([
              Promise.all(tags.map(tag => customElements.whenDefined(tag))),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Custom elements timed out')), 15_000)),
            ]);
            const host = document.createElement('div');
            host.id = 'model-design-lazy-probe';
            const panel = document.createElement('loading-panel');
            const mask = document.createElement('loading-mask');
            host.append(panel, mask);
            document.body.append(host);
            await Promise.all([panel.componentOnReady(), mask.componentOnReady()]);
            const ready = !!panel.querySelector('*') && !!mask.querySelector('*');
            host.remove();
            return { ready, tags };
          }, runtimeLoaderImport);
          assert.equal(result.ready, true, 'Real source-built lazy components must render');
          assert.ok(app.runtimeRequests.some(request =>
            request.path.includes(`/plugins/${runtimeModelRepo}/dist/esm/ibiz-model-runtime_4.entry.js`) &&
            request.status === 200), 'Expected source-built Stencil lazy chunk was not consumed');
          return result;
        });
        await stage('pluralize', async () => {
          const result = await page.evaluate(async () => {
            const { default: pluralize } = await System.import('pluralize');
            return { irregular: pluralize('person', 2), singular: pluralize('people', 1),
              unchanged: pluralize('fish', 2), count: pluralize('box', 3, true) };
          });
          assert.deepEqual(result, { irregular: 'people', singular: 'person', unchanged: 'fish', count: '3 boxes' });
          return result;
        });
        await stage('editor-render-and-worker', async () => {
          await page.evaluate(async () => {
            const test = window.__modelDesignProbe;
            if (!test) throw new Error('Real installation prerequisite failed');
            test.loader = (await System.import('@monaco-editor/loader')).default;
            const existing = test.loader.__getMonacoInstance();
            test.baselineEditorIds = existing?.editor.getEditors().map(editor => editor.getId()).sort() ?? [];
            test.baselineModelUris = existing?.editor.getModels().map(model => model.uri.toString()).sort() ?? [];
            const host = document.createElement('div');
            host.id = 'model-design-editor-probe';
            host.style.cssText = 'position:fixed;inset:24px;z-index:10000;background:white;';
            document.body.append(host);
            test.host = host;
            if (!test.element.ElDialog) throw new Error('The native host must export a real ElDialog');
            test.dialogOpened = false;
            test.app = test.vue.createApp({
              // Use the host's modal stack rather than focusing outside its active drawer.
              render: () => test.vue.h(test.element.ElDialog, {
                modelValue: true, fullscreen: true, appendToBody: false,
                title: 'Model-design lifecycle probe', zIndex: 10000,
                closeOnClickModal: false, closeOnPressEscape: false, showClose: false,
                onOpened: () => { test.dialogOpened = true; },
              }, {
                default: () => test.vue.h('div', { style: 'height:calc(100vh - 110px);' }, [
                  test.vue.h(test.component, {
                    modelValue: test.state.value, readonly: test.state.readonly, language: 'typescript',
                    'onUpdate:modelValue': value => { test.changes.push(value); test.state.value = value; },
                  }),
                ]),
              }),
            });
            test.app.use(test.pinia.createPinia());
            test.app.use(test.element.default);
            ibiz.plugin.register(test.app);
            test.app.mount(host);
          });
          await page.waitForFunction(() => {
            const test = window.__modelDesignProbe;
            const monaco = test?.loader.__getMonacoInstance();
            const editor = monaco?.editor.getEditors().find(editor => test.host.contains(editor.getDomNode()));
            if (!editor) return false;
            test.monaco = monaco;
            test.editor = editor;
            if (!test.model) {
              test.model = editor.getModel();
              test.editorDisposeEvents = 0;
              test.modelDisposeEvents = 0;
              editor.onDidDispose(() => { test.editorDisposeEvents++; });
              test.model.onWillDispose(() => { test.modelDisposeEvents++; });
            }
            return test.dialogOpened && editor.getValue() === test.state.value &&
              !!test.host.querySelector('.monaco-editor .view-lines');
          }, undefined, { timeout: 30_000 });
          const screenshot = `${application.toLowerCase()}-editor.png`;
          await page.screenshot({ path: join(destination, screenshot), fullPage: true });
          app.editorScreenshot = screenshot;
          const result = await page.evaluate(async () => {
            const test = window.__modelDesignProbe;
            const worker = await test.monaco.languages.typescript.getTypeScriptWorker();
            const uri = test.editor.getModel().uri;
            const diagnostics = await Promise.race([
              worker(uri).then(client => client.getSyntacticDiagnostics(uri.toString())),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Real TS worker timed out')), 15_000)),
            ]);
            const rect = test.editor.getDomNode().getBoundingClientRect();
            return { diagnostics, width: rect.width, height: rect.height, value: test.editor.getValue(),
              pluginBaseUrl: test.pluginBaseUrl };
          });
          assert.deepEqual(result.diagnostics, []);
          assert.ok(result.width > 100 && result.height > 100);
          return { ...result, screenshot, container: 'host-element-plus-dialog',
            nativeView: false, harnessFocusTrapOverrides: false };
        });
        await stage('edit-prop-sync', async () => {
          await page.evaluate(() => {
            const test = window.__modelDesignProbe;
            if (!test?.editor) throw new Error('Editor rendering prerequisite failed');
            test.editor.setValue('const userEdit = 3;');
          });
          await page.waitForFunction(() => window.__modelDesignProbe.changes.includes('const userEdit = 3;'));
          await page.evaluate(() => { window.__modelDesignProbe.state.value = 'const updatedValue = 2;'; });
          await page.waitForFunction(() => window.__modelDesignProbe.editor.getValue() === 'const updatedValue = 2;');
          return page.evaluate(() => ({ value: window.__modelDesignProbe.editor.getValue(),
            changes: window.__modelDesignProbe.changes }));
        });
        await stage('readonly-toggle', async () => {
          app.readonlyObserved = { checkpoint: 'initial', snapshots: [] };
          const observe = async checkpoint => {
            app.readonlyObserved.checkpoint = checkpoint;
            const observation = await observeModelDesignEditor(page, checkpoint);
            app.readonlyObserved.snapshots.push(observation);
            return observation;
          };
          await observe('before-readonly');
          const before = await page.evaluate(() => window.__modelDesignProbe.editor.getValue());
          await page.evaluate(() => { window.__modelDesignProbe.state.readonly = true; });
          await observe('wait-readonly-option');
          await page.waitForFunction(() => {
            const test = window.__modelDesignProbe;
            return test?.editor?.getOption(test.monaco.editor.EditorOption.readOnly) === true;
          }, undefined, { timeout: 5000 });
          await page.evaluate(() => {
            const editor = window.__modelDesignProbe.editor;
            editor.setPosition({ lineNumber: 1, column: 1 });
            editor.focus();
          });
          assertModelDesignEditorFocus(await observe('readonly-keyboard'));
          await page.keyboard.type('BLOCKED');
          await page.evaluate(() => window.__modelDesignProbe.vue.nextTick());
          assertModelDesignEditorFocus(await observe('check-readonly-keyboard'));
          const blocked = await page.evaluate(() => window.__modelDesignProbe.editor.getValue());
          assert.equal(blocked, before, 'Readonly must block actual keyboard input, not only expose an option');
          await page.evaluate(() => { window.__modelDesignProbe.state.readonly = false; });
          await observe('wait-editable-option');
          await page.waitForFunction(() => {
            const test = window.__modelDesignProbe;
            return test?.editor?.getOption(test.monaco.editor.EditorOption.readOnly) === false;
          }, undefined, { timeout: 5000 });
          await page.evaluate(() => {
            const editor = window.__modelDesignProbe.editor;
            editor.setPosition({ lineNumber: 1, column: 1 });
            editor.focus();
          });
          assertModelDesignEditorFocus(await observe('editable-keyboard'));
          await page.keyboard.type('EDITABLE');
          assertModelDesignEditorFocus(await observe('wait-editable-keyboard'));
          await page.waitForFunction(value => window.__modelDesignProbe.editor.getValue() === `EDITABLE${value}`,
            before, { timeout: 5000 });
          await observe('check-editor-model-identity');
          const identity = await page.evaluate(() => {
            const test = window.__modelDesignProbe;
            return {
              sameEditor: test.monaco.editor.getEditors()
                .find(editor => test.host.contains(editor.getDomNode())) === test.editor,
              sameModel: test.editor.getModel() === test.model,
            };
          });
          assert.equal(identity.sameEditor, true, 'Readonly changes must not remount the editor');
          assert.equal(identity.sameModel, true, 'Readonly changes must preserve the model');
          return { readonly: true, editableAgain: true, keyboardBlocked: true,
            keyboardEditableAgain: true, readonlyFocusVerified: true, editableFocusVerified: true,
            harnessCorrection: false, ...identity };
        });
        await stage('unmount-cleanup', async () => {
          const result = await page.evaluate(async () => {
            const test = window.__modelDesignProbe;
            if (!test?.editor) throw new Error('Editor lifecycle prerequisite failed');
            test.app.unmount();
            test.host.remove();
            await test.vue.nextTick();
            const editorIds = test.monaco.editor.getEditors().map(editor => editor.getId()).sort();
            const modelUris = test.monaco.editor.getModels().map(model => model.uri.toString()).sort();
            return {
              editorsRestored: JSON.stringify(editorIds) === JSON.stringify(test.baselineEditorIds),
              modelsRestored: JSON.stringify(modelUris) === JSON.stringify(test.baselineModelUris),
              editorIds, modelUris, baselineEditorIds: test.baselineEditorIds,
              baselineModelUris: test.baselineModelUris,
              editorDisposed: test.editorDisposeEvents === 1,
              modelDisposed: test.model.isDisposed(),
              editorDisposeEvents: test.editorDisposeEvents,
              modelDisposeEvents: test.modelDisposeEvents,
              hostRemoved: !test.host.isConnected, harnessCorrection: false,
            };
          });
          app.cleanupObserved = result;
          assert.equal(result.editorsRestored, true, `Leaked editor: ${JSON.stringify(result)}`);
          assert.equal(result.modelsRestored, true, `Leaked model: ${JSON.stringify(result)}`);
          assert.equal(result.editorDisposed, true, 'The real component must dispose its owned editor');
          assert.equal(result.modelDisposed, true, 'The real component must dispose its owned model');
          assert.equal(result.modelDisposeEvents, 1, 'Expected one actual model disposal event');
          return result;
        });
      } finally { await context.close(); }
    }
  } catch (error) { report.errors.push(String(error)); }
  finally {
    try { if (browser) await browser.close(); }
    finally {
      try {
        const current = verifyNativeAiCodeRuntimeAssets({ workspace, assets });
        assert.equal(hash(fs.readFileSync(join(current.directory, 'receipt.json'))),
          report.sourceEvidence.runtimeReceiptSha256, 'Runtime receipt changed during browser run');
        assert.equal(hash(fs.readFileSync(join(current.candidate, 'receipt.json'))),
          report.sourceEvidence.candidateReceiptSha256, 'Candidate receipt changed during browser run');
        assert.equal(hash(fs.readFileSync(harnessPath)), harnessSha256, 'Harness changed during browser run');
        assert.deepEqual(readQueryPolicy(workspace, modelDesignRoot), report.readQueryPolicy,
          'Read-query source/model contract changed during browser run');
        const currentAuthentication = readModelDesignAuthentication({
          workspace, authenticate, modelDesignRoot, localDefaultRoot, nonAdminFixture, nonAdminUser,
        });
        assert.deepEqual(currentAuthentication.evidence, authentication.evidence, 'Authentication input changed');
        assert.ok(currentAuthentication.privateInputFingerprint === authentication.privateInputFingerprint &&
          currentAuthentication.credentials?.username === authentication.credentials?.username &&
          currentAuthentication.credentials?.password === authentication.credentials?.password,
        'Authentication credential input changed; private values suppressed');
        report.authenticationInputReverified = true;
        report.harnessIdentityReverified = true;
        report.sourceIdentityReverified = true;
      } catch (error) {
        report.sourceIdentityReverified = false;
        report.errors.push(String(error));
      }
      Object.assign(report, summarizeModelDesignRuntime(report.applications, expectedFiles, {
        authenticationRequired: authenticate, modelDesignRoot, localDefaultRoot,
        authenticationBinding: authentication.evidence,
      }));
      for (const [application, app] of Object.entries(report.applications)) {
        app.workflowCoverage = modelDesignWorkflowCoverage(app,
          application === 'ModelDesign' ? { modelDesignRoot } : {});
      }
      if (report.errors.length) report.isolatedRuntimePassed = false;
      report.finishedAt = new Date().toISOString();
      report.status = report.isolatedRuntimePassed ? 'PASS-ISOLATED-NOT-NATIVE-ACCEPTED' : 'FAIL';
      directories.write(target, 'report.json', JSON.stringify(report, null, 2) + '\n');
      directories.close();
    }
  }
  return { destination, report };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    assets: { type: 'string' }, output: { type: 'string' },
    'central-url': { type: 'string' }, 'modeldesign-url': { type: 'string' },
    'modeldesign-root': { type: 'string' },
    'local-default-root': { type: 'boolean' },
    'nonadmin-fixture': { type: 'string' }, 'nonadmin-user': { type: 'string' },
    authenticate: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/harness-native-model-design-runtime.mjs --assets PATH [--central-url URL --modeldesign-url URL --authenticate --output PATH] [--modeldesign-root RUN_OWNED_ROOT --nonadmin-fixture PATH --nonadmin-user USER | --local-default-root]');
    return 0;
  }
  const result = await runNativeModelDesignRuntime({
    assets: values.assets, output: values.output,
    authenticate: values.authenticate ?? false,
    ...(values['central-url'] ? { centralUrl: values['central-url'] } : {}),
    ...(values['modeldesign-url'] ? { modeldesignUrl: values['modeldesign-url'] } : {}),
    ...(values['modeldesign-root'] !== undefined ? { modelDesignRoot: values['modeldesign-root'] } : {}),
    ...(values['local-default-root'] !== undefined ? { localDefaultRoot: values['local-default-root'] } : {}),
    ...(values['nonadmin-fixture'] !== undefined ? { nonAdminFixture: values['nonadmin-fixture'] } : {}),
    ...(values['nonadmin-user'] !== undefined ? { nonAdminUser: values['nonadmin-user'] } : {}),
  });
  console.log(`${result.report.status}: ${result.destination}`);
  for (const [name, app] of Object.entries(result.report.applications)) {
    console.log(`${name}: ${Object.values(app.stages).filter(stage => stage.status === 'PASS').length}/${stages.length} stages PASS`);
  }
  return result.report.isolatedRuntimePassed ? 2 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; })
    .catch(error => { console.error(String(error)); process.exitCode = 1; });
}
