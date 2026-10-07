import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { inflateSync } from 'node:zlib';
import { verifyRuntimeModelSourceBuild } from '../harness-runtime-model-source-build.mjs';

export const workspace = fileURLToPath(new URL('../../', import.meta.url));
export const originalRoot = resolve(workspace,
  'plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/es/node_modules/.pnpm/' +
  '@ibiz-template-plugin_runtime-model@0.2.2_@stencil_store@2.0.16/node_modules/' +
  '@ibiz-template-plugin/runtime-model');
export const sourceRoot = resolve(process.env.RUNTIME_MODEL_SOURCE_ROOT ||
  resolve(workspace, 'modelingweb/local-plugins/runtime-model/src'));
export const builtRoot = resolve(process.env.RUNTIME_MODEL_BUILT_ROOT ||
  dirname(sourceRoot));
export const runtimeRequire = createRequire(join(dirname(sourceRoot), 'package.json'));
export const ts = runtimeRequire('typescript');
export const entryPath = join(originalRoot, 'dist/esm/ibiz-model-runtime_4.entry.mjs');
export const originalBytes = readFileSync(entryPath, 'utf8');
export const originalAst = parse(entryPath, originalBytes);
export const thirdPartyStencil = await import(pathToFileURL(join(originalRoot, 'dist/esm/index-729ab4d0.mjs')));
export const classNames = [
  'StoreBase', 'QXStore', 'ModelRuntimeService', 'LoadingController',
  'ModelRuntimeStore', 'ModelRuntimeController',
];
export const componentTags = [
  'ibiz-model-runtime', 'ibiz-model-runtime-list', 'loading-mask', 'loading-panel',
];
export const knownOriginalIssues = [
  {
    id: 'response-shadows-cache-key', method: 'ModelRuntimeController.loadModelData',
    observation: 'The response array shadows the request node; ordinary arrays are cached under undefined.',
  },
  {
    id: 'pagination-delete-count', method: 'IBizModelRuntimeList.getShowList',
    observation: 'splice(start, end) treats end as a count; load after 30 can add 40 rather than page.size=10.',
  },
  {
    id: 'unescaped-search-expression', method: 'ModelRuntimeController.searchValue / IBizModelRuntimeList.setSearchValue',
    observation: 'An unmatched "[" throws SyntaxError; only the first "*" is replaced.',
  },
  {
    id: 'empty-root-never-loaded', method: 'ModelRuntimeController.loadRootData',
    observation: 'An empty initial root response logs an error but leaves loaded=false.',
  },
  {
    id: 'children-promise-does-not-wait', method: 'ModelRuntimeController.loadChildren',
    observation: 'The uncached branch calls load without returning/awaiting its promise.',
  },
  {
    id: 'config-http-status-unchecked', method: 'ModelRuntimeService.getConfig',
    observation: 'Configuration JSON is returned even when the HTTP response is non-2xx.',
  },
  {
    id: 'selection-not-reactive', method: 'IBizModelRuntimeList.rowSelect',
    observation: 'activeData is not reactive; loading children does not immediately render the selected row active.',
  },
];

export async function waitForRuntimeModelScrollEnd(page) {
  await page.waitForFunction(() => {
    const content = document.querySelector('#runtime .ibiz-model-runtime-content');
    return content !== null && content.clientWidth > 0 && content.scrollWidth > 0 &&
      Math.abs(content.scrollWidth - content.clientWidth - content.scrollLeft) <= 1;
  });
}

export function loaderRelativePath(root) {
  const paths = ['dist/esm/loader.js', 'dist/esm/loader.mjs']
    .filter(candidate => existsSync(join(root, candidate)));
  assert.equal(paths.length, 1, `Expected one real loader in ${root}/dist/esm (.js or .mjs)`);
  assert.ok(readFileSync(join(root, paths[0])).length > 0, 'Real loader is empty');
  return paths[0];
}

