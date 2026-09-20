import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { EXAMPLES, generateInventory } from '../harness-example-inventory.mjs';

const CLI = fileURLToPath(
  new URL('../harness-example-inventory.mjs', import.meta.url),
);
const EXAMPLE = 'ibiz-app-hub/examples/quickstart';

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'harness-example-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function snapshot(root) {
  const result = {};
  function visit(directory) {
    for (const entry of readdirSync(join(root, directory), {
      withFileTypes: true,
    })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else
        result[path] = createHash('sha256')
          .update(readFileSync(join(root, path)))
          .digest('hex');
    }
  }
  visit('');
  return result;
}

function simpleFiles() {
  return {
    'ibiz-app-hub/pnpm-workspace.yaml':
      "packages:\n  - 'packages/*'\n  - 'examples/*'\n",
    'ibiz-app-hub/packages/core/package.json': JSON.stringify({
      name: '@fixture/core',
      scripts: { watch: 'tsc --watch' },
    }),
    'ibiz-app-hub/packages/core/src/index.ts': 'export const core = true;',
    [`${EXAMPLE}/package.json`]: JSON.stringify({
      name: 'fixture-quickstart',
      version: '1.2.3',
      scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build' },
      dependencies: {
        '@fixture/core': 'workspace:*',
        '@fixture/missing': 'workspace:*',
        vue: '^3.3.8',
      },
    }),
    [`${EXAMPLE}/index.html`]:
      '<script type="module" src="/src/main.ts"></script>',
    [`${EXAMPLE}/src/publish/pages/index.ts`]: `
      import { defineAsyncComponent } from 'vue';
      // case 'comment_view': return import('./comment.vue');
      const documentation = "case 'string_view': import('./string.vue')";
      function irrelevant() { switch ('x') { case 'not_a_view': return 1; } }
      export async function getAppViewComponent(name: string) {
        if (name.startsWith('sub.')) return import('../../sub.vue');
        switch (name) {
          case 'first': return defineAsyncComponent(() => import('./first.vue'));
          case 'second': return defineAsyncComponent(() => import('./second.vue'));
          case 'first': return defineAsyncComponent(() => import('./first.vue'));
          default: throw new Error(name);
        }
      }`,
    [`${EXAMPLE}/src/publish/pages/first.vue`]:
      '<template><div>First</div></template>',
    [`${EXAMPLE}/src/publish/pages/second.vue`]:
      '<template><div>Second</div></template>',
    [`${EXAMPLE}/src/publish/model/view-config/index.ts`]: `
      import { IViewConfig } from '@fixture/core';
      import first from './first';
      import second from './second';
      import unused from './not-registered';
      // ibiz.hub.config.view.set('web.comment_view', {});
      const documentation = "ibiz.hub.config.view.set('web.string_view', {})";
      export function initViewConfig() {
        other.view.set('not_a_view', {});
        ibiz.hub.config.view.set('web.first', first as IViewConfig);
        ibiz.hub.config.view.set('web.second', second);
      }`,
    [`${EXAMPLE}/src/publish/model/view-config/first.ts`]: 'export default {};',
    [`${EXAMPLE}/src/publish/model/view-config/second.ts`]:
      'export default {};',
    [`${EXAMPLE}/public/environments/environment.js`]: `
      window.Environment = {
        appId: 'fixture__web', BaseUrl: '/api', baseUrl: 'fixture__web',
        pluginBaseUrl: './plugins', assetsUrl: './assets', favicon: './favicon.ico',
        anonymousPwd: 'must-not-appear', enableMqtt: false, mqttUrl: '/mqtt',
        customParams: '{"file_preview_address":"https://preview.example.test","password":"secret-value"}',
        // pluginBaseUrl: 'https://comment.example.test',
      };`,
    [`${EXAMPLE}/environment.config`]:
      '# A mapping, not endpoint values\nbaseUrl:BASEURL\npluginBaseUrl:PLUGINBASEURL\n',
    [`${EXAMPLE}/src/main.ts`]: `
      import './style.css';
      const apps = [{
        name: 'quickstart_b', entry: 'https://child.example.test',
        baseUrl: 'child__web', pluginBaseUrl: './plugins'
      }] as const;
      // ctx.registerMicroApps([{name: 'comment', entry: 'https://comment.example.test'}]);
      const documentation = "ctx.registerMicroApps([{entry: 'https://string.example.test'}])";
      ctx.microAppConfigCenter.registerMicroApps(apps);
      runApp([]);
      throw new Error('Scanned code must never execute');`,
    [`${EXAMPLE}/src/style.css`]: 'body {}',
    [`${EXAMPLE}/vite.config.ts`]: `
      import { defineConfig } from 'vite';
      // https://vitejs.dev/config/
      const settings = {
        base: './', server: { host: '127.0.0.1', port: 5432, proxy: {
          '/api/fixture__web': { target: 'https://api.example.test', changeOrigin: true },
          '/local': 'http://localhost:8080',
          // '/comment': {target: 'https://comment.example.test'},
        }}
      } satisfies Record<string, unknown>;
      export default defineConfig(settings);`,
    [`${EXAMPLE}/public/extras/json/system-import.json`]: JSON.stringify({
      imports: {
        vue: '../js/vue.js',
        missing: '../js/missing.js',
        remote: 'https://cdn.example.test/core.js',
      },
      styles: { vue: '../js/style.css' },
    }),
    [`${EXAMPLE}/public/extras/js/vue.js`]:
      'System.register([], function() {});',
    [`${EXAMPLE}/public/extras/js/style.css`]: 'body {}',
    [`${EXAMPLE}/public/assets/logo.svg`]: '<svg/>',
    [`${EXAMPLE}/public/plugins/local/package.json`]: '{"name":"local"}',
    [`${EXAMPLE}/public/favicon.ico`]: 'fixture',
    [`${EXAMPLE}/README.md`]:
      "9000 views, https://docs.example.test; registerMicroApps([{name: 'fake'}])",
  };
}

