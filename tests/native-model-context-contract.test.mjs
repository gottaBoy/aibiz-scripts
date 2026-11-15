import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  fileURLToPath(new URL('../../vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSAPPS/ModelDesign/PSAPPDEVIEWS',
    import.meta.url)),
);
const require = createRequire(new URL('../../modelingweb/app/package.json', import.meta.url));
const ts = require('typescript');
const views = [
  'PSSystemDashboardView.json',
  'PSSystemDashboardView_SysInfo.json',
  'PSSystemSettingInfoView.json',
];

function prepareCandidate(t) {
  const repository = fileURLToPath(new URL('../../vendor-upstream/ibizmodeling-standard', import.meta.url));
  const patch = fileURLToPath(new URL('../patches/modeling-system-context-20261115.patch', import.meta.url));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'model-context-patch-'));
  t.after(() => fs.rmSync(staging, { recursive: true, force: true }));
  const prefix = 'modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSAPPS/ModelDesign/PSAPPDEVIEWS';
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const originals = new Map();
  for (const name of views) {
    const relative = `${prefix}/${name}`;
    const original = execFileSync('git', ['-C', repository, 'show', `96e9e54e:${relative}`], { env: environment });
    originals.set(relative, JSON.parse(original));
    assert.deepEqual(fs.readFileSync(path.join(root, name)), original,
      'The shared bind source must remain at the unmodified upstream bytes');
    fs.mkdirSync(path.dirname(path.join(staging, relative)), { recursive: true });
    fs.writeFileSync(path.join(staging, relative), original);
  }
  execFileSync('git', ['apply', '--check', patch], { cwd: staging, env: environment });
  execFileSync('git', ['apply', patch], { cwd: staging, env: environment });
  return { staging, originals, environment, patch, prefix,
    read: name => JSON.parse(fs.readFileSync(path.join(staging, prefix, name), 'utf8')) };
}

test('owned patch replays exactly three navigation changes only in a disposable candidate', t => {
  const { staging, originals, environment, patch } = prepareCandidate(t);
  for (const [relative, original] of originals) {
    const expected = structuredClone(original);
    const binding = expected.getPSAppViewNavContexts.find(row => row.key === 'PSSYSTEM');
    assert.equal(binding.value, '2C40DFCD-0DF5-47BF-91A5-C45F810B0001');
    assert.equal(binding.rawValue, true);
    Object.assign(binding, { value: 'pssystemid', rawValue: false });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(staging, relative))), expected);
  }
  assert.throws(() => execFileSync('git', ['apply', '--check', patch], {
    cwd: staging, env: environment, stdio: 'pipe',
  }), 'Already transformed input must not silently be transformed twice');
});

test('candidate system dashboard and settings views inherit the selected logical system context', t => {
  const candidate = prepareCandidate(t);
  for (const name of views) {
    const model = candidate.read(name);
    const contexts = model.getPSAppViewNavContexts?.filter(row => row.key === 'PSSYSTEM') ?? [];
    assert.equal(contexts.length, 1, `${name} must declare one PSSYSTEM navigation context`);
    assert.deepEqual(contexts[0], {
      key: 'PSSYSTEM', name: 'PSSYSTEM', value: 'pssystemid', rawValue: false,
    }, `${name} must bind PSSYSTEM from the selected logical-system record`);
    assert.doesNotMatch(JSON.stringify(model), /2C40DFCD-0DF5-47BF-91A5-C45F810B0001/,
      `${name} must not retain the template PSSYSTEM UUID`);
  }
});

for (const variant of [
  'ibiz-app-hub/packages/runtime',
  'modelingweb/packages-latest/@ibiz-template/runtime',
]) {
  test(`${variant}: actual navigation converter binds candidate data without falling back to a template`, t => {
    const candidate = prepareCandidate(t);
    const file = fileURLToPath(new URL(`../../${variant}/src/utils/nav-params/nav-params.ts`, import.meta.url));
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, { exports, require: name => require(name) });
    for (const name of views) {
      const model = candidate.read(name);
      const bindings = model.getPSAppViewNavContexts.filter(row => row.key === 'PSSYSTEM');
      for (const side of ['a', 'b']) {
        const result = exports.convertNavData(bindings, {}, {
          psdevslnsys: `root-${side}`, pssystemid: `logical-${side}`,
        });
        assert.equal(result.pssystem, `logical-${side}`);
      }
      for (const data of [{}, { psdevslnsys: 'root-only' }]) {
        const result = exports.convertNavData(bindings, {}, data);
        assert.equal(Object.hasOwn(result, 'pssystem'), false,
          'A missing authorized logical-system result is still a bootstrap blocker');
      }
    }
  });
}
