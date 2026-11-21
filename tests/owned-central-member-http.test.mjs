import assert from 'node:assert/strict';
import test from 'node:test';
import { runOwnedCentralMemberHttp, validateCentralMemberRequest } from '../owned-central-member-http.mjs';

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
    guardCalls: 0, guard() { this.guardCalls++; },
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
