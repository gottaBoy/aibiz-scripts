import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import {
  buildLocalConsoleLayout, inputNames, pluginRoot,
} from '../../modelingweb/local-plugins/console-layout/build.mjs';
import { loadMigrationContract } from '../harness-modeling-core-audit.mjs';
import { readTree } from '../native-candidate-files.mjs';
import {
  consoleTerminalSelection, swaggerPreviewSelection, readConsoleLayoutReplacements,
  readConsoleTerminalReplacement, readSwaggerPreviewReplacement, verifyConsoleLayoutBuild,
} from '../prepare-native-console-layout-replacements.mjs';

const workspace = resolve(pluginRoot, '../../..');
const require = createRequire(join(workspace, 'modelingweb/app/package.json'));
const ts = require('typescript');
const postcss = require('postcss');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const contract = loadMigrationContract(workspace);
const openapi = {
  openapi: '3.0.3', info: { title: 'Actual explicit schema', version: '1.0' },
  paths: {
    '/items': { parameters: [{ name: 'scope', in: 'query' }], get: {
      summary: '<img src=x onerror=alert(1)>', parameters: [{ name: 'id', in: 'query' }],
      responses: { 200: { description: 'OK' } },
    }, post: { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      responses: { 201: { description: 'Created' } } } },
  },
};
const code = Object.fromEntries(await Promise.all(['console', 'swagger'].map(async variant => [
  variant, {
    system: await readFile(join(pluginRoot, `dist/${variant}/index.system.js`), 'utf8'),
    esm: await readFile(join(pluginRoot, `dist/${variant}/index.mjs`), 'utf8'),
  },
])));

function emitter() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    off(event, fn) { listeners.get(event)?.delete(fn); },
    emit(event, ...args) { for (const fn of [...listeners.get(event) || []]) fn(...args); },
    count(event) { return listeners.get(event)?.size || 0; },
  };
}

function transport({ defer = false } = {}) {
  const client = emitter();
  const acknowledgements = [];
  const subscribed = [];
  const mqtt = { client, evt: emitter(), closed: 0 };
  client.subscribe = (topic, done) => {
    subscribed.push(topic);
    if (defer) acknowledgements.push(done);
    else done(null, [{ topic, qos: 0 }]);
  };
  client.end = () => { mqtt.closed += 1; };
  client.unsubscribe = () => { throw new Error('Shared host subscription must not be removed'); };
  return { mqtt, client, subscribed, acknowledgements };
}

