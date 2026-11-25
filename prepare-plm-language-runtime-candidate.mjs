#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { rewriteGuardEntry, staticModuleReferences, resolveGuardResource } from './prepare-plm-guard-overlay.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hub = path.join(workspace, 'ibiz-app-hub');
const artifacts = path.join(workspace, '.artifacts');
const require = createRequire(path.join(workspace, 'plm-web/package.json'));
const vueRequire = createRequire(require.resolve('vue'));
const parseHtml = vueRequire('@vue/compiler-dom').parse;
const postcss = require('postcss');
const cssRequire = createRequire(require.resolve('postcss'));
const cssValues = cssRequire('postcss-value-parser');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const packages = ['packages/runtime', 'components/ibiz-next-vue3'];
const excluded = new Set(['node_modules', 'dist', 'out', 'es', 'lib', '.git', '.artifacts', '.bin']);
const toolRequire = createRequire(path.join(hub, 'package.json'));
const absoluteAssetSources = new Map([
  ['/assets/images/login-header.png', 'plm-web/public/assets/images/login-header.png'],
  ['/assets/images/login-avatar.png', 'plm-web/public/assets/images/login-avatar.png'],
]);

export function languageAbsoluteAssetSource(reference) {
  return absoluteAssetSources.get(reference);
}

