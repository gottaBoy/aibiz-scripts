import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nativeFieldRoundtrip, readNativeBrowserToken,
} from '../../modelingweb/app/tests/native-field-roundtrip.mjs';

const privateToken = 'private-browser-token';
function fixture(options = {}) {
  let value = 4;
  const calls = [];
  let writes = 0;
  let loggedIn = false;
  const response = (body, status = 200) => ({ status: () => status, json: async () => body });
  const flow = nativeFieldRoundtrip({
    entry: 'http://fixture/modeldesign/',
    applicationId: 'ibizmodeling__modeldesign',
    basePath: '/api/ibizmodeling__modeldesign/entities/one/fields',
    fieldId: 'field-1',
    readToken: async () => options.token ?? privateToken,
    credentials: { loginname: 'fixture-user', password: 'private-password' },
    request: {
      async post(url, init) {
        calls.push({ url, ...init });
        if (url.endsWith('/v7/login')) {
          if (options.loginThrows) throw new Error('private-password private-browser-token');
          loggedIn = true;
          return response({ token: 'private-fresh-token' }, options.loginStatus ?? 200);
        }
        if (options.readThrows) throw new Error('private-browser-token private-fresh-token');
        if (options.readInvalidJson) {
          return { status: () => 200, json: async () => { throw new Error(privateToken); } };
        }
        return response([{ psdefieldid: 'field-1', psdefieldname: 'Order', ordervalue: value }]);
      },
      async put(url, init) {
        writes++;
        calls.push({ url, ...init });
        value = init.data.ordervalue;
        if (writes === 1 && options.writeThrows) throw new Error('private-browser-token transport failed');
        if (writes > 1 && options.cleanupThrows) throw new Error('private-fresh-token');
        if (writes > 1 && options.expireOnce && writes === 2) return response({}, 401);
        if (loggedIn && options.invalidateOriginal &&
            init.headers.Authorization === `Bearer ${privateToken}`) return response({}, 401);
        return response({ ordervalue: value }, options.cleanupFails && writes > 1 ? 500 : 200);
      },
    },
  });
  return { flow, calls, value: () => value };
}

test('roundtrip uses private browser/fresh tokens and restores persisted original state', async () => {
  const { flow, calls, value } = fixture();
  const evidence = [await flow.save(), await flow.readback(), await flow.restore()];
  assert.equal(value(), 4);
  assert.equal(evidence[0].browserEditorInteractionVerified, false);
  assert.equal(evidence[0].transport, 'authenticated-http');
  assert.ok(!JSON.stringify(evidence).includes('private-'));
  assert.ok(calls.some(call => call.headers?.Authorization === `Bearer ${privateToken}`));
  assert.ok(calls.some(call => call.headers?.Authorization === 'Bearer private-fresh-token'));
  assert.equal((await flow.restore()).needed, false);
});

test('a write that mutates before throwing still triggers persistent cleanup', async () => {
  const { flow, value } = fixture({ writeThrows: true });
  await assert.rejects(flow.save(), /field write transport or JSON decoding failed/);
  assert.equal(value(), 11);
  await assert.rejects(flow.readback(), /did not complete/);
  assert.equal((await flow.restore()).restored, true);
  assert.equal(value(), 4);
});

test('fresh login failure does not prevent restoration and does not leak returned tokens', async () => {
  const { flow, value } = fixture({ loginStatus: 401 });
  await flow.save();
  await assert.rejects(flow.readback(), /fresh session login must return HTTP 200/);
  await flow.restore();
  assert.equal(value(), 4);
});

test('failed cleanup is explicit and can be retried without losing the target', async () => {
  const { flow } = fixture({ cleanupFails: true });
  await flow.save();
  await assert.rejects(flow.restore(), /write must return HTTP 200/);
  await assert.rejects(flow.restore(), /write must return HTTP 200/);
});

test('invalid session tokens prevent every network request', async () => {
  for (const token of ['', 'has space', 'has\nnewline']) {
    const { flow, calls } = fixture({ token });
    await assert.rejects(flow.save(), /valid private session token/);
    assert.equal(calls.length, 0);
    assert.equal((await flow.restore()).needed, false);
  }
});

test('browser session access sanitizes evaluated errors and returns no token evidence object', async () => {
  assert.equal(await readNativeBrowserToken({ evaluate: async () => privateToken }), privateToken);
  await assert.rejects(readNativeBrowserToken({
    evaluate: async () => { throw new Error(privateToken); },
  }), error => /could not read/.test(error.message) && !error.message.includes(privateToken));
});

for (const phase of ['readThrows', 'readInvalidJson', 'writeThrows', 'loginThrows', 'cleanupThrows']) {
  test(`roundtrip sanitizes secret-bearing ${phase} errors`, async () => {
    const { flow } = fixture({ [phase]: true });
    const evidence = [];
    const capture = async action => {
      try { evidence.push(await action()); }
      catch (error) { evidence.push({ error: String(error) }); }
    };
    await capture(() => flow.save());
    await capture(() => flow.readback());
    await capture(() => flow.restore());
    const text = JSON.stringify(evidence);
    assert.ok(evidence.some(item => item.error?.includes('transport or JSON decoding failed')));
    assert.ok(!text.includes(privateToken));
    assert.ok(!text.includes('private-fresh-token'));
    assert.ok(!text.includes('private-password'));
  });
}

test('cleanup uses the new private session when login invalidates the original token', async () => {
  const { flow, calls, value } = fixture({ invalidateOriginal: true });
  await flow.save();
  await flow.readback();
  await flow.restore();
  assert.equal(value(), 4);
  const writes = calls.filter(call => call.data?.ordervalue !== undefined);
  assert.equal(writes.at(-1).headers.Authorization, 'Bearer private-fresh-token');
});

test('cleanup refreshes authentication once after HTTP 401', async () => {
  const { flow, calls, value } = fixture({ expireOnce: true });
  await flow.save();
  assert.equal((await flow.restore()).restored, true);
  assert.equal(value(), 4);
  assert.equal(calls.filter(call => call.url.endsWith('/v7/login')).length, 1);
});