function fixture(variant = 'console', { format = 'system', mqtt, fetchImpl, mounted } = {}) {
  const exported = {};
  const registry = new Map();
  const components = new Map();
  const runtime = {
    i18n: { getLang: () => 'en' },
    env: { enableMqtt: mqtt !== undefined },
    appData: mqtt ? { mqtttopic: 'tenant/project/build' } : {},
    hub: { mqtt },
  };
  class HostViewController {
    constructor(model, context, params, ctx) {
      this.model = model;
      this.context = context;
      this.params = params;
      this.ctx = ctx;
      this.state = {};
      this.hostCalls = [];
    }
    async onCreated() { this.hostCalls.push('created'); }
    async onMounted() { this.hostCalls.push('mounted'); if (mounted) await mounted; }
    async onDestroyed() { this.hostCalls.push('destroyed'); }
  }
  // Controlled lifecycle boundary, not a real app acceptance claim.
  const peers = {
    '@ibiz-template/runtime': {
      ViewController: HostViewController,
      registerViewProvider: (key, provider) => registry.set(key, provider),
    },
    '@ibiz-template/vue3-util': { IBizView: { name: 'IBizView', controlledHostBoundary: true } },
    vue: {
      defineComponent: input => input, h: (type, props, children) => ({ type, props, children }),
      inject: () => { throw new Error('DOM setup needs a real injected host CTX'); },
      nextTick: async () => {}, ref: () => ({}), watch() {}, onBeforeUnmount() {},
    },
  };
  const sandbox = {
    ibiz: runtime, TextEncoder, TextDecoder, URL, Uint8Array, AbortController,
    document: { baseURI: 'http://fixture.local/modeling/' },
    fetch: (...args) => {
      assert.ok(fetchImpl, 'No invented schema request allowed');
      return fetchImpl(...args);
    },
  };
  if (format === 'system') {
    let registrations = 0;
    runInNewContext(code[variant].system, {
      ...sandbox,
      System: { register(dependencies, declare) {
        registrations += 1;
        assert.deepEqual(plain(dependencies).sort(), Object.keys(peers).sort());
        const declaration = declare((name, value) => {
          if (typeof name === 'object') Object.assign(exported, name);
          else exported[name] = value;
          return value;
        });
        declaration.setters.forEach((setter, index) => setter(peers[dependencies[index]]));
        declaration.execute();
      } },
    });
    assert.equal(registrations, 1);
  } else {
    const compiled = ts.transpileModule(code[variant].esm, {
      reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    assert.equal(compiled.diagnostics.length, 0);
    runInNewContext(compiled.outputText, { ...sandbox, exports: exported,
      require(id) { assert.ok(Object.hasOwn(peers, id)); return peers[id]; } });
  }
  exported.default.install({ component: (name, body) => components.set(name, body) });
  const selection = variant === 'console' ? consoleTerminalSelection : swaggerPreviewSelection;
  assert.deepEqual([...registry.keys()], [`VIEW_CUSTOM_${selection.pluginCode}`]);
  const provider = registry.get(`VIEW_CUSTOM_${selection.pluginCode}`)();
  const create = (context = { srfconsoleid: 'tenant/project/build' }, params = {}) =>
    provider.createController({ id: 'real-shaped-custom-view', viewType: 'DECUSTOMVIEW' }, context, params, {});
  return { exported, provider, components, runtime, HostViewController, create };
}

async function workspaceFixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'console-layout-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'modelingweb/local-plugins/console-layout');
  await mkdir(dirname(root), { recursive: true });
  await cp(pluginRoot, root, { recursive: true });
  const app = join(base, 'modelingweb/app');
  await mkdir(app);
  await symlink(join(workspace, 'modelingweb/app/node_modules'), join(app, 'node_modules'));
  const options = { workspace: base, contract };
  const receiptPath = join(root, 'dist/build-receipt.json');
  const mutateReceipt = async change => {
    const receipt = JSON.parse(await readFile(receiptPath));
    change(receipt);
    await writeFile(receiptPath, JSON.stringify(receipt));
  };
  return { base, root, options, mutateReceipt };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

test('reproducible pinned build has seven source inputs, eight actual outputs, and independent identities', async () => {
  const before = readTree(pluginRoot, { jsonOnly: false });
  const { receipt, artifacts } = await buildLocalConsoleLayout({ writeOutputs: false });
  assert.equal(receipt.inputs.length, 7);
  assert.equal(receipt.outputs.length, 8);
  assert.deepEqual(receipt.inputs.map(item => item.path), inputNames);
  assert.equal(receipt.originalSourceRecovered, false);
  assert.equal(receipt.nativeCompatibilityVerified, false);
  assert.equal(receipt.toolchain.typescript.version, '5.3.3');
  assert.equal(receipt.toolchain.rollup.version, '4.9.3');
  const files = new Map(before.contents.map(file => [file.path, file.data]));
  assert.deepEqual(receipt, JSON.parse(files.get('dist/build-receipt.json')));
  for (const [path, data] of artifacts) assert.deepEqual(data, files.get(`dist/${path}`));
  assert.deepEqual(readTree(pluginRoot, { jsonOnly: false }).entries, before.entries);
});

test('readers retain exact source identity and scoped selectors, never whole-package layout replacement', async () => {
  const replacements = await verifyConsoleLayoutBuild({ workspace, contract });
  assert.deepEqual(replacements.map(item => ({
    from: item.plugin.from, to: item.plugin.to, pluginType: item.plugin.pluginType, pluginCode: item.plugin.pluginCode,
  })), [consoleTerminalSelection, swaggerPreviewSelection]);
  assert.deepEqual(readConsoleTerminalReplacement({ workspace, contract }).plugin, replacements[0].plugin);
  assert.deepEqual(readSwaggerPreviewReplacement({ workspace, contract }).plugin, replacements[1].plugin);
  for (const { files, plugin } of replacements) {
    assert.deepEqual(files.entries.map(file => file.path),
      ['index.mjs', 'index.system.js', 'package.json', 'style.css']);
    assert.deepEqual(plugin.supportedPluginCodes, [plugin.pluginCode]);
    for (const flag of ['originalSourceRecovered', 'originalRepositoryAuthenticated',
      'nativeCompatibilityVerified', 'acceptedForProduction']) assert.equal(plugin[flag], false);
    assert.equal(plugin.partialReplacement, true);
    assert.equal(plugin.originalMigrationAcceptance, 'not-satisfied-by-independent-replacement');
  }
});

for (const format of ['system', 'esm']) {
  for (const variant of ['console', 'swagger']) {
    test(`${variant} ${format} exports and provider use host ViewController / IBizView without manual mounting`, async () => {
      const data = fixture(variant, { format });
      const controller = data.create();
      assert.ok(controller instanceof data.HostViewController);
      const component = data.components.get(data.provider.component);
      const props = { modelData: controller.model, context: controller.context, provider: data.provider };
      const forwarded = component.setup(props, { attrs: { onCreated: 'host-event', id: 'host-id' } })();
      assert.equal(forwarded.type.name, 'IBizView');
      assert.equal(forwarded.props.provider, data.provider);
      assert.equal(forwarded.props.onCreated, 'host-event');
      assert.equal(forwarded.props.id, 'host-id');
      assert.equal(typeof forwarded.children.default, 'function');
      await controller.onCreated();
      await controller.onDestroyed();
      assert.deepEqual(controller.hostCalls, ['created', 'destroyed']);
    });
  }
}

test('actual installed host bundles expose every peer import and lifecycle method used by both variants', async () => {
  for (const variant of ['console', 'swagger']) {
    const ast = ts.createSourceFile('index.mjs', code[variant].esm, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length, 0);
    for (const statement of ast.statements.filter(item => ts.isImportDeclaration(item))) {
      const peer = statement.moduleSpecifier.text;
      const imports = statement.importClause.namedBindings.elements.map(item => (item.propertyName || item.name).text);
      const paths = peer === 'vue'
        ? [require.resolve('vue/dist/vue.runtime.esm-browser.js')]
        : ['ibiz-app-hub/packages', 'modelingweb/packages-latest/@ibiz-template'].map(base =>
          join(workspace, base, peer.split('/')[1], 'dist/index.system.min.js'));
      for (const path of paths) {
        const actual = await readFile(path, 'utf8');
        const hostAst = ts.createSourceFile(path, actual, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        assert.equal(hostAst.parseDiagnostics.length, 0);
        const exported = new Set();
        let checker;
        let exportSymbol;
        if (peer !== 'vue') {
          const options = { allowJs: true, noLib: true, noResolve: true, noEmit: true };
          const host = ts.createCompilerHost(options);
          host.getSourceFile = name => name === path ? hostAst : undefined;
          checker = ts.createProgram([path], options, host).getTypeChecker();
          function findRegister(node) {
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
                node.expression.expression.getText(hostAst) === 'System' &&
                node.expression.name.text === 'register') {
              assert.equal(exportSymbol, undefined, 'Exactly one real host System.register expected');
              const declare = node.arguments.find(arg => ts.isFunctionExpression(arg) || ts.isArrowFunction(arg));
              assert.ok(declare?.parameters[0]);
              exportSymbol = checker.getSymbolAtLocation(declare.parameters[0].name);
            }
            ts.forEachChild(node, findRegister);
          }
          findRegister(hostAst);
          assert.ok(exportSymbol, `Missing host System.register export symbol: ${path}`);
        }
        function visit(node) {
          if (checker && ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
              checker.getSymbolAtLocation(node.expression) === exportSymbol) {
            if (ts.isStringLiteral(node.arguments[0])) exported.add(node.arguments[0].text);
            else if (ts.isObjectLiteralExpression(node.arguments[0])) {
              for (const prop of node.arguments[0].properties) {
                if (ts.isPropertyAssignment(prop)) exported.add(prop.name.text);
              }
            }
          }
          if (ts.isExportDeclaration(node) && node.exportClause?.elements) {
            for (const item of node.exportClause.elements) exported.add(item.name.text);
          }
          ts.forEachChild(node, visit);
        }
        visit(hostAst);
        for (const name of imports) assert.ok(exported.has(name), `Missing actual host export ${peer}/${name}`);
      }
    }
  }
  const mqtt = await readFile(join(workspace, 'modelingweb/packages/@ibiz-template/runtime/out/service/mqtt/mqtt.service.js'), 'utf8');
  assert.match(mqtt, /this\.evt\.emit\('message', topic, msg\)/);
  const host = await readFile(join(workspace, 'modelingweb/packages/@ibiz-template/runtime/out/controller/common/view/view.controller.js'), 'utf8');
  for (const method of ['onCreated', 'onMounted', 'onDestroyed']) assert.match(host, new RegExp(`async ${method}\\(`));
  assert.match(host, /this\.handleContextParams\(\)/);
});

test('original model selectors and console navigation calculation are preserved as evidence', async () => {
  const modelRoot = join(workspace,
    'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSAPPS/ModelDesign');
  const app = JSON.parse(await readFile(join(modelRoot, 'PSSYSAPP.json')));
  for (const selection of [consoleTerminalSelection, swaggerPreviewSelection]) {
    assert.ok(app.getAllPSAppPFPluginRefs.some(ref =>
      ref.rTObjectRepo === selection.from && ref.pluginCode === selection.pluginCode &&
      ref.pluginType === selection.pluginType));
  }
  const view = JSON.parse(await readFile(join(modelRoot, 'PSAPPDEVIEWS/PSSysDevBKTaskCustomView.json')));
  assert.ok(view.getPSAppViewNavContexts.some(item => item.key === 'SRFCONSOLEID' &&
    item.value === 'psdevslnsys' && item.rawValue === false));
});

for (const variant of ['console', 'swagger']) {
  test(`${variant} CSS affects only own component selectors, without remote assets or global rules`, async () => {
    const css = await readFile(join(pluginRoot, `src/${variant}.css`), 'utf8');
    const ast = postcss.parse(css);
    let rules = 0;
    ast.walkRules(rule => {
      rules += 1;
      for (const selector of rule.selectors) assert.ok(selector.startsWith(`.aibiz-${variant}`), selector);
    });
    ast.walkAtRules(rule => assert.equal(rule.name, 'media', 'Only nested responsive media rules are allowed'));
    ast.walkDecls(decl => assert.doesNotMatch(decl.value, /url\s*\(/i));
    assert.ok(rules > 10);
    assert.equal(await readFile(join(pluginRoot, `dist/${variant}/style.css`), 'utf8'), css);
  });
}

test('console validates model-computed exact topic, rejects wildcards/control characters and missing identity', () => {
  const { consoleTopic } = fixture().exported;
  assert.equal(consoleTopic({ srfconsoleid: 'tenant/project/build' }), 'tenant/project/build');
  for (const value of [undefined, '', ' ', 'a/#', '+/build', 'x\n', 7, 'x'.repeat(513)]) {
    assert.throws(() => consoleTopic({ srfconsoleid: value }), /context\.srfconsoleid/);
  }
});

test('console filters exact MQTT topic/type, strips ANSI, uses text, and bounds retained logs', async () => {
  const data = transport();
  const fixtureData = fixture('console', { mqtt: data.mqtt });
  const controller = fixtureData.create();
  await controller.onCreated();
  await controller.onMounted();
  assert.equal(controller.state.consoleStatus, 'connected');
  assert.deepEqual(data.subscribed, ['tenant/project/build']);
  data.mqtt.evt.emit('message', 'another/build', { type: 'CONSOLE', content: 'secret' });
  data.mqtt.evt.emit('message', 'tenant/project/build', { type: 'COMMAND', content: 'not a log' });
  data.mqtt.evt.emit('message', 'tenant/project/build', { type: 'CONSOLE', content: {} });
  assert.equal(controller.state.consoleEntries.length, 0);
  data.mqtt.evt.emit('message', 'tenant/project/build', {
    type: 'CONSOLE', subtype: 'builder', content: '\x1b[31m<img onerror=alert(1)>\x1b[0m\n',
  });
  assert.equal(controller.state.consoleEntries[0].text, '<img onerror=alert(1)>\n');
  assert.equal(controller.state.consoleEntries[0].sender, 'builder');
  controller.state.consolePaused = true;
  data.mqtt.evt.emit('message', 'tenant/project/build', { type: 'CONSOLE', content: 'paused' });
  assert.equal(controller.state.consoleEntries.length, 1);
  assert.equal(controller.state.consoleDropped, 1);
  controller.state.consolePaused = false;
  for (let index = 0; index < 1100; index += 1) {
    data.mqtt.evt.emit('message', 'tenant/project/build', { type: 'CONSOLE', content: `line${index}` });
  }
  assert.equal(controller.state.consoleEntries.length, 1000);
  for (let index = 0; index < 100; index += 1) {
    data.mqtt.evt.emit('message', 'tenant/project/build', { type: 'CONSOLE', content: 'a'.repeat(20000) });
  }
  assert.ok(controller.state.consoleEntries.every(entry => entry.text.length <= 16384));
  assert.ok(controller.state.consoleEntries.reduce((size, entry) => size + entry.text.length + entry.sender.length, 0) <= 1024 * 1024);
  controller.clear();
  assert.equal(controller.state.consoleEntries.length, 0);
  assert.equal(controller.state.consoleDropped, 0);
  await controller.onDestroyed();
});

test('console distinguishes disabled local MQTT from an enabled but unavailable host service', () => {
  const { hostMqttAvailability } = fixture().exported;
  const disabled = hostMqttAvailability({
    env: { enableMqtt: false }, appData: {}, hub: {},
  });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.available, false);
  assert.equal(disabled.reason, 'MQTT is disabled in this deployment.');
  const missingTopic = hostMqttAvailability({
    env: { enableMqtt: true }, appData: {}, hub: {},
  });
  assert.equal(missingTopic.enabled, true);
  assert.equal(missingTopic.available, false);
  assert.equal(missingTopic.reason, 'Authenticated application data does not contain an MQTT topic.');
  const deploymentDisabled = hostMqttAvailability({
    env: { enableMqtt: true }, appData: {}, hub: {},
  }, { enableMqtt: false });
  assert.equal(deploymentDisabled.enabled, false);
  assert.equal(deploymentDisabled.reason, 'MQTT is disabled in this deployment.');
  const missingService = hostMqttAvailability({
    env: { enableMqtt: true }, appData: { mqtttopic: 'tenant/project/build' }, hub: {},
  });
  assert.equal(missingService.enabled, true);
  assert.equal(missingService.available, false);
  assert.equal(missingService.reason, 'Authenticated host MQTT service is unavailable.');
});

test('shared console listeners reconnect, separate topics and release without closing/unsubscribing host clients', async () => {
  const data = transport();
  const { create } = fixture('console', { mqtt: data.mqtt });
  const first = create();
  const second = create();
  const other = create({ srfconsoleid: 'other' });
  for (const controller of [first, second, other]) {
    await controller.onCreated();
    await controller.onMounted();
  }
  assert.equal(data.mqtt.evt.count('message'), 2);
  assert.equal(data.client.count('connect'), 2);
  data.mqtt.evt.emit('message', 'other', { type: 'CONSOLE', content: 'isolated' });
  assert.equal(first.state.consoleEntries.length, 0);
  assert.equal(other.state.consoleEntries.length, 1);
  data.client.emit('close');
  assert.equal(first.state.consoleStatus, 'disconnected');
  const before = data.subscribed.length;
  data.client.emit('connect');
  assert.equal(data.subscribed.length, before + 2);
  await first.onDestroyed();
  assert.equal(data.mqtt.evt.count('message'), 2);
  await second.onDestroyed();
  assert.equal(data.mqtt.evt.count('message'), 1);
  await other.onDestroyed();
  assert.equal(data.mqtt.evt.count('message'), 0);
  assert.equal(data.client.count('connect'), 0);
  assert.equal(data.client.count('close'), 0);
  assert.equal(data.client.count('error'), 0);
  assert.equal(data.mqtt.closed, 0);
});

test('console subscription refusal, wrong grant, host error and stale ack remain explicit failures', async () => {
  const data = transport({ defer: true });
  const { create } = fixture('console', { mqtt: data.mqtt });
  const controller = create();
  await controller.onCreated();
  await controller.onMounted();
  data.acknowledgements[0](null, [{ topic: 'tenant/project/build', qos: 128 }]);
  assert.equal(controller.state.consoleStatus, 'error');
  assert.match(controller.state.consoleError, /did not grant/);
  data.client.emit('connect');
  data.acknowledgements[1](null, [{ topic: 'wrong', qos: 0 }]);
  assert.equal(controller.state.consoleStatus, 'error');
  data.client.emit('connect');
  data.acknowledgements[2](new Error('Permission denied'));
  assert.match(controller.state.consoleError, /Permission denied/);
  data.client.emit('connect');
  data.client.emit('error', new Error('Broker failure'));
  data.acknowledgements[3](null, [{ topic: 'tenant/project/build', qos: 0 }]);
  assert.equal(controller.state.consoleStatus, 'error');
  assert.match(controller.state.consoleError, /Broker failure/);
  data.client.emit('connect');
  await controller.onDestroyed();
  data.acknowledgements[4](null, [{ topic: 'tenant/project/build', qos: 0 }]);
  assert.equal(controller.state.consoleStatus, 'disposed');
});

test('console has visible disabled/unavailable states and cannot attach after pending mount disposal', async () => {
  for (const context of [{}, { srfconsoleid: 'valid' }]) {
    const controller = fixture().create(context);
    await controller.onCreated();
    await controller.onMounted();
    assert.equal(controller.state.consoleStatus, context.srfconsoleid ? 'disabled' : 'error');
    assert.match(controller.state.consoleError, context.srfconsoleid ? /disabled in this deployment/ : /context\.srfconsoleid/);
    await controller.onDestroyed();
  }
  const mounted = deferred();
  const data = transport();
  const controller = fixture('console', { mqtt: data.mqtt, mounted: mounted.promise }).create();
  await controller.onCreated();
  const pending = controller.onMounted();
  await controller.onDestroyed();
  mounted.resolve();
  await pending;
  assert.equal(data.subscribed.length, 0);
  assert.equal(data.mqtt.evt.count('message'), 0);
});

test('console localizes its own labels without translating log data or unknown broker errors', () => {
  const fixtureData = fixture();
  fixtureData.runtime.i18n.getLang = () => 'zh-CN';
  const { consoleLabel } = fixtureData.exported;
  assert.equal(consoleLabel('Follow'), '跟随输出');
  assert.equal(consoleLabel('MQTT is disabled in this deployment.'), '当前部署未启用 MQTT，实时日志不可用。');
  assert.equal(consoleLabel('Broker supplied diagnostic'), 'Broker supplied diagnostic');
  fixtureData.runtime.i18n.getLang = () => 'EN_gb';
  assert.equal(consoleLabel('Follow'), 'Follow');
});

test('OpenAPI inspection supports explicit Swagger2/3.0/3.1 with params/responses and no remote ref resolution', () => {
  const { inspectOpenApi } = fixture('swagger').exported;
  for (const version of ['3.0.3', '3.1.0', '2.0']) {
    const input = structuredClone(openapi);
    if (version === '2.0') { delete input.openapi; input.swagger = version; }
    else input.openapi = version;
    const result = inspectOpenApi(input);
    assert.deepEqual(plain(result.operations.map(item => item.id)), ['GET /items', 'POST /items']);
    assert.equal(result.operations[0].parameters.length, 2);
    assert.equal(result.operations[0].responses[200].description, 'OK');
    assert.ok(result.operations[1].requestBody);
  }
});

test('OpenAPI rejects missing/invalid/oversized documents and incomplete operations rather than empty success', () => {
  const { inspectOpenApi } = fixture('swagger').exported;
  for (const input of [undefined, null, [], '{}', 'invalid JSON', { openapi: '9.0', paths: {} },
    { ...openapi, paths: [] }, { ...openapi, paths: { bad: {} } },
    { ...openapi, paths: { '/bad': { get: {} } } }, ' '.repeat(4 * 1024 * 1024 + 1)]) {
    assert.throws(() => inspectOpenApi(input));
  }
});

test('schema URLs reject cross-origin, credentials, fragments and non-HTTP inputs', () => {
  const { sameOriginSchemaUrl } = fixture('swagger').exported;
  assert.equal(sameOriginSchemaUrl('./schema.json', 'http://fixture.local/modeling/'),
    'http://fixture.local/modeling/schema.json');
  for (const url of ['', null, '//evil.test/schema', 'data:application/json,{}',
    'http://user:pass@fixture.local/schema', '/schema#fragment', 'https://fixture.local/schema']) {
    assert.throws(() => sameOriginSchemaUrl(url, 'http://fixture.local/modeling/'));
  }
});

test('missing and ambiguous model schema inputs fail explicitly without guessed endpoint fetches', async () => {
  for (const params of [{}, { openapi, schemaurl: '/schema' }]) {
    const controller = fixture('swagger').create({}, params);
    await controller.onCreated();
    await controller.onMounted();
    assert.equal(controller.state.schemaStatus, 'error');
    assert.ok(controller.state.schemaError.length);
    assert.equal(controller.state.schemaDocument, null);
    await controller.onDestroyed();
  }
});

test('schema fetch uses same-origin credentials, no redirects, JSON body and actual operation evidence', async () => {
  const calls = [];
  const { create } = fixture('swagger', { fetchImpl: async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify(openapi), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } });
  const controller = create({}, { schemaurl: '/schema.json' });
  await controller.onCreated();
  await controller.onMounted();
  assert.equal(controller.state.schemaStatus, 'ready');
  assert.equal(controller.state.schemaDocument.info.title, openapi.info.title);
  assert.equal(controller.state.schemaOperations.length, 2);
  assert.equal(calls[0][0], 'http://fixture.local/schema.json');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[0][1].redirect, 'error');
  const signal = calls[0][1].signal;
  await controller.onDestroyed();
  assert.equal(signal.aborted, false, 'Completed requests do not need an active controller');
});

