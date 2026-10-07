import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { loadMigrationContract, WORKSPACE } from '../harness-modeling-core-audit.mjs';
import { fingerprint, readTree } from '../native-candidate-files.mjs';
import { readStudioThemeReplacements, studioThemeMappings } from '../prepare-native-studio-theme-replacement.mjs';
import { prepareNativeModelCandidate, rewritePluginReferences } from '../prepare-native-model-candidate.mjs';
import { inspectNativeThemeReferences } from '../native-theme-references.mjs';
import { fixtureSnapshot } from './helpers/native-ai-code-source-deps-fixture.mjs';

const sourcePath = 'modelingweb/local-plugins/studio-theme';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (path, value) => {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'native-theme-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const root = join(workspace, sourcePath);
  fs.mkdirSync(dirname(root), { recursive: true });
  fs.cpSync(join(WORKSPACE, sourcePath), root, { recursive: true });
  const contract = structuredClone(loadMigrationContract());
  contract.migrationMappings = [];
  contract.plugins = [];
  for (const app of ['Central', 'ModelDesign']) contract.evidence.applications[app].references = [];
  const models = [];
  for (const app of ['Central', 'ModelDesign']) {
    for (const name of ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json']) {
      const path = `PSSYSAPPS/${app}/${name}`;
      const model = {
        app, name, note: studioThemeMappings[0].from,
        getAllPSAppUIThemes: studioThemeMappings.map((mapping, index) => ({
          themeTag: mapping.tag,
          themeParams: { 'icon-theme': index ? 'true' : 'false',
            ...(index ? {} : { 'theme-package-path': mapping.from }) },
          ...(index ? { themeUrl: mapping.from } : {}),
        })),
        other: {
          'theme-package-path': studioThemeMappings[0].from,
          getAllPSAppUIThemes: [{
            themeUrl: studioThemeMappings[0].from,
            themeParams: { 'theme-package-path': studioThemeMappings[0].from },
          }],
        },
      };
      json(join(workspace, contract.evidence.modelRoot, path), model);
      if (name === 'PSSYSAPP.json') contract.evidence.applications[app].inputSha256 =
        hash(fs.readFileSync(join(workspace, contract.evidence.modelRoot, path)));
      models.push({ path, model });
    }
  }
  json(join(workspace, 'scripts/fixtures/modeling-core-migration-contract.json'), contract);
  fs.copyFileSync(join(WORKSPACE, 'modelingweb/nginx-native.conf'), join(workspace, 'modelingweb/nginx-native.conf'));
  return { workspace, root, contract, models,
    output: join(workspace, '.artifacts/native-model-migration/themes') };
}

function changeJson(path, mutate) {
  const value = JSON.parse(fs.readFileSync(path));
  mutate(value);
  json(path, value);
}

function changeModel(data, app, name, mutate) {
  const path = join(data.workspace, data.contract.evidence.modelRoot, 'PSSYSAPPS', app, name);
  changeJson(path, mutate);
  if (name === 'PSSYSAPP.json') {
    data.contract.evidence.applications[app].inputSha256 = hash(fs.readFileSync(path));
    json(join(data.workspace, 'scripts/fixtures/modeling-core-migration-contract.json'), data.contract);
  }
}

function rehash(data, section, path) {
  changeJson(join(data.root, 'dist/build-receipt.json'), receipt => {
    const file = join(data.root, section === 'outputs' ? 'dist' : '', path);
    receipt[section].find(item => item.path === path).sha256 = hash(fs.readFileSync(file));
  });
}

function changeStyles(data, variant, text) {
  fs.writeFileSync(join(data.root, `src/${variant}.css`), text);
  fs.writeFileSync(join(data.root, `dist/${variant}/style.css`), text);
  rehash(data, 'inputs', `src/${variant}.css`);
  rehash(data, 'outputs', `${variant}/style.css`);
}

