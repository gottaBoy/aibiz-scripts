import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { launchChromium } from '../browser-launch.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const appRequire = createRequire(resolve(workspace, 'modelingweb/app/package.json'));
const browserRequire = createRequire(resolve(workspace, 'ibiz-app-hub/package.json'));
const { chromium } = browserRequire('playwright');
const output = resolve(workspace, `.artifacts/local-console-layout-browser/probe-${randomUUID()}`);
const root = resolve(workspace, 'modelingweb/local-plugins/console-layout');
const resources = new Map(await Promise.all([
  ['/console.mjs', `${root}/dist/console/index.mjs`, 'text/javascript'],
  ['/swagger.mjs', `${root}/dist/swagger/index.mjs`, 'text/javascript'],
  ['/console.css', `${root}/dist/console/style.css`, 'text/css'],
  ['/swagger.css', `${root}/dist/swagger/style.css`, 'text/css'],
  ['/vue.mjs', appRequire.resolve('vue/dist/vue.runtime.esm-browser.js'), 'text/javascript'],
  ['/font.woff2', resolve(workspace,
    'modelingweb/app/dist/assets/font-awesome-4.7.0/fonts/fontawesome-webfont.woff2'), 'font/woff2'],
].map(async ([path, file, type]) => [path, { bytes: await readFile(file), type }])));