for (const [name, response] of [
  ['HTTP failure', () => new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })],
  ['non-JSON', () => new Response('{}', { headers: { 'Content-Type': 'text/html' } })],
  ['invalid JSON', () => new Response('invalid', { headers: { 'Content-Type': 'application/json' } })],
  ['oversized declared body', () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '4194305' } })],
  ['oversized streamed body', () => new Response(' '.repeat(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } })],
  ['network exception', () => { throw new Error('fetch broke'); }],
]) {
  test(`schema ${name} is visible, never ready with empty results`, async () => {
    const controller = fixture('swagger', { fetchImpl: async () => response() }).create({}, { schemaurl: '/schema' });
    await controller.onCreated();
    await controller.onMounted();
    assert.equal(controller.state.schemaStatus, 'error');
    assert.ok(controller.state.schemaError.length);
    assert.equal(controller.state.schemaDocument, null);
    assert.equal(controller.state.schemaOperations.length, 0);
    await controller.onDestroyed();
  });
}

test('pending schema fetch is aborted on disposal, and late completion cannot mark destroyed view ready', async () => {
  const pending = deferred();
  let signal;
  const controller = fixture('swagger', { fetchImpl: async (_url, options) => {
    signal = options.signal;
    return pending.promise;
  } }).create({}, { schemaurl: '/schema' });
  await controller.onCreated();
  const mounted = controller.onMounted();
  await new Promise(done => setImmediate(done));
  assert.equal(controller.state.schemaStatus, 'loading');
  await controller.onDestroyed();
  assert.equal(signal.aborted, true);
  pending.resolve(new Response(JSON.stringify(openapi), { headers: { 'Content-Type': 'application/json' } }));
  await mounted;
  assert.equal(controller.state.schemaStatus, 'disposed');
  assert.equal(controller.state.schemaDocument, null);
});