export function loaderEntryEvidence(root, componentEntries = []) {
  const loaderRelative = loaderRelativePath(root);
  const extension = extname(loaderRelative);
  const entryRelative = `loader/index${extension}`;
  const polyfillsRelative = `dist/esm/polyfills/index${extension}`;
  const otherExtension = extension === '.js' ? '.mjs' : '.js';
  assert.equal(existsSync(join(root, `loader/index${otherExtension}`)), false,
    'Ambiguous public loader entry');
  const entryBytes = readFileSync(join(root, entryRelative));
  const polyfillsBytes = readFileSync(join(root, polyfillsRelative));
  assert.ok(entryBytes.length > 0, 'Public loader entry is empty');
  assert.ok(polyfillsBytes.length > 0, 'Polyfill loader is empty');
  const ast = parse(entryRelative, entryBytes.toString('utf8'));
  const reexports = ast.statements.filter(ts.isExportDeclaration).map(statement => {
    assert.ok(statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier),
      'Public loader must reexport literal modules');
    assert.equal(statement.isTypeOnly, false, 'Public loader cannot use type-only exports');
    const clause = statement.exportClause;
    assert.ok(!clause || ts.isNamedExports(clause), 'Unexpected public loader export clause');
    return {
      path: statement.moduleSpecifier.text,
      names: clause ? clause.elements.map(element => {
        assert.equal(element.isTypeOnly, false);
        assert.equal(element.propertyName, undefined, 'Public loader export renamed');
        return element.name.text;
      }).sort() : null,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(reexports, [
    { path: `../${loaderRelative}`, names: extension === '.mjs' ? ['defineCustomElements'] : null },
    { path: `../${polyfillsRelative}`, names: extension === '.mjs' ? ['applyPolyfills'] : null },
  ].sort((a, b) => a.path.localeCompare(b.path)), 'Public loader reexports changed');
  const loaderBytes = readFileSync(join(root, loaderRelative));
  const loaderAst = parse(loaderRelative, loaderBytes.toString('utf8'));
  const imports = loaderAst.statements.filter(ts.isImportDeclaration).map(statement => {
    assert.ok(ts.isStringLiteral(statement.moduleSpecifier), 'Nonliteral loader import');
    const specifier = statement.moduleSpecifier.text;
    assert.ok(specifier.startsWith('./'), 'Loader runtime import must remain package-relative');
    const file = resolve(root, dirname(loaderRelative), specifier);
    assert.ok(file.startsWith(`${resolve(root)}/`), 'Loader runtime import escapes package');
    return relative(root, file).split('\\').join('/');
  });
  assert.ok(imports.length > 0, 'Loader runtime import missing');
  const requiredResources = new Set([
    entryRelative, loaderRelative, polyfillsRelative, ...imports, ...componentEntries,
  ]);
  // Static imports/reexports must execute; conditional polyfills are checked if requested.
  for (const path of requiredResources) {
    const file = resolve(root, path);
    assert.ok(file.startsWith(`${resolve(root)}/`), 'Loader resource escapes package');
    const bytes = readFileSync(file);
    assert.ok(bytes.length > 0, `Loader resource is empty: ${path}`);
    const ast = parse(path, bytes.toString('utf8'));
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) &&
          !(ts.isExportDeclaration(statement) && statement.moduleSpecifier)) continue;
      assert.ok(statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier),
        'Loader graph module must be literal');
      assert.equal(statement.isTypeOnly === true || statement.importClause?.isTypeOnly === true,
        false, 'Loader graph cannot import/reexport type-only modules');
      const specifier = statement.moduleSpecifier.text;
      assert.ok(specifier.startsWith('./') || specifier.startsWith('../'),
        'Loader graph import must remain package-relative');
      assert.ok(!/[?#\\]/.test(specifier) && ['.js', '.mjs'].includes(extname(specifier)),
        'Ambiguous loader graph import');
      const importedFile = resolve(dirname(file), specifier);
      assert.ok(importedFile.startsWith(`${resolve(root)}/`), 'Loader graph import escapes package');
      requiredResources.add(relative(root, importedFile).split('\\').join('/'));
    }
  }
  return {
    entryRelative, loaderRelative, polyfillsRelative, requiredResources: [...requiredResources].sort(),
    entrySha256: sha256(entryBytes), loaderSha256: sha256(loaderBytes),
    polyfillsSha256: sha256(polyfillsBytes),
  };
}

function resourceInventory(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    assert.equal(entry.isSymbolicLink(), false, 'Observed resource symlink rejected');
    const path = join(current, entry.name);
    if (entry.isDirectory()) return resourceInventory(root, path);
    assert.ok(entry.isFile(), 'Observed resource is not a regular file');
    const bytes = readFileSync(path);
    return [{ path: relative(root, path).split('\\').join('/'), bytes: bytes.length, sha256: sha256(bytes) }];
  }).sort((a, b) => a.path.localeCompare(b.path));
}

