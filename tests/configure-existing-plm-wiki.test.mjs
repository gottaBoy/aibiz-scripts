import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { addWikiParameter, assertWikiNacosInputIsActive, writeWikiConfiguration } from '../configure-existing-plm-wiki.mjs';

const input = 'deploysystemid: ibizplm\nsettings:\n  product: ibizplm\n  appdatactx:\n    mode: v9\nextension: true\n';

test('publication requires the running system to use the exact remote configuration', () => {
  const id = 'e2b9db6202c28d519ff0080e67a1cdb4a635bb48793a4c33e5a9267cf0b64546';
  const container = (local, system = 'ibizplm') => ({ Id: id, Config: { Env: [
    `IBIZ_SERVICEHUB_LOCALMODE=${local}`, `SYSTEM_NAME=${system}`, `IBIZ_SERVICEHUB_ID=${system}`,
  ] } });
  assert.doesNotThrow(() => assertWikiNacosInputIsActive(container('false')));
  assert.throws(() => assertWikiNacosInputIsActive(container('true', 'ibizservicerunner')), /local settings/);
  assert.throws(() => assertWikiNacosInputIsActive(container('false', 'ibizservicerunner')), /publication target/);
});

test('adds the exact Groovy param namespace and preserves unrelated configuration', () => {
  const output = addWikiParameter(input, 'http://127.0.0.1:30250');
  assert.match(output, /param:\n\s+plm_wiki: http:\/\/127\.0\.0\.1:30250/);
  assert.match(output, /mode: v9/);
  assert.equal(addWikiParameter(output, 'http://127.0.0.1:30250'), output);
});

test('refuses other origins, deployment identities, duplicate keys and overwritten parameters', () => {
  for (const origin of ['https://example.com', 'http://127.0.0.1:30250/', 'http://localhost:30250']) {
    assert.throws(() => addWikiParameter(input, origin));
  }
  assert.throws(() => addWikiParameter(input.replace('ibizplm', 'other'), 'http://127.0.0.1:30250'));
  assert.throws(() => addWikiParameter(`${input}settings: {}\n`, 'http://127.0.0.1:30250'));
  assert.throws(() => addWikiParameter(input.replace('  product:', '  param:\n    plm_wiki: https://example.com\n  product:'),
    'http://127.0.0.1:30250'));
});

const digest = value => createHash('sha256').update(value).digest('hex');
function transport(initial, publication = 'ok') {
  let current = Buffer.from(initial);
  const calls = [];
  return {
    calls,
    request: async (address, options) => {
      const url = new URL(address);
      assert.equal(url.origin, 'http://127.0.0.1:8848');
      assert.equal(url.pathname, '/nacos/v1/cs/configs');
      calls.push(options.method ?? 'GET');
      if (!options.method) {
        assert.equal(url.searchParams.get('dataId'), 'deploysystem-ibizplm');
        assert.equal(url.searchParams.get('group'), 'ibiz_config_group');
        return new Response(current, { status: 200 });
      }
      assert.equal(options.method, 'POST');
      const form = options.body;
      assert.equal(form.get('dataId'), 'deploysystem-ibizplm');
      assert.equal(form.get('group'), 'ibiz_config_group');
      assert.equal(form.get('type'), 'yaml');
      if (publication !== 'ignored') current = Buffer.from(form.get('content'));
      if (publication === 'uncertain') throw new Error('Controlled response loss after commit');
      return new Response('true', { status: 200 });
    },
    current: () => current,
  };
}

test('publishes once, independently reads back, then can restore the exact original bytes', async () => {
  const before = Buffer.from(input);
  const after = Buffer.from(addWikiParameter(input, 'http://127.0.0.1:30250'));
  const io = transport(before);
  const applied = await writeWikiConfiguration({ expected: before, next: after, request: io.request });
  assert.equal(applied.readbackVerified, true);
  assert.equal(applied.observedSha256, digest(after));
  assert.deepEqual(io.calls, ['GET', 'POST', 'GET']);
  const restored = await writeWikiConfiguration({ expected: after, next: before, request: io.request });
  assert.equal(restored.readbackVerified, true);
  assert.equal(restored.observedSha256, digest(before));
  assert.deepEqual(io.current(), before);
});

test('configuration drift refuses publication before any write', async () => {
  const io = transport(`${input}unrelated: changed\n`);
  await assert.rejects(writeWikiConfiguration({
    expected: Buffer.from(input), next: Buffer.from(addWikiParameter(input, 'http://127.0.0.1:30250')),
    request: io.request,
  }), /Nacos input drifted/);
  assert.deepEqual(io.calls, ['GET']);
});

test('a response lost after commit records the observed candidate without a second POST', async () => {
  const before = Buffer.from(input);
  const after = Buffer.from(addWikiParameter(input, 'http://127.0.0.1:30250'));
  const io = transport(before, 'uncertain');
  await assert.rejects(writeWikiConfiguration({ expected: before, next: after, request: io.request }), error => {
    assert.equal(error.evidence.requestDispatched, true);
    assert.equal(error.evidence.readbackVerified, false);
    assert.equal(error.evidence.observedSha256, digest(after));
    return true;
  });
  assert.deepEqual(io.calls, ['GET', 'POST', 'GET']);
});

test('a successful publish response cannot conceal unchanged remote content', async () => {
  const before = Buffer.from(input);
  const io = transport(before, 'ignored');
  await assert.rejects(writeWikiConfiguration({
    expected: before, next: Buffer.from(addWikiParameter(input, 'http://127.0.0.1:30250')),
    request: io.request,
  }), error => {
    assert.equal(error.evidence.readbackVerified, false);
    assert.equal(error.evidence.observedSha256, digest(before));
    return true;
  });
  assert.equal(io.calls.filter(method => method === 'POST').length, 1);
});