test('explicit document replacement aborts old schema request and wins over stale completion', async () => {
  const pending = deferred();
  let signal;
  const controller = fixture('swagger', { fetchImpl: async (_url, options) => {
    signal = options.signal;
    return pending.promise;
  } }).create();
  await controller.onCreated();
  const loading = controller.loadUrl('/schema');
  controller.setDocument(openapi);
  assert.equal(signal.aborted, true);
  pending.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  await loading;
  assert.equal(controller.state.schemaStatus, 'ready');
  assert.equal(controller.state.schemaDocument.info.title, openapi.info.title);
  await controller.onDestroyed();
});

for (const [name, mutate, pattern] of [
  ['omitted source input', receipt => receipt.inputs.pop(), /source input hashes/],
  ['duplicate source input', receipt => receipt.inputs.push(receipt.inputs[0]), /source input hashes/],
  ['omitted output', receipt => receipt.outputs.pop(), /output hashes/],
  ['wrong TS version', receipt => { receipt.toolchain.typescript.version = '5.2.2'; }, /toolchain/],
  ['wrong Rollup hash', receipt => { receipt.toolchain.rollup.sha256 = '0'.repeat(64); }, /toolchain/],
  ['original source claim', receipt => { receipt.originalSourceRecovered = true; }, /false/],
  ['native acceptance claim', receipt => { receipt.nativeCompatibilityVerified = true; }, /false/],
  ['unscoped layout selector', receipt => receipt.packages[1].supportedPluginCodes.push('DESIGN_INDEX_VIEW'), /selectors/],
  ['forged compiler scope', receipt => { receipt.compilerChecks = 'full native typecheck'; }, /TypeScript isolated/],
  ['undeclared peer', receipt => receipt.runtimeImports.swagger.push('swagger-ui'), /host imports/],
]) {
  test(`reader rejects ${name}`, async t => {
    const data = await workspaceFixture(t);
    await data.mutateReceipt(mutate);
    assert.throws(() => readConsoleLayoutReplacements(data.options), pattern);
  });
}