test('two independently named theme deliveries bind exact source and build without original recovery claims', t => {
  const data = fixture(t);
  const before = fixtureSnapshot(data.workspace);
  const replacements = readStudioThemeReplacements(data);
  assert.equal(replacements.length, 2);
  for (const [index, { files, plugin }] of replacements.entries()) {
    const mapping = studioThemeMappings[index];
    assert.equal(plugin.from, mapping.from);
    assert.equal(plugin.to, mapping.to);
    assert.equal(plugin.themeTag, mapping.tag);
    assert.equal(plugin.variant, mapping.variant);
    assert.equal(plugin.sourceStatus, 'independent-local-implementation');
    assert.equal(plugin.sourceFingerprint, fingerprint(plugin.sourceInputs).fingerprint);
    assert.equal(plugin.outputFingerprint, files.fingerprint);
    assert.deepEqual(files.entries.map(file => file.path),
      ['index.mjs', 'index.system.js', 'package.json', 'style.css']);
    for (const flag of ['originalSourceRecovered', 'originalRepositoryAuthenticated',
      'nativeCompatibilityVerified', 'acceptedForProduction']) assert.equal(plugin[flag], false);
    assert.equal(plugin.originalMigrationAcceptance, 'not-satisfied-by-independent-replacement');
  }
  assert.deepEqual(fixtureSnapshot(data.workspace), before);
});

test('explicit theme candidate rewrites only native theme fields in all six models', t => {
  const data = fixture(t);
  const originals = fixtureSnapshot(join(data.workspace, data.contract.evidence.modelRoot));
  const source = fixtureSnapshot(data.root);
  const replacements = readStudioThemeReplacements(data);
  const receipt = prepareNativeModelCandidate({ ...data, studioThemeReplacement: true });
  assert.deepEqual(receipt.plugins, replacements.map(item => item.plugin));
  assert.deepEqual(receipt.unresolvedThemeMappings, []);
  assert.deepEqual(receipt.unresolvedMappings, []);
  assert.equal(receipt.acceptedForProduction, false);
  assert.equal(receipt.independentReplacementMappings.length, 2);
  for (const { path, model } of data.models) {
    const candidate = JSON.parse(fs.readFileSync(join(data.output, 'model', path)));
    assert.equal(candidate.note, model.note);
    assert.deepEqual(candidate.other, model.other);
    assert.equal(candidate.getAllPSAppUIThemes[0].themeParams['theme-package-path'], studioThemeMappings[0].to);
    assert.equal(candidate.getAllPSAppUIThemes[1].themeUrl, studioThemeMappings[1].to);
    assert.deepEqual(rewritePluginReferences(candidate,
      new Map(studioThemeMappings.map(item => [item.to, item.from]))).model, model);
    const record = receipt.applications[model.app].files.find(file => file.path === path);
    assert.deepEqual(record.changes.map(item => item.location), [
      '/getAllPSAppUIThemes/0/themeParams/theme-package-path',
      '/getAllPSAppUIThemes/1/themeUrl',
    ]);
    assert.deepEqual(record.unresolvedThemes, []);
  }
  for (const { files, plugin } of replacements) {
    assert.deepEqual(readTree(join(data.output, 'plugins', plugin.to), { jsonOnly: false }).entries, files.entries);
  }
  assert.deepEqual(fixtureSnapshot(join(data.workspace, data.contract.evidence.modelRoot)), originals);
  assert.deepEqual(fixtureSnapshot(data.root), source);
});

test('theme replacement requires explicit selection', t => {
  const data = fixture(t);
  assert.throws(() => prepareNativeModelCandidate(data), /No locally built/);
  assert.equal(fs.existsSync(data.output), false);
});

for (const app of ['Central', 'ModelDesign']) {
  for (const name of ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json']) {
    for (const [index, { variant }] of studioThemeMappings.entries()) {
      for (const kind of ['tag', 'type']) {
        test(`theme candidate validates ${variant} ${kind} in each declaration: ${app}/${name}`, t => {
          const data = fixture(t);
          changeModel(data, app, name, model => {
            const theme = model.getAllPSAppUIThemes[index];
            if (kind === 'tag') theme.themeTag = `wrong_${variant}`;
            else theme.themeParams['icon-theme'] = index ? 'false' : 'true';
          });
          const before = fixtureSnapshot(data.workspace);
          assert.throws(() => prepareNativeModelCandidate({ ...data, studioThemeReplacement: true }),
            new RegExp(`Native theme ${kind} differs.*PSSYSAPPS/${app}/${name.replaceAll('.', '\\.')}`));
          assert.equal(fs.existsSync(data.output), false);
          assert.deepEqual(fixtureSnapshot(data.workspace), before);
        });
      }
    }
  }
}