export function bindLanguageAbsoluteAsset(reference, source, served, nginx) {
  const sourcePath = languageAbsoluteAssetSource(reference);
  assert.ok(sourcePath, 'Only the two reviewed login image aliases are eligible');
  assert.ok(Buffer.isBuffer(source) && Buffer.isBuffer(served) && Buffer.isBuffer(nginx));
  assert.ok(source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.deepEqual(served, source, 'The served alias must match its actual public source');
  assert.ok(nginx.toString().includes(
    `location = ${reference} {\n        alias /dist${reference};\n    }`,
  ), 'The startup Nginx source must contain the exact reviewed alias');
  return { urlPath: reference, sourcePath, bytes: source.length, sha256: sha(source),
    nginxSourcePath: 'plm-web/nginx-local.conf', nginxSourceSha256: sha(nginx) };
}

function cssReferences(text, filename) {
  const references = new Set();
  const root = postcss.parse(text, { from: filename });
  const inspect = value => cssValues(value).walk(node => {
    if (node.type === 'function' && node.value.toLowerCase() === 'url') {
      const reference = cssValues.stringify(node.nodes).replace(/^(['"])(.*)\1$/, '$2').trim();
      if (reference && !/^(?:data:|#)/i.test(reference)) references.add(reference);
    }
  });
  root.walkDecls(declaration => inspect(declaration.value));
  root.walkAtRules('import', rule => {
    const [first] = cssValues(rule.params).nodes;
    if (first?.type === 'string') references.add(first.value);
    else inspect(rule.params);
  });
  return [...references];
}

export function languageSourceInventory(root, prefix = '') {
  const rows = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const relative = path.posix.join(prefix, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Source symlink: ${relative}`);
    if (entry.isDirectory()) rows.push(...languageSourceInventory(root, relative));
    else if (entry.isFile()) {
      const bytes = fs.readFileSync(path.join(root, relative));
      rows.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function outputInventory(root, prefix = '') {
  const rows = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    assert.ok(!entry.isSymbolicLink());
    if (entry.isDirectory()) rows.push(...outputInventory(root, relative));
    else if (entry.isFile()) {
      const bytes = fs.readFileSync(path.join(root, relative));
      rows.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function writePrivate(root, relative, bytes) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { path: relative, bytes: bytes.length, sha256: sha(bytes) };
}

function linkDependencies(original, destination) {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const dependencies = [];
  for (const entry of fs.readdirSync(original, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const source = path.join(original, entry.name);
    if (entry.name.startsWith('@') && !entry.isSymbolicLink()) {
      fs.mkdirSync(path.join(destination, entry.name), { mode: 0o700 });
      for (const item of fs.readdirSync(source)) {
        const actual = fs.realpathSync(path.join(source, item));
        fs.symlinkSync(actual, path.join(destination, entry.name, item));
        dependencies.push({ name: `${entry.name}/${item}`, realpath: actual });
      }
    } else {
      const actual = fs.realpathSync(source);
      fs.symlinkSync(actual, path.join(destination, entry.name));
      dependencies.push({ name: entry.name, realpath: actual });
    }
  }
  return dependencies;
}

function activeHtmlEntries(html) {
  const scripts = [];
  const visit = node => {
    if (node.type === 1 && node.tag === 'script') scripts.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(parseHtml(html, { onError(error) {
    if (error.code === 11 && /^<!doctype/i.test(html.slice(error.loc.start.offset))) return;
    throw error;
  } }));
  const attr = (node, name) => node.props.find(prop => prop.type === 6 && prop.name === name)?.value?.content;
  const maps = scripts.filter(node => attr(node, 'type') === 'systemjs-importmap');
  const entries = scripts.filter(node => attr(node, 'id') === 'vite-legacy-entry');
  assert.equal(maps.length, 1);
  assert.equal(entries.length, 1);
  const relative = value => {
    assert.match(value ?? '', /^\.\/[A-Za-z0-9_@./-]+$/);
    assert.ok(!value.split('/').includes('..'));
    return value.slice(2);
  };
  return { importMap: relative(attr(maps[0], 'src')), appEntry: relative(attr(entries[0], 'data-src')) };
}

export function languageImportMap(original, revision) {
  assert.match(revision, /^[a-f0-9]{16}$/);
  const result = structuredClone(original);
  assert.ok(result.imports?.['@ibiz-template/runtime'] && result.imports?.['@ibiz-template/vue3-components']);
  result.imports['@ibiz-template/runtime'] = `../js/@ibiz-template/runtime/language-${revision}/index.system.min.js`;
  result.imports['@ibiz-template/vue3-components'] = `../js/@ibiz-template/vue3-components/language-${revision}/index.system.min.js`;
  result.styles['@ibiz-template/vue3-components'] = `../js/@ibiz-template/vue3-components/language-${revision}/index.min.css`;
  return result;
}

function command(program, args, cwd, log) {
  const fd = fs.openSync(log, 'wx', 0o600);
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', fd, fd] });
    child.once('error', error => { fs.closeSync(fd); reject(error); });
    child.once('exit', code => {
      fs.fsyncSync(fd); fs.closeSync(fd);
      if (code === 0) resolve();
      else reject(new Error(`Source candidate build failed (${code}): ${program} ${args.join(' ')}; ${log}`));
    });
  });
}

export async function prepareLanguageRuntimeCandidate(output) {
  assert.ok(path.isAbsolute(output));
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  fs.mkdirSync(output, { mode: 0o700 });
  const scriptBytes = fs.readFileSync(fileURLToPath(import.meta.url));
  writePrivate(output, 'executed-preparer.private.mjs', scriptBytes);
  const tools = ['esbuild', 'rollup'].map(name => {
    const entry = toolRequire.resolve(name);
    return { name, path: entry, sha256: sha(fs.readFileSync(entry)) };
  });
  const source = packages.map(relative => ({ package: relative,
    files: languageSourceInventory(path.join(hub, relative)),
    originalDist: outputInventory(path.join(hub, relative, 'dist')) }));
  const snapshot = path.join(output, 'snapshot');
  fs.mkdirSync(snapshot, { mode: 0o700 });
  writePrivate(snapshot, 'tsconfig.json', fs.readFileSync(path.join(hub, 'tsconfig.json')));
  fs.symlinkSync(path.join(hub, 'node_modules'), path.join(snapshot, 'node_modules'));
  const dependencies = [];
  for (const item of source) {
    const target = path.join(snapshot, item.package);
    for (const file of item.files) {
      const bytes = fs.readFileSync(path.join(hub, item.package, file.path));
      assert.equal(sha(bytes), file.sha256);
      writePrivate(target, file.path, bytes);
    }
    dependencies.push({ package: item.package,
      packages: linkDependencies(path.join(hub, item.package, 'node_modules'), path.join(target, 'node_modules')) });
  }
  // The CLI resolves Babel presets relative to its configured package root.
  const babel = path.join(snapshot, 'components/ibiz-next-vue3/node_modules/@babel');
  fs.mkdirSync(babel, { recursive: true });
  const babelPreset = path.join(hub, 'node_modules/.pnpm/@babel+preset-env@7.27.2_@babel+core@7.27.4/node_modules/@babel/preset-env');
  if (!fs.existsSync(path.join(babel, 'preset-env'))) fs.symlinkSync(babelPreset, path.join(babel, 'preset-env'));
  const runtime = path.join(snapshot, 'packages/runtime');
  const component = path.join(snapshot, 'components/ibiz-next-vue3');
  await command(process.execPath, ['scripts/build.js'], runtime, path.join(output, 'runtime-esbuild.private.log'));
  await command(path.join(hub, 'node_modules/.bin/rollup'), ['-c'], runtime, path.join(output, 'runtime-rollup.private.log'));
  await command(path.join(hub, 'components/ibiz-next-vue3/node_modules/.bin/ibiz-temp'), ['build', '-c'],
    component, path.join(output, 'component-build.private.log'));
  for (const item of source) {
    assert.deepEqual(languageSourceInventory(path.join(hub, item.package)), item.files, 'Current source drifted during build');
    assert.deepEqual(languageSourceInventory(path.join(snapshot, item.package)), item.files, 'Executed source snapshot drifted');
    assert.deepEqual(outputInventory(path.join(hub, item.package, 'dist')), item.originalDist, 'Shared package dist changed');
  }
  const outputs = packages.map(relative => ({ package: relative,
    files: outputInventory(path.join(snapshot, relative, 'dist')) }));
  const runtimeEntry = outputs[0].files.find(file => file.path === 'index.system.min.js');
  const componentEntry = outputs[1].files.find(file => file.path === 'index.system.min.js');
  assert.ok(runtimeEntry && componentEntry);
  const runtimeText = fs.readFileSync(path.join(runtime, 'dist/index.esm.js'), 'utf8');
  assert.ok(runtimeText.includes('mergeBackendSearchGroup'), 'Current caption merger must be present in runtime output');
  const componentText = outputs[1].files.filter(file => file.path.endsWith('.js'))
    .map(file => fs.readFileSync(path.join(component, 'dist', file.path), 'utf8')).join('\n');
  assert.ok(componentText.includes('Added you to the product') && componentText.includes('product_member_create'));
  const revision = sha(jsonBytes([runtimeEntry, componentEntry])).slice(0, 16);
  const overlay = path.join(output, 'overlay');
  const files = [];
  for (const item of outputs) {
    const name = item.package === 'packages/runtime' ? 'runtime' : 'vue3-components';
    for (const file of item.files) {
      const bytes = fs.readFileSync(path.join(snapshot, item.package, 'dist', file.path));
      assert.equal(sha(bytes), file.sha256);
      files.push(writePrivate(overlay, `extras/js/@ibiz-template/${name}/language-${revision}/${file.path}`, bytes));
    }
  }
  const originalIndex = fs.readFileSync(path.join(workspace, 'plm-web/dist/index.html'));
  const entries = activeHtmlEntries(originalIndex.toString());
  const originalMap = fs.readFileSync(path.join(workspace, 'plm-web/dist', entries.importMap));
  const mapPath = `extras/json/system-import-language-${revision}.json`;
  const importMap = languageImportMap(JSON.parse(originalMap), revision);
  files.push(writePrivate(overlay, mapPath, jsonBytes(importMap)));
  files.push(writePrivate(overlay, 'index.html', Buffer.from(rewriteGuardEntry(originalIndex.toString(), {
    appEntry: `./${entries.appEntry}`, importMap: `./${mapPath}`,
  }))));
  writePrivate(output, 'rollback/index.html', originalIndex);
  writePrivate(output, `rollback/${entries.importMap}`, originalMap);
  const staticModules = [], inherited = new Map(), absoluteAssets = new Map(), dynamicImports = [], unresolved = [];
  const queue = files.filter(file => /\.(?:js|css)$/.test(file.path)).map(file => file.path);
  const seen = new Set();
  const supplied = new Map(files.map(file => [file.path, file]));
  while (queue.length) {
    const relative = queue.shift();
    if (seen.has(relative)) continue;
    seen.add(relative);
    let bytes;
    if (supplied.has(relative)) bytes = fs.readFileSync(path.join(overlay, relative));
    else {
      const response = await fetch(`http://127.0.0.1:30250/ibizplm-plmweb/${relative}`, { signal: AbortSignal.timeout(20_000) });
      if (response.status !== 200) { unresolved.push({ path: relative, status: response.status }); continue; }
      bytes = Buffer.from(await response.arrayBuffer());
      const record = writePrivate(output, `inherited/${relative}`, bytes);
      inherited.set(relative, { ...record, path: relative });
    }
    if (!/\.(?:js|css)$/.test(relative)) continue;
    const result = relative.endsWith('.css')
      ? { references: cssReferences(bytes.toString(), relative), dynamic: [] }
      : staticModuleReferences(bytes.toString(), relative);
    staticModules.push({ path: relative, sha256: sha(bytes), bytes: bytes.length, references: result.references });
    dynamicImports.push(...result.dynamic.map(item => ({ path: relative, ...item })));
    for (const reference of result.references) {
      try {
        const aliasSource = languageAbsoluteAssetSource(reference);
        if (aliasSource) {
          if (!absoluteAssets.has(reference)) {
            const source = fs.readFileSync(path.join(workspace, aliasSource));
            const nginx = fs.readFileSync(path.join(workspace, 'plm-web/nginx-local.conf'));
            const response = await fetch(`http://127.0.0.1:30250${reference}`, {
              redirect: 'error', signal: AbortSignal.timeout(20_000),
            });
            assert.equal(response.status, 200, `The exact image alias failed: ${reference}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            const binding = bindLanguageAbsoluteAsset(reference, source, bytes, nginx);
            const record = writePrivate(output, `absolute-assets${reference}`, bytes);
            absoluteAssets.set(reference, { ...binding, cachePath: record.path });
          }
          continue;
        }
        const target = resolveGuardResource(reference, relative, importMap, mapPath);
        queue.push(target);
      } catch (error) { unresolved.push({ from: relative, reference, error: error.message }); }
    }
  }
  assert.deepEqual(fs.readFileSync(path.join(workspace, 'plm-web/dist/index.html')), originalIndex);
  for (const item of source) {
    assert.deepEqual(languageSourceInventory(path.join(hub, item.package)), item.files, 'Source drifted during dependency audit');
    assert.deepEqual(languageSourceInventory(path.join(snapshot, item.package)), item.files);
  }
  for (const tool of tools) assert.equal(sha(fs.readFileSync(tool.path)), tool.sha256);
  for (const asset of absoluteAssets.values()) {
    assert.equal(sha(fs.readFileSync(path.join(workspace, asset.sourcePath))), asset.sha256);
    assert.equal(sha(fs.readFileSync(path.join(workspace, asset.nginxSourcePath))), asset.nginxSourceSha256);
  }
  const report = { contract: 'plm-language-runtime-candidate-v1', status: 'PREPARED-NOT-PUBLISHED',
    revision, preparerSha256: sha(scriptBytes), source, dependencies, tools, outputs, files,
    originalIndexSha256: sha(originalIndex), originalMapSha256: sha(originalMap), activeOriginalEntries: entries,
    mapPath, staticModules, inherited: [...inherited.values()], absoluteAssets: [...absoluteAssets.values()], dynamicImports, unresolved,
    originalPackageDistsUnchanged: true, sharedApplicationDistUnchanged: true,
    runtimeEntry, componentEntry, functionalAcceptance: false, preparedAt: new Date().toISOString() };
  writePrivate(output, 'language-runtime-candidate.private.json', jsonBytes(report));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { output: { type: 'string' } } });
  prepareLanguageRuntimeCandidate(values.output).then(report => console.log(JSON.stringify({
    status: report.status, revision: report.revision, files: report.files.length,
    runtimeEntry: report.runtimeEntry, componentEntry: report.componentEntry,
    staticModules: report.staticModules.length, dynamicImports: report.dynamicImports.length,
    unresolved: report.unresolved, functionalAcceptance: false,
  }))).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
