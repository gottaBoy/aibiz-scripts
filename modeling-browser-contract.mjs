import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

export const languages = Object.freeze(['zh-CN', 'en']);
export const viewports = Object.freeze([
  Object.freeze({ width: 390, height: 844 }),
  Object.freeze({ width: 768, height: 1024 }),
]);
export const flowSteps = Object.freeze([
  'load-local-editor', 'edit-domain-model', 'switch-language-preserves-draft',
  'save-and-read-back', 'reload-and-compare', 'undo-redo-and-update',
  'reject-invalid-import', 'reject-invalid-api-write',
  'export-and-import-copy', 'delete-copy', 'desktop-render',
]);

export function deploymentTarget(value) {
  const invalid = () => new Error('Expected an HTTP loopback origin with optional /modeling-plugins path, without credentials, query or fragment');
  let url;
  try { url = new URL(value); } catch { throw invalid(); }
  if (
    typeof value !== 'string' || value.trim() !== value ||
    !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?(?:\/(?:modeling-plugins\/?)?)?$/.test(value) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.protocol !== 'http:' || url.username || url.password || url.search || url.hash ||
    !/^\/(?:modeling-plugins\/?)?$/.test(url.pathname) ||
    /[%\\?#]/.test(value)
  ) throw invalid();
  return { origin: url.origin, pageBase: `${url.origin}${url.pathname.replace(/\/$/, '')}` };
}

export function errorSummary(error) {
  const cause = error?.cause;
  return `${error?.message || String(error)}${cause?.code ? ` (${cause.code}${cause.syscall ? `: ${cause.syscall}` : ''})` : ''}`;
}

// Keep the timeout active through body consumption, not just response headers.
export function jsonClient(origin, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  assert.equal(deploymentTarget(origin).origin, origin);
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0);
  return async (path, options = {}) => {
    assert.match(path, /^\/api\/modeling-plugins\/[a-zA-Z0-9/_-]+$/);
    const controller = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Request timed out after ${timeoutMs} ms: ${path}`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(`${origin}${path}`, {
            ...options, signal: controller.signal, redirect: 'error',
          });
          if (response.status >= 300 && response.status < 400) throw new Error(`Redirect rejected: ${path}`);
          const body = await response.json();
          return { status: response.status, body };
        })(),
        expired,
      ]);
    } catch (error) {
      throw new Error(`${options.method || 'GET'} ${path}: ${errorSummary(error)}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function documentPath(pluginId, id) {
  assert.match(pluginId, /^[a-z][a-z0-9_-]+$/);
  assert.match(id, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
  return `/api/modeling-plugins/${pluginId}/documents/${id}`;
}

export function editorUrl(pageBase, pluginId, language, documentId, visit) {
  deploymentTarget(pageBase);
  documentPath(pluginId, documentId || 'new');
  assert.ok(languages.includes(language));
  assert.equal(typeof visit, 'string');
  assert.ok(visit.length > 0);
  const url = new URL(`${pageBase}/modeling-plugins.html`);
  url.searchParams.set('lang', language);
  // Hash-only navigation may retain the previous editor until an async request finishes.
  url.searchParams.set('harness_visit', visit);
  url.hash = `/${pluginId}${documentId ? `?document=${documentId}` : ''}`;
  return url.href;
}

function snapshot(document) {
  assert.equal(document.schemaVersion, 1);
  documentPath(document.pluginId, document.id);
  assert.ok(Number.isSafeInteger(document.revision) && document.revision >= 0);
  assert.equal(typeof document.title, 'string');
  assert.ok(document.content && typeof document.content === 'object' && !Array.isArray(document.content));
  return structuredClone({
    schemaVersion: document.schemaVersion, pluginId: document.pluginId,
    id: document.id, revision: document.revision,
    title: document.title.trim(), content: document.content,
  });
}

export function assertSavedDocument(draft, saved) {
  const expected = snapshot(draft);
  expected.revision += 1;
  assert.deepEqual(snapshot(saved), expected, 'Save changed intended content/revision');
}

export async function downloadOnClick(page, click) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    Promise.resolve().then(click),
  ]);
  return download;
}