test('theme candidate rejects a mismatched extra declaration of the same repository before any writes', t => {
  const data = fixture(t);
  changeModel(data, 'Central', 'PSSYSAPP.simple.json', model => {
    const extra = structuredClone(model.getAllPSAppUIThemes[0]);
    extra.themeTag = 'other_dark';
    model.getAllPSAppUIThemes.push(extra);
  });
  const before = fixtureSnapshot(data.workspace);
  assert.throws(() => prepareNativeModelCandidate({ ...data, studioThemeReplacement: true }),
    /Native theme tag differs.*Central\/PSSYSAPP\.simple\.json/);
  assert.equal(fs.existsSync(data.output), false);
  assert.deepEqual(fixtureSnapshot(data.workspace), before);
});

test('theme references bind identical explicit package fields to one declaration and both source locations', () => {
  const repo = studioThemeMappings[0].from;
  const original = { getAllPSAppUIThemes: [{
    themeTag: 'studio_dark', themeUrl: repo,
    themeParams: { 'theme-package-path': repo, 'icon-theme': 'false' },
  }], other: { getAllPSAppUIThemes: [{ themeUrl: 'https://ignored.invalid' }] } };
  const before = structuredClone(original);
  const [reference] = inspectNativeThemeReferences(original);
  assert.equal(reference.repo, repo);
  assert.deepEqual(reference.locations, [
    '/getAllPSAppUIThemes/0/themeParams/theme-package-path',
    '/getAllPSAppUIThemes/0/themeUrl',
  ]);
  assert.deepEqual(reference.themes, [{ tag: 'studio_dark', type: 'COLOR' }]);
  assert.deepEqual(original, before);
});

test('theme candidate preserves consistent dual-field declarations and records both exact rewrites', t => {
  const data = fixture(t);
  changeModel(data, 'Central', 'PSSYSAPP.simple.json', model => {
    model.getAllPSAppUIThemes[0].themeUrl = studioThemeMappings[0].from;
    model.getAllPSAppUIThemes[1].themeParams['theme-package-path'] = studioThemeMappings[1].from;
  });
  const before = fixtureSnapshot(join(data.workspace, data.contract.evidence.modelRoot));
  const receipt = prepareNativeModelCandidate({ ...data, studioThemeReplacement: true });
  const record = receipt.applications.Central.files.find(file => file.path.endsWith('/PSSYSAPP.simple.json'));
  const candidate = JSON.parse(fs.readFileSync(join(data.output, 'model', record.path)));
  for (const [index, mapping] of studioThemeMappings.entries()) {
    assert.equal(candidate.getAllPSAppUIThemes[index].themeUrl, mapping.to);
    assert.equal(candidate.getAllPSAppUIThemes[index].themeParams['theme-package-path'], mapping.to);
  }
  assert.deepEqual(record.changes.map(change => change.location).sort(), [
    '/getAllPSAppUIThemes/0/themeParams/theme-package-path', '/getAllPSAppUIThemes/0/themeUrl',
    '/getAllPSAppUIThemes/1/themeParams/theme-package-path', '/getAllPSAppUIThemes/1/themeUrl',
  ]);
  assert.deepEqual(fixtureSnapshot(join(data.workspace, data.contract.evidence.modelRoot)), before);
  assert.equal(receipt.acceptedForProduction, false);
  assert.ok(receipt.independentReplacementMappings.every(mapping =>
    mapping.originalSourceRecovered === false && mapping.nativeCompatibilityVerified === false));
});