export function sourceBuildEvidence(root = builtRoot, {
  workspace: evidenceWorkspace = workspace,
  reportPath = process.env.RUNTIME_MODEL_SOURCE_BUILD_REPORT || join(dirname(root), 'report.json'),
  sourceRoot: expectedSourceRoot = process.env.RUNTIME_MODEL_SOURCE_ROOT,
} = {}) {
  const { report, reportPath: verifiedPath, reportSha256 } = verifyRuntimeModelSourceBuild({
    workspace: evidenceWorkspace, sourceReport: reportPath,
  });
  assert.equal(resolve(report.buildRoot), resolve(root), 'Report and tested loader root differ');
  const verifiedSourceRoot = resolve(report.packageRoot, 'src');
  if (expectedSourceRoot !== undefined) {
    assert.equal(resolve(expectedSourceRoot), verifiedSourceRoot,
      'Report and requested source root differ');
  }
  const recovered = loaderEntryEvidence(root, report.builds[0].loader.components.map(component =>
    `dist/esm/${component.bundle}.entry.js`));
  const observedRoot = resolve(evidenceWorkspace, report.originalObservation.path);
  const original = loaderEntryEvidence(observedRoot, ['dist/esm/ibiz-model-runtime_4.entry.mjs']);
  const originalEntries = resourceInventory(observedRoot);
  assert.equal(originalEntries.length, report.originalObservation.files, 'Original resource count drift');
  assert.equal(originalEntries.reduce((sum, item) => sum + item.bytes, 0),
    report.originalObservation.bytes, 'Original resource size drift');
  assert.equal(sha256(JSON.stringify(originalEntries)), report.originalObservation.fingerprint,
    'Original resource fingerprint drift');
  for (const path of recovered.requiredResources) {
    assert.ok(report.outputs.entries.some(item => item.path === path),
      `Browser loader resource missing from verified inventory: ${path}`);
  }
  return {
    reportPath: verifiedPath, reportSha256, buildRoot: root, sourceRoot: verifiedSourceRoot,
    candidateVersion: report.candidateVersion, candidateRevision: report.candidateRevision ?? null,
    loaderRelative: recovered.loaderRelative, originalLoaderRelative: original.loaderRelative,
    loaderEntryRelative: recovered.entryRelative, originalLoaderEntryRelative: original.entryRelative,
    loaderSha256: recovered.loaderSha256, originalLoaderSha256: original.loaderSha256,
    loaderIndexSha256: recovered.entrySha256, originalLoaderIndexSha256: original.entrySha256,
    polyfillsSha256: recovered.polyfillsSha256, originalPolyfillsSha256: original.polyfillsSha256,
    resourceManifests: {
      recovered: { ...recovered, entries: report.outputs.entries },
      original: { ...original, entries: originalEntries },
    },
    sourceFingerprint: report.inputs.files.fingerprint,
    sourceBuildVerified: true, reproducibleBuildVerified: true,
    nativeAcceptance: false,
  };
}

export function runtimeModelResourceResponse({
  sourceBuild, side, origin, url, status, resourceType, bytes,
}) {
  assert.ok(['original', 'recovered'].includes(side), 'Unknown loader resource side');
  const parsed = new URL(url);
  assert.equal(parsed.origin, origin, 'Loader response has a foreign origin');
  const prefix = `/packages/${side}/`;
  assert.ok(parsed.pathname.startsWith(prefix), 'Loader response belongs to another package');
  assert.equal(parsed.search, '', 'Unexpected loader resource query');
  assert.equal(parsed.hash, '', 'Unexpected loader resource fragment');
  const path = decodeURIComponent(parsed.pathname.slice(prefix.length));
  const expected = sourceBuild.resourceManifests[side].entries.find(item => item.path === path);
  assert.ok(expected, `Loaded resource absent from verified inventory: ${path}`);
  assert.equal(status, 200, `Loader resource HTTP failure: ${path}`);
  assert.equal(bytes.length, expected.bytes, `Browser resource size drift: ${path}`);
  const digest = sha256(bytes);
  assert.equal(digest, expected.sha256, `Browser resource hash drift: ${path}`);
  return { url, path, status, resourceType, bytes: bytes.length, sha256: digest };
}