for (const path of ['src/console.ts', 'src/swagger.css', 'build.mjs', 'dist/console/index.system.js']) {
  test(`reader rejects unrecorded drift at ${path}`, async t => {
    const data = await workspaceFixture(t);
    await writeFile(join(data.root, path), `${await readFile(join(data.root, path), 'utf8')}\n// drift\n`);
    assert.throws(() => readConsoleLayoutReplacements(data.options), /hashes/);
  });
}

test('reader rejects original delivery identity even when attacker refreshes manifest output hash', async t => {
  const data = await workspaceFixture(t);
  const path = 'console/package.json';
  const manifest = JSON.parse(await readFile(join(data.root, 'dist', path)));
  manifest.name = '@ibiz-template-plugin/console-terminal';
  manifest.version = '0.0.3-alpha.87';
  manifest.gitHead = 'f'.repeat(40);
  const bytes = Buffer.from(JSON.stringify(manifest));
  await writeFile(join(data.root, 'dist', path), bytes);
  await data.mutateReceipt(receipt => { receipt.outputs.find(item => item.path === path).sha256 = hash(bytes); });
  assert.throws(() => readConsoleLayoutReplacements(data.options), /delivery manifest/);
});

test('in-memory rebuild rejects forged SystemJS delivery with refreshed output hash and leaves source unchanged', async t => {
  const data = await workspaceFixture(t);
  const path = 'swagger/index.system.js';
  const bytes = Buffer.from(`${await readFile(join(data.root, 'dist', path), 'utf8')}\nthrow Error("forged");\n`);
  await writeFile(join(data.root, 'dist', path), bytes);
  await data.mutateReceipt(receipt => { receipt.outputs.find(item => item.path === path).sha256 = hash(bytes); });
  const before = readTree(data.root, { jsonOnly: false });
  await assert.rejects(verifyConsoleLayoutBuild(data.options), /Recomputed build receipt/);
  assert.deepEqual(readTree(data.root, { jsonOnly: false }).entries, before.entries);
});

