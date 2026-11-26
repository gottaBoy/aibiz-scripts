import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runOwnedCentralMemberHttp, validateCentralMemberRequest,
  currentCentralReadRequest, validateCurrentCentralOrganization, currentCentralDenial,
} from '../owned-central-member-http.mjs';

function fixture() {
  const runId = '123456789abc';
  const roots = ['a', 'b'].map(side => ({
    side, rootId: `nf_${runId}_root_${side}`, schemeId: `nf_${runId}_scheme_${side}`,
    centerId: `nf_${runId}_center_${side}`,
  }));
  const users = roots.flatMap(root => ['editor', 'viewer', 'no-access'].map(role => ({
    personId: `nf_${runId}_person_${root.side}_${role === 'editor' ? 'e' : role === 'viewer' ? 'v' : 'n'}`,
    loginname: `user_${root.side}_${role}`, role, rootId: root.rootId, centerId: root.centerId,
    administrator: false,
  })));
  const accounts = users.map(user => ({
    id: user.personId, loginname: user.loginname, tenant: user.centerId,
    organization: `${user.centerId}_org`, system: 'ibizmodeling',
  }));
  const context = {
    manifest: { runId, users, roots },
    credentials: { users: Object.fromEntries(users.map(user => [user.loginname, 'secret'])) },
    guardCalls: 0, guard() {
      this.guardCalls++;
      return { origins: { backend: 'http://127.0.0.1:32459' } };
    },
  };
  let snapshotValue = { tables: [{ database: 'model', table: 'T', rows: [] }] };
  const requests = [];
  const sessions = new Map();
  const transport = async (ctx, spec) => {
    requests.push(spec);
    if (spec.path === '/v7/login') {
      const actor = users.find(user => user.loginname === spec.data.loginname);
      const token = `a.${Buffer.from(JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + 20, sub: actor.personId,
      })).toString('base64url')}.c`;
      sessions.set(token, actor);
      return { status: 200, error: null, bytes: 60, data: { token } };
    }
    if (spec.path === '/appdata') {
      const actor = sessions.get(spec.token);
      return { status: 200, error: null, bytes: 2, data: { context: {
        srfpersonid: actor.personId, srfuserid: actor.personId, srfdcid: actor.centerId,
        srforgid: `${actor.centerId}_org`, srfsystemid: 'ibizmodeling',
      } } };
    }
    if (spec.path === '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser') {
      if (!spec.token) return { status: 401, error: null, bytes: 0, data: null };
      const actor = sessions.get(spec.token);
      const rows = actor.role === 'no-access' ? [] : [{
        psdevslnid: actor.rootId.replace('_root_', '_scheme_'),
        psdevslnsysid: actor.rootId, psdevcenterid: actor.centerId,
        psdevslnname: actor.rootId,
      }];
      return { status: 200, error: null, bytes: JSON.stringify(rows).length, data: rows };
    }
    throw new Error(`Unexpected path: ${spec.path}`);
  };
  return { context, accounts, transport, requests, snapshot: () => structuredClone(snapshotValue),
    setSnapshot(value) { snapshotValue = value; } };
}

test('fresh six-actor member read binds exact route, nonempty own rows and physical invariance', async () => {
  const s = fixture();
  const report = await runOwnedCentralMemberHttp(s);
  assert.equal(report.status, 'passed-central-member-read-not-accepted');
  assert.equal(s.requests.filter(row => row.path?.endsWith('fetchcurdcslnuser')
    && row.token).length, 6);
  assert.equal(report.requests.filter(row => row.rows > 0).length, 4);
  assert.equal(report.outcomes.find(row => row.kind === 'anonymous').status, 401);
  assert.equal(report.navigationAcceptance, false);
  assert.equal(report.identityOrHeaderInjection, false);
  assert.equal(report.transport, 'controlled-transport-not-live-evidence');
  assert.equal(report.snapshots.length, 15);
  assert.ok(report.snapshots.every(row => row.sha256 === report.baseline));
  assert.ok(s.context.guardCalls > 0);
  assert.ok(s.requests.every(spec => spec.path === '/v7/login' || spec.path === '/appdata'
    || spec.path === '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser'));
});

test('request contract rejects wrong route, method, body, root headers and token shape', () => {
  const bad = [
    { path: '/api/ibizmodeling__central/psdevslns/fetchdefault', method: 'POST' },
    { path: '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser', method: 'GET' },
    { path: '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser', method: 'POST',
      data: { page: 1, size: 1000 } },
  ];
  for (const row of bad) assert.throws(() => validateCentralMemberRequest({
    peer: 'backend', token: 'a.b.c', applicationContext: {
      system: 'ibizmodeling', organization: 'center_org',
    }, data: { page: 0, size: 1000 }, ...row,
  }, { centerId: 'center' }));
});