export function verifyRuntimeModelLoadedResources(sourceBuild, side, resources) {
  const manifest = sourceBuild.resourceManifests[side];
  assert.ok(manifest, 'Missing verified loader resource manifest');
  for (const resource of resources) {
    const expected = manifest.entries.find(item => item.path === resource.path);
    assert.ok(expected, `Unexpected browser resource: ${resource.path}`);
    assert.equal(resource.status, 200);
    assert.equal(resource.bytes, expected.bytes);
    assert.equal(resource.sha256, expected.sha256);
  }
  for (const path of manifest.requiredResources) {
    assert.ok(resources.some(resource => resource.path === path && resource.resourceType === 'script'),
      `Browser did not load the verified loader module: ${path}`);
  }
  return true;
}

// Decode Chromium's own PNG output without adding a dependency to product packages.
export function screenshotPixels(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Screenshot is not a PNG');
  let width;
  let height;
  let channels;
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'Only 8-bit Chromium screenshots are supported');
      assert.ok([2, 6].includes(data[9]), 'Unsupported PNG color type');
      assert.equal(data[12], 0, 'Interlaced screenshots are not supported');
      channels = data[9] === 6 ? 4 : 3;
    }
    if (type === 'IDAT') chunks.push(data);
    offset += size + 12;
    if (type === 'IEND') break;
  }
  assert.ok(width > 0 && height > 0 && channels, 'PNG has no valid dimensions');
  const encoded = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  assert.equal(encoded.length, height * (stride + 1), 'PNG decompressed size mismatch');
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = encoded[y * (stride + 1)];
    assert.ok(filter <= 4, 'Unsupported PNG filter');
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= channels ? pixels[index - channels] : 0;
      const above = y > 0 ? pixels[index - stride] : 0;
      const corner = y > 0 && x >= channels ? pixels[index - stride - channels] : 0;
      const prediction = [0, left, above, Math.floor((left + above) / 2),
        paeth(left, above, corner)][filter];
      pixels[index] = (encoded[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  const colors = new Set();
  let min = 255;
  let max = 0;
  for (let index = 0; index < pixels.length; index += channels) {
    const rgb = pixels.subarray(index, index + 3);
    colors.add(rgb.toString('hex'));
    const value = (rgb[0] + rgb[1] + rgb[2]) / 3;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { width, height, channels, pixels, colors: colors.size, luminanceRange: max - min };
}

export function parse(file, code) {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  assert.deepEqual(ast.parseDiagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')),
    [], `Cannot parse ${file}`);
  return ast;
}

export function sourceFiles(root = sourceRoot) {
  root = resolve(root);
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    assert.equal(entry.isSymbolicLink(), false, `Unexpected source symlink ${entry.name}`);
    const file = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(file)
      : /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [file] : [];
  }).sort();
}

export const plain = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function clock() {
  let now = 0;
  let counter = 0;
  const jobs = new Map();
  return {
    setTimeout(fn, delay = 0) {
      const id = ++counter;
      jobs.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout(id) { jobs.delete(id); },
    advance(ms = 0) {
      const until = now + ms;
      let iterations = 0;
      for (;;) {
        const job = [...jobs].filter(([, item]) => item.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!job) break;
        assert.ok(++iterations < 1000, 'Timer loop did not converge');
        jobs.delete(job[0]);
        now = job[1].at;
        job[1].fn();
      }
      now = until;
    },
    get pending() { return jobs.size; },
  };
}

function exportSource(ast) {
  const additions = [];
  for (const statement of ast.statements) {
    if (ts.isClassDeclaration(statement) && statement.name) additions.push(statement.name.text);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === 'loading') additions.push('loading');
      }
    }
  }
  const exported = new Set();
  for (const statement of ast.statements) {
    if (ts.isClassDeclaration(statement) &&
      statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      exported.add(statement.name?.text);
    }
  }
  // Export test-visible declarations in memory only; product files are untouched.
  return `${ast.text}\n${additions.filter(name => !exported.has(name))
    .map(name => `exports.${name} = ${name};`).join('\n')}`;
}