test('strict source tree rejects unrecorded file and source/build symlink', async t => {
  const data = await workspaceFixture(t);
  await writeFile(join(data.root, 'src/unused.ts'), 'export const unused = true;\n');
  assert.throws(() => readConsoleLayoutReplacements(data.options), /file set/);
  await assert.rejects(buildLocalConsoleLayout({ root: data.root, writeOutputs: false }), /source file set/);
  await rm(join(data.root, 'src/unused.ts'));
  await rm(join(data.root, 'src/console.ts'));
  await symlink(join(pluginRoot, 'src/console.ts'), join(data.root, 'src/console.ts'));
  assert.throws(() => readConsoleLayoutReplacements(data.options), /Symlink/);
  await assert.rejects(buildLocalConsoleLayout({ root: data.root, writeOutputs: false }), /non-symlink/);
});

for (const path of ['dist', 'dist/console', 'dist/console/index.system.js', 'dist/build-receipt.json']) {
  test(`build rejects output symlink ${path} without changing an external sentinel or existing files`, async t => {
    const data = await workspaceFixture(t);
    const target = join(data.root, path);
    const outside = join(data.base, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'sentinel'), 'private-original');
    await rm(target, { recursive: true });
    await symlink(path.endsWith('.js') || path.endsWith('.json') ? join(outside, 'sentinel') : outside, target);
    await assert.rejects(buildLocalConsoleLayout({ root: data.root }), /Symlink|non-symlink/);
    assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'private-original');
  });
}