test('snapshot drift after a member read fails before claiming a pass', async () => {
  const s = fixture();
  let count = 0;
  s.snapshot = () => {
    count++;
    return count === 3 ? { changed: true } : { changed: false };
  };
  await assert.rejects(runOwnedCentralMemberHttp(s), /physical model state/);
});

test('foreign rows are rejected even when status and JSON shape are otherwise valid', async () => {
  const s = fixture();
  const baseTransport = s.transport;
  s.transport = async (ctx, spec) => {
    const result = await baseTransport(ctx, spec);
    if (spec.path.endsWith('fetchcurdcslnuser') && spec.token) {
      result.data[0] = { ...result.data[0], psdevcenterid: 'foreign-center' };
    }
    return result;
  };
  await assert.rejects(runOwnedCentralMemberHttp(s), /foreign-center/);
});

test('default live transport never supplies person, user, center or principal headers', async () => {
  const s = fixture();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const headers = new Headers(init.headers);
    requests.push({ path: new URL(url).pathname, headers: [...headers.keys()] });
    assert.deepEqual([...headers.keys()].sort(), [
      'accept', 'content-type', ...(headers.has('authorization') ? ['authorization'] : []),
      ...(headers.has('srforgid') ? ['srforgid', 'srfsystemid'] : []),
    ].sort());
    for (const name of ['srfuserid', 'srfpersonid', 'srfdcid', 'srfusername', 'srfusermode',
      'x-user-id', 'x-principal', 'srfpersonname']) assert.equal(headers.has(name), false, name);
    const result = await s.transport(s.context, {
      peer: 'backend', path: new URL(url).pathname, method: init.method,
      ...(init.body ? { data: JSON.parse(init.body) } : {}),
      ...(headers.has('authorization') ? { token: headers.get('authorization').slice(7) } : {}),
      ...(headers.has('srforgid') ? { applicationContext: {
        system: headers.get('srfsystemid'), organization: headers.get('srforgid'),
      } } : {}),
    });
    return new Response(JSON.stringify(result.data), { status: result.status,
      headers: { 'content-type': 'application/json' } });
  };
  try {
    const report = await runOwnedCentralMemberHttp({ ...s, transport: undefined });
    assert.equal(report.status, 'passed-central-member-read-not-accepted');
    assert.equal(report.transport, 'native-issued-session-only');
    assert.equal(requests.length, 19);
  } finally { globalThis.fetch = originalFetch; }
});

test('a server denial without injected identity remains a failed receipt', async () => {
  const s = fixture();
  const transport = s.transport;
  s.transport = async (context, spec) => spec.path.endsWith('fetchcurdcslnuser') && spec.token
    ? { status: 403, error: null, bytes: 0, data: null } : transport(context, spec);
  await assert.rejects(runOwnedCentralMemberHttp(s), error => {
    assert.equal(error.evidence.status, 'failed-central-member-read');
    assert.equal(error.evidence.identityOrHeaderInjection, false);
    assert.equal(error.evidence.nativeAcceptance, false);
    assert.equal(error.evidence.snapshots.length, 3);
    return true;
  });
});

for (const path of ['/v7/login', '/appdata']) {
  test(`physical changes during ${path} cannot hide between otherwise unchanged member snapshots`, async () => {
    const s = fixture();
    const transport = s.transport;
    const journal = [];
    s.record = (kind, value) => journal.push({ kind, value });
    s.transport = async (context, spec) => {
      const result = await transport(context, spec);
      if (spec.path === path) s.setSnapshot({ tables: [{ database: 'model', table: 'T', rows: [{ unexpected: true }] }] });
      return result;
    };
    await assert.rejects(runOwnedCentralMemberHttp(s), error => {
      assert.match(error.message, /initial physical model state/);
      assert.equal(error.evidence.status, 'failed-central-member-read');
      assert.equal(error.evidence.snapshots.length, 2);
      assert.notEqual(error.evidence.snapshots[0].sha256, error.evidence.snapshots[1].sha256);
      assert.equal(journal.length, 2, 'The mismatched snapshot must be recorded before refusal');
      assert.equal(journal.at(-1).value.value.tables[0].rows[0].unexpected, true);
      return true;
    });
  });
}