function transpile(file, code, stripDecorators = false) {
  const result = ts.transpileModule(code, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React, jsxFactory: 'h', experimentalDecorators: true,
      useDefineForClassFields: false, esModuleInterop: true,
    },
    reportDiagnostics: true,
    transformers: stripDecorators ? { before: [context => {
      const visit = node => ts.isDecorator(node) ? undefined : ts.visitEachChild(node, visit, context);
      return node => ts.visitNode(node, visit);
    }] } : undefined,
  });
  assert.deepEqual(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error)
    .map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [], `Compile failed: ${file}`);
  return result.outputText;
}

function originalModule(platform) {
  const statements = originalAst.statements.filter(statement =>
    !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement));
  const printer = ts.createPrinter();
  const body = statements.map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, originalAst)).join('\n');
  const exports = {};
  runInNewContext(`${body}\nObject.assign(exports, {
    ${classNames.join(',')}, loading, IBizModelRuntime, IBizModelRuntimeList,
    LoadingMask: LoadingPanel$1, LoadingPanel, createStore, InfiniteAjaxScroll
  });`, {
    ...platform, exports,
    getRenderingRef: thirdPartyStencil.g, forceUpdate: thirdPartyStencil.f,
    registerInstance: thirdPartyStencil.r, createEvent: thirdPartyStencil.c,
    h: thirdPartyStencil.h, Host: thirdPartyStencil.H,
  }, { filename: entryPath, timeout: 5000 });
  return exports;
}

function localModules(platform, root = sourceRoot) {
  root = resolve(root);
  const manifestPath = join(dirname(root), 'package.json');
  assert.ok(existsSync(manifestPath), 'Recovered source package manifest is missing');
  const localRequire = createRequire(manifestPath);
  const files = sourceFiles(root);
  assert.ok(files.length >= 4, 'Recovered runtime-model source is absent or incomplete');
  const cache = new Map();
  const dependencies = [];
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const ast = parse(file, readFileSync(file, 'utf8'));
    const compiled = transpile(file, exportSource(ast), true);
    function require(id) {
      if (id.startsWith('.')) {
        const stem = resolve(dirname(file), id);
        const target = [stem, `${stem}.ts`, `${stem}.tsx`, join(stem, 'index.ts')]
          .find(candidate => files.includes(candidate));
        assert.ok(target, `Unresolved recovered-source import ${id} in ${file}`);
        return load(target);
      }
      assert.ok(['@stencil/core', '@stencil/store', 'ramda', '@webcreate/infinite-ajax-scroll'].includes(id),
        `Unexpected external dependency ${id}; never replace a native business class`);
      dependencies.push(id);
      if (id === '@stencil/core') {
        return { h: thirdPartyStencil.h, Host: thirdPartyStencil.H, forceUpdate: thirdPartyStencil.f };
      }
      if (id === '@webcreate/infinite-ajax-scroll') {
        const thirdPartyFile = localRequire.resolve(id);
        const thirdParty = { exports: {} };
        runInNewContext(readFileSync(thirdPartyFile, 'utf8'), {
          ...platform, module: thirdParty, exports: thirdParty.exports, require: localRequire,
        }, { filename: thirdPartyFile, timeout: 5000 });
        return thirdParty.exports;
      }
      return localRequire(id);
    }
    runInNewContext(compiled, { ...platform, exports: module.exports, module, require },
      { filename: file, timeout: 5000 });
    return module.exports;
  }
  const result = {};
  const declarations = [];
  for (const file of files) {
    const ast = parse(file, readFileSync(file, 'utf8'));
    const exported = load(file);
    Object.assign(result, exported);
    for (const statement of ast.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name) continue;
      const component = statement.decorators?.find(decorator =>
        ts.isCallExpression(decorator.expression) && decorator.expression.expression.getText(ast) === 'Component');
      if (component) {
        const options = component.expression.arguments[0];
        const tag = options?.properties?.find(property => property.name?.getText(ast) === 'tag')?.initializer?.text;
        assert.ok(componentTags.includes(tag), `Unknown component tag ${tag}`);
        const key = {
          'ibiz-model-runtime': 'IBizModelRuntime', 'ibiz-model-runtime-list': 'IBizModelRuntimeList',
          'loading-mask': 'LoadingMask', 'loading-panel': 'LoadingPanel',
        }[tag];
        result[key] = exported[statement.name.text];
        declarations.push({ tag, class: statement.name.text, path: file, sha256: sha256(ast.text) });
      }
    }
  }
  for (const key of [...classNames, 'IBizModelRuntime', 'IBizModelRuntimeList', 'LoadingMask', 'LoadingPanel']) {
    assert.equal(typeof result[key], 'function', `Recovered source declaration ${key} is missing`);
  }
  assert.deepEqual(declarations.map(item => item.tag).sort(), [...componentTags].sort(),
    'Exactly the four real Stencil component declarations are required');
  return {
    exports: result, sourceRoot: root, files, declarations,
    dependencies: [...new Set(dependencies)].sort(),
  };
}