for (const [name, mutate, expected] of [
  ['conflicting explicit packages', theme => { theme.themeUrl = studioThemeMappings[1].from; },
    /Native theme package fields must match/],
  ['remote explicit fallback', theme => { theme.themeUrl = 'https://remote.invalid/theme'; },
    /Native theme packages require/],
  ['invalid explicit primary', theme => {
    theme.themeUrl = theme.themeParams['theme-package-path'];
    theme.themeParams['theme-package-path'] = '';
  }, /Native theme packages require/],
  ['non-string explicit icon type', theme => { theme.themeParams['icon-theme'] = true; },
    /Native theme icon type/],
  ['unknown explicit icon type', theme => { theme.themeParams['icon-theme'] = 'ICON'; },
    /Native theme icon type/],
]) {
  test(`theme inspector and candidate reject ${name} without publishing or modifying evidence`, t => {
    const data = fixture(t);
    changeModel(data, 'Central', 'PSSYSAPP.simple.json', model => mutate(model.getAllPSAppUIThemes[0]));
    const before = fixtureSnapshot(data.workspace);
    const original = JSON.parse(fs.readFileSync(join(data.workspace, data.contract.evidence.modelRoot,
      'PSSYSAPPS/Central/PSSYSAPP.simple.json')));
    assert.throws(() => inspectNativeThemeReferences(original), expected);
    assert.throws(() => prepareNativeModelCandidate({ ...data, studioThemeReplacement: true }), expected);
    assert.equal(fs.existsSync(data.output), false);
    assert.deepEqual(fixtureSnapshot(data.workspace), before);
  });
}

for (const path of ['build.mjs', 'src/index.ts', 'src/color.css', 'src/icon.css', 'package.json',
  'dist/color/style.css', 'dist/icon/style.css', 'dist/color/index.mjs', 'dist/icon/index.system.js']) {
  test(`theme verifier and candidate reject drift in ${path} without writes`, t => {
    const data = fixture(t);
    fs.appendFileSync(join(data.root, path), '\n');
    const before = fixtureSnapshot(data.workspace);
    assert.throws(() => readStudioThemeReplacements(data), /input hashes|output hashes/);
    assert.throws(() => prepareNativeModelCandidate({ ...data, studioThemeReplacement: true }),
      /input hashes|output hashes/);
    assert.equal(fs.existsSync(data.output), false);
    assert.deepEqual(fixtureSnapshot(data.workspace), before);
  });
}

for (const [name, mutate, pattern] of [
  ['claimed original source', receipt => { receipt.originalSourceRecovered = true; }, /source recovery/],
  ['claimed native compatibility', receipt => { receipt.nativeCompatibilityVerified = true; }, /compatibility/],
  ['production acceptance flag', receipt => { receipt.acceptedForProduction = true; }, /receipt fields/],
  ['compiler scope', receipt => { receipt.compilerChecks = 'full application passed'; }, /compiler verification/],
  ['unversioned toolchain', receipt => { delete receipt.toolchain.typescript.version; }, /toolchain record/],
  ['toolchain hash', receipt => { receipt.toolchain.rollup.sha256 = 'invalid'; }, /toolchain hash/],
  ['toolchain version', receipt => { receipt.toolchain.typescript.version = '5.4.0'; }, /5.3.3/],
  ['external imports', receipt => { receipt.runtimeImports = ['remote']; }, /imports/],
  ['source inventory', receipt => { receipt.inputs.pop(); }, /input hashes/],
  ['output inventory', receipt => { receipt.outputs.pop(); }, /output hashes/],
]) {
  test(`theme verifier rejects ${name}`, t => {
    const data = fixture(t);
    changeJson(join(data.root, 'dist/build-receipt.json'), mutate);
    assert.throws(() => readStudioThemeReplacements(data), pattern);
  });
}

