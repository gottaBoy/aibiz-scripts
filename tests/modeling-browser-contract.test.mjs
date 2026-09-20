import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkLive } from '../../modelingweb/app/scripts/modeling-plugins-deployment.mjs';
import {
  assertSavedDocument, coverageProblems, deploymentTarget, DocumentLedger, documentPath, downloadOnClick,
  assertRendering, editorUrl, errorSummary, flowSteps, jsonClient, languages, viewports,
} from '../modeling-browser-contract.mjs';

const catalog = JSON.parse(await readFile(new URL('../../modelingweb/app/src/modeling-plugins/catalog.json', import.meta.url)));
const prefix = 'Harness fixture-run-001 ';
const draft = (id = 'generated-001') => ({
  schemaVersion: 1, id, pluginId: 'logicdesign', title: `${prefix}Logic`,
  revision: 0, updatedAt: '', content: { nodes: [{ id: 'start', kind: 'start' }] },
});
const absent = () => ({ status: 404, body: { error: 'not_found' } });

function fixture() {
  const documents = new Map();
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    const current = documents.get(path);
    if (!current) return absent();
    if (options.method === 'DELETE') {
      if (options.headers['If-Match'] !== `"${current.revision}"`) return { status: 409, body: { error: 'revision_conflict' } };
      if (options.headers['X-Document-SHA256'] !== createHash('sha256').update(JSON.stringify(current)).digest('hex')) {
        return { status: 409, body: { error: 'revision_conflict' } };
      }
      documents.delete(path);
      return { status: 200, body: { deleted: true } };
    }
    return { status: 200, body: structuredClone(current) };
  };
  const put = (body, patch = {}) => {
    const saved = { ...body, title: body.title.trim(), revision: body.revision + 1, updatedAt: '2026-09-15T02:00:00Z', ...patch };
    documents.set(documentPath(body.pluginId, body.id), structuredClone(saved));
    return saved;
  };
  return { documents, calls, request, put, ledger: new DocumentLedger(request, prefix) };
}

test('deployment targets preserve the loopback origin and optional Nginx prefix', () => {
  for (const origin of ['http://127.0.0.1:32003', 'http://localhost:32003', 'http://[::1]:32003']) {
    assert.deepEqual(deploymentTarget(`${origin}/`), { origin, pageBase: origin });
    assert.deepEqual(deploymentTarget(`${origin}/modeling-plugins/`), { origin, pageBase: `${origin}/modeling-plugins` });
  }
});

test('non-loopback, credentials, query strings, encoded paths and ambiguous targets fail before network access', () => {
  for (const target of [
    undefined, '', '/modeling-plugins', ' https://example.test', 'http://example.test',
    'https://localhost', 'http://127.0.0.1.evil.test', 'http://127.0.0.2',
    'http://2130706433', 'http://127.1', 'http://user:password@localhost',
    'http://localhost/modeldesign', 'http://localhost/modeling-plugins?token=secret',
    'http://localhost/#', 'http://localhost/%2e/modeling-plugins',
    'http://localhost\\modeling-plugins', 'http://localhost/modeling-plugins//',
    'http://localhost/modeling-plugins/..',
  ]) assert.throws(() => deploymentTarget(target), /Expected an HTTP loopback/);
});

test('consecutive plugin navigations differ before the hash and keep language/document context', () => {
  const first = new URL(editorUrl('http://localhost:32003/modeling-plugins', 'logicdesign', 'en', 'document-1', 'run-1'));
  const second = new URL(editorUrl('http://localhost:32003/modeling-plugins', 'formdesign', 'en', undefined, 'run-2'));
  assert.notEqual(first.search, second.search);
  assert.equal(first.pathname, '/modeling-plugins/modeling-plugins.html');
  assert.equal(first.searchParams.get('lang'), 'en');
  assert.equal(first.hash, '#/logicdesign?document=document-1');
  assert.equal(second.hash, '#/formdesign');
});

test('the JSON client prohibits redirects and keeps an abort signal on requests', async () => {
  const calls = [];
  const request = jsonClient('http://127.0.0.1:32003', {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response('{"deleted":true}', { status: 200 });
    },
  });
  const response = await request('/api/modeling-plugins/logicdesign/documents/test', {
    method: 'DELETE', headers: { 'If-Match': '"2"' }, redirect: 'follow',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.deleted, true);
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.headers['If-Match'], '"2"');
  await assert.rejects(request('http://untrusted.test/path'));
  await assert.rejects(request('/api/modeling-plugins/../users'));
  assert.equal(calls.length, 1);
});