test('build rejects hardlinked output before truncating any valid output and cannot escape local source root', async t => {
  const data = await workspaceFixture(t);
  const outside = join(data.base, 'sentinel');
  await writeFile(outside, 'private-original');
  await rm(join(data.root, 'dist/swagger/index.system.js'));
  await link(outside, join(data.root, 'dist/swagger/index.system.js'));
  const before = await readFile(join(data.root, 'dist/console/index.mjs'));
  await assert.rejects(buildLocalConsoleLayout({ root: data.root }), /single-link/);
  assert.equal(await readFile(outside, 'utf8'), 'private-original');
  assert.deepEqual(await readFile(join(data.root, 'dist/console/index.mjs')), before);
  await assert.rejects(buildLocalConsoleLayout({ root: data.root, outputDir: data.base }), /inside/);
});

test('reader rejects missing/ambiguous original mapping and does not relax migration boundary', () => {
  for (const altered of [
    { ...contract, migrationMappings: contract.migrationMappings.filter(item => item.from !== consoleTerminalSelection.from) },
    { ...contract, migrationMappings: [...contract.migrationMappings,
      contract.migrationMappings.find(item => item.from === swaggerPreviewSelection.from)] },
  ]) assert.throws(() => readConsoleLayoutReplacements({ workspace, contract: altered }), /exactly once/);
});
