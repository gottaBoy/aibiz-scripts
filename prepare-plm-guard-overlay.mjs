#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(workspace, 'plm-web/package.json'));
const vueRequire = createRequire(require.resolve('vue'));
const { parse: parseHtml } = vueRequire('@vue/compiler-dom');
const ts = require('typescript');
const postcss = require('postcss');
const cssRequire = createRequire(require.resolve('postcss'));
const parseCssValue = cssRequire('postcss-value-parser');
const prefix = '/ibizplm-plmweb/';
const apiPrefix = '/api/ibizplm__plmweb/';
const origin = 'http://127.0.0.1:30250';
const digest = value => createHash('sha256').update(value).digest('hex');
const frameworkPrefix = 'extras/js/@ibiz-template/vue3-components/';

function htmlElements(html) {
  const elements = [];
  const visit = node => {
    if (node.type === 1) elements.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(parseHtml(html, { onError(error) {
    if (error.code === 11 && /^<!doctype\s+html\s*>/i.test(html.slice(error.loc.start.offset))) return;
    throw error;
  } }));
  return elements;
}

const attribute = (element, name) => element.props.find(prop => prop.type === 6 && prop.name === name);

export function rewriteGuardEntry(html, { appEntry, importMap }) {
  const elements = htmlElements(html).filter(element => element.tag === 'script');
  const legacy = elements.filter(element => attribute(element, 'id')?.value?.content === 'vite-legacy-entry');
  const maps = elements.filter(element => attribute(element, 'type')?.value?.content === 'systemjs-importmap');
  assert.equal(legacy.length, 1, 'Exactly one actual legacy application entry is required');
  assert.equal(maps.length, 1, 'Exactly one actual SystemJS import map is required');
  const replacements = [
    [attribute(legacy[0], 'data-src'), appEntry],
    [attribute(maps[0], 'src'), importMap],
  ].map(([prop, value]) => {
    assert.ok(prop?.value?.loc && typeof value === 'string' && value.startsWith('./'));
    return { start: prop.value.loc.start.offset, end: prop.value.loc.end.offset, text: JSON.stringify(value) };
  }).sort((left, right) => right.start - left.start);
  let result = html;
  for (const replacement of replacements) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  return result;
}

export function guardImportMap(original, relativeFramework) {
  assert.ok(original?.imports?.['@ibiz-template/vue3-components']);
  assert.ok(original?.styles?.['@ibiz-template/vue3-components']);
  assert.match(relativeFramework, /^\.\.\/js\/@ibiz-template\/vue3-components\/guard-[a-f0-9]{16}\/$/);
  const result = structuredClone(original);
  result.imports['@ibiz-template/vue3-components'] = `${relativeFramework}index.system.min.js`;
  result.styles['@ibiz-template/vue3-components'] = `${relativeFramework}index.min.css`;
  return result;
}

export function staticModuleReferences(text, filename = 'module.js') {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(source.parseDiagnostics.length, 0, `JavaScript parsing failed: ${filename}`);
  const references = new Set();
  const dynamic = [];
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'register' &&
          ts.isIdentifier(expression.expression) && expression.expression.text === 'System') {
        for (const argument of node.arguments) {
          if (ts.isArrayLiteralExpression(argument)) {
            for (const element of argument.elements) {
              assert.ok(ts.isStringLiteral(element), `A SystemJS dependency is not a literal: ${filename}`);
              references.add(element.text);
            }
          }
        }
      }
      if ((ts.isPropertyAccessExpression(expression) && expression.name.text === 'import') ||
          expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [argument] = node.arguments;
        if (node.arguments.length === 1 && ts.isStringLiteral(argument)) references.add(argument.text);
        else dynamic.push({ offset: node.getStart(source), expression: node.getText(source).slice(0, 200) });
      }
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) references.add(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { references: [...references], dynamic };
}