// Passed directly to Playwright evaluate; no module closure dependencies.
export function inspectRendering() {
  const editor = document.querySelector('[data-testid="plugin-editor"]');
  if (!editor) return null;
  const stage = editor.querySelector('[data-testid="graph-canvas"]');
  const bounds = stage?.getBoundingClientRect();
  const nodes = [...editor.querySelectorAll('.x6-node[data-cell-id]')];
  const edges = [...editor.querySelectorAll('.x6-edge[data-cell-id]')];
  return {
    errors: editor.querySelectorAll('[role="alert"]').length,
    nodeIds: nodes.map(node => node.getAttribute('data-cell-id')).sort(),
    edgeIds: edges.map(edge => edge.getAttribute('data-cell-id')).sort(),
    visibleNodes: nodes.filter(node => {
      const box = node.getBoundingClientRect();
      return bounds && box.width > 0 && box.height > 0 &&
        box.right > bounds.left && box.left < bounds.right &&
        box.bottom > bounds.top && box.top < bounds.bottom;
    }).length,
    charts: [...editor.querySelectorAll('[data-testid="chart-preview"]')].map(chart => {
      const colors = new Set();
      let pixels = 0;
      for (const canvas of chart.querySelectorAll('canvas')) {
        const context = canvas.getContext('2d');
        if (!context || !canvas.width || !canvas.height) continue;
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const stride = Math.max(4, Math.floor(data.length / (4096 * 4)) * 4);
        for (let offset = 0; offset < data.length; offset += stride) {
          if (!data[offset + 3]) continue;
          pixels += 1;
          if (colors.size < 8) colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
        }
      }
      return { pixels, colors: colors.size };
    }),
  };
}

export function assertRendering(entry, document, evidence) {
  assert.ok(evidence, 'Domain editor is missing');
  assert.equal(evidence.errors, 0, 'Domain editor reports a rendering error');
  if (entry.family === 'graph') {
    assert.deepEqual(evidence.nodeIds, document.content.nodes.map(node => node.id).sort(), 'SVG nodes differ from the model');
    assert.deepEqual(evidence.edgeIds, document.content.edges.map(edge => edge.id).sort(), 'SVG edges differ from the model');
    assert.ok(evidence.visibleNodes > 0, 'Graph canvas is blank or incorrectly framed');
  }
  if (entry.id === 'chartdesign' && document.content.settings.chartType !== 'table') {
    assert.ok(evidence.charts.length > 0, 'Chart preview is missing');
  }
  for (const chart of evidence.charts) {
    assert.ok(chart.pixels > 20 && chart.colors > 2, 'Chart canvas is blank or uniform');
  }
}

const missing = response => response.status === 404 && response.body?.error === 'not_found';

export class DocumentLedger {
  constructor(request, titlePrefix) {
    assert.ok(titlePrefix?.startsWith('Harness ') && titlePrefix.length > 12);
    this.request = request;
    this.titlePrefix = titlePrefix;
    this.documents = new Map();
  }

  // Record intended revisions before sending the UI save, including lost acknowledgements.
  async beforeSave(draft) {
    const expected = snapshot(draft);
    assert.ok(expected.title.startsWith(this.titlePrefix), 'Only this run can own a document');
    const path = documentPath(draft.pluginId, draft.id);
    let owner = this.documents.get(path);
    if (!owner) {
      assert.equal(draft.revision, 0, 'Cannot claim an existing revision');
      assert.ok(missing(await this.request(path)), 'Refusing to overwrite a pre-existing document');
      owner = { path, snapshots: new Map(), acknowledged: new Set() };
      this.documents.set(path, owner);
    } else if (draft.revision > 0) {
      assert.ok(owner.snapshots.has(draft.revision), 'Cannot update an unknown revision');
    }
    expected.revision += 1;
    assert.ok(Number.isSafeInteger(expected.revision));
    owner.snapshots.set(expected.revision, expected);
  }

  acknowledge(document) {
    const owner = this.documents.get(documentPath(document.pluginId, document.id));
    assert.ok(owner, 'Unclaimed document acknowledgement');
    assert.deepEqual(snapshot(document), owner.snapshots.get(document.revision), 'Save changed intended content');
    owner.acknowledged.add(document.revision);
  }