test('JSON client rejects redirects and invalid JSON rather than counting status-only success', async () => {
  const redirect = jsonClient('http://localhost', { fetchImpl: async () => new Response('', { status: 302 }) });
  await assert.rejects(redirect('/api/modeling-plugins/catalog'), /Redirect rejected/);
  const invalid = jsonClient('http://localhost', { fetchImpl: async () => new Response('<html>Login</html>') });
  await assert.rejects(invalid('/api/modeling-plugins/catalog'));
});

test('JSON client times out during body consumption, not only connection setup', async () => {
  let signal;
  const request = jsonClient('http://localhost', {
    timeoutMs: 20,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return { status: 200, json: () => new Promise(() => {}) };
    },
  });
  await assert.rejects(request('/api/modeling-plugins/catalog'), /timed out/);
  assert.equal(signal.aborted, true);
});

test('network permission diagnostics retain the actual cause code', async () => {
  const error = new TypeError('fetch failed', { cause: { code: 'EPERM', syscall: 'connect' } });
  assert.match(errorSummary(error), /EPERM: connect/);
  const request = jsonClient('http://localhost', { fetchImpl: async () => { throw error; } });
  await assert.rejects(request('/api/modeling-plugins/catalog'), /EPERM: connect/);
});

test('cleanup covers original and copy documents even without completed browser results', async () => {
  const f = fixture();
  const original = draft();
  const copy = draft('generated-copy');
  await f.ledger.beforeSave(original);
  await f.ledger.beforeSave(copy);
  const saved = f.put(original);
  f.ledger.acknowledge(saved);
  // Copy was persisted, but its response never reached the browser.
  f.put(copy);
  const result = await f.ledger.cleanup();
  assert.equal(result.status, 'pass');
  assert.equal(result.attempted, 2);
  assert.equal(result.deleted, 2);
  assert.equal(f.documents.size, 0);
  assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 2);
});

test('cleanup can recover a lost update acknowledgement with the exact intended revision', async () => {
  const f = fixture();
  const input = draft();
  await f.ledger.beforeSave(input);
  const first = f.put(input);
  f.ledger.acknowledge(first);
  const update = { ...first, title: `${prefix}Updated`, content: { nodes: [{ id: 'changed' }] } };
  await f.ledger.beforeSave(update);
  f.put(update);
  assert.equal((await f.ledger.cleanup()).status, 'pass');
  assert.equal(f.calls.find(call => call.method === 'DELETE').headers['If-Match'], '"2"');
});

test('claiming a pre-existing document never overwrites or schedules it for deletion', async () => {
  const f = fixture();
  const input = draft();
  f.put(input);
  await assert.rejects(f.ledger.beforeSave(input), /pre-existing document/);
  const result = await f.ledger.cleanup();
  assert.equal(result.attempted, 0);
  assert.equal(f.documents.size, 1);
  assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 0);
});

test('a same-ID/revision replacement between cleanup GET and DELETE is retained', async () => {
  const f = fixture();
  const input = draft();
  await f.ledger.beforeSave(input);
  const saved = f.put(input);
  f.ledger.acknowledge(saved);
  f.ledger.request = async (path, options = {}) => {
    if (options.method === 'DELETE') f.put(input, { title: 'Someone else replaced this document' });
    return f.request(path, options);
  };
  const result = await f.ledger.cleanup();
  assert.equal(result.status, 'fail');
  assert.equal(result.deleted, 0);
  assert.equal(f.documents.get(documentPath(input.pluginId, input.id)).title, 'Someone else replaced this document');
});

test('save acknowledgements preserve intended changes even without a deployed ledger', () => {
  const input = { ...draft(), revision: 1, title: `${prefix}Edited` };
  const saved = { ...input, revision: 2 };
  assert.doesNotThrow(() => assertSavedDocument(input, saved));
  assert.throws(() => assertSavedDocument(input, { ...saved, title: `${prefix}Stale` }));
  assert.throws(() => assertSavedDocument(input, { ...saved, revision: 1 }));
});

test('a failed click cannot leave an unhandled download rejection', async () => {
  let rejectDownload;
  const page = { waitForEvent: () => new Promise((_, reject) => { rejectDownload = reject; }) };
  await assert.rejects(downloadOnClick(page, () => { throw new Error('click failed'); }), /click failed/);
  rejectDownload(new Error('download timed out after click failure'));
  await new Promise(resolve => setImmediate(resolve));
  const download = { path: 'fixture' };
  assert.equal(await downloadOnClick({ waitForEvent: async () => download }, async () => {}), download);
});

test('a generic HTTP 404 is not evidence that a document is absent', async () => {
  const ledger = new DocumentLedger(async () => ({ status: 404, body: { message: 'proxy unavailable' } }), prefix);
  await assert.rejects(ledger.beforeSave(draft()), /pre-existing document/);
  assert.equal(ledger.documents.size, 0);
});

