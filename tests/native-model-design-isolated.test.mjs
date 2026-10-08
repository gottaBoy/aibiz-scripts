import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { isolatedLaunchInput, verifyIsolatedContainerState } from '../native-model-design-isolated-launch.mjs';
import {
  assertModelDesignEditorFocus, nativeModelDesignPluginBaseUrl, observeModelDesignEditor,
  inspectModelDesignAccountIdentity, isModelDesignReadQuery, modelDesignWorkflowCoverage,
  nativeModelDesignRootEntry, readModelDesignAuthentication, runNativeModelDesignRuntime,
  summarizeModelDesignRuntime, verifyModelDesignHttp,
} from '../harness-native-model-design-runtime.mjs';
import { modelDesignActionKeys } from '../prepare-native-model-design-candidate.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { WORKSPACE } from '../harness-modeling-core-audit.mjs';

const options = {
  workspace: WORKSPACE, candidate: `${WORKSPACE}/.artifacts/native-model-migration/unit-candidate`,
  assets: `${WORKSPACE}/.artifacts/native-ai-code-runtime-assets/unit-assets`, name: 's07-unit-isolated',
};

test('source preflight failure leaves an honest immutable report without launching a browser or contacting hosts', async t => {
  const output = join(WORKSPACE, '.artifacts/native-model-design-runtime', `test-preflight-${randomUUID()}`);
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  let requests = 0;
  const server = createServer((_, response) => { requests += 1; response.end('must not be requested'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = () => runNativeModelDesignRuntime({
    output, authenticate: true,
    assets: join(WORKSPACE, '.artifacts/native-ai-code-runtime-assets', `missing-${randomUUID()}`),
    centralUrl: `${base}/central/`, modeldesignUrl: `${base}/modeldesign/`,
    executablePath: '/deliberately-missing-browser',
  });
  const result = await run();
  const bytes = fs.readFileSync(join(output, 'report.json'));
  assert.deepEqual(JSON.parse(bytes), result.report);
  assert.equal(result.report.status, 'FAIL');
  assert.equal(result.report.sourcePreflight.status, 'FAIL');
  assert.equal(result.report.browserExecuted, false);
  assert.equal(result.report.sourceIdentityReverified, false);
  assert.equal(result.report.harnessIdentityReverified, false);
  assert.equal(result.report.isolatedRuntimePassed, false);
  assert.equal(result.report.nativeAccepted, false);
  assert.equal(result.report.acceptedForProduction, false);
  assert.equal(result.report.expectedFiles, 0);
  assert.equal(result.report.fullApplicationAcceptanceRequired, true);
  assert.deepEqual(result.report.runtimeFailure, { application: null, gate: 'source-preflight' });
  assert.deepEqual(result.report.applications, {});
  assert.equal(result.report.sourceEvidence, undefined);
  assert.match(result.report.sourcePreflight.error, /Missing|ENOENT|directory/i);
  assert.equal(requests, 0);
  await assert.rejects(run(), /Do not overwrite previous browser evidence/);
  assert.deepEqual(fs.readFileSync(join(output, 'report.json')), bytes);
  assert.equal(requests, 0);
});

test('authentication has no implicit shared account and does not infer nonadmin status from explicit credentials', () => {
  assert.deepEqual(readModelDesignAuthentication({ environment: {} }).evidence,
    { required: false, source: 'not-selected', permissionAcceptance: false });
  for (const environment of [{}, { MODEL_DESIGN_PASSWORD: 'fixture-private-password' }]) {
    assert.throws(() => readModelDesignAuthentication({ authenticate: true, environment }),
      /Explicit MODEL_DESIGN_USER/);
  }
  for (const password of [undefined, '', 'private\nvalue', 'private\x00value', 'a'.repeat(1025)]) {
    let error;
    try { readModelDesignAuthentication({ authenticate: true,
      environment: { MODEL_DESIGN_USER: 'fixture-user', MODEL_DESIGN_PASSWORD: password } }); }
    catch (current) { error = current; }
    assert.match(String(error), /Explicit MODEL_DESIGN_PASSWORD/);
    assert.ok(!String(error).includes('private'));
  }
  const result = readModelDesignAuthentication({ authenticate: true,
    environment: { MODEL_DESIGN_USER: 'fixture-user', MODEL_DESIGN_PASSWORD: 'fixture-private-password' } });
  assert.equal(result.credentials.username, 'fixture-user');
  assert.equal(result.evidence.source, 'explicit-environment');
  assert.equal(result.evidence.nonAdminIdentityVerified, false);
  assert.equal(result.evidence.permissionAcceptance, false);
  assert.ok(!JSON.stringify(result.evidence).includes('fixture-private-password'));
  assert.throws(() => readModelDesignAuthentication({ authenticate: true, modelDesignRoot: 'owned-root',
    environment: { MODEL_DESIGN_USER: 'fixture-user', MODEL_DESIGN_PASSWORD: 'fixture-private-password' } }),
  /owned nonadmin fixture/);
});

test('local-default-root authentication is an explicit route-only mode and never permission evidence', () => {
  const environment = { MODEL_DESIGN_USER: 'local-user', MODEL_DESIGN_PASSWORD: 'local-private-password' };
  const result = readModelDesignAuthentication({
    authenticate: true, modelDesignRoot: 'local-root', localDefaultRoot: true, environment,
  });
  assert.equal(result.credentials.username, 'local-user');
  assert.equal(result.evidence.required, true);
  assert.equal(result.evidence.source, 'explicit-environment');
  assert.equal(result.evidence.localDefaultRoot, true);
  assert.equal(result.evidence.nonAdminIdentityVerified, false);
  assert.equal(result.evidence.permissionAcceptance, false);
  assert.match(result.evidence.boundary, /route semantics only/);
  assert.ok(!JSON.stringify(result.evidence).includes('local-private-password'));
  assert.throws(() => readModelDesignAuthentication({
    authenticate: true, modelDesignRoot: 'local-root', environment,
  }), /owned nonadmin fixture or --local-default-root/);
  assert.throws(() => readModelDesignAuthentication({ localDefaultRoot: true, environment }),
    /requires --authenticate/);
  assert.throws(() => readModelDesignAuthentication({
    authenticate: true, modelDesignRoot: 'local-root', environment,
  }), /owned nonadmin fixture or --local-default-root/);
});

function ownedAuthenticationFixture(t) {
  const fixture = createFixture({
    runId: randomUUID().replaceAll('-', '').slice(0, 12), scenario: 'two-center',
    passwordStorageMode: 'none', modelVersion: 816,
  });
  const directory = join(WORKSPACE, '.artifacts/native-nonadmin-fixtures', fixture.manifest.runId);
  fs.mkdirSync(directory, { mode: 0o700 });
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  fs.writeFileSync(join(directory, 'manifest.json'), JSON.stringify(fixture.manifest), { mode: 0o600 });
  fs.writeFileSync(join(directory, 'credentials.private.json'), JSON.stringify(fixture.credentials), { mode: 0o600 });
  const user = fixture.manifest.users.find(user => user.role === 'editor');
  const options = { authenticate: true, nonAdminFixture: directory, nonAdminUser: user.loginname,
    modelDesignRoot: user.rootId,
    environment: { MODEL_DESIGN_USER: 'shared-user', MODEL_DESIGN_PASSWORD: 'shared-private-password' } };
  return { fixture, directory, user, options,
    writeManifest() { fs.writeFileSync(join(directory, 'manifest.json'), JSON.stringify(fixture.manifest)); } };
}

test('owned authentication binds the exact generated fixture user/root, never environment overrides or native claims', t => {
  const { fixture, user, options } = ownedAuthenticationFixture(t);
  for (const selected of fixture.manifest.users.filter(item => item.rootId === user.rootId)) {
    const result = readModelDesignAuthentication({ ...options, nonAdminUser: selected.loginname });
    assert.equal(result.credentials.username, selected.loginname);
    assert.equal(result.credentials.password, fixture.credentials.users[selected.loginname]);
    assert.equal(result.evidence.role, selected.role);
    assert.equal(result.evidence.personId, selected.personId);
    assert.equal(result.evidence.centerId, selected.centerId);
    assert.equal(result.evidence.requestedRoot, selected.rootId);
    assert.equal(result.evidence.systemId, fixture.manifest.roots[0].logicalSystemId);
    assert.match(result.evidence.manifest.sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.evidence.credentialsIncludedInEvidence, false);
    assert.equal(result.evidence.nonAdminIdentityVerified, false);
    assert.equal(result.evidence.permissionAcceptance, false);
    assert.ok(!JSON.stringify(result.evidence).includes(fixture.credentials.users[selected.loginname]));
    assert.ok(!JSON.stringify(result.evidence).includes('shared-private-password'));
  }
});

for (const [name, mutate] of [
  ['missing authenticate selection', state => { state.options.authenticate = false; }],
  ['missing user selection', state => { delete state.options.nonAdminUser; }],
  ['missing fixture selection', state => { delete state.options.nonAdminFixture; }],
  ['missing root selection', state => { delete state.options.modelDesignRoot; }],
  ['foreign path', state => { state.options.nonAdminFixture = '/tmp/foreign-fixture'; }],
  ['run identity drift', state => { state.fixture.manifest.runId = '0'.repeat(12); }],
  ['wrong ownership label', state => { state.fixture.manifest.ownership.label = 'unrelated'; }],
  ['shared mysql owner', state => { state.fixture.manifest.ownership.mysqlContainer = 'mysql'; }],
  ['shared network', state => { state.fixture.manifest.ownership.network = 'compose_agent_network'; }],
  ['published mysql allowed', state => { state.fixture.manifest.ownership.publishedMysqlPortsAllowed = true; }],
  ['foreign user', state => { state.options.nonAdminUser = 'shared-user'; }],
  ['duplicate user', state => { state.fixture.manifest.users.push({ ...state.user }); }],
  ['administrative identity', state => { state.user.administrator = true; }],
  ['unknown role', state => { state.user.role = 'administrator'; }],
  ['elevated access mode', state => { state.user.accessMode = 7; }],
  ['borrowed person', state => { state.user.personId = 'shared-person'; }],
  ['borrowed developer', state => { state.user.developerId = 'shared-person'; }],
  ['another center', state => { state.user.centerId = 'shared-center'; }],
  ['another root', state => { state.options.modelDesignRoot = state.fixture.manifest.roots[1].rootId; }],
  ['duplicate root', state => { state.fixture.manifest.roots.push({ ...state.fixture.manifest.roots[0] }); }],
  ['foreign physical model database', state => { state.fixture.manifest.roots[0].database = 'ibizplm'; }],
  ['foreign model instance', state => { state.fixture.manifest.roots[0].modelInstanceId = 'shared-model'; }],
  ['foreign system', state => { state.fixture.manifest.roots[0].logicalSystemId = 'shared-system'; }],
  ['public credential file', state => { fs.chmodSync(join(state.directory, 'credentials.private.json'), 0o644); }],
  ['invalid private JSON', state => {
    fs.writeFileSync(join(state.directory, 'credentials.private.json'), 'fixture-private-invalid-json');
  }],
  ['missing owned credential', state => {
    fs.writeFileSync(join(state.directory, 'credentials.private.json'),
      JSON.stringify({ users: { [state.user.loginname]: 'fixture-private-invalid-password' } }));
  }],
]) {
  test(`owned authentication rejects ${name} before any browser login and suppresses private values`, t => {
    const state = ownedAuthenticationFixture(t);
    mutate(state);
    state.writeManifest();
    let error;
    try { readModelDesignAuthentication(state.options); } catch (current) { error = current; }
    assert.ok(error, name);
    assert.ok(!String(error).includes('fixture-private-invalid'));
    assert.ok(!String(error).includes('shared-private-password'));
  });
}

for (const name of ['manifest.json', 'credentials.private.json']) {
  test(`owned authentication refuses a symlink ${name} without consuming the target`, t => {
    const { directory, options } = ownedAuthenticationFixture(t);
    fs.renameSync(join(directory, name), join(directory, 'link-target.json'));
    fs.symlinkSync('link-target.json', join(directory, name));
    assert.throws(() => readModelDesignAuthentication(options), /Symlink resource rejected/);
  });
}

test('owned authentication refuses a symlink fixture ancestor', t => {
  const { directory, options } = ownedAuthenticationFixture(t);
  const link = join(WORKSPACE, '.artifacts/native-nonadmin-fixtures',
    randomUUID().replaceAll('-', '').slice(0, 12));
  fs.symlinkSync(directory, link);
  t.after(() => fs.unlinkSync(link));
  assert.throws(() => readModelDesignAuthentication({ ...options, nonAdminFixture: link }),
    /Symlink directory rejected/);
});

function accountIdentityFixture() {
  const runId = 'a'.repeat(12);
  const expected = {
    required: true, source: 'run-owned-native-nonadmin-fixture', runId,
    account: `nf_${runId}_a_e`, role: 'editor',
    personId: `nf_${runId}_person_a_e`, centerId: `nf_${runId}_center_a`,
    requestedRoot: `nf_${runId}_root_a`,
    systemId: `nf_${runId}_system`, modelInstanceId: `nf_${runId}_inst_a`,
    modelRecordId: `nf_${runId}_module`,
    credentialsIncludedInEvidence: false, nonAdminIdentityVerified: false, permissionAcceptance: false,
  };
  const hostContext = { srfpersonid: expected.personId, srfuserid: expected.personId,
    srfdcid: expected.centerId };
  const entry = 'http://127.0.0.1:32119/modeldesign/';
  const response = { origin: new URL(entry).origin, path: '/api/ibizmodeling__modeldesign/appdata',
    method: 'GET', status: 200, contentType: 'application/json', responseMocked: false,
    body: JSON.stringify({ context: hostContext, token: 'fixture-private-token', ignored: 'private-value' }) };
  return { expected, hostContext, entry, response };
}

test('account identity requires actual appdata and host identity, recording no token or inferred permission acceptance', () => {
  const { expected, hostContext, entry, response } = accountIdentityFixture();
  const evidence = inspectModelDesignAccountIdentity(response, hostContext, expected, entry);
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.identityBindingVerified, true);
  assert.equal(evidence.nonAdminDeclaredByFixture, true);
  assert.equal(evidence.permissionAcceptance, false);
  assert.match(evidence.responseSha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(evidence).includes('private'));
});

for (const [name, mutate] of [
  ['absent expectation', state => { state.expected = {}; }],
  ['another owned root', state => { state.expected.requestedRoot = `nf_${state.expected.runId}_root_b`; }],
  ['another owned account', state => { state.expected.account = `nf_${state.expected.runId}_b_e`; }],
  ['role identity mismatch', state => { state.expected.role = 'viewer'; }],
  ['foreign model instance', state => { state.expected.modelInstanceId = 'foreign-instance'; }],
  ['fixture declaration claiming permissions', state => { state.expected.permissionAcceptance = true; }],
  ['different application', state => { state.response.path = '/api/ibizmodeling__central/appdata'; }],
  ['different origin', state => { state.response.origin = 'http://127.0.0.1:32118'; }],
  ['mutation response', state => { state.response.method = 'POST'; }],
  ['unauthorized response', state => { state.response.status = 401; }],
  ['HTML fallback', state => { state.response.contentType = 'text/html'; }],
  ['mocked identity', state => { state.response.responseMocked = true; }],
  ['missing nonmocked evidence', state => { delete state.response.responseMocked; }],
  ['missing response context', state => { state.response.body = '{}'; }],
  ['borrowed response person', state => {
    state.response.body = JSON.stringify({ context: { ...state.hostContext, srfpersonid: 'shared-person' } });
  }],
  ['borrowed response user', state => {
    state.response.body = JSON.stringify({ context: { ...state.hostContext, srfuserid: 'shared-person' } });
  }],
  ['borrowed response center', state => {
    state.response.body = JSON.stringify({ context: { ...state.hostContext, srfdcid: 'shared-center' } });
  }],
  ['missing host context', state => { state.hostContext = undefined; }],
  ['another host person', state => { state.hostContext = { ...state.hostContext, srfpersonid: 'shared-person' }; }],
  ['another host center', state => { state.hostContext = { ...state.hostContext, srfdcid: 'shared-center' }; }],
  ['invalid private response JSON', state => { state.response.body = 'fixture-private-invalid-json'; }],
]) {
  test(`native account identity refuses ${name} and preserves private response values`, () => {
    const state = accountIdentityFixture();
    mutate(state);
    let error;
    try {
      inspectModelDesignAccountIdentity(state.response, state.hostContext, state.expected, state.entry);
    } catch (current) { error = current; }
    assert.ok(error, name);
    assert.ok(!String(error).includes('fixture-private-token'));
    assert.ok(!String(error).includes('fixture-private-invalid-json'));
  });
}

test('selected-root navigation uses the native appContext/index contract without changing asset base', () => {
  const entry = 'http://127.0.0.1:32349/modeldesign/';
  assert.equal(nativeModelDesignRootEntry(entry), entry);
  for (const root of ['nf_owned_root_a', 'UUID-1.a', 'a'.repeat(128)]) {
    const target = new URL(nativeModelDesignRootEntry(entry, root));
    assert.equal(target.origin, new URL(entry).origin);
    assert.equal(target.pathname, '/modeldesign/');
    assert.equal(target.search, '');
    assert.equal(target.hash, `#/psdevslnsys=${root}/modelingindex/-`);
    assert.equal(nativeModelDesignPluginBaseUrl(entry), entry + 'plugins');
  }
  assert.throws(() => nativeModelDesignRootEntry('http://127.0.0.1:32348/central/', 'owned'),
    /only valid for ModelDesign/);
});

for (const [name, root] of [
  ['empty root', ''], ['null root', null], ['numeric root', 1], ['object root', {}],
  ['path traversal', '../owned'], ['path separator', 'owned/other'],
  ['encoded separator', 'owned%2fother'], ['another context', 'owned;pssystemid=other'],
  ['hash override', 'owned#/login'], ['query override', 'owned?root=other'],
  ['equals override', 'owned=other'], ['space', 'owned root'], ['newline', 'owned\n'],
  ['oversized root', 'a'.repeat(129)],
]) {
  test(`root navigation and query policy reject ${name}`, () => {
    const entry = 'http://127.0.0.1:32349/modeldesign/';
    assert.throws(() => nativeModelDesignRootEntry(entry, root), /root/);
    assert.throws(() => isModelDesignReadQuery(entry, {
      method: 'POST', url: 'http://127.0.0.1:32349/api/ibizmodeling__modeldesign/psmodules/fetchcursys',
    }, { modelDesignRoot: root }), /root/);
  });
}

test('selected-root read policy permits only its exact native fetch and the existing message query', () => {
  const entry = 'http://127.0.0.1:32349/modeldesign/';
  const modelDesignRoot = 'nf_owned_root_a';
  for (const path of [
    `/api/ibizmodeling__modeldesign/psdevslnsys/${modelDesignRoot}/psmodules/fetchcursys`,
    '/api/ibizmodeling__modeldesign/extension/internal_messages/fetch_cur_receiver',
  ]) {
    assert.equal(isModelDesignReadQuery(entry, { method: 'POST',
      url: new URL(path, entry).href }, { modelDesignRoot }), true);
  }
  assert.equal(isModelDesignReadQuery(entry, { method: 'POST',
    url: new URL(`/api/ibizmodeling__modeldesign/psdevslnsys/${modelDesignRoot}/psmodules/fetchcursys`,
      entry).href }), false, 'A root must be explicitly selected, never inferred from the request');
});

for (const [name, method, path, origin] of [
  ['rootless fallback', 'POST', '/psmodules/fetchcursys'],
  ['other root', 'POST', '/psdevslnsys/nf_owned_root_b/psmodules/fetchcursys'],
  ['encoded root', 'POST', '/psdevslnsys/nf_%6fwned_root_a/psmodules/fetchcursys'],
  ['encoded endpoint', 'POST', '/psdevslnsys/nf_owned_root_a/psmodules/%66etchcursys'],
  ['root mutation', 'POST', '/psdevslnsys/nf_owned_root_a/psmodules'],
  ['module import', 'POST', '/psdevslnsys/nf_owned_root_a/psmodules/key/importmodelv2'],
  ['another fetch', 'POST', '/psdevslnsys/nf_owned_root_a/psmodules/fetchdefault'],
  ['wrong method', 'DELETE', '/psdevslnsys/nf_owned_root_a/psmodules/fetchcursys'],
  ['query override', 'POST', '/psdevslnsys/nf_owned_root_a/psmodules/fetchcursys?_method=DELETE'],
  ['wrong origin', 'POST', '/psdevslnsys/nf_owned_root_a/psmodules/fetchcursys', 'http://127.0.0.1:32348'],
]) {
  test(`selected-root query policy rejects ${name}`, () => {
    assert.equal(isModelDesignReadQuery('http://127.0.0.1:32349/modeldesign/', {
      method, url: `${origin ?? 'http://127.0.0.1:32349'}/api/ibizmodeling__modeldesign${path}`,
    }, { modelDesignRoot: 'nf_owned_root_a' }), false);
  });
}

test('read-query policy permits only the two proven native query contracts at the exact host/application', () => {
  for (const app of ['central', 'modeldesign']) {
    const entry = `http://127.0.0.1:32148/${app}/`;
    assert.equal(isModelDesignReadQuery(entry, { method: 'POST',
      url: `http://127.0.0.1:32148/api/ibizmodeling__${app}/extension/internal_messages/fetch_cur_receiver` }), true);
    assert.equal(isModelDesignReadQuery(entry, { method: 'POST',
      url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/psmodules/fetchcursys' }),
    app === 'modeldesign');
  }
});

for (const [name, change] of [
  ['wrong method', { method: 'PUT' }],
  ['other host', { url: 'http://remote.invalid/api/ibizmodeling__modeldesign/psmodules/fetchcursys' }],
  ['other port', { url: 'http://127.0.0.1:32149/api/ibizmodeling__modeldesign/psmodules/fetchcursys' }],
  ['embedded credentials', { url: 'http://user:secret@127.0.0.1:32148/api/ibizmodeling__modeldesign/psmodules/fetchcursys' }],
  ['query override', { url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/psmodules/fetchcursys?_method=DELETE' }],
  ['fragment', { url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/psmodules/fetchcursys#write' }],
  ['relative path', { url: '/api/ibizmodeling__modeldesign/psmodules/fetchcursys' }],
  ['other app', { url: 'http://127.0.0.1:32148/api/ibizmodeling__central/psmodules/fetchcursys' }],
  ['module create', { url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/psmodules' }],
  ['model import', { url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/psmodules/key/importmodelv2' }],
  ['mark all messages read', { url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/extension/internal_messages/mark_all_read' }],
  ['mark message read', { url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/extension/internal_messages/id/mark_read' }],
  ['trailing path', { url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/psmodules/fetchcursys/write' }],
  ['encoded route', { url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/psmodules/%66etchcursys' }],
  ['another fetch contract', { url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/psmodules/fetchdefault' }],
]) {
  test(`read-query policy refuses ${name}`, () => {
    assert.equal(isModelDesignReadQuery('http://127.0.0.1:32148/modeldesign/', {
      method: 'POST', url: 'http://127.0.0.1:32148/api/ibizmodeling__modeldesign/psmodules/fetchcursys',
      ...change,
    }), false);
  });
}

test('readonly diagnostics observe real prop/option/focus mismatch without correcting the editor', async () => {
  const active = { tagName: 'INPUT', className: 'outside-host', value: 'private-host-value' };
  const node = {
    contains: () => false,
    getBoundingClientRect: () => ({ left: 24, top: 66, width: 1200, height: 800 }),
  };
  const editor = {
    getDomNode: () => node, getOption: () => false,
    getValue: () => 'const updatedValue = 2;',
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    getId: () => 'owned-editor',
    getModel: () => ({ uri: { toString: () => 'inmemory://owned' } }),
    hasTextFocus: () => false,
  };
  const sandbox = {
    window: { __modelDesignProbe: {
      state: { readonly: true }, editor, monaco: { editor: { EditorOption: { readOnly: 1 } } },
    } },
    document: { activeElement: active, elementFromPoint: () => active },
  };
  const page = {
    evaluate: (callback, arg) => runInNewContext(`(${callback})(${JSON.stringify(arg)})`, sandbox),
  };
  const observation = await observeModelDesignEditor(page, 'wait-readonly-option');
  assert.equal(observation.propReadonly, true);
  assert.equal(observation.optionReadonly, false);
  assert.equal(observation.hasTextFocus, false);
  assert.equal(observation.activeWithinEditor, false);
  assert.equal(observation.hitWithinEditor, false);
  assert.equal(observation.activeElement.tag, 'INPUT');
  assert.equal(observation.value, 'const updatedValue = 2;');
  assert.ok(!JSON.stringify(observation).includes('private-host-value'));
  assert.equal(sandbox.window.__modelDesignProbe.state.readonly, true);
});

test('readonly diagnostics record missing rendering prerequisite instead of inventing editor evidence', async () => {
  const page = {
    evaluate: (callback, arg) => runInNewContext(`(${callback})(${JSON.stringify(arg)})`, { window: {} }),
  };
  const observation = await observeModelDesignEditor(page, 'failure');
  assert.equal(observation.checkpoint, 'failure');
  assert.equal(observation.editorMissing, true);
  assert.equal(observation.optionReadonly, undefined);
});

test('keyboard acceptance requires both Monaco focus and actual DOM focus inside its own editor', () => {
  assert.doesNotThrow(() => assertModelDesignEditorFocus({
    hasTextFocus: true, activeWithinEditor: true,
  }));
  for (const observation of [
    { hasTextFocus: false, activeWithinEditor: false },
    { hasTextFocus: true, activeWithinEditor: false },
    { hasTextFocus: false, activeWithinEditor: true },
    { hasTextFocus: {}, activeWithinEditor: true },
    {},
  ]) {
    assert.throws(() => assertModelDesignEditorFocus(observation));
  }
});

test('isolated input uses unique loopback frontends and only read-only source mounts', () => {
  const input = isolatedLaunchInput(options);
  assert.equal(input.applications.length, 2);
  assert.equal(input.mounts.length, 13);
  assert.ok(input.mounts.every(mount => mount.readOnly));
  assert.equal(input.nativeAccepted, false);
  assert.equal(input.acceptedForProduction, false);
  for (const app of input.applications) {
    assert.ok(app.args.includes('--pull=never'));
    assert.equal(app.args[app.args.indexOf('--network') + 1], 'compose_agent_network');
    assert.match(app.args[app.args.indexOf('--publish') + 1], /^127\.0\.0\.1:3211[89]:8080$/);
    assert.match(app.container, /^s07-unit-isolated-(central|modeldesign)$/);
    assert.ok(!app.args.some(arg => /unless-stopped|restart|compose/.test(arg) && arg !== 'compose_agent_network'));
    assert.equal(app.environment.NATIVE_MODEL_APP, app.application);
    assert.equal(app.environment.NATIVE_PLATFORM_HOST, 'ibiz-ebsx-allinone-local');
    assert.equal(app.environment.PLUGINBASEURL,
      `http://127.0.0.1:${new URL(app.entry).port}/${app.application.toLowerCase()}/plugins`);
    assert.equal(app.args[app.args.indexOf('--health-cmd') + 1],
      `wget -q -O /dev/null --timeout=3 http://127.0.0.1:8080/${app.application.toLowerCase()}/`);
    const mounts = app.args.filter((_, index) => app.args[index - 1] === '--mount');
    assert.equal(mounts.length, input.mounts.length);
    assert.ok(mounts.every(mount => mount.endsWith(',readonly')));
  }
  assert.deepEqual(input.cleanup.args, ['rm', '--force',
    's07-unit-isolated-central', 's07-unit-isolated-modeldesign']);
});

test('plugin base preserves each native host origin and application prefix for blob workers', () => {
  for (const entry of [
    'http://127.0.0.1:32138/central/',
    'http://localhost:32139/modeldesign/',
    'http://[::1]:32139/modeldesign/',
  ]) {
    const base = nativeModelDesignPluginBaseUrl(entry);
    assert.equal(base, `${entry}plugins`);
    const worker = new URL(`${base}/monaco-editor@0.52.2/min/vs/language/typescript/tsWorker.js`);
    assert.equal(worker.origin, new URL(entry).origin);
    assert.equal(worker.pathname,
      `${new URL(entry).pathname}plugins/monaco-editor@0.52.2/min/vs/language/typescript/tsWorker.js`);
  }
});

for (const entry of [
  'http://example.com/central/', 'https://127.0.0.1/central/',
  'http://user:secret@127.0.0.1/central/', 'http://127.0.0.1/central/?next=remote',
  'http://127.0.0.1/central/#/view', 'http://127.0.0.1/central',
  'http://127.0.0.1/central/nested/', 'http://127.0.0.1/plugins/', '//remote/central/',
]) {
  test(`plugin base refuses a non-native or ambiguous entry: ${entry.replace('secret', 'redacted')}`, () => {
    assert.throws(() => nativeModelDesignPluginBaseUrl(entry));
  });
}

for (const [name, change] of [
  ['shared service port', { centralPort: 32008 }],
  ['duplicate port', { centralPort: 32119 }],
  ['out of range port', { centralPort: 65536 }],
  ['fractional port', { centralPort: 32118.5 }],
  ['unsafe container name', { name: 'shared;restart' }],
  ['unsafe platform host', { platformHost: 'host/path' }],
  ['remote mount', { candidate: '/tmp/outside' }],
]) {
  test(`isolated input refuses ${name}`, () => {
    assert.throws(() => isolatedLaunchInput({ ...options, ...change }));
  });
}

function containerFixture() {
  const input = isolatedLaunchInput(options);
  const app = input.applications[0];
  const inspection = {
    Config: {
      Labels: { 'aibiz.native-model-design-isolated': input.name },
      Env: Object.entries(app.environment).map(([name, value]) => `${name}=${value}`),
      Healthcheck: { Test: ['CMD-SHELL', app.args[app.args.indexOf('--health-cmd') + 1]] },
    },
    State: { Running: true, Health: { Status: 'healthy' } },
    Mounts: input.mounts.map(mount => ({
      Type: 'bind', Source: mount.source, Destination: mount.target, RW: false,
    })),
  };
  return { input, app, inspection };
}

test('container evidence requires the actual app healthcheck and every read-only input mount', () => {
  const { input, app, inspection } = containerFixture();
  assert.deepEqual(verifyIsolatedContainerState(input, app, inspection), {
    readOnlyMountsVerified: true, healthStatus: 'healthy',
    healthcheck: inspection.Config.Healthcheck.Test,
  });
});

for (const [name, mutate] of [
  ['unhealthy despite HTTP 200', inspection => { inspection.State.Health.Status = 'unhealthy'; }],
  ['starting', inspection => { inspection.State.Health.Status = 'starting'; }],
  ['missing health state', inspection => { delete inspection.State.Health; }],
  ['stopped', inspection => { inspection.State.Running = false; }],
  ['inherited wrong app route', inspection => {
    inspection.Config.Healthcheck.Test[1] = 'wget -q -O /dev/null http://127.0.0.1:8080/modeldesign/';
  }],
  ['missing mount', inspection => { inspection.Mounts.pop(); }],
  ['writable input', inspection => { inspection.Mounts[0].RW = true; }],
  ['different mounted source', inspection => { inspection.Mounts[0].Source = '/tmp/not-the-verified-input'; }],
  ['relative plugin base', inspection => {
    inspection.Config.Env = inspection.Config.Env.map(value =>
      value.startsWith('PLUGINBASEURL=') ? 'PLUGINBASEURL=./plugins' : value);
  }],
  ['other application plugin base', inspection => {
    inspection.Config.Env = inspection.Config.Env.map(value =>
      value.startsWith('PLUGINBASEURL=') ? 'PLUGINBASEURL=http://127.0.0.1:32119/modeldesign/plugins' : value);
  }],
]) {
  test(`container evidence refuses ${name}`, () => {
    const { input, app, inspection } = containerFixture();
    mutate(inspection);
    assert.throws(() => verifyIsolatedContainerState(input, app, inspection));
  });
}

const stageNames = [
  'http-delivery', 'factory-registration', 'native-esm-lazy-chunk', 'pluralize',
  'editor-render-and-worker', 'edit-prop-sync', 'readonly-toggle', 'unmount-cleanup',
];
const componentNames = [
  'IBizModelClipboard', 'IBizModelClipboardItem', 'IBizModelClipboardImportView',
  'IBizModelClipboardPasteView', 'IBizDesignCodeEditor', 'IBizModelEditView',
  'IBizModelTree', 'IBizModelRuntime', 'IBizModelClone', 'IBizDSLModelClipboard',
  'IBizDSLModelClipboardImportView', 'IBizDSLModelEditView',
];

function summaryFixture() {
  return Object.fromEntries(['Central', 'ModelDesign'].map((name, index) => [name, {
    entry: `http://127.0.0.1:${32118 + index}/${name.toLowerCase()}/`,
    identity: { nativeModelApp: name, appId: `ibizmodeling__${name.toLowerCase()}` },
    runtimeErrors: [], bootErrors: [], blockedMutations: [], readQueries: [],
    runtimeConfiguration: {
      pluginBaseUrl: `http://127.0.0.1:${32118 + index}/${name.toLowerCase()}/plugins`,
      source: 'native-host-environment', harnessOverrides: false,
    },
    stages: Object.fromEntries(stageNames.map(stage => [stage, {
      status: 'PASS', evidence: {
        'http-delivery': { files: 1, checks: [{ path: '/delivered.js', status: 200,
          bytes: 1, sha256: 'a'.repeat(64) }], missing: [1, 2, 3].map(i => ({ path: `/missing-${i}`, status: 404 })),
        modelChecks: ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json', 'PSSYSAPP.hub.json']
          .map((endpoint, index) => ({
            path: `/api/ibizmodeling__${name.toLowerCase()}/remotemodel/${endpoint}`,
            source: `PSSYSAPPS/${name}/${index === 3 ? 'PSSYSAPP.json' : endpoint}`,
            status: 200, bytes: 1, sha256: 'a'.repeat(64),
          })) },
        'factory-registration': {
          actionKeys: [...modelDesignActionKeys], components: [...componentNames],
          registrations: modelDesignActionKeys.map(key => ({
            key, constructor: 'FixtureProvider', execActionCallable: true,
          })),
        },
        'native-esm-lazy-chunk': { ready: true },
        pluralize: { irregular: 'people' },
        'editor-render-and-worker': { diagnostics: [], width: 1024, height: 768,
          pluginBaseUrl: `http://127.0.0.1:${32118 + index}/${name.toLowerCase()}/plugins`,
          container: 'host-element-plus-dialog', nativeView: false, harnessFocusTrapOverrides: false },
        'edit-prop-sync': { value: 'const updatedValue = 2;' },
        'readonly-toggle': { readonly: true, editableAgain: true,
          keyboardBlocked: true, keyboardEditableAgain: true, sameEditor: true, sameModel: true,
          readonlyFocusVerified: true, editableFocusVerified: true,
          harnessCorrection: false },
        'unmount-cleanup': {
          editorsRestored: true, modelsRestored: true, editorDisposed: true, modelDisposed: true,
          editorDisposeEvents: 1, modelDisposeEvents: 1, hostRemoved: true, harnessCorrection: false,
          editorIds: ['unrelated-editor'], baselineEditorIds: ['unrelated-editor'],
          modelUris: ['inmemory://unrelated'], baselineModelUris: ['inmemory://unrelated'],
        },
      }[stage],
    }])),
  }]));
}

test('summary fixture can establish only isolated runtime status, never native acceptance', () => {
  const report = summarizeModelDesignRuntime(summaryFixture(), 1);
  assert.equal(report.isolatedRuntimePassed, true);
  assert.equal(report.nativeAccepted, false);
  assert.equal(report.acceptedForProduction, false);
  assert.equal(report.fullApplicationAcceptanceRequired, true);
  assert.equal(report.runtimeFailure, null);
});

for (const [gate, change] of [
  ['boot-errors', app => { app.bootErrors.push({ kind: 'console', text: 'private-diagnostic-value' }); }],
  ['runtime-errors', app => { app.runtimeErrors.push({ kind: 'pageerror', text: 'private-diagnostic-value' }); }],
  ['mutation-guard', app => { app.blockedMutations.push({ path: '/private-diagnostic-value' }); }],
  ['read-queries', app => { app.readQueries.push({
    method: 'POST', url: new URL('/api/ibizmodeling__modeldesign/psmodules/fetchcursys', app.entry).href,
    status: 500, contentType: 'application/json', responseMocked: false,
    responseBody: 'private-diagnostic-value',
  }); }],
  ['required-component-stages', app => { app.stages['readonly-toggle'].status = 'FAIL'; }],
  ['http-delivery', app => { app.stages['http-delivery'].evidence.checks = []; }],
  ['readonly-toggle', app => { app.stages['readonly-toggle'].evidence.keyboardBlocked = false; }],
  ['unmount-cleanup', app => { app.stages['unmount-cleanup'].evidence.editorDisposeEvents = 0; }],
]) {
  test(`summary reports the actual ${gate} failure without copying private diagnostics`, () => {
    const apps = summaryFixture();
    change(apps.ModelDesign);
    const report = summarizeModelDesignRuntime(apps, 1);
    assert.equal(report.isolatedRuntimePassed, false);
    assert.equal(report.nativeAccepted, false);
    assert.deepEqual(report.runtimeFailure, { application: 'ModelDesign', gate });
    assert.ok(!JSON.stringify(report).includes('private-diagnostic-value'));
  });
}

test('summary reports missing app topology instead of mistaking partial component success for PASS', () => {
  const apps = summaryFixture();
  delete apps.ModelDesign;
  const report = summarizeModelDesignRuntime(apps, 1);
  assert.equal(report.isolatedRuntimePassed, false);
  assert.deepEqual(report.runtimeFailure, { application: null, gate: 'application-topology' });
});

test('summary accepts real successful read-query evidence without discarding boot errors', () => {
  const apps = summaryFixture();
  apps.ModelDesign.readQueries.push({
    method: 'POST', url: 'http://127.0.0.1:32119/api/ibizmodeling__modeldesign/psmodules/fetchcursys',
    status: 200, contentType: 'application/json', responseMocked: false,
  });
  assert.equal(summarizeModelDesignRuntime(apps, 1).isolatedRuntimePassed, true);
  apps.ModelDesign.bootErrors.push({ kind: 'response', status: 404, path: '/plugins/console-terminal/package.json' });
  assert.equal(summarizeModelDesignRuntime(apps, 1).isolatedRuntimePassed, false);
});

for (const [name, change] of [
  ['pending read response', query => { delete query.status; }],
  ['backend failure', query => { query.status = 500; }],
  ['HTML query fallback', query => { query.contentType = 'text/html'; }],
  ['mock response', query => { query.responseMocked = true; }],
  ['mutation masquerading as query', query => { query.url = query.url.replace('fetchcursys', 'importmodelv2'); }],
  ['cross-origin query', query => { query.url = query.url.replace(':32119', ':32118'); }],
]) {
  test(`summary refuses ${name} in query evidence`, () => {
    const apps = summaryFixture();
    const query = {
      method: 'POST', url: 'http://127.0.0.1:32119/api/ibizmodeling__modeldesign/psmodules/fetchcursys',
      status: 200, contentType: 'application/json', responseMocked: false,
    };
    change(query);
    apps.ModelDesign.readQueries.push(query);
    assert.equal(summarizeModelDesignRuntime(apps, 1).isolatedRuntimePassed, false);
  });
}

function authenticatedFixture() {
  const apps = summaryFixture();
  for (const [name, app] of Object.entries(apps)) {
    const applicationId = `ibizmodeling__${name.toLowerCase()}`;
    app.authentication = { status: 'PASS', evidence: {
      origin: new URL(app.entry).origin, path: `/api/${applicationId}/v7/login`,
      method: 'POST', status: 200, contentType: 'application/json',
      tokenIssued: true, tokenPersisted: true,
    } };
    app.expectedAuthEvents = [{
      kind: 'response', path: `/api/${applicationId}/appdata`, status: 401, authenticated: false,
    }];
  }
  return apps;
}

function rootRouteFixture() {
  const apps = authenticatedFixture();
  const app = apps.ModelDesign;
  const root = 'nf_owned_root_a';
  const target = new URL(nativeModelDesignRootEntry(app.entry, root));
  app.rootRoute = {
    requestedRoot: root, targetUrl: target.href, actualHash: target.hash, hostContextRoot: root,
    source: 'original-native-route-template', navigation: 'direct-route',
    centralOpenDesignActionExecuted: false, harnessContextOverrides: false,
  };
  app.readQueries.push({
    method: 'POST', url: new URL(`/api/ibizmodeling__modeldesign/psdevslnsys/${root}/psmodules/fetchcursys`,
      app.entry).href, status: 200, contentType: 'application/json', responseMocked: false,
  });
  return apps;
}

test('selected-root summary requires route, host context and actual successful native query together', () => {
  const result = summarizeModelDesignRuntime(rootRouteFixture(), 1, {
    authenticationRequired: true, modelDesignRoot: 'nf_owned_root_a',
  });
  assert.equal(result.isolatedRuntimePassed, true);
  assert.equal(result.nativeAccepted, false);
  assert.equal(result.acceptedForProduction, false);
});

test('selected-root route accepts native navigation below the same root, not root changes', () => {
  const apps = rootRouteFixture();
  apps.ModelDesign.rootRoute.actualHash =
    `${apps.ModelDesign.rootRoute.actualHash}psdevslnsys=nf_owned_root_a/psdataentitysidebartreeview_dataentity/-`;
  assert.equal(summarizeModelDesignRuntime(apps, 1, {
    authenticationRequired: true, modelDesignRoot: 'nf_owned_root_a',
  }).isolatedRuntimePassed, true);
});

for (const [name, change] of [
  ['no root navigation', app => { delete app.rootRoute; }],
  ['other requested root', app => { app.rootRoute.requestedRoot = 'nf_owned_root_b'; }],
  ['other target root', app => { app.rootRoute.targetUrl = app.rootRoute.targetUrl.replace('_a/', '_b/'); }],
  ['rootless actual hash', app => { app.rootRoute.actualHash = '#/-/index/-'; }],
  ['other actual root', app => { app.rootRoute.actualHash = app.rootRoute.actualHash.replace('_a/', '_b/'); }],
  ['missing host context', app => { app.rootRoute.hostContextRoot = null; }],
  ['other host context', app => { app.rootRoute.hostContextRoot = 'nf_owned_root_b'; }],
  ['harness-injected context', app => { app.rootRoute.harnessContextOverrides = true; }],
  ['synthetic route provenance', app => { app.rootRoute.source = 'harness-context'; }],
  ['direct navigation claiming action execution', app => {
    app.rootRoute.centralOpenDesignActionExecuted = true;
  }],
  ['direct navigation claiming original action source', app => {
    app.rootRoute.source = 'original-native-open-design-action';
  }],
  ['missing direct navigation boundary', app => { delete app.rootRoute.navigation; }],
  ['no native query', app => { app.readQueries = []; }],
  ['only message query', app => { app.readQueries[0].url =
    new URL('/api/ibizmodeling__modeldesign/extension/internal_messages/fetch_cur_receiver', app.entry).href; }],
  ['rootless query fallback', app => { app.readQueries[0].url =
    new URL('/api/ibizmodeling__modeldesign/psmodules/fetchcursys', app.entry).href; }],
  ['other query root', app => { app.readQueries[0].url = app.readQueries[0].url.replace('_a/', '_b/'); }],
  ['failed native query', app => { app.readQueries[0].status = 500; }],
  ['pending native query', app => { delete app.readQueries[0].status; }],
  ['mocked native query', app => { app.readQueries[0].responseMocked = true; }],
]) {
  test(`selected-root summary rejects ${name}`, () => {
    const apps = rootRouteFixture();
    change(apps.ModelDesign);
    assert.equal(summarizeModelDesignRuntime(apps, 1, {
      authenticationRequired: true, modelDesignRoot: 'nf_owned_root_a',
    }).isolatedRuntimePassed, false);
  });
}

test('summary cannot silently accept root evidence without the explicit root option', () => {
  assert.equal(summarizeModelDesignRuntime(rootRouteFixture(), 1, {
    authenticationRequired: true,
  }).isolatedRuntimePassed, false);
});

test('workflow coverage distinguishes eleven registered actions from unexecuted native behavior', () => {
  const app = authenticatedFixture().ModelDesign;
  const coverage = modelDesignWorkflowCoverage(app);
  assert.equal(coverage.nativeWorkflowExecuted, false);
  assert.equal(coverage.rootSelection.status, 'NOT-RUN');
  assert.equal(coverage.rootSelection.centralOpenDesignActionExecuted, false);
  assert.deepEqual(coverage.componentEditing, { status: 'PASS', nativeView: false, persisted: false });
  for (const name of ['save', 'refresh', 'freshSessionReadback']) {
    assert.equal(coverage[name].status, 'NOT-RUN');
  }
  assert.deepEqual(coverage.actions.map(item => item.key), modelDesignActionKeys);
  assert.equal(coverage.actions.length, 11);
  assert.ok(coverage.actions.every(item =>
    item.registration === 'PASS' && item.execution === 'NOT-RUN' && item.nativeBehaviorVerified === false));
});

for (const [name, change] of [
  ['no factory evidence', app => { delete app.stages['factory-registration']; }],
  ['no provider evidence', app => { delete app.stages['factory-registration'].evidence.registrations; }],
  ['non-array provider evidence', app => {
    app.stages['factory-registration'].evidence.registrations = { key: modelDesignActionKeys[0] };
  }],
  ['string provider evidence', app => {
    app.stages['factory-registration'].evidence.registrations = modelDesignActionKeys.join(',');
  }],
  ['null provider entries', app => {
    app.stages['factory-registration'].evidence.registrations = modelDesignActionKeys.map(() => null);
  }],
  ['failed factory', app => { app.stages['factory-registration'].status = 'FAIL'; }],
  ['duplicated providers', app => {
    app.stages['factory-registration'].evidence.registrations.push(
      ...app.stages['factory-registration'].evidence.registrations);
  }],
  ['uncallable provider', app => {
    for (const item of app.stages['factory-registration'].evidence.registrations) item.execActionCallable = false;
  }],
]) {
  test(`workflow coverage refuses to turn ${name} into verified registrations`, () => {
    const app = summaryFixture().ModelDesign;
    change(app);
    const coverage = modelDesignWorkflowCoverage(app);
    assert.ok(coverage.actions.every(item =>
      item.registration === 'NOT-VERIFIED' && item.execution === 'NOT-RUN'));
    assert.equal(coverage.save.status, 'NOT-RUN');
  });
}

test('workflow root coverage requires the host route and successful real query, not a requested root alone', () => {
  const app = rootRouteFixture().ModelDesign;
  const options = { modelDesignRoot: 'nf_owned_root_a' };
  const coverage = modelDesignWorkflowCoverage(app, options);
  assert.equal(coverage.rootSelection.status, 'PASS');
  assert.equal(coverage.rootSelection.navigation, 'direct-route');
  assert.equal(coverage.rootSelection.centralOpenDesignActionExecuted, false);
  assert.equal(coverage.nativeWorkflowExecuted, false);
  app.readQueries[0].status = 500;
  assert.equal(modelDesignWorkflowCoverage(app, options).rootSelection.status, 'FAIL');
  delete app.rootRoute;
  assert.equal(modelDesignWorkflowCoverage(app, options).rootSelection.status, 'FAIL');
});

for (const [name, change] of [
  ['pending response', app => { delete app.readQueries[0].status; }],
  ['synthetic response', app => { app.readQueries[0].responseMocked = true; }],
  ['rootless fallback', app => {
    app.readQueries[0].url = new URL('/api/ibizmodeling__modeldesign/psmodules/fetchcursys', app.entry).href;
  }],
  ['other root', app => { app.rootRoute.hostContextRoot = 'nf_owned_root_b'; }],
  ['no authentication', app => { delete app.authentication; }],
]) {
  test(`workflow root coverage reports ${name} as FAIL without promoting save or action execution`, () => {
    const app = rootRouteFixture().ModelDesign;
    change(app);
    const coverage = modelDesignWorkflowCoverage(app, { modelDesignRoot: 'nf_owned_root_a' });
    assert.equal(coverage.rootSelection.status, 'FAIL');
    assert.equal(coverage.save.status, 'NOT-RUN');
    assert.ok(coverage.actions.every(item => item.execution === 'NOT-RUN'));
  });
}

test('authenticated summary requires real-token contract evidence and retains native false', () => {
  const result = summarizeModelDesignRuntime(authenticatedFixture(), 1, { authenticationRequired: true });
  assert.equal(result.isolatedRuntimePassed, true);
  assert.equal(result.nativeAccepted, false);
});

for (const [name, change] of [
  ['missing login evidence', app => { delete app.authentication; }],
  ['failed login', app => { app.authentication.status = 'FAIL'; }],
  ['wrong login origin', app => { app.authentication.evidence.origin = 'http://remote.invalid'; }],
  ['other app login', app => { app.authentication.evidence.path = '/api/ibizmodeling__modeldesign/v7/login'; }],
  ['non-JSON response', app => { app.authentication.evidence.contentType = 'text/html'; }],
  ['HTTP failure', app => { app.authentication.evidence.status = 401; }],
  ['token not issued', app => { app.authentication.evidence.tokenIssued = false; }],
  ['token not persisted', app => { app.authentication.evidence.tokenPersisted = false; }],
  ['truthy persistence object', app => { app.authentication.evidence.tokenPersisted = {}; }],
  ['missing expected-event inventory', app => { delete app.expectedAuthEvents; }],
  ['post-auth 401 treated as expected', app => { app.expectedAuthEvents[0].authenticated = true; }],
  ['other API 401 treated as expected', app => { app.expectedAuthEvents[0].path = '/api/other/appdata'; }],
  ['403 treated as expected', app => { app.expectedAuthEvents[0].status = 403; }],
  ['pageerror treated as expected', app => { app.expectedAuthEvents.push({ kind: 'pageerror', authenticated: false }); }],
]) {
  test(`authenticated summary rejects ${name}`, () => {
    const apps = authenticatedFixture();
    change(apps.Central);
    assert.equal(summarizeModelDesignRuntime(apps, 1, { authenticationRequired: true }).isolatedRuntimePassed, false);
  });
}

test('raw summary cannot silently discard expected-authentication inventory', () => {
  assert.equal(summarizeModelDesignRuntime(authenticatedFixture(), 1).isolatedRuntimePassed, false);
});

function ownedAccountSummaryFixture() {
  const { expected, hostContext, response } = accountIdentityFixture();
  const apps = authenticatedFixture();
  const target = new URL(nativeModelDesignRootEntry(apps.ModelDesign.entry, expected.requestedRoot));
  apps.ModelDesign.rootRoute = {
    requestedRoot: expected.requestedRoot, targetUrl: target.href, actualHash: target.hash,
    hostContextRoot: expected.requestedRoot, source: 'original-native-route-template',
    navigation: 'direct-route', centralOpenDesignActionExecuted: false, harnessContextOverrides: false,
  };
  apps.ModelDesign.readQueries.push({
    method: 'POST', url: new URL(
      `/api/ibizmodeling__modeldesign/psdevslnsys/${expected.requestedRoot}/psmodules/fetchcursys`,
      apps.ModelDesign.entry).href,
    status: 200, contentType: 'application/json', responseMocked: false,
  });
  for (const [name, app] of Object.entries(apps)) {
    app.accountIdentity = inspectModelDesignAccountIdentity({
      ...response, origin: new URL(app.entry).origin,
      path: `/api/ibizmodeling__${name.toLowerCase()}/appdata`,
    }, hostContext, expected, app.entry);
  }
  return { apps, options: {
    authenticationRequired: true, modelDesignRoot: expected.requestedRoot, authenticationBinding: expected,
  } };
}

test('owned-account summary binds both real app identities but does not promote fixture declarations to permissions', () => {
  const { apps, options } = ownedAccountSummaryFixture();
  const report = summarizeModelDesignRuntime(apps, 1, options);
  assert.equal(report.isolatedRuntimePassed, true);
  assert.equal(report.runtimeFailure, null);
  assert.equal(report.nativeAccepted, false);
  assert.equal(report.acceptedForProduction, false);
  assert.equal(report.fullApplicationAcceptanceRequired, true);
  assert.ok(!JSON.stringify(report).includes('fixture-private-token'));
});

for (const [name, mutate] of [
  ['missing authentication binding', state => { delete state.options.authenticationBinding; }],
  ['unknown authentication policy', state => {
    state.options.authenticationBinding.source = 'synthetic-nonadmin-verification';
  }],
  ['environment fallback at a selected root', state => {
    state.options.authenticationBinding.source = 'explicit-environment';
  }],
  ['authentication disabled', state => { state.options.authenticationRequired = false; }],
  ['fixture not requiring authentication', state => { state.options.authenticationBinding.required = false; }],
  ['fixture claims permission acceptance', state => {
    state.options.authenticationBinding.permissionAcceptance = true;
  }],
  ['fixture declares a foreign account', state => { state.options.authenticationBinding.account = 'shared-user'; }],
  ['fixture declares another owned root', state => {
    const binding = state.options.authenticationBinding;
    binding.requestedRoot = `nf_${binding.runId}_root_b`;
  }],
  ['Central account evidence missing', state => { delete state.apps.Central.accountIdentity; }],
  ['ModelDesign account evidence missing', state => { delete state.apps.ModelDesign.accountIdentity; }],
  ['borrowed person identity', state => { state.apps.ModelDesign.accountIdentity.personId = 'shared-person'; }],
  ['borrowed center identity', state => { state.apps.Central.accountIdentity.centerId = 'shared-center'; }],
  ['cross-app identity URL', state => {
    state.apps.ModelDesign.accountIdentity.path = state.apps.Central.accountIdentity.path;
  }],
  ['cross-origin identity response', state => {
    state.apps.ModelDesign.accountIdentity.origin = state.apps.Central.accountIdentity.origin;
  }],
  ['synthetic identity provenance', state => {
    state.apps.ModelDesign.accountIdentity.source = 'fixture-manifest';
  }],
  ['non-GET identity', state => { state.apps.Central.accountIdentity.method = 'POST'; }],
  ['identity HTTP failure', state => { state.apps.ModelDesign.accountIdentity.httpStatus = 401; }],
  ['HTML identity response', state => { state.apps.ModelDesign.accountIdentity.contentType = 'text/html'; }],
  ['mocked identity response', state => { state.apps.ModelDesign.accountIdentity.responseMocked = true; }],
  ['unbound response bytes', state => { delete state.apps.ModelDesign.accountIdentity.responseSha256; }],
  ['truthy identity verification', state => { state.apps.ModelDesign.accountIdentity.identityBindingVerified = {}; }],
  ['identity claims permission acceptance', state => { state.apps.Central.accountIdentity.permissionAcceptance = true; }],
]) {
  test(`owned-account summary rejects ${name} without exposing private diagnostics or claiming native acceptance`, () => {
    const state = ownedAccountSummaryFixture();
    mutate(state);
    const report = summarizeModelDesignRuntime(state.apps, 1, state.options);
    assert.equal(report.isolatedRuntimePassed, false);
    assert.equal(report.nativeAccepted, false);
    assert.equal(report.acceptedForProduction, false);
    assert.ok(report.runtimeFailure);
    assert.ok(!JSON.stringify(report).includes('fixture-private-token'));
  });
}

for (const [name, mutate] of [
  ['missing application', apps => { delete apps.ModelDesign; }],
  ['same entry', apps => { apps.ModelDesign.entry = apps.Central.entry; }],
  ['wrong application identity', apps => { apps.ModelDesign.identity.nativeModelApp = 'Central'; }],
  ['bare PASS labels without evidence', apps => {
    for (const stage of Object.values(apps.Central.stages)) delete stage.evidence;
  }],
  ['missing HTTP checks', apps => { apps.Central.stages['http-delivery'].evidence.checks = []; }],
  ['wrong HTTP hash shape', apps => { apps.Central.stages['http-delivery'].evidence.checks[0].sha256 = 'invalid'; }],
  ['missing served model', apps => { apps.Central.stages['http-delivery'].evidence.modelChecks.pop(); }],
  ['other application model route', apps => {
    apps.Central.stages['http-delivery'].evidence.modelChecks[0].path =
      '/api/ibizmodeling__modeldesign/remotemodel/PSSYSAPP.json';
  }],
  ['hub alias hash differs from full model', apps => {
    apps.Central.stages['http-delivery'].evidence.modelChecks[3].sha256 = 'b'.repeat(64);
  }],
  ['missing one of eleven actions', apps => { apps.Central.stages['factory-registration'].evidence.actionKeys.pop(); }],
  ['missing provider inventory', apps => {
    delete apps.Central.stages['factory-registration'].evidence.registrations;
  }],
  ['missing callable provider', apps => {
    apps.Central.stages['factory-registration'].evidence.registrations[0].execActionCallable = false;
  }],
  ['duplicate provider evidence', apps => {
    const registrations = apps.Central.stages['factory-registration'].evidence.registrations;
    registrations[0] = registrations[1];
  }],
  ['action keys without observed providers', apps => {
    apps.Central.stages['factory-registration'].evidence.registrations = [];
  }],
  ['failed lazy render', apps => { apps.Central.stages['native-esm-lazy-chunk'].evidence.ready = false; }],
  ['worker diagnostics not empty', apps => {
    apps.Central.stages['editor-render-and-worker'].evidence.diagnostics = [{ error: 'real-worker' }];
  }],
  ['worker relative plugin base', apps => { apps.Central.runtimeConfiguration.pluginBaseUrl = './plugins'; }],
  ['worker harness overrides host configuration', apps => {
    apps.Central.runtimeConfiguration.harnessOverrides = true;
  }],
  ['worker cross-application URL', apps => {
    apps.Central.stages['editor-render-and-worker'].evidence.pluginBaseUrl = apps.ModelDesign.runtimeConfiguration.pluginBaseUrl;
  }],
  ['blank editor despite worker PASS', apps => {
    apps.Central.stages['editor-render-and-worker'].evidence.width = 0;
  }],
  ['probe falsely claims native view workflow', apps => {
    apps.Central.stages['editor-render-and-worker'].evidence.nativeView = true;
  }],
  ['host focus trap disabled by harness', apps => {
    apps.Central.stages['editor-render-and-worker'].evidence.harnessFocusTrapOverrides = true;
  }],
  ['readonly false', apps => { apps.Central.stages['readonly-toggle'].evidence.readonly = false; }],
  ['readonly option only without keyboard evidence', apps => {
    delete apps.Central.stages['readonly-toggle'].evidence.keyboardBlocked;
  }],
  ['readonly blocks but never becomes editable', apps => {
    apps.Central.stages['readonly-toggle'].evidence.keyboardEditableAgain = false;
  }],
  ['readonly text unchanged without keyboard focus', apps => {
    apps.Central.stages['readonly-toggle'].evidence.readonlyFocusVerified = false;
  }],
  ['editable keyboard has no verified focus', apps => {
    delete apps.Central.stages['readonly-toggle'].evidence.editableFocusVerified;
  }],
  ['readonly remounts the editor', apps => {
    apps.Central.stages['readonly-toggle'].evidence.sameEditor = false;
  }],
  ['readonly replaces the model', apps => {
    apps.Central.stages['readonly-toggle'].evidence.sameModel = false;
  }],
  ['readonly corrected by harness', apps => {
    apps.Central.stages['readonly-toggle'].evidence.harnessCorrection = true;
  }],
  ['leaked Monaco model', apps => { apps.Central.stages['unmount-cleanup'].evidence.modelsRestored = false; }],
  ['unmount has no actual editor disposal', apps => {
    apps.Central.stages['unmount-cleanup'].evidence.editorDisposeEvents = 0;
  }],
  ['unmount has no actual model disposal', apps => {
    apps.Central.stages['unmount-cleanup'].evidence.modelDisposeEvents = 0;
  }],
  ['unmount double-disposes editor', apps => {
    apps.Central.stages['unmount-cleanup'].evidence.editorDisposeEvents = 2;
  }],
  ['unmount replaces unrelated editor with same count', apps => {
    apps.Central.stages['unmount-cleanup'].evidence.editorIds = ['replacement-editor'];
  }],
  ['unmount replaces unrelated model with same count', apps => {
    apps.Central.stages['unmount-cleanup'].evidence.modelUris = ['inmemory://replacement'];
  }],
  ['unmount corrected by harness', apps => {
    apps.Central.stages['unmount-cleanup'].evidence.harnessCorrection = true;
  }],
  ['boot runtime error', apps => { apps.Central.bootErrors.push({ kind: 'pageerror' }); }],
  ['post-install runtime error', apps => { apps.Central.runtimeErrors.push({ kind: 'pageerror' }); }],
  ['blocked write request', apps => { apps.Central.blockedMutations.push({ method: 'POST' }); }],
  ['skipped stage', apps => { apps.Central.stages['edit-prop-sync'].status = 'SKIP'; }],
  ['unexpected acceptance stage', apps => { apps.Central.stages.unrequested = { status: 'PASS' }; }],
]) {
  test(`summary refuses false pass: ${name}`, () => {
    const apps = summaryFixture();
    mutate(apps);
    assert.equal(summarizeModelDesignRuntime(apps, 1).isolatedRuntimePassed, false);
  });
}

async function modelServer(t, { changed = false, missing = false } = {}) {
  const names = ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json'];
  const bodies = names.map(name => Buffer.from(JSON.stringify({ id: 'ibizmodeling__central', name })));
  const entries = names.map((name, index) => ({
    path: `PSSYSAPPS/Central/${name}`, bytes: bodies[index].length,
    sha256: createHash('sha256').update(bodies[index]).digest('hex'),
  }));
  const server = createServer((request, response) => {
    const name = request.url.split('/').at(-1);
    const index = name === 'PSSYSAPP.hub.json' ? 0 : names.indexOf(name);
    if (index === -1 || (missing && index === 2)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    const bytes = Buffer.from(bodies[index]);
    if (changed && index === 1) bytes[0] = '['.charCodeAt(0);
    response.end(bytes);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  return { entry: `http://127.0.0.1:${server.address().port}/central/`, entries };
}

test('HTTP fixture binds three served native models and the hub alias to exact candidate bytes', async t => {
  const { entry, entries } = await modelServer(t);
  const evidence = await verifyModelDesignHttp(entry, [], [], { application: 'Central', modelEntries: entries });
  assert.equal(evidence.modelChecks.length, 4);
  assert.deepEqual(evidence.modelChecks.map(check => check.sha256), [
    ...entries.map(file => file.sha256), entries[0].sha256,
  ]);
});

for (const [name, options, error] of [
  ['same-size changed model', { changed: true }, /Native model HTTP hash/],
  ['missing served model', { missing: true }, /Native model HTTP status/],
]) {
  test(`HTTP fixture rejects ${name}`, async t => {
    const { entry, entries } = await modelServer(t, options);
    await assert.rejects(verifyModelDesignHttp(entry, [], [], {
      application: 'Central', modelEntries: entries,
    }), error);
  });
}

test('HTTP fixture refuses missing candidate evidence or a different application route', async t => {
  const { entry, entries } = await modelServer(t);
  await assert.rejects(verifyModelDesignHttp(entry, [], [], {
    application: 'Central', modelEntries: entries.slice(0, 2),
  }), /Missing candidate model/);
  await assert.rejects(verifyModelDesignHttp(entry, [], [], {
    application: 'ModelDesign', modelEntries: entries,
  }), /Native model entry identity differs/);
});