const hostRuntime = `
import { reactive } from 'vue';
const providers=new Map();
function eventBus(){
 const listeners=new Map();
 return {
  on(key,fn){if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn)},
  off(key,fn){listeners.get(key)?.delete(fn)},
  emit(key,...args){for(const fn of [...listeners.get(key)||[]])fn(...args)},
  count(key){return listeners.get(key)?.size||0}
 };
}
export const mqtt={evt:eventBus(),client:eventBus(),subscriptions:[],closed:0};
mqtt.client.subscribe=(topic,done)=>{mqtt.subscriptions.push(topic);done(null,[{topic,qos:0}])};
mqtt.client.unsubscribe=()=>{throw Error('shared unsubscribe forbidden')};
mqtt.client.end=()=>{mqtt.closed++};
window.ibiz={
  env:{enableMqtt:true},appData:{mqtttopic:'tenant/project/build'},
  i18n:{getLang:()=> 'en'},hub:{mqtt}
};
export class ViewController{
 constructor(model,context,params,ctx){
  this.model=model;this.context=context;this.params=params;this.ctx=ctx;this.state=reactive({});this.hostCalls=[];
 }
 async onCreated(){this.hostCalls.push('created')}
 async onMounted(){this.hostCalls.push('mounted')}
 async onDestroyed(){this.hostCalls.push('destroyed')}
}
export function registerViewProvider(key,provider){providers.set(key,provider)}
export function provider(key){if(!providers.has(key))throw Error('missing provider '+key);return providers.get(key)()}
`;
const hostView = `
import {defineComponent,h,provide,ref,onMounted,onBeforeUnmount} from 'vue';
export const IBizView=defineComponent({
 name:'IBizView',
 props:{modelData:Object,context:Object,params:Object,provider:Object,modal:Object,state:Object},
 setup(props,{slots}){
  const ctx={};const c=props.provider.createController(props.modelData,props.context,props.params,ctx);
  ctx.view=c;provide('ctx',ctx);
  if(props.modelData.id==='console')window.demo.console=c;else window.demo.swagger=c;
  const created=ref(false);let disposed=false;
  const creating=c.onCreated().then(()=>{if(!disposed)created.value=true});
  onMounted(async()=>{await creating;if(!disposed)await c.onMounted()});
  onBeforeUnmount(()=>{disposed=true;c.onDestroyed()});
  return()=>h('div',{'data-fixture-host-view':props.modelData.id},created.value?slots.default?.():null);
 }
});
`;
const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Independent custom view fixture</title><link rel="icon" href="data:,">
<link rel="stylesheet" href="/console.css"><link rel="stylesheet" href="/swagger.css">
<style>
@font-face{font-family:FontAwesome;src:url("/font.woff2") format("woff2")}
.fa{font-family:FontAwesome;font-style:normal}.fa-pause:before{content:"\\f04c"}
.fa-play:before{content:"\\f04b"}.fa-trash:before{content:"\\f1f8"}.fa-check:before{content:"\\f00c"}
body{margin:0;font:14px sans-serif}#app{padding:12px;max-width:1200px;margin:auto}
[data-fixture-host-view="console"]{height:320px;margin-bottom:16px}
button,input,textarea{font:inherit}button:focus-visible,input:focus-visible{outline:2px solid #18816c}
</style>
<script type="importmap">{"imports":{"vue":"/vue.mjs","@ibiz-template/runtime":"/runtime.mjs","@ibiz-template/vue3-util":"/host-view.mjs"}}</script>
</head><body><div id="app"></div><script type="module">
import {createApp,defineComponent,h,resolveComponent,ref} from 'vue';
import consolePlugin from '/console.mjs';import swaggerPlugin from '/swagger.mjs';
import {mqtt,provider} from '/runtime.mjs';
window.demo={mqtt,ready:false};
const visible=ref(true);
window.demo.hideConsole=()=>{visible.value=false};window.demo.showConsole=()=>{visible.value=true};
window.demo.emit=(topic,content)=>mqtt.evt.emit('message',topic,{type:'CONSOLE',subtype:'builder',content});
const schema={openapi:'3.0.3',info:{title:'Build API',version:'1.0'},
paths:{'/items':{get:{summary:'Inspect items',parameters:[{name:'scope',in:'query'}],
responses:{200:{description:'OK'}}}},'/jobs':{post:{summary:'Start job',
requestBody:{content:{'application/json':{schema:{type:'object'}}}},responses:{201:{description:'Created'}}}}}};
const Root=defineComponent({setup(){return()=>[
 visible.value?h(resolveComponent('AibizConsoleView'),{
 modelData:{id:'console',viewType:'DECUSTOMVIEW'},context:{srfconsoleid:'tenant/build'},
 params:{},provider:provider('VIEW_CUSTOM_CONSOLE_VIEW')}):null,
 h(resolveComponent('AibizSwaggerPreviewView'),{
 modelData:{id:'swagger',viewType:'DECUSTOMVIEW'},context:{},params:{openapi:schema},
 provider:provider('VIEW_CUSTOM_SWAGGER_PREVIEW_VIEW')})
]}});
const app=createApp(Root);app.use(consolePlugin);app.use(swaggerPlugin);app.mount('#app');
window.demo.unmount=()=>app.unmount();window.demo.ready=true;
</script></body></html>`;

test('independent Console/OpenAPI views render actual Vue DOM and preserve errors/disposal on desktop and mobile',
  { timeout: 90_000 }, async t => {
    const report = {
      contract: 'local-console-layout-browser-fixture', status: 'failed',
      boundary: 'Controlled host lifecycle with real Vue DOM, not native modeling runtime/service acceptance',
      originalSourceRecovered: false, nativeCompatibilityVerified: false, acceptedForProduction: false,
      viewports: {},
    };
    await mkdir(output, { recursive: true });
    t.after(async () => {
      report.status = Object.keys(report.viewports).length === 2 &&
        Object.values(report.viewports).every(item => item.status === 'PASS') ? 'passed' : 'failed';
      await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Independent Console/OpenAPI browser report: ${output}/report.json`);
    });
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      response.setHeader('Cache-Control', 'no-store');
      const module = path === '/runtime.mjs' ? hostRuntime : path === '/host-view.mjs' ? hostView : null;
      if (path === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(html);
      } else if (module) {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end(module);
      } else if (resources.has(path)) {
        const resource = resources.get(path);
        response.writeHead(200, { 'Content-Type': resource.type });
        response.end(resource.bytes);
      } else {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end('{"error":"fixture has no schema endpoint"}');
      }
    });
    t.after(() => new Promise(done => {
      server.close(done);
      server.closeAllConnections();
    }));
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchChromium(chromium);
    t.after(() => browser.close());
    for (const [name, viewport] of [
      ['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }],
    ]) {
      await t.test(name, async () => {
        const result = { status: 'FAIL', viewport, errors: [], nonlocalRequests: [], expectedHttpFailures: [] };
        report.viewports[name] = result;
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
        try {
          await context.route('**/*', route => {
            if (new URL(route.request().url()).origin === origin) return route.continue();
            result.nonlocalRequests.push(route.request().url());
            return route.abort();
          });
          const page = await context.newPage();
          page.on('pageerror', error => result.errors.push({ type: 'pageerror', message: error.message, stack: error.stack }));
          page.on('console', message => {
            if (message.type() === 'error') result.errors.push({ type: 'console', message: message.text(), location: message.location() });
          });
          page.on('response', response => {
            if (response.status() >= 400) result.expectedHttpFailures.push({
              url: response.url(), status: response.status(),
            });
          });
          await page.goto(origin);
          await page.waitForFunction(() => window.demo?.ready &&
            window.demo.console?.state.consoleStatus === 'connected' && window.demo.swagger?.state.schemaStatus === 'ready');
          const log = page.getByRole('log');
          await page.evaluate(() => {
            window.demo.emit('other/tenant', 'private-unrelated-log');
            window.demo.emit('tenant/build', '\\x1b[31mbuild-ready\\x1b[0m');
            window.demo.emit('tenant/build', '<img src=x onerror="window.injected=true">');
          });
          await page.waitForFunction(() => document.querySelector('[role="log"]').textContent.includes('build-ready'));
          assert.doesNotMatch(await log.innerText(), /private-unrelated-log/);
          assert.match(await log.innerText(), /<img src=x/);
          assert.equal(await log.locator('img').count(), 0);
          assert.equal(await page.evaluate(() => window.injected), undefined);
          await page.getByRole('searchbox', { name: 'Filter logs' }).fill('build-ready');
          assert.doesNotMatch(await log.innerText(), /<img/);
          await page.getByRole('searchbox', { name: 'Filter logs' }).fill('');
          await page.getByRole('button', { name: 'Pause', exact: true }).click();
          await page.evaluate(() => window.demo.emit('tenant/build', 'paused-discarded'));
          assert.doesNotMatch(await log.innerText(), /paused-discarded/);
          await page.getByRole('button', { name: 'Resume', exact: true }).click();
          await page.getByRole('button', { name: 'Clear logs', exact: true }).click();
          await page.waitForFunction(() => window.demo.console.state.consoleEntries.length === 0);
          await page.evaluate(() => window.demo.emit('tenant/build', 'real-visible-log'));
          await page.waitForFunction(() => document.querySelector('[role="log"]').textContent.includes('real-visible-log'));
          const jobs = page.getByRole('button', { name: 'POST /jobs Start job', exact: true });
          await jobs.click();
          assert.equal(await page.getByRole('heading', { name: 'POST /jobs', exact: true }).count(), 1);
          assert.match(await page.locator('.aibiz-swagger main').innerText(), /Request Body/);
          await page.getByRole('searchbox', { name: 'Filter operations' }).fill('items');
          assert.equal(await jobs.count(), 0);
          await page.getByRole('searchbox', { name: 'Filter operations' }).fill('');
          await page.evaluate(() => window.demo.swagger.setDocument('{}'));
          await page.waitForFunction(() => window.demo.swagger.state.schemaStatus === 'error');
          assert.match(await page.getByRole('alert').innerText(), /Expected a Swagger/);
          await page.getByRole('textbox', { name: 'OpenAPI JSON' }).fill(JSON.stringify({
            openapi: '3.1.0', info: { title: 'User supplied', version: '2' },
            paths: { '/restored': { get: { responses: { 200: { description: 'Recovered' } } } } },
          }));
          await page.getByRole('button', { name: 'Load document', exact: true }).click();
          await page.waitForFunction(() => window.demo.swagger.state.schemaStatus === 'ready');
          assert.equal(await page.getByRole('heading', { name: 'GET /restored', exact: true }).count(), 1);
          result.rendering = await page.evaluate(async () => {
            await document.fonts.ready;
            return {
              horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
              log: document.querySelector('[role="log"]').textContent,
              schemaStatus: window.demo.swagger.state.schemaStatus,
              fontLoaded: [...document.fonts].some(font => font.family === 'FontAwesome' && font.status === 'loaded'),
              consoleHostCalls: window.demo.console.hostCalls,
              swaggerHostCalls: window.demo.swagger.hostCalls,
              topic: window.demo.console.state.consoleTopic,
            };
          });
          assert.equal(result.rendering.horizontalOverflow, false);
          assert.equal(result.rendering.fontLoaded, true);
          assert.deepEqual(result.rendering.consoleHostCalls, ['created', 'mounted']);
          assert.deepEqual(result.rendering.swaggerHostCalls, ['created', 'mounted']);
          assert.equal(result.rendering.topic, 'tenant/build');
          await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
          assert.deepEqual(result.errors, [], 'Initial rendering must have no filtered browser errors');
          await page.evaluate(() => window.demo.swagger.loadUrl('/denied-schema.json'));
          await page.waitForFunction(() => window.demo.swagger.state.schemaStatus === 'error');
          assert.match(await page.getByRole('alert').innerText(), /HTTP request failed: 404/);
          assert.equal(result.expectedHttpFailures.length, 1);
          assert.ok(result.expectedHttpFailures[0].url.endsWith('/denied-schema.json'));
          // Preserve every error. The one intentional HTTP404 browser console diagnostic
          // belongs to the explicit negative fixture, not a filtered runtime success.
          assert.ok(result.errors.every(error => error.type === 'console' &&
            /Failed to load resource.*404/.test(error.message)));
          result.disposal = await page.evaluate(async () => {
            const old = window.demo.console;
            window.demo.hideConsole();
            await new Promise(done => setTimeout(done, 0));
            window.demo.emit('tenant/build', 'after-disposal');
            const result = {
              status: old.state.consoleStatus, listeners: window.demo.mqtt.evt.count('message'),
              closed: window.demo.mqtt.closed, retained: old.state.consoleEntries.map(item => item.text),
            };
            window.demo.showConsole();
            await new Promise(done => setTimeout(done, 0));
            result.remountedStatus = window.demo.console.state.consoleStatus;
            result.remountedListeners = window.demo.mqtt.evt.count('message');
            window.demo.unmount();
            await new Promise(done => setTimeout(done, 0));
            result.finalListeners = window.demo.mqtt.evt.count('message');
            result.finalConnectListeners = window.demo.mqtt.client.count('connect');
            return result;
          });
          assert.equal(result.disposal.status, 'disposed');
          assert.equal(result.disposal.listeners, 0);
          assert.equal(result.disposal.closed, 0);
          assert.ok(!result.disposal.retained.includes('after-disposal'));
          assert.equal(result.disposal.remountedStatus, 'connected');
          assert.equal(result.disposal.remountedListeners, 1);
          assert.equal(result.disposal.finalListeners, 0);
          assert.equal(result.disposal.finalConnectListeners, 0);
          assert.deepEqual(result.nonlocalRequests, []);
          result.status = 'PASS';
        } finally { await context.close(); }
      });
    }
  });