test('only this run title and a fresh revision can create ownership', async () => {
  const f = fixture();
  await assert.rejects(f.ledger.beforeSave({ ...draft(), title: 'User model' }), /Only this run/);
  await assert.rejects(f.ledger.beforeSave({ ...draft(), revision: 4 }), /existing revision/);
  assert.equal(f.calls.length, 0);
});

test('acknowledgements cannot replace the intended content with arbitrary server data', async () => {
  const f = fixture();
  const input = draft();
  await f.ledger.beforeSave(input);
  const saved = f.put(input, { content: { unrelated: true } });
  assert.throws(() => f.ledger.acknowledge(saved), /Save changed intended content/);
  const result = await f.ledger.cleanup();
  assert.equal(result.status, 'fail');
  assert.equal(result.retained.length, 1);
  assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 0);
});

test('concurrently changed content or a newer revision is retained for manual review', async () => {
  for (const patch of [{ revision: 9 }, { content: { owner: 'someone-else' } }, { id: 'foreign' }]) {
    const f = fixture();
    const input = draft();
    await f.ledger.beforeSave(input);
    f.put(input, patch);
    const result = await f.ledger.cleanup();
    assert.equal(result.status, 'fail');
    assert.equal(result.deleted, 0);
    assert.equal(f.documents.size, 1);
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 0);
  }
});

test('already removed, acknowledged documents are verified absent', async () => {
  const f = fixture();
  const input = draft();
  await f.ledger.beforeSave(input);
  f.ledger.acknowledge(f.put(input));
  f.documents.clear();
  const result = await f.ledger.cleanup();
  assert.equal(result.status, 'pass');
  assert.equal(result.alreadyAbsent, 1);
  assert.equal(result.deleted, 0);
});

test('unacknowledged writes are not cleared on a potentially premature 404 or stale read', async () => {
  for (const hasFirstRevision of [false, true]) {
    const f = fixture();
    const input = draft();
    await f.ledger.beforeSave(input);
    if (hasFirstRevision) {
      const first = f.put(input);
      f.ledger.acknowledge(first);
      await f.ledger.beforeSave({ ...first, title: `${prefix}Second` });
    }
    const result = await f.ledger.cleanup();
    assert.equal(result.status, 'fail');
    assert.equal(result.retained.length, 1);
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 0);
  }
});

test('cleanup stops on an explicit permission denial and records the unattempted documents', async () => {
  const f = fixture();
  await f.ledger.beforeSave(draft());
  await f.ledger.beforeSave(draft('copy'));
  let attempts = 0;
  f.ledger.request = async () => {
    attempts += 1;
    throw new Error('connect EPERM');
  };
  const result = await f.ledger.cleanup();
  assert.equal(attempts, 1);
  assert.equal(result.status, 'fail');
  assert.equal(result.retained.length, 2);
});

test('failed deletes, invalid acknowledgements, and a still-present document fail cleanup', async () => {
  for (const mode of ['conflict', 'false-ack', 'still-present']) {
    const f = fixture();
    const request = async (path, options = {}) => {
      if (options.method !== 'DELETE') return f.request(path, options);
      return mode === 'conflict' ? { status: 409, body: { error: 'revision_conflict' } } :
        { status: 200, body: { deleted: mode !== 'false-ack' } };
    };
    const ledger = new DocumentLedger(request, prefix);
    await ledger.beforeSave(draft());
    f.put(draft());
    const result = await ledger.cleanup();
    assert.equal(result.status, 'fail', mode);
    assert.equal(result.retained.length, 1, mode);
  }
});

function completeReport(mode = 'deployed-sidecar') {
  const cases = catalog.flatMap(({ id }) => languages.map(language => ({ id, language })));
  const steps = [...flowSteps, 'fresh-session-reload'];
  if (mode === 'isolated-local-server') steps.push('server-restart-recovery');
  return {
    executionMode: mode, clientArtifactMatched: true,
    browserErrors: [], externalRequests: [], failedRequests: [],
    results: cases.map(row => ({ ...row, status: 'pass', steps: steps.map(name => ({ name, status: 'pass' })) })),
    viewportResults: cases.flatMap(row => viewports.map(viewport => ({ ...row, viewport, status: 'pass' }))),
    cleanup: { status: 'pass', attempted: 92, deleted: 46, alreadyAbsent: 46, failures: [], retained: [] },
  };
}