for (const [name, text, pattern] of [
  ['unscoped CSS', 'body { color: red; }\n', /stay scoped/],
  ['similar tag', ':root.studio_dark_extra { color: red; }\n', /stay scoped/],
  ['remote CSS', '@import "https://example.invalid/theme.css";\n:root.studio_dark { color: red; }\n', /Remote theme/],
  ['asset URL', ':root.studio_dark { background: url("/remote.png"); }\n', /External theme/],
  ['empty CSS', '/* empty */\n', /cannot be empty/],
  ['font override', '@font-face { font-family: FontAwesome; src: local(Arial); }\n:root.studio_dark { color: red; }\n',
    /Global theme at-rules/],
  ['global animation', '@keyframes global { to { opacity: 0; } }\n:root.studio_dark { color: red; }\n',
    /Global theme at-rules/],
  ['global property', '@property --test { syntax: "<color>"; inherits: false; initial-value: red; }\n:root.studio_dark { color: red; }\n',
    /Global theme at-rules/],
  ['global page', '@page { margin: 0; }\n:root.studio_dark { color: red; }\n', /Global theme at-rules/],
  ['nested font override', '@media screen { @supports (color: red) { @font-face { font-family: FontAwesome; src: local(Arial); } } }\n:root.studio_dark { color: red; }\n',
    /Global theme at-rules/],
  ['vendor animation', '@-webkit-keyframes global { to { opacity: 0; } }\n:root.studio_dark { color: red; }\n',
    /Global theme at-rules/],
  ['unscoped conditional rule', '@media screen { body { color: red; } }\n:root.studio_dark { color: red; }\n',
    /stay scoped/],
  ['top-level declaration', '--global: red;\n:root.studio_dark { color: red; }\n',
    /declarations must belong/],
  ['bare conditional declaration', '@media screen { --global: red; :root.studio_dark { color: red; } }\n',
    /declarations must belong/],
  ['statement conditional', '@media screen;\n:root.studio_dark { color: red; }\n', /Global theme at-rules/],
]) {
  test(`theme verifier and candidate reject ${name} even with refreshed receipt hashes`, t => {
    const data = fixture(t);
    changeStyles(data, 'color', text);
    const before = fixtureSnapshot(data.workspace);
    assert.throws(() => readStudioThemeReplacements(data), pattern);
    assert.throws(() => prepareNativeModelCandidate({ ...data, studioThemeReplacement: true }), pattern);
    assert.equal(fs.existsSync(data.output), false);
    assert.deepEqual(fixtureSnapshot(data.workspace), before);
  });
}

test('theme verifier preserves recursively scoped conditional CSS for both variants without provenance claims', t => {
  const data = fixture(t);
  for (const { variant, tag } of studioThemeMappings) {
    changeStyles(data, variant,
      `@media screen { @supports (color: red) { @container (min-width: 20px) { :root.${tag} { color: red; } } } }\n`);
  }
  const before = fixtureSnapshot(data.workspace);
  const replacements = readStudioThemeReplacements(data);
  assert.deepEqual(replacements.map(item => item.plugin.variant), ['color', 'icon']);
  for (const { files, plugin } of replacements) {
    assert.deepEqual(files.contents.find(file => file.path === 'style.css').data,
      fs.readFileSync(join(data.root, `src/${plugin.variant}.css`)));
    assert.equal(plugin.originalSourceRecovered, false);
    assert.equal(plugin.nativeCompatibilityVerified, false);
    assert.equal(plugin.acceptedForProduction, false);
  }
  assert.deepEqual(fixtureSnapshot(data.workspace), before);
});

for (const [name, text, pattern] of [
  ['static imports', 'import x from "remote"; export default x;\n', /external imports/],
  ['dynamic imports', 'export default { install() { import("remote"); } };\n', /Dynamic theme/],
  ['missing default', 'export const theme = {};\n', /default plugin export/],
]) {
  test(`theme verifier rejects ${name} with refreshed output hashes`, t => {
    const data = fixture(t);
    fs.writeFileSync(join(data.root, 'dist/color/index.mjs'), text);
    rehash(data, 'outputs', 'color/index.mjs');
    assert.throws(() => readStudioThemeReplacements(data), pattern);
  });
}

test('theme verifier rejects source-tree symlinks', t => {
  const data = fixture(t);
  const path = join(data.root, 'src/color.css');
  fs.renameSync(path, `${path}.real`);
  fs.symlinkSync(`${path}.real`, path);
  assert.throws(() => readStudioThemeReplacements(data), /Symlink resource rejected/);
});
