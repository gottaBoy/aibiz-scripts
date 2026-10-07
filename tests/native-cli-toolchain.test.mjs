import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));

test('native CLI acquisition, isolated build and regression have project entry points', () => {
  const { scripts } = read('../package.json');
  assert.equal(scripts['fetch:native-cli-source'], 'node fetch-native-cli-source.mjs');
  assert.equal(scripts['build:native-cli-source'], 'node harness-native-cli-source-build.mjs');
  assert.ok(scripts['test:native-cli-source'].includes('tests/fetch-native-cli-source.test.mjs'));
  assert.ok(scripts['test:native-cli-source'].includes('tests/native-cli-source-build.test.mjs'));
  assert.ok(scripts['test:native-cli-source'].includes('tests/native-cli-build-options.test.mjs'));
  assert.ok(scripts['test:native-cli-source'].includes('tests/native-cli-toolchain.test.mjs'));
});

for (const directory of ['native-cli-source', 'native-cli-format']) {
  test(`${directory} tools contain only exact third-party dependencies without scripts`, () => {
    const manifest = read(`../toolchains/${directory}/package.json`);
    const lock = read(`../toolchains/${directory}/package-lock.json`);
    assert.equal(manifest.private, true);
    assert.equal(manifest.scripts, undefined);
    assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
    for (const [name, version] of Object.entries(manifest.dependencies)) {
      assert.ok(!/^@(?:ibiz|ibiz-template|ibizlab)(?:\/|-)/.test(name));
      assert.match(version, /^\d+\.\d+\.\d+$/);
      assert.equal(lock.packages[`node_modules/${name}`].version, version);
    }
    for (const [path, pkg] of Object.entries(lock.packages)) {
      assert.ok(!/node_modules\/@(?:ibiz|ibiz-template|ibizlab)(?:\/|-)/.test(path),
        `Unexpected own package in supplemental toolchain: ${path}`);
      if (path) {
        assert.ok(pkg.resolved.startsWith('https://registry.npmjs.org/'));
        assert.match(pkg.integrity, /^sha512-/);
      }
    }
  });
}

test('formatting resolver cannot expose legacy untyped rimraf to original CLI source', () => {
  const manifest = read('../toolchains/native-cli-format/package.json');
  const lock = read('../toolchains/native-cli-format/package-lock.json');
  assert.equal(manifest.dependencies.rimraf, '5.0.5');
  assert.equal(lock.packages['node_modules/rimraf'].version, '5.0.5');
  assert.equal(lock.packages['node_modules/flat-cache/node_modules/rimraf'].version, '3.0.2');
  assert.equal(lock.packages['node_modules/flat-cache'].dependencies.rimraf, '^3.0.2');
});