test('acceptance requires all 46 language flows and 92 mobile/tablet cases', () => {
  assert.deepEqual(coverageProblems(completeReport(), catalog), []);
  for (const change of [
    report => { report.clientArtifactMatched = false; },
    report => { report.results.pop(); },
    report => { report.results = {}; },
    report => { report.results[0] = null; },
    report => { report.results[1] = report.results[0]; },
    report => { report.results[0].steps.pop(); },
    report => { report.results[0].steps[1] = report.results[0].steps[0]; },
    report => { report.viewportResults.pop(); },
    report => { report.viewportResults[0].viewport = { width: 1440, height: 1000 }; },
    report => { report.results[0].status = 'pending-recovery'; },
    report => { report.browserErrors.push({ message: 'render failed' }); },
    report => { report.failedRequests.push({ status: 500 }); },
    report => { report.externalRequests.push('https://external.test'); },
    report => { report.cleanup.status = 'fail'; },
    report => { report.cleanup.deleted = 0; },
    report => { report.cleanup.retained.push('/api/modeling-plugins/logicdesign/documents/fixture'); },
  ]) {
    const report = completeReport();
    change(report);
    assert.ok(coverageProblems(report, catalog).length > 0);
  }
});

test('deployed read-back never substitutes for isolated server restart evidence', () => {
  const report = completeReport('isolated-local-server');
  assert.deepEqual(coverageProblems(report, catalog), []);
  report.results[0].steps.find(step => step.name === 'server-restart-recovery').name = 'deployed-sidecar-persistence';
  assert.ok(coverageProblems(report, catalog).length > 0);
});

test('malformed catalog evidence fails coverage without throwing during report finalization', () => {
  for (const invalid of [{}, [null], null, [], [{ id: 42 }]]) {
    assert.deepEqual(coverageProblems(completeReport(), invalid), ['catalog: invalid']);
  }
});

test('a sized container is not proof that a graph or chart was rendered', () => {
  const graph = { content: { nodes: [{ id: 'node-1' }], edges: [] } };
  const drawn = { errors: 0, nodeIds: ['node-1'], edgeIds: [], visibleNodes: 1, charts: [] };
  assert.doesNotThrow(() => assertRendering({ family: 'graph' }, graph, drawn));
  for (const patch of [{ errors: 1 }, { nodeIds: [] }, { visibleNodes: 0 }]) {
    assert.throws(() => assertRendering({ family: 'graph' }, graph, { ...drawn, ...patch }));
  }
  const chart = { content: { settings: { chartType: 'bar' } } };
  const entry = { id: 'chartdesign', family: 'layout' };
  assert.throws(() => assertRendering(entry, chart, drawn));
  assert.throws(() => assertRendering(entry, chart, { ...drawn, charts: [{ pixels: 5000, colors: 1 }] }));
  assert.doesNotThrow(() => assertRendering(entry, chart, { ...drawn, charts: [{ pixels: 50, colors: 8 }] }));
});

function liveFixture(prefix, fault = '') {
  const assets = {
    'modeling-plugins.html': '<!doctype html><script src="./assets/test.js"></script>',
    'assets/test.js': 'console.log("fixture")',
    'assets/test.css': '.fixture { color: red }',
  };
  const manifest = {
    plugins: [{ id: 'logicdesign', family: 'graph' }],
    files: { 'server.mjs': 'not-public', ...Object.fromEntries(Object.entries(assets).map(([name, text]) =>
      [name, createHash('sha256').update(text).digest('hex')])) },
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ path: url.pathname, options });
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/api/modeling-plugins/catalog') {
      if (options.headers?.Origin) return new Response('{}', { status: fault === 'origin' ? 200 : 403 });
      return Response.json(manifest.plugins);
    }
    if (url.pathname === `${prefix}server.mjs` || url.pathname === `${prefix}plugin-manifest.json`) {
      return new Response('', { status: fault === 'private-file' ? 200 : 404 });
    }
    const text = assets[url.pathname.slice(prefix.length)];
    if (text === undefined) return new Response('', { status: 404 });
    return new Response(fault === 'stale-client' ? 'stale' : text);
  };
  return { manifest, calls, fetchImpl };
}

test('client checksums and private-file/origin protection are checked under both supported paths', async () => {
  for (const assetPrefix of ['/', '/modeling-plugins/']) {
    const f = liveFixture(assetPrefix);
    await checkLive('http://localhost:32003', f.manifest, { assetPrefix, fetchImpl: f.fetchImpl });
    assert.ok(f.calls.some(call => call.path === `${assetPrefix}assets/test.js`));
    assert.equal(f.calls.length, 7);
  }
});

test('stale client assets or broken access protection fail before browser editing', async () => {
  for (const fault of ['stale-client', 'private-file', 'origin']) {
    const f = liveFixture('/modeling-plugins/', fault);
    await assert.rejects(checkLive('http://localhost:32003', f.manifest, { fetchImpl: f.fetchImpl }));
  }
});

test('unsupported asset paths cannot start an HTTP resource scan', async () => {
  const f = liveFixture('/');
  await assert.rejects(checkLive('http://localhost:32003', f.manifest, { assetPrefix: '//elsewhere/', fetchImpl: f.fetchImpl }));
  assert.equal(f.calls.length, 0);
});