function cssReferences(text, filename) {
  const references = new Set();
  const stylesheet = postcss.parse(text, { from: filename });
  const inspect = value => {
    parseCssValue(value).walk(node => {
      if (node.type === 'function' && node.value.toLowerCase() === 'url') {
        const value = parseCssValue.stringify(node.nodes).replace(/^(['"])(.*)\1$/, '$2').trim();
        if (value && !value.startsWith('data:') && !value.startsWith('#')) references.add(value);
      }
    });
  };
  stylesheet.walkDecls(declaration => inspect(declaration.value));
  stylesheet.walkAtRules('import', rule => {
    const [first] = parseCssValue(rule.params).nodes;
    if (first?.type === 'string') references.add(first.value);
    else inspect(rule.params);
  });
  return [...references];
}

export function resolveGuardResource(reference, from, importMap, mapPath) {
  const mapped = importMap.imports?.[reference];
  assert.ok(mapped || reference.startsWith('.') || reference.startsWith('/'),
    `Unmapped module ${reference} in ${from}`);
  const result = new URL(mapped ?? reference, `${origin}${prefix}${mapped ? mapPath : from}`);
  assert.equal(result.origin, origin, `An external resource is outside this candidate: ${reference}`);
  assert.ok(result.pathname.startsWith(prefix), `A resource escapes the PLM static prefix: ${reference}`);
  return decodeURIComponent(result.pathname.slice(prefix.length));
}

async function immutableFile(root, relative, bytes) {
  assert.ok(relative && !path.isAbsolute(relative) && !relative.split('/').includes('..'));
  const destination = path.join(root, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const descriptor = await fs.open(destination, 'wx', 0o600);
  try {
    await descriptor.writeFile(bytes);
    await descriptor.sync();
  } finally { await descriptor.close(); }
  return { path: relative, bytes: bytes.length, sha256: digest(bytes) };
}

async function servedBytes(relative) {
  const response = await fetch(`${origin}${prefix}${relative}`, { signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, `Actual live static resource failed: ${relative} ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function containerWitness() {
  const [container] = JSON.parse(execFileSync('docker', ['inspect', 'plmweb'], { encoding: 'utf8' }));
  assert.ok(container.State.Running && /^[a-f0-9]{64}$/.test(container.Id));
  return { id: container.Id, image: container.Image, startedAt: container.State.StartedAt,
    restartCount: container.RestartCount,
    mounts: [...container.Mounts].sort((left, right) => left.Destination.localeCompare(right.Destination)),
    configurationSha256: digest(JSON.stringify({ config: container.Config, host: container.HostConfig })) };
}

export async function prepareGuardOverlay({ candidate, output }) {
  const candidateRoot = await fs.realpath(candidate);
  const destination = path.resolve(output);
  assert.equal(await fs.realpath(path.dirname(destination)), path.join(workspace, '.artifacts'));
  const receiptBytes = await fs.readFile(path.join(candidateRoot, 'source-build.json'));
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.deployed, false);
  assert.equal(receipt.nativeAcceptance, false);
  assert.equal(receipt.sharedDistUnchanged, true);
  assert.equal(receipt.runtimeOverrides?.length, 1);
  const [runtime] = receipt.runtimeOverrides;
  assert.equal(runtime.package, '@ibiz-template/vue3-components');
  assert.equal(runtime.sourceBuildOnly, true);
  const before = containerWitness();
  const sourceDifferences = [];
  const sourceRoots = [
    ['plm-web/src', receipt.sourceFiles],
    ['ibiz-app-hub/components/ibiz-next-vue3/src', runtime.sourceFiles],
  ];
  for (const [root, files] of sourceRoots) {
    for (const file of files) {
      const bytes = await fs.readFile(path.join(workspace, root, file.path));
      if (digest(bytes) !== file.sha256) sourceDifferences.push({
        path: `${root}/${file.path}`, recorded: file.sha256, current: digest(bytes),
      });
    }
  }
  const essential = [
    ['plm-web/src', 'main.ts', receipt.sourceFiles],
    ['plm-web/src', 'guard/auth-guard/auth-guard.ts', receipt.sourceFiles],
    ['ibiz-app-hub/components/ibiz-next-vue3/src', 'web-app/main.ts', runtime.sourceFiles],
    ['ibiz-app-hub/components/ibiz-next-vue3/src', 'web-app/router/index.ts', runtime.sourceFiles],
    ['ibiz-app-hub/components/ibiz-next-vue3/src', 'web-app/guard/auth-guard/auth-guard.ts', runtime.sourceFiles],
  ];
  for (const [root, file, inventory] of essential) {
    const expected = inventory.find(row => row.path === file);
    assert.ok(expected);
    assert.equal(digest(await fs.readFile(path.join(workspace, root, file))), expected.sha256);
  }
  const candidateHtml = await fs.readFile(path.join(candidateRoot, 'dist/index.html'), 'utf8');
  const candidateScript = htmlElements(candidateHtml).find(element =>
    attribute(element, 'id')?.value?.content === 'vite-legacy-entry');
  const appEntry = attribute(candidateScript, 'data-src')?.value?.content?.split('?')[0]?.replace(/^\.\//, '');
  assert.match(appEntry ?? '', /^static\/js\/index-legacy-[a-f0-9]+\.js$/);
  const appRecord = receipt.outputFiles.find(file => file.path === appEntry);
  assert.ok(appRecord);
  const mainRuntime = runtime.outputFiles.find(file => /^index-[A-Za-z0-9_-]+\.js$/.test(file.path) && file.bytes > 1_000_000);
  assert.ok(mainRuntime);
  const revision = digest(Buffer.from(`${appRecord.sha256}:${mainRuntime.sha256}`)).slice(0, 16);
  const runtimeDirectory = `${frameworkPrefix}guard-${revision}/`;
  const mapPath = `extras/json/system-import-guard-${revision}.json`;
  for (const relative of [appEntry, mapPath, runtimeDirectory]) {
    const status = execFileSync('docker', ['exec', 'plmweb', 'sh', '-c',
      'if test -e "$1"; then printf present; else printf absent; fi', 'guard-overlay', `/dist/${relative}`],
    { encoding: 'utf8' });
    assert.equal(status, 'absent', `A supposedly new live target already exists: ${relative}`);
  }
  await fs.mkdir(destination, { mode: 0o700 });
  const overlay = path.join(destination, 'overlay');
  const base = path.join(destination, 'base');
  const originalIndex = await servedBytes('index.html');
  const originalMap = await servedBytes('extras/json/system-import.json');
  const map = guardImportMap(JSON.parse(originalMap), `../js/@ibiz-template/vue3-components/guard-${revision}/`);
  const outputFiles = [];
  for (const file of runtime.outputFiles) {
    const bytes = await fs.readFile(path.join(candidateRoot, 'dist', frameworkPrefix, file.path));
    assert.equal(digest(bytes), file.sha256, `A recorded compiled framework output changed: ${file.path}`);
    outputFiles.push(await immutableFile(overlay, runtimeDirectory + file.path, bytes));
  }
  const appBytes = await fs.readFile(path.join(candidateRoot, 'dist', appEntry));
  assert.equal(digest(appBytes), appRecord.sha256);
  outputFiles.push(await immutableFile(overlay, appEntry, appBytes));
  outputFiles.push(await immutableFile(overlay, mapPath, Buffer.from(`${JSON.stringify(map, null, 2)}\n`)));
  outputFiles.push(await immutableFile(overlay, 'index.html', Buffer.from(rewriteGuardEntry(originalIndex.toString(), {
    appEntry: `./${appEntry}`, importMap: `./${mapPath}`,
  }))));
  await immutableFile(path.join(destination, 'rollback'), 'index.html', originalIndex);
  await immutableFile(path.join(destination, 'rollback'), 'extras/json/system-import.json', originalMap);
  await immutableFile(destination, 'inherited-source-build.private.json', receiptBytes);
  const sourceFiles = [];
  for (const [root, file] of essential) {
    sourceFiles.push(await immutableFile(path.join(destination, 'sources'), `${root}/${file}`,
      await fs.readFile(path.join(workspace, root, file))));
  }
  const overlayByPath = new Map(outputFiles.map(file => [file.path, file]));
  const inventory = new Map();
  const pending = new Set(outputFiles.map(file => file.path));
  const dynamic = [];
  const conditionalCssReferences = [];
  const errors = [];
  const enqueue = reference => {
    if (!inventory.has(reference)) pending.add(reference);
  };
  const visit = async relative => {
    if (inventory.has(relative)) return;
    inventory.set(relative, { path: relative, pending: true });
    const bytes = overlayByPath.has(relative)
      ? await fs.readFile(path.join(overlay, relative)) : await servedBytes(relative);
    const file = overlayByPath.has(relative) ? overlayByPath.get(relative) : await immutableFile(base, relative, bytes);
    inventory.set(relative, { ...file, source: overlayByPath.has(relative) ? 'source-built-overlay' : 'actual-live-http-bytes' });
    const resolve = reference => resolveGuardResource(reference, relative, map, mapPath);
    if (relative.endsWith('.html')) {
      for (const element of htmlElements(bytes.toString())) {
        for (const name of ['src', 'data-src', 'href']) {
          const value = attribute(element, name)?.value?.content;
          if (value && !value.startsWith('#')) enqueue(resolve(value));
        }
      }
    } else if (relative === mapPath) {
      for (const reference of [...Object.values(map.imports), ...Object.values(map.styles)]) {
        enqueue(resolveGuardResource(reference, mapPath, {}, mapPath));
      }
    } else if (relative.endsWith('.js')) {
      const modules = staticModuleReferences(bytes.toString(), relative);
      for (const reference of modules.references) enqueue(resolve(reference));
      dynamic.push(...modules.dynamic.map(item => ({ path: relative, ...item })));
    } else if (relative.endsWith('.css')) {
      for (const reference of cssReferences(bytes.toString(), relative)) {
        const location = new URL(reference, `${origin}${prefix}${relative}`);
        assert.equal(location.origin, origin, `A CSS resource is outside this local candidate: ${reference}`);
        const response = await fetch(location, { signal: AbortSignal.timeout(20_000) });
        const body = Buffer.from(await response.arrayBuffer());
        if (response.status !== 200 || !location.pathname.startsWith(prefix)) {
          let inheritedFromLiveCss = !overlayByPath.has(relative);
          if (!inheritedFromLiveCss && relative.startsWith(runtimeDirectory)) {
            const originalCss = `${frameworkPrefix}${relative.slice(runtimeDirectory.length)}`;
            const originalBytes = await servedBytes(originalCss);
            const originalLocation = new URL(reference, `${origin}${prefix}${originalCss}`);
            const originalResponse = await fetch(originalLocation, { signal: AbortSignal.timeout(20_000) });
            await originalResponse.arrayBuffer();
            inheritedFromLiveCss = cssReferences(originalBytes.toString(), originalCss).includes(reference) &&
              originalLocation.pathname === location.pathname && originalResponse.status === response.status;
          }
          assert.ok(inheritedFromLiveCss, `The overlay introduced a missing CSS asset: ${reference}`);
          conditionalCssReferences.push({ declaredBy: relative, reference, status: response.status,
            bytes: body.length, sha256: digest(body), inheritedFromLiveCss,
            actualBrowserRequestWouldRemainFailure: true });
        } else {
          enqueue(decodeURIComponent(location.pathname.slice(prefix.length)));
        }
      }
    }
  };
  while (pending.size) {
    const batch = [...pending].slice(0, 8);
    for (const relative of batch) pending.delete(relative);
    const results = await Promise.allSettled(batch.map(visit));
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') errors.push({ path: batch[index], error: result.reason.message });
    }
    if (errors.length) break;
  }
  const after = containerWitness();
  assert.deepEqual(after, before, 'The actual shared runtime identity or mounts changed');
  const report = {
    contract: 'private-plm-guard-overlay-v1', status: errors.length ? 'BLOCKED-STATIC-CLOSURE' : 'PREPARED-NOT-DEPLOYED',
    candidateRoot, inheritedReceiptSha256: digest(receiptBytes), revision, appEntry, mapPath, runtimeDirectory,
    sourceFiles, sourceDifferences, monolithicApplicationContainsOtherHistoricalChanges: true,
    dependencySourceClosureReconstructed: false, sourceBuildCommand: [
      'node plm-web/tools/plm-candidate-host.mjs build <private-new-application-output>',
      'node scripts/prepare-plm-login-runtime.mjs --candidate <application> --output <private-new-runtime-output>',
      'node scripts/prepare-plm-login-runtime.mjs --candidate <application> --runtime <runtime> --output <private-new-combined-output>',
    ],
    outputFiles, outputInventorySha256: digest(JSON.stringify(outputFiles)),
    inheritedRuntimeSourceInventorySha256: digest(JSON.stringify(runtime.sourceFiles)),
    inheritedApplicationSourceInventorySha256: digest(JSON.stringify(receipt.sourceFiles)),
    staticFiles: [...inventory.values()].sort((left, right) => left.path.localeCompare(right.path)),
    nonliteralDynamicImports: dynamic, conditionalCssReferences, errors, before, after,
    staticClosureScope: 'Resolvable literal PLM dependencies; dynamic boundaries and dormant root CSS declarations retained separately',
    excludedHistoricalCandidateDifferences: ['static/js/model/entities/article-page.js', 'static/js/model/entities/article-page-legacy.js'],
    existingPluginsCopiedFromHistoricalCandidate: false,
    rollback: { overwritten: [{ path: 'index.html', bytes: originalIndex.length, sha256: digest(originalIndex) }],
      restoreFrom: 'rollback/index.html', removeOnlyExactNewFilesWithMatchingHashes: outputFiles.filter(file => file.path !== 'index.html') },
    preparerSha256: digest(await fs.readFile(fileURLToPath(import.meta.url))),
    businessAcceptance: false, sharedDeployment: false, preparedAt: new Date().toISOString(),
  };
  await immutableFile(destination, 'guard-overlay.private.json', Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
  assert.equal(errors.length, 0, `Static closure is blocked; retained the private partial receipt: ${JSON.stringify(errors)}`);
  return report;
}

export async function serveGuardOverlay(directory) {
  const root = await fs.realpath(directory);
  assert.ok(root.startsWith(`${workspace}/.artifacts/`));
  const report = JSON.parse(await fs.readFile(path.join(root, 'guard-overlay.private.json')));
  assert.equal(report.status, 'PREPARED-NOT-DEPLOYED');
  const files = new Map(report.staticFiles.map(file => [file.path, file]));
  const requests = [];
  const errors = [];
  const materializing = new Map();
  const inheritedCssPaths = new Set(report.conditionalCssReferences.map(item =>
    new URL(item.reference, `${origin}${prefix}${item.declaredBy}`).pathname));
  const server = createServer(async (request, response) => {
    const startedAt = new Date().toISOString();
    try {
      const url = new URL(request.url, 'http://private.invalid');
      assert.ok(request.url.startsWith('/') && !request.url.startsWith('//') && !/[%\\]/.test(url.pathname));
      assert.equal(request.url.split('?')[0], url.pathname);
      if (url.pathname.startsWith(apiPrefix)) {
        const upstream = httpRequest(`${origin}${url.pathname}${url.search}`, {
          method: request.method, headers: { ...request.headers, host: new URL(origin).host },
        }, result => {
          response.writeHead(result.statusCode, result.headers);
          requests.push({ source: 'unchanged-native-api-proxy', startedAt, method: request.method,
            path: url.pathname, status: result.statusCode });
          result.pipe(response);
        });
        upstream.on('error', error => {
          errors.push({ path: url.pathname, error: error.message });
          response.writeHead(502);
          response.end('Native upstream unavailable');
        });
        request.pipe(upstream);
        return;
      }
      assert.equal(request.method, 'GET');
      if (!url.pathname.startsWith(prefix) && inheritedCssPaths.has(url.pathname)) {
        const upstream = await fetch(`${origin}${url.pathname}${url.search}`, { signal: AbortSignal.timeout(20_000) });
        const bytes = Buffer.from(await upstream.arrayBuffer());
        response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
          'Cache-Control': 'no-store' });
        response.end(bytes);
        requests.push({ source: 'unchanged-inherited-css-resource', startedAt, path: url.pathname,
          status: upstream.status, sha256: digest(bytes) });
        return;
      }
      assert.ok(url.pathname.startsWith(prefix));
      const relative = url.pathname === prefix ? 'index.html' : url.pathname.slice(prefix.length);
      assert.ok(relative && !relative.split('/').includes('..'));
      let record = files.get(relative);
      let bytes;
      if (record) {
        const directory = record.source === 'source-built-overlay' ? 'overlay'
          : record.source === 'actual-live-http-bytes' ? 'base' : 'runtime-materialized';
        bytes = await fs.readFile(path.join(root, directory, relative));
        assert.equal(digest(bytes), record.sha256, `A sealed static input changed: ${relative}`);
      } else {
        if (!materializing.has(relative)) materializing.set(relative, (async () => {
          const upstream = await fetch(`${origin}${prefix}${relative}`, { signal: AbortSignal.timeout(20_000) });
          const contents = Buffer.from(await upstream.arrayBuffer());
          if (upstream.status !== 200) return { bytes: contents, rejectedStatus: upstream.status,
            contentType: upstream.headers.get('content-type') };
          return { bytes: contents, record: {
            ...await immutableFile(path.join(root, 'runtime-materialized'), relative, contents),
            source: 'actual-live-http-bytes-materialized-at-runtime',
          } };
        })());
        const materialized = await materializing.get(relative);
        ({ bytes, record } = materialized);
        if (materialized.rejectedStatus) {
          response.writeHead(materialized.rejectedStatus, {
            'Content-Type': materialized.contentType ?? 'application/octet-stream', 'Cache-Control': 'no-store',
          });
          response.end(bytes);
          requests.push({ source: 'unchanged-live-static-rejection', startedAt, path: url.pathname,
            status: materialized.rejectedStatus, sha256: digest(bytes) });
          return;
        }
        files.set(relative, record);
      }
      const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
        '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
        '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
      response.writeHead(200, { 'Content-Type': contentTypes[path.extname(relative)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store', ETag: `"${record.sha256}"` });
      response.end(bytes);
      requests.push({ source: record.source, startedAt, path: url.pathname, status: 200, sha256: record.sha256 });
    } catch (error) {
      errors.push({ path: request.url?.split('?')[0], error: error.message });
      response.writeHead(502, { 'Content-Type': 'text/plain' });
      response.end('Private candidate input validation failed');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}${prefix}`;
  const close = async () => {
    await new Promise(resolve => server.close(resolve));
    await immutableFile(root, 'guard-overlay-server.private.json', Buffer.from(`${JSON.stringify({
      url, closed: true, requests, errors, files: [...files.values()], before: report.after, after: containerWitness(),
      serverSourceSha256: digest(await fs.readFile(fileURLToPath(import.meta.url))),
    }, null, 2)}\n`));
  };
  return { server, url, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string' }, output: { type: 'string' }, serve: { type: 'string' },
  } });
  if (values.serve) {
    serveGuardOverlay(values.serve).then(({ url, close }) => {
      console.log(url);
      let closing = false;
      const shutdown = () => {
        if (closing) return;
        closing = true;
        close().then(() => { process.exitCode = 0; }).catch(error => { console.error(error.message); process.exitCode = 1; });
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    }).catch(error => { console.error(error); process.exitCode = 1; });
  } else {
    prepareGuardOverlay(values).then(report => console.log(JSON.stringify({
      status: report.status, revision: report.revision, overlayFiles: report.outputFiles.length,
      staticFiles: report.staticFiles.length, nonliteralDynamicImports: report.nonliteralDynamicImports.length,
    }))).catch(async error => {
      console.error(error);
      if (values.output) {
        try {
          await immutableFile(path.resolve(values.output), 'preparation-failure.private.json', Buffer.from(`${JSON.stringify({
            status: 'FAILED-PREPARATION', error: error.stack, failedAt: new Date().toISOString(),
          }, null, 2)}\n`));
        } catch {}
      }
      process.exitCode = 1;
    });
  }
}
