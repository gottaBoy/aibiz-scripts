import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  inspectPersonSelectRuntime, personSelectDelta, personSelectNativePlan, personSelectOutput,
  personSelectRef, personSelectTree, verifyPersonSelectHostModel,
} from '../prepare-person-select-closeout.mjs';

const workspace = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(workspace, 'plm-web/package.json'));
const ts = require('typescript');
const tree = entries => ({ entries, files: entries.length,
  bytes: entries.reduce((n, row) => n + row.bytes, 0), fingerprint: 'test-only' });
const file = (name, sha256 = '1'.repeat(64), bytes = 4) => ({ path: name, sha256, bytes });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aibiz-person-closeout-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('candidate output must be new, direct, private-artifact scoped and have no symlink ancestry', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, '.artifacts'));
  assert.equal(personSelectOutput(root, '.artifacts/person-select-closeout-test'),
    path.join(root, '.artifacts/person-select-closeout-test'));
  for (const output of ['public/plugins/person-select', '.artifacts/sub/person-select-closeout-test',
    '.artifacts/not-owned', '.artifacts/../outside']) {
    assert.throws(() => personSelectOutput(root, output));
  }
  fs.mkdirSync(path.join(root, '.artifacts/person-select-closeout-test'));
  assert.throws(() => personSelectOutput(root, '.artifacts/person-select-closeout-test'), /new private/);
  const linked = path.join(root, 'link');
  fs.symlinkSync(root, linked);
  assert.throws(() => personSelectOutput(linked, '.artifacts/person-select-closeout-next'), /ancestry/);
});

test('snapshot hashes actual source bytes and excludes caches/generated outputs but rejects source links', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'src/index.ts'), 'export const user = "真实🙂";');
  fs.writeFileSync(path.join(root, 'node_modules/cached.js'), 'existing package');
  fs.writeFileSync(path.join(root, 'dist/stale.js'), 'previous output');
  const before = personSelectTree(root);
  assert.equal(before.files, 1);
  fs.writeFileSync(path.join(root, 'src/index.ts'), 'export const user = "changed";');
  assert.notEqual(personSelectTree(root).fingerprint, before.fingerprint);
  fs.symlinkSync(path.join(root, 'src/index.ts'), path.join(root, 'src/link.ts'));
  assert.throws(() => personSelectTree(root), /dependency links/);
});

test('actual authoritative app and view bind the one 434 plugin and real product member route', () => {
  const app = JSON.parse(fs.readFileSync(path.join(workspace, 'plm/model/PSSYSAPPS/plmweb/PSSYSAPP.json')));
  const view = JSON.parse(fs.readFileSync(path.join(workspace,
    'plm/model/PSSYSAPPS/plmweb/PSAPPDEVIEWS/idea_main_view.json')));
  const refs = fs.readFileSync(path.join(workspace, 'plm-web/tools/plugin-recovery/runtime-plugins.txt'), 'utf8')
    .trim().split(/\r?\n/);
  const result = verifyPersonSelectHostModel(app, view, refs);
  assert.equal(result.field, 'assignee_name');
  assert.equal(result.persistedValueField, 'assignee_id');
  assert.equal(result.params.URL, 'products/${context.product}/product_members/fetch_default');
  const wrong = structuredClone(app);
  wrong.getAllPSAppPFPluginRefs.find(row => row.rTObjectRepo === personSelectRef).rTObjectName = 'FakePlugin';
  assert.throws(() => verifyPersonSelectHostModel(wrong, view, refs));
  assert.throws(() => verifyPersonSelectHostModel(app, view, [...refs.slice(1), refs.at(-1)]));
  const wrongValue = structuredClone(view);
  result.pointer.split('/').slice(1).reduce((node, key) => node[key], wrongValue).valueItemName = 'FOREIGN_ID';
  assert.throws(() => verifyPersonSelectHostModel(app, wrongValue, refs));
  const visibleValue = structuredClone(view);
  result.hiddenValueField.pointer.split('/').slice(1)
    .reduce((node, key) => node[key], visibleValue).hidden = false;
  assert.throws(() => verifyPersonSelectHostModel(app, visibleValue, refs));
});

test('candidate delta contains only the selected plugin, preserves unmatched files and never deletes', () => {
  const candidate = tree([file('index.legacy.js', '2'.repeat(64)), file('style.css'),
    file('assets/images/svg/member.svg')]);
  const baselines = ['public', 'dist'].map(target => ({ target, path: `/existing/${target}`,
    inventory: tree([file('index.legacy.js'), file('style.css'), file('types/index.d.ts')]) }));
  const result = personSelectDelta(candidate, baselines);
  for (const row of result) {
    assert.equal(row.delta.length, 2);
    assert.ok(row.delta.every(item => item.path.startsWith(`plugins/${personSelectRef}/dist/`)));
    assert.deepEqual(row.removed, []);
    assert.ok(row.preserved.some(item => item.path === 'types/index.d.ts'));
    assert.equal(row.metadataRewritten, false);
  }
  assert.throws(() => personSelectDelta(tree([file('plugins/foreign/index.js')]), baselines), /Unexpected/);
  assert.throws(() => personSelectDelta(tree([file('index.html')]), baselines), /Unexpected/);
  assert.throws(() => personSelectDelta(tree([file('assets/images/../../foreign.js')]), baselines), /Unexpected/);
});

test('SystemJS inspection binds real dependency and export surfaces and rejects empty or altered registration', () => {
  const source = 'System.register(["vue","@ibiz-template/runtime"],function(e){return {execute(){e("IBizPersonelSelect",{});e("default",{});}}});';
  const result = inspectPersonSelectRuntime(ts, source);
  assert.deepEqual(result.dependencies, ['vue', '@ibiz-template/runtime']);
  assert.deepEqual(result.exports, ['IBizPersonelSelect', 'default']);
  assert.deepEqual(inspectPersonSelectRuntime(ts,
    source.replace('register([', 'register("IBizPersonelSelect",[')
      .replace(',function(e)', ',(function(e)').replace('}}});', '}}}));')).exports,
  ['IBizPersonelSelect', 'default']);
  assert.throws(() => inspectPersonSelectRuntime(ts, ''), /one real/);
  assert.throws(() => inspectPersonSelectRuntime(ts, source.replace('IBizPersonelSelect', 'ForeignPlugin')));
  assert.throws(() => inspectPersonSelectRuntime(ts, source.replace('"vue"', '"/unbound/runtime.js"')),
    /bare external/);
  assert.throws(() => inspectPersonSelectRuntime(ts, source.replace('["vue"', '[dynamicName')));
});

test('native acceptance plan uses normal host, persistent selection and independent refusals without claiming execution', () => {
  const plan = personSelectNativePlan({ view: 'idea_main_view', field: 'assignee_name',
    persistedValueField: 'assignee_id',
    params: { URL: 'products/${context.product}/product_members/fetch_default', DEPTURL: '/users/fetch_default' } });
  assert.equal(plan.executed, false);
  assert.equal(plan.nativeAcceptance, false);
  assert.equal(plan.fullB02Acceptance, false);
  assert.equal(plan.fullL02Acceptance, false);
  assert.equal(plan.cells.length, 4);
  assert.ok(plan.steps.some(step => /fresh UI login/.test(step)));
  assert.ok(plan.steps.some(step => /abort.*exact editor request/.test(step)));
  assert.ok(plan.steps.some(step => /Readonly.*snapshots/.test(step)));
  assert.ok(plan.forbidden.includes('controller injection'));
});