  async cleanup() {
    const result = { status: 'pass', attempted: 0, deleted: 0, alreadyAbsent: 0, failures: [], retained: [] };
    for (const owner of this.documents.values()) {
      result.attempted += 1;
      try {
        const current = await this.request(owner.path);
        if (missing(current)) {
          assert.ok(
            [...owner.snapshots.keys()].every(revision => owner.acknowledged.has(revision)),
            'Unacknowledged write may still be pending; absence is not confirmed',
          );
          result.alreadyAbsent += 1;
          continue;
        }
        assert.equal(current.status, 200, 'Cannot read cleanup candidate');
        assert.equal(current.body.revision, Math.max(...owner.snapshots.keys()), 'A newer write may still be pending');
        assert.ok(
          isDeepStrictEqual(snapshot(current.body), owner.snapshots.get(current.body.revision)),
          'Document has unexpected revision/content; retained without deleting',
        );
        const removed = await this.request(owner.path, {
          method: 'DELETE',
          headers: {
            'If-Match': `"${current.body.revision}"`,
            'X-Document-SHA256': createHash('sha256').update(JSON.stringify(current.body)).digest('hex'),
          },
        });
        assert.equal(removed.status, 200, 'Cleanup DELETE failed');
        assert.equal(removed.body?.deleted, true, 'Cleanup acknowledgement missing');
        assert.ok(missing(await this.request(owner.path)), 'Deleted document is still present');
        result.deleted += 1;
      } catch (error) {
        result.status = 'fail';
        result.failures.push({ path: owner.path, error: errorSummary(error) });
        result.retained.push(owner.path);
        if (/EPERM|EACCES/.test(errorSummary(error))) {
          const remaining = [...this.documents.keys()].slice(result.attempted);
          result.retained.push(...remaining);
          break;
        }
      }
    }
    return result;
  }
}

export function coverageProblems(report, catalog) {
  const problems = [];
  if (!Array.isArray(catalog) || catalog.length !== 23 ||
    catalog.some(item => !item || typeof item.id !== 'string') ||
    new Set(catalog.map(item => item.id)).size !== 23) return ['catalog: invalid'];
  if (report.clientArtifactMatched !== true) problems.push('client artifact: not verified');
  const checkRows = (rows, expected, key, valid, label) => {
    if (!Array.isArray(rows)) { problems.push(`${label}: invalid rows`); return; }
    if (rows.length !== expected.length) problems.push(`${label}: incomplete row count`);
    for (const value of expected) {
      const matches = rows.filter(row => row && key(row) === value);
      if (matches.length !== 1 || !valid(matches[0])) problems.push(`${label}: incomplete ${value}`);
    }
  };
  const cases = catalog.flatMap(({ id }) => languages.map(language => `${id}:${language}`));
  const steps = [...flowSteps, 'fresh-session-reload'];
  if (report.executionMode === 'isolated-local-server') steps.push('server-restart-recovery');
  if (!['isolated-local-server', 'deployed-sidecar'].includes(report.executionMode)) problems.push('unknown execution mode');
  checkRows(report.results, cases, row => `${row.id}:${row.language}`, row =>
    row?.status === 'pass' && Array.isArray(row.steps) && row.steps.length === steps.length &&
    steps.every(name => row.steps.filter(step => step?.name === name && step.status === 'pass').length === 1),
  'flows');
  const sizes = cases.flatMap(key => viewports.map(size => `${key}:${size.width}x${size.height}`));
  checkRows(report.viewportResults, sizes, row => `${row.id}:${row.language}:${row.viewport?.width}x${row.viewport?.height}`,
    row => row?.status === 'pass', 'viewports');
  for (const key of ['browserErrors', 'externalRequests', 'failedRequests']) {
    if (!Array.isArray(report[key]) || report[key].length) problems.push(`${key}: not clear`);
  }
  if (report.executionMode === 'deployed-sidecar' && (
    report.cleanup?.status !== 'pass' || report.cleanup.failures?.length !== 0 ||
    report.cleanup.retained?.length !== 0 ||
    report.cleanup.attempted !== cases.length * 2 ||
    report.cleanup.deleted + report.cleanup.alreadyAbsent !== report.cleanup.attempted
  )) problems.push('deployed cleanup: incomplete');
  return problems;
}