test('empty workspace reports missing examples and unknown counts, never passed acceptance', (t) => {
  const root = fixture(t);
  const result = generateInventory({ root });
  assert.equal(result.acceptance.status, 'not_run');
  assert.deepEqual(
    result.examples.map((example) => example.name),
    EXAMPLES,
  );
  for (const example of result.examples) {
    assert.equal(example.directory.exists, false);
    assert.equal(example.acceptance.status, 'not_run');
    assert.equal(example.views.pages.count, null);
    assert.equal(example.views.pages.observedCount, 0);
    assert.equal(example.views.viewConfig.count, null);
    assert.equal(example.dependencies.workspace.hasDeclarations, null);
    assert.equal(example.dependencies.microApps.count, null);
    assert.ok(example.inputs.every((input) => input.status === 'missing'));
  }
  assert.deepEqual(readdirSync(root), []);
});

test('simple fixture has traceable counts, endpoints, micro-apps, resources and workspace source', (t) => {
  const root = fixture(t, simpleFiles());
  const before = snapshot(root);
  const result = generateInventory({ root });
  const example = result.examples[0];
  assert.equal(example.entry.html.exists, true);
  assert.equal(example.entry.main.exists, true);
  assert.equal(
    example.entry.scripts.find((script) => script.name === 'dev').command,
    'vite --host 127.0.0.1',
  );
  assert.equal(example.entry.vite.settings['server.port'].value, 5432);
  assert.equal(example.entry.vite.settings.base.value, './');
  assert.equal(example.views.pages.count, 2);
  assert.equal(example.views.viewConfig.count, 2);
  assert.deepEqual(
    example.views.pages.entries.map((entry) => entry.id),
    ['first', 'second'],
  );
  assert.equal(example.views.pages.entries[0].registrations.length, 2);
  for (const group of Object.values(example.views)) {
    assert.equal(group.count, group.entries.length);
    for (const entry of group.entries) {
      for (const registration of entry.registrations) {
        const { file, line, column } = registration.source;
        const text = readFileSync(join(root, file), 'utf8').split('\n')[
          line - 1
        ];
        assert.ok(column > 0);
        assert.ok(text.includes(entry.id));
        assert.ok(registration.modules.every((module) => module.local.exists));
      }
    }
  }
  assert.equal(example.dependencies.microApps.count, 1);
  assert.equal(
    example.dependencies.microApps.entries[0].fields.name.value,
    'quickstart_b',
  );
  assert.equal(
    example.dependencies.endpoints.find((item) => item.role === 'api-prefix')
      .location,
    'same-origin',
  );
  assert.equal(
    example.dependencies.endpoints.find((item) => item.role === 'api-namespace')
      .location,
    'namespace',
  );
  assert.equal(
    example.dependencies.endpoints.find((item) => item.role === 'mqtt').enabled,
    false,
  );
  assert.equal(
    example.dependencies.endpoints.find((item) => item.route === '/local')
      .location,
    'loopback',
  );
  assert.equal(
    example.dependencies.endpoints.find(
      (item) => item.role === 'custom-service',
    ).value,
    'https://preview.example.test',
  );
  assert.equal(example.entry.vite.proxies.length, 2);
  assert.equal(example.environment.bindings.length, 2);
  assert.equal(example.localResources.mainImports[0].local.exists, true);
  assert.equal(example.localResources.systemResources.count, 3);
  assert.equal(
    example.localResources.systemResources.entries.find(
      (item) => item.name === 'missing',
    ).local.exists,
    false,
  );
  assert.ok(
    example.localResources.configuredPaths.every((item) => item.local.exists),
  );
  const workspace = example.dependencies.workspace;
  assert.equal(workspace.count, 2);
  assert.equal(workspace.hasDeclarations, true);
  assert.equal(workspace.hasLocalSource, true);
  assert.equal(workspace.resolutionComplete, true);
  const core = workspace.entries.find((item) => item.name === '@fixture/core');
  assert.equal(core.source.jsonPointer, '/dependencies/@fixture~1core');
  assert.equal(
    core.candidates[0].sourceDirectories[0].path,
    'ibiz-app-hub/packages/core/src',
  );
  assert.equal(
    core.candidates[0].sourceEvidence.path,
    'ibiz-app-hub/packages/core/src/index.ts',
  );
  assert.equal(core.candidates[0].watchScript, 'tsc --watch');
  assert.equal(
    workspace.entries.find((item) => item.name === '@fixture/missing')
      .hasLocalSource,
    false,
  );
  const json = JSON.stringify(result);
  for (const ignored of [
    'comment_view',
    'string_view',
    'not_a_view',
    'docs.example.test',
    'comment.example.test',
    'string.example.test',
    'must-not-appear',
    'secret-value',
  ]) {
    assert.ok(!json.includes(ignored), ignored);
  }
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(generateInventory({ root }), result);
  assert.equal(example.acceptance.status, 'not_run');
});

