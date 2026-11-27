import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { patchScssCollectionOrder, stylesheetGraphOrder } from '../fixtures/frontend-scss-order-patch.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageRequire = createRequire(path.join(workspace, 'ibiz-app-hub/components/ibiz-next-vue3/package.json'));
const cliRequire = createRequire(packageRequire.resolve('@ibiz-template/cli/package.json'));
const coreRequire = createRequire(cliRequire.resolve('@ibiz-template/cli-core/package.json'));
const pluginPath = coreRequire.resolve('rollup-plugin-scss');
const pluginRequire = createRequire(pluginPath);
const original = fs.readFileSync(pluginPath, 'utf8');

test('the single static entry determines order, retaining shared styles only once through cycles', () => {
  const graph = {
    entry: { isEntry: true, importedIds: ['first', 'second'] },
    first: { importedIds: ['shared', 'red.scss'] },
    second: { importedIds: ['shared', 'blue.scss'] },
    shared: { importedIds: ['first', 'base.scss'] },
    'base.scss': {}, 'red.scss': {}, 'blue.scss': {},
  };
  assert.deepEqual(stylesheetGraphOrder(['blue.scss', 'second', 'entry', 'shared', 'first'],
    id => graph[id], { 'blue.scss': '', 'red.scss': '', 'base.scss': '' }),
  ['base.scss', 'red.scss', 'blue.scss']);
  assert.throws(() => stylesheetGraphOrder(['first'], id => graph[id], {}), /One reviewed/);
  assert.throws(() => stylesheetGraphOrder(['entry'], id => graph[id], { 'unreachable.scss': '' }),
    /outside/);
});

test('bundled lazy-module styles follow all static styles, retaining declared dynamic graph order', () => {
  const graph = {
    entry: { isEntry: true, importedIds: ['first', 'base.scss'], dynamicallyImportedIds: ['lazy-a', 'lazy-b'] },
    first: { importedIds: ['red.scss'] },
    'lazy-a': { importedIds: ['shared.scss', 'a.scss'], dynamicallyImportedIds: ['nested'] },
    'lazy-b': { importedIds: ['shared.scss', 'b.scss'] },
    nested: { importedIds: ['nested.scss'], dynamicallyImportedIds: ['lazy-a'] },
    'base.scss': {}, 'red.scss': {}, 'shared.scss': {}, 'a.scss': {}, 'b.scss': {}, 'nested.scss': {},
  };
  const styles = Object.fromEntries(['nested.scss', 'b.scss', 'a.scss', 'shared.scss', 'base.scss', 'red.scss']
    .map(name => [name, '']));
  assert.deepEqual(stylesheetGraphOrder(Object.keys(graph).reverse(), id => graph[id], styles),
    ['red.scss', 'base.scss', 'shared.scss', 'a.scss', 'b.scss', 'nested.scss']);
});

function factory(source) {
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`,
    { process, console, Buffer })(pluginRequire, module, module.exports);
  return module.exports;
}

async function compile(source, completionOrder) {
  const stylesheet = factory(source);
  const plugin = stylesheet({ sass: coreRequire('sass'), outputStyle: 'compressed', failOnError: true });
  const sources = {
    '/fixture/red.scss': '.same { color: red; }',
    '/fixture/blue.scss': '.same { color: blue; }',
  };
  for (const id of completionOrder) await plugin.transform.call({}, sources[id], id);
  const graph = {
    '/fixture/index.ts': { isEntry: true, importedIds: ['/fixture/red.scss', '/fixture/blue.scss'] },
    '/fixture/red.scss': {}, '/fixture/blue.scss': {},
  };
  const emitted = [];
  await plugin.generateBundle.call({
    getModuleIds: () => Object.keys(graph).reverse()[Symbol.iterator](),
    getModuleInfo: id => graph[id],
    emitFile: value => emitted.push(value),
  }, {});
  assert.equal(emitted.length, 1);
  return emitted[0].source;
}

test('the real cached collector races with transform order; source graph repair preserves cascade order', async () => {
  const forward = ['/fixture/red.scss', '/fixture/blue.scss'];
  const backward = [...forward].reverse();
  const first = await compile(original, forward);
  const second = await compile(original, backward);
  assert.notEqual(first, second, 'Original collector must expose the actual ordering defect');
  const patched = patchScssCollectionOrder(original);
  const repairedFirst = await compile(patched, forward);
  const repairedSecond = await compile(patched, backward);
  assert.equal(repairedFirst, repairedSecond);
  assert.equal(repairedFirst, '.same{color:red}.same{color:blue}',
    'The later source import remains the later cascade rule');
  assert.throws(() => patchScssCollectionOrder('different upstream implementation'), /Unexpected/);
});