export function platformFixture() {
  const timer = clock();
  const calls = [];
  const logs = [];
  const refs = new Map();
  let responder = async () => ({ status: 200, data: [] });
  const platform = {
    Headers, Response, URL, AbortController,
    window: { setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout },
    document: { getElementById: id => refs.get(id) },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level =>
      [level, (...args) => logs.push({ level, args: args.map(value => String(value)) })])),
    setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
    async fetch(url, options = {}) {
      calls.push({
        url: String(url), method: options.method || 'GET', mode: options.mode || null,
        headers: Object.fromEntries(new Headers(options.headers)), body: options.body ?? null,
      });
      const result = await responder(String(url), options);
      if (result instanceof Response) return result;
      return {
        status: result.status ?? 200,
        async json() {
          if (result.jsonError) throw result.jsonError;
          return structuredClone(result.data);
        },
      };
    },
  };
  return {
    platform, timer, calls, logs, refs,
    respond(fn) { responder = fn; },
  };
}

export function implementation(side, { sourceRoot: root = sourceRoot } = {}) {
  assert.ok(['original', 'recovered'].includes(side), `Unknown runtime-model implementation side: ${side}`);
  const environment = platformFixture();
  const original = originalModule(environment.platform);
  const local = side === 'recovered' ? localModules(environment.platform, root) : null;
  const exported = local?.exports ?? original;
  const hostRef = () => ({ $hostElement$: { isConnected: false } });
  const instance = key => {
    const value = new exported[key](hostRef());
    // Actual third-party Stencil registration for method-only tests, not a DOM host.
    thirdPartyStencil.r(value, hostRef());
    return value;
  };
  for (const [id, key] of [
    ['rootLoadingPanel', 'LoadingPanel'], ['loadingPanel', 'LoadingPanel'], ['rootLoadingMask', 'LoadingMask'],
  ]) environment.refs.set(id, instance(key));
  return { ...environment, exported, instance, local };
}

export function rawNode(id, name, leaf = 1) {
  return { psmodelrtid: id, psmodelrtname: name, leafflag: leaf, iconpath: 'fixture-icon' };
}

export const docsFixture = {
  'openChild()': { description: 'Open a child model', return: 'net.example.Child' },
  'onlyDocumentation()': { description: 'Documentation-only operation', return: 'java.util.List<net.example.Doc>' },
};
export const rootNode = rawNode('PSSYSAPP@ROOT', 'Fixture Root', 0);
export const branchNode = rawNode('METHOD@branch@PSSYSAPP', 'openChild#Child branch ==> child-value', 0);
export const childrenFixture = [
  branchNode,
  ...Array.from({ length: 75 }, (_, index) =>
    rawNode(`METHOD@value${index}@PSSYSAPP`, `getValue${index}#Value ${index} ==> value-${index}`)),
];

export async function settle() {
  for (let index = 0; index < 100; index++) await Promise.resolve();
}

export function controllerFixture(env) {
  const controller = new env.exported.ModelRuntimeController();
  controller.url = '/fixture/nodes';
  controller.headers = { Authorization: 'Bearer fixture', 'X-Fixture': 'controlled' };
  controller.configBaseUrl = '/fixture/config';
  env.respond(async (url, options) => {
    if (url.startsWith(controller.configBaseUrl)) return { data: docsFixture };
    const params = JSON.parse(options.body);
    if (params.srfkey === '#') return { data: [rootNode] };
    if (params.srfkey === rootNode.psmodelrtid) return { data: childrenFixture };
    return { data: [rawNode('METHOD@final@PSSYSAPP', 'getFinal#Final value ==> final-value')] };
  });
  return controller;
}