test('existing empty registries are distinct from missing files', (t) => {
  const root = fixture(t, {
    [`${EXAMPLE}/src/publish/pages/index.ts`]: '// No views yet\nexport {};',
    [`${EXAMPLE}/src/publish/model/view-config/index.ts`]:
      '// No views yet\nexport {};',
    [`${EXAMPLE}/src/main.ts`]: '// No micro-apps yet\nexport {};',
    [`${EXAMPLE}/package.json`]: '{"name":"empty","dependencies":{}}',
  });
  const example = generateInventory({ root }).examples[0];
  assert.equal(example.views.pages.count, 0);
  assert.equal(example.views.viewConfig.count, 0);
  assert.equal(example.dependencies.microApps.count, 0);
  assert.equal(example.dependencies.workspace.hasDeclarations, false);
  assert.equal(example.acceptance.status, 'not_run');
});

test('an existing empty example directory is not treated as an accepted or zero-view example', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, EXAMPLE), { recursive: true });
  const before = snapshot(root);
  const example = generateInventory({ root }).examples[0];
  assert.equal(example.directory.exists, true);
  assert.equal(example.directory.kind, 'directory');
  assert.equal(example.entry.main.exists, false);
  assert.equal(example.views.pages.count, null);
  assert.equal(example.views.viewConfig.count, null);
  assert.equal(example.acceptance.status, 'not_run');
  assert.deepEqual(snapshot(root), before);
});

test('invalid syntax and dynamic configuration remain unknown instead of being counted as zero', (t) => {
  const root = fixture(t, {
    [`${EXAMPLE}/src/publish/pages/index.ts`]:
      'export function getAppViewComponent( {',
    [`${EXAMPLE}/src/publish/model/view-config/index.ts`]:
      'ibiz.hub.config.view.set(getId(), {});',
    [`${EXAMPLE}/src/main.ts`]: 'ctx.registerMicroApps(loadApps());',
    [`${EXAMPLE}/vite.config.ts`]: `
      export default defineConfig(() => ({server: {proxy: {'/api': {target: process.env.API_URL}}}}));`,
    [`${EXAMPLE}/package.json`]: '{not JSON}',
  });
  const example = generateInventory({ root }).examples[0];
  assert.equal(example.views.pages.count, null);
  assert.equal(example.views.viewConfig.count, null);
  assert.equal(example.dependencies.microApps.count, null);
  assert.equal(example.dependencies.endpoints[0].resolution, 'dynamic');
  assert.equal(example.dependencies.endpoints[0].location, 'unknown');
  assert.equal(example.dependencies.endpoints[0].value, null);
  assert.ok(
    example.issues.some((issue) => issue.code === 'invalid-typescript'),
  );
  assert.ok(example.issues.some((issue) => issue.code === 'invalid-json'));
  assert.ok(example.issues.some((issue) => issue.code === 'dynamic-view-id'));
  assert.ok(
    example.issues.some((issue) => issue.code === 'dynamic-micro-apps'),
  );
});

