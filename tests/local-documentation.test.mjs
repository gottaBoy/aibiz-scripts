import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'ibiz-app-hub/package.json'));
const ts = require('typescript');
const source = await readFile(
  join(root, 'modelingweb/app/vite-plugins/local-documentation.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const {
  documentationMiddleware,
  publishDocumentation,
  localDocumentationPlugin,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'local-doc-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const docs = join(directory, 'source');
  for (const [file, content] of Object.entries({
    'index.html':
      '<!doctype html><script src="script/docsify.js"></script><div id="app"></div>',
    'script/docsify.js': 'window.docsLoaded = true;',
    'README.md': '# Local docs',
    'api/ServiceAPI/ServiceAPI.md': '# API',
    '.gitignore': 'private',
  })) {
    await mkdir(dirname(join(docs, file)), { recursive: true });
    await writeFile(join(docs, file), content);
  }
  return { directory, docs };
}

async function request(middleware, url, method = 'GET') {
  const result = { statusCode: 200, headers: {}, next: false, body: '' };
  const response = {
    setHeader(name, value) {
      result.headers[name] = value;
    },
    end(body) {
      result.body = body?.toString() || '';
    },
    get statusCode() {
      return result.statusCode;
    },
    set statusCode(value) {
      result.statusCode = value;
    },
  };
  await middleware({ url, method }, response, () => {
    result.next = true;
  });
  return result;
}

test('local docs are served unchanged under both app paths without a reload injector', async (t) => {
  const { docs } = await fixture(t);
  const middleware = documentationMiddleware(docs, [
    '/doc/',
    '/modeldesign/doc/',
  ]);
  for (const prefix of ['/doc/', '/modeldesign/doc/']) {
    const response = await request(middleware, prefix);
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.body,
      await readFile(join(docs, 'index.html'), 'utf8'),
    );
    assert.ok(!response.body.includes('livereload'));
    assert.equal(response.headers['Content-Type'], 'text/html; charset=utf-8');
    const markdown = await request(
      middleware,
      `${prefix}api/ServiceAPI/ServiceAPI.md?cache=1`,
    );
    assert.equal(markdown.body, '# API');
    const missing = await request(middleware, `${prefix}missing.md`);
    assert.equal(missing.statusCode, 404);
    assert.ok(!missing.body.includes('<script'));
  }
  assert.equal((await request(middleware, '/api/test')).next, true);
  assert.equal(
    (await request(middleware, '/doc?mode=x')).headers.Location,
    '/doc/?mode=x',
  );
  assert.equal((await request(middleware, '/doc/', 'HEAD')).body, '');
  assert.equal((await request(middleware, '/doc/', 'POST')).statusCode, 405);
});

test('docs middleware rejects encoded traversal, hidden files and symlink escapes', async (t) => {
  const { directory, docs } = await fixture(t);
  await writeFile(join(directory, 'secret.txt'), 'secret');
  await symlink(join(directory, 'secret.txt'), join(docs, 'outside.txt'));
  const middleware = documentationMiddleware(docs, ['/doc/']);
  for (const path of [
    '%2e%2e/secret.txt',
    '..%5csecret.txt',
    '.gitignore',
    'outside.txt',
    '%00',
  ]) {
    assert.equal(
      (await request(middleware, `/doc/${path}`)).statusCode,
      403,
      path,
    );
  }
  assert.equal((await request(middleware, '/doc/%E0%A4%A')).statusCode, 400);
});

test('build and preview share the local snapshot, omit hidden files, and fail on missing inputs', async (t) => {
  const { directory, docs } = await fixture(t);
  const output = join(directory, 'dist/doc');
  const plugin = localDocumentationPlugin({
    sourceDirectory: docs,
    mountPaths: ['/doc/'],
  });
  plugin.configResolved({
    root: directory,
    command: 'build',
    build: { outDir: 'dist' },
  });
  await plugin.closeBundle();
  assert.equal(
    await readFile(join(output, 'index.html'), 'utf8'),
    await readFile(join(docs, 'index.html'), 'utf8'),
  );
  await assert.rejects(readFile(join(output, '.gitignore')), {
    code: 'ENOENT',
  });
  let preview;
  plugin.configurePreviewServer({
    middlewares: {
      use(value) {
        preview = value;
      },
    },
  });
  assert.equal((await request(preview, '/doc/README.md')).body, '# Local docs');
  await assert.rejects(
    publishDocumentation(docs, join(docs, 'dist')),
    /overlap/,
  );
  await assert.rejects(
    publishDocumentation(join(directory, 'missing'), output),
    { code: 'ENOENT' },
  );
  const dev = localDocumentationPlugin({ sourceDirectory: docs });
  dev.configResolved({
    root: directory,
    command: 'serve',
    build: { outDir: 'dev-output' },
  });
  await dev.closeBundle();
  await assert.rejects(readFile(join(directory, 'dev-output/doc/index.html')), {
    code: 'ENOENT',
  });
});

test('both source models and both build integrations point to the existing local document snapshot', async () => {
  for (const [jsonName, tsName, hash] of [
    [
      'ps_core_prd_func_data_model_html_view',
      'ps-core-prd-func-data-model-html-view',
      '/',
    ],
    [
      'ps_core_prd_func_api_show_html_view',
      'ps-core-prd-func-api-show-html-view',
      '/api/ServiceAPI/ServiceAPI',
    ],
  ]) {
    const model = JSON.parse(
      await readFile(
        join(root, `plm/model/PSSYSAPPS/plmweb/PSAPPDEVIEWS/${jsonName}.json`),
        'utf8',
      ),
    );
    assert.equal(model.htmlUrl, `./doc/#${hash}`);
    const text = await readFile(
      join(root, `plm-web/src/publish/model/views/${tsName}.ts`),
      'utf8',
    );
    const sf = ts.createSourceFile(
      'view.ts',
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const exported = sf.statements.find((node) => ts.isExportAssignment(node));
    const url = exported.expression.properties.find(
      (prop) => prop.name?.getText(sf) === 'htmlUrl',
    ).initializer.text;
    assert.equal(url, model.htmlUrl);
    assert.equal(
      new URL(url, 'http://localhost:32003/modeldesign/').host,
      'localhost:32003',
    );
  }
  const docs = join(root, 'plm/doc/docsify');
  const html = await readFile(join(docs, 'index.html'), 'utf8');
  assert.ok(html.includes('script/docsify.js'));
  assert.doesNotMatch(html, /livereload|snipver|reportAllChanges/);
  assert.ok(
    (await readFile(join(docs, 'api/ServiceAPI/ServiceAPI.md'), 'utf8')).length,
  );
  for (const app of ['modelingweb/app', 'plm-web']) {
    const path = join(root, app, 'vite-plugins/ibiz-vite-plugin.ts');
    const sf = ts.createSourceFile(
      path,
      await readFile(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = sf.statements.filter((node) =>
      ts.isImportDeclaration(node),
  );
  const imported = imports.find((node) =>
    node.moduleSpecifier.text.endsWith('/local-documentation'),
  );
  assert.ok(imported);
  assert.equal(existsSync(resolve(dirname(path), `${imported.moduleSpecifier.text}.ts`)), true);
    const calls = [];
    const walk = (node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sf) === 'localDocumentationPlugin'
      )
        calls.push(node);
      ts.forEachChild(node, walk);
    };
    walk(sf);
    assert.equal(calls.length, 1);
  }
});