test('anonymous 401 also requires before/after snapshots equal to the initial physical state', async () => {
  const s = fixture();
  const transport = s.transport;
  const journal = [];
  s.record = (kind, value) => journal.push({ kind, value });
  s.transport = async (context, spec) => {
    const result = await transport(context, spec);
    if (spec.path.endsWith('fetchcurdcslnuser') && !spec.token) s.setSnapshot({ changedDuringAnonymous: true });
    return result;
  };
  await assert.rejects(runOwnedCentralMemberHttp(s), error => {
    assert.match(error.message, /initial physical model state/);
    assert.equal(error.evidence.status, 'failed-central-member-read');
    assert.equal(error.evidence.snapshots.length, 15);
    assert.equal(error.evidence.snapshots.at(-2).purpose, 'before-anonymous');
    assert.equal(error.evidence.snapshots.at(-1).purpose, 'after-anonymous');
    assert.deepEqual(error.evidence.outcomes.find(row => row.kind === 'anonymous'), { kind: 'anonymous', status: 401 });
    assert.deepEqual(journal.at(-1).value.value, { changedDuringAnonymous: true });
    return true;
  });
});

test('shared Central policy permits only normal bootstrap and native dataset reads on its observed origin', () => {
  const origin = 'http://127.0.0.1:32008';
  for (const [method, pathname] of [
    ['GET', '/central/'], ['GET', '/central/environments/environment.js'],
    ['POST', '/api/ibizmodeling__central/v7/login'],
    ['GET', '/api/ibizmodeling__central/uaa/getbydcsystem/ibizmodeling'],
    ['GET', '/api/ibizmodeling__central/appdata'],
    ['POST', '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser'],
    ['GET', '/api/ibizmodeling__central/psdevcenters/demo'],
  ]) assert.equal(currentCentralReadRequest({ origin, method, pathname }, origin), true);
  for (const [method, pathname] of [
    ['POST', '/api/ibizmodeling__central/psdevslns'],
    ['POST', '/api/ibizmodeling__central/psdevslns/own/save'],
    ['PUT', '/api/ibizmodeling__central/psdevslns/own'],
    ['DELETE', '/api/ibizmodeling__central/psdevslns/own'],
    ['GET', '/api/ibizmodeling__modeldesign/appdata'],
    ['GET', '/central-other/'], ['GET', '/central/../outside'],
  ]) assert.equal(currentCentralReadRequest({ origin, method, pathname }, origin), false);
  assert.equal(currentCentralReadRequest({ origin: 'http://external.invalid', method: 'GET', pathname: '/central/' }, origin), false);
});

test('current normal organization context must come from the same UI response and actual headers', () => {
  const input = { choices: [{ orgid: 'issued-org', systemid: 'ibizmodeling' }],
    context: { srfuserid: 'issued-user', srfpersonid: 'issued-person', srforgid: 'issued-org', srfsystemid: 'ibizmodeling' },
    headers: { srforgid: 'issued-org', srfsystemid: 'ibizmodeling' },
    credential: { username: 'normal', userId: 'issued-user', personId: 'issued-person' } };
  assert.equal(validateCurrentCentralOrganization(input).source, 'normal-ui-native-choice-and-authenticated-appdata');
  for (const alter of [
    value => { value.choices = []; },
    value => { value.choices.push({ ...value.choices[0] }); },
    value => { value.headers.srforgid = 'guessed'; },
    value => { value.context.srfpersonid = 'other'; },
    value => { value.context.srfloginname = 'other'; },
    value => { value.headers.srfuserid = 'issued-user'; },
  ]) { const changed = structuredClone(input); alter(changed); assert.throws(() => validateCurrentCentralOrganization(changed)); }
  const derived = structuredClone(input);
  derived.context.srfuserid = 'modeling-derived-user';
  assert.equal(validateCurrentCentralOrganization(derived).userIdScope, 'current-modeling-application');
  derived.credential.modelingUserId = 'different-explicit-modeling-user';
  assert.throws(() => validateCurrentCentralOrganization(derived));
});

test('native 403 stops the same session and never authorizes a new-account or header fallback', () => {
  const memberPath = '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser';
  assert.deepEqual(currentCentralDenial({ status: 403, method: 'POST', path: memberPath }),
    { stop: true, reason: 'native-403-same-session-stop-no-fallback', method: 'POST', path: memberPath });
  for (const status of [200, 401, 500]) assert.equal(currentCentralDenial({ status }).stop, false);
});