test('workspace aliases and relative dependencies resolve only to packages with actual source', (t) => {
  const files = simpleFiles();
  files[`${EXAMPLE}/package.json`] = JSON.stringify({
    name: 'fixture',
    dependencies: {
      alias: 'workspace:@fixture/core@*',
      relative: 'workspace:../../packages/core',
      '@fixture/types-only': 'workspace:*',
      '@fixture/theme': 'workspace:*',
    },
  });
  files['ibiz-app-hub/packages/types-only/package.json'] =
    '{"name":"@fixture/types-only"}';
  files['ibiz-app-hub/packages/types-only/src/index.d.ts'] =
    'export declare const api: unknown;';
  files['ibiz-app-hub/packages/theme/package.json'] =
    '{"name":"@fixture/theme","files":["style"]}';
  files['ibiz-app-hub/packages/theme/style/global.scss'] = '$color: #fff;';
  const root = fixture(t, files);
  const workspace = generateInventory({ root }).examples[0].dependencies
    .workspace;
  assert.equal(
    workspace.entries.find((entry) => entry.name === 'alias').hasLocalSource,
    true,
  );
  assert.equal(
    workspace.entries.find((entry) => entry.name === 'relative').hasLocalSource,
    true,
  );
  assert.equal(
    workspace.entries.find((entry) => entry.name === '@fixture/types-only')
      .hasLocalSource,
    false,
  );
  const theme = workspace.entries.find(
    (entry) => entry.name === '@fixture/theme',
  );
  assert.equal(theme.hasLocalSource, true);
  assert.equal(
    theme.candidates[0].sourceEvidence.path,
    'ibiz-app-hub/packages/theme/style/global.scss',
  );
});

test('JSON primitives and missing workspace metadata are reported without claiming source availability', (t) => {
  const root = fixture(t, {
    [`${EXAMPLE}/package.json`]: 'null',
    [`${EXAMPLE}/public/extras/json/system-import.json`]: '[]',
    'ibiz-app-hub/examples/quickstart_b/package.json':
      '{"dependencies":{"core":"workspace:*"}}',
  });
  const result = generateInventory({ root });
  const invalid = result.examples[0];
  assert.equal(invalid.package, null);
  assert.equal(invalid.localResources.systemResources.count, null);
  assert.equal(
    invalid.issues.filter((issue) => issue.code === 'invalid-json').length,
    2,
  );
  const workspace = result.examples[1].dependencies.workspace;
  assert.equal(workspace.hasDeclarations, true);
  assert.equal(workspace.hasLocalSource, null);
  assert.equal(workspace.entries[0].hasLocalSource, null);
  assert.equal(workspace.resolutionComplete, false);
});

test('CLI writes --output JSON, supports stdout and never overwrites source or an existing output', (t) => {
  const root = fixture(t, simpleFiles());
  const destination = fixture(t);
  const before = snapshot(root);
  const output = join(destination, 'reports/inventory.json');
  assert.equal(
    execFileSync(process.execPath, [CLI, '--root', root, '--output', output], {
      encoding: 'utf8',
    }),
    '',
  );
  const fromFile = JSON.parse(readFileSync(output, 'utf8'));
  const fromStdout = JSON.parse(
    execFileSync(process.execPath, [CLI, '--root', root, '--output', '-'], {
      encoding: 'utf8',
    }),
  );
  assert.deepEqual(fromFile, fromStdout);
  assert.equal(fromFile.acceptance.status, 'not_run');
  for (const target of [output, join(root, EXAMPLE, 'package.json')]) {
    const result = spawnSync(
      process.execPath,
      [CLI, '--root', root, '--output', target],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EEXIST/);
  }
  const invalid = spawnSync(
    process.execPath,
    [CLI, '--root', root, '--output'],
    { encoding: 'utf8' },
  );
  assert.equal(invalid.status, 1);
  assert.deepEqual(snapshot(root), before);
});
