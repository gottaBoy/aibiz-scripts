import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildApiReferenceFiles } from '../../plm/doc/tools/api-reference.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'ibiz-app-hub/package.json'));
const ts = require('typescript');
async function importPlugin(path) {
  const source = await readFile(join(root, path), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const [plmPlugin, modelingPlugin] = await Promise.all([
  importPlugin('plm-web/vite-plugins/local-documentation.ts'),
  importPlugin('modelingweb/app/vite-plugins/local-documentation.ts'),
]);

const generated = new Map([
  ['api-reference/zh-CN/ServiceAPI.md', Buffer.from('# zh')],
  ['api-reference/en/ServiceAPI.md', Buffer.from('# en')],
  ['api-reference/zh-CN/entities/Test.md', Buffer.from('# entity')],
  ['api-reference/en/entities/Test.md', Buffer.from('# entity')],
  ['api-reference/zh-CN/_sidebar.md', Buffer.from('- Test')],
  ['api-reference/en/_sidebar.md', Buffer.from('- Test')],
  ['api-reference/zh-CN/search.json', Buffer.from('{"language":"zh-CN","entries":[]}')],
  ['api-reference/en/search.json', Buffer.from('{"language":"en","entries":[]}')],
  ['api-reference/manifest.json', Buffer.from('{"contract":"test"}')],
]);

function request(middleware, url, method = 'GET') {
  const result = { statusCode: 200, headers: {}, body: '', next: false };
  const response = {
    setHeader(name, value) { result.headers[name] = value; },
    end(body) { result.body = body?.toString() || ''; },
    get statusCode() { return result.statusCode; },
    set statusCode(value) { result.statusCode = value; },
  };
  return Promise.resolve(middleware({ url, method }, response, () => { result.next = true; }))
    .then(() => result);
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'localized-api-docs-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), '<script src="script/docsify.js"></script>');
  await mkdir(join(directory, 'script'));
  await writeFile(join(directory, 'script/docsify.js'), '');
  await writeFile(join(directory, 'README.md'), '# Original data model');
  return directory;
}

for (const [name, plugin] of [['plm-web', plmPlugin], ['modelingweb', modelingPlugin]]) {
  test(`${name} generated documentation middleware is GET/HEAD-only and path-safe`, async t => {
    const source = await fixture(t);
    const middleware = plugin.documentationMiddleware(source, ['/doc/'], async () => generated);
    assert.equal((await request(middleware, '/doc/api-reference/en/ServiceAPI.md')).body, '# en');
    assert.equal((await request(middleware, '/doc/api-reference/en/ServiceAPI.md', 'HEAD')).body, '');
    assert.equal((await request(middleware, '/doc/api-reference/en/ServiceAPI.md', 'POST')).statusCode, 405);
    for (const path of [
      '/doc/api-reference/../README.md',
      '/doc/api-reference/%2e%2e/README.md',
      '/doc/api-reference/en/%00',
    ]) assert.ok([403, 404].includes((await request(middleware, path)).statusCode));
    assert.equal((await request(middleware, '/doc/README.md')).body, '# Original data model');
  });

  test(`${name} build and preview publish the same generated snapshot`, async t => {
    const source = await fixture(t);
    const directory = await mkdtemp(join(tmpdir(), 'localized-api-out-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = join(directory, 'dist/doc');
    let generations = 0;
    const instance = plugin.localDocumentationPlugin({
      sourceDirectory: source, generatedFiles: async () => { generations += 1; return generated; },
    });
    instance.configResolved({ root: directory, command: 'build', build: { outDir: 'dist' } });
    await instance.closeBundle();
    for (const path of generated.keys()) assert.deepEqual(
      await readFile(join(output, path)), generated.get(path), path,
    );
    let preview;
    instance.configurePreviewServer({ middlewares: { use(value) { preview = value; } } });
    assert.equal((await request(preview, '/doc/api-reference/zh-CN/ServiceAPI.md')).body, '# zh');
    assert.equal(generations, 1, 'Preview must read the build snapshot without regenerating');
    assert.equal((await request(preview, '/doc/README.md')).body, '# Original data model');
  });
}

test('both Vite integrations inject the API generator callback without replacing existing documentation options', async () => {
  for (const path of ['plm-web/vite-plugins/ibiz-vite-plugin.ts', 'modelingweb/app/vite-plugins/ibiz-vite-plugin.ts']) {
    const source = await readFile(join(root, path), 'utf8');
    assert.match(source, /import\s+\{\s*buildApiReferenceFiles\s*\}\s+from/);
    assert.match(source, /generatedFiles:\s*\(\)\s*=>\s*buildApiReferenceFiles/);
    assert.match(source, /sourceDirectory:\s*resolve\(__dirname,[\s\S]*plm\/doc\/docsify/);
    assert.match(source, /localDocumentationPlugin\(\{/);
  }
});

test('generated callback fails closed for invalid maps without serving or publishing private output', async t => {
  const source = await fixture(t);
  for (const value of [
    [],
    new Map([['api-reference/../escape.md', Buffer.from('x')]]),
    new Map([['api-reference/x.md', 'x']]),
    new Map([['other/x.md', Buffer.from('x')]]),
    new Map([['api-reference/en/.secret.md', Buffer.from('secret')]]),
    new Map([['api-reference/en\\secret.md', Buffer.from('secret')]]),
    new Map([['api-reference/en/x\0.md', Buffer.from('secret')]]),
    new Map([['api-reference/en/not-generated.md', Buffer.from('secret')]]),
    new Map([['api-reference/fr/ServiceAPI.md', Buffer.from('secret')]]),
  ]) {
    for (const plugin of [plmPlugin, modelingPlugin]) {
      const middleware = plugin.documentationMiddleware(source, ['/doc/'], async () => value);
      const result = await request(middleware, '/doc/api-reference/en/ServiceAPI.md');
      assert.equal(result.statusCode, 500);
      assert.doesNotMatch(result.body, /secret|escape/);
      await assert.rejects(plugin.publishDocumentation(source, `${source}-output`, async () => value),
        /Generated documentation|Unsafe/);
    }
  }
});

test('generated output cannot escape a published snapshot through a symlink', async t => {
  const source = await fixture(t);
  const directory = await mkdtemp(join(tmpdir(), 'localized-api-symlink-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'dist');
  const outside = join(directory, 'outside');
  await mkdir(target);
  await mkdir(outside);
  await symlink(outside, join(target, 'api-reference'));
  await assert.rejects(plmPlugin.publishDocumentation(source, target, async () => generated), /escapes/);
});

test('actual authority-generated pages and search are served through both integrations', async () => {
  const source = join(root, 'plm/doc/docsify');
  const files = await buildApiReferenceFiles({ sourceDirectory: source });
  assert.ok(files.size > 100);
  const first = JSON.parse(files.get('api-reference/en/search.json')).entries
    .find(entry => entry.path.includes('/entities/'));
  assert.ok(first);
  for (const plugin of [plmPlugin, modelingPlugin]) {
    const middleware = plugin.documentationMiddleware(source, ['/doc/', '/modeldesign/doc/'], async () => files);
    for (const mount of ['/doc/', '/modeldesign/doc/']) {
      const en = await request(middleware, `${mount}api-reference/en/ServiceAPI.md`);
      const zh = await request(middleware, `${mount}api-reference/zh-CN/ServiceAPI.md`);
      assert.equal(en.statusCode, 200);
      assert.notEqual(en.body, zh.body);
      assert.equal(en.headers['X-Content-Type-Options'], 'nosniff');
      const entityPath = first.path.slice(2).split('?')[0] + '.md';
      assert.equal((await request(middleware, mount + entityPath)).statusCode, 200);
      const search = await request(middleware, `${mount}api-reference/en/search.json`);
      assert.equal(JSON.parse(search.body).language, 'en');
      assert.equal((await request(middleware, `${mount}api-reference/en/not-generated.md`)).statusCode, 404);
    }
  }
});
