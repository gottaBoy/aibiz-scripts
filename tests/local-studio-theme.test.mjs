import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  cp, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import {
  buildLocalStudioTheme, inputNames, pluginRoot,
} from '../../modelingweb/local-plugins/studio-theme/build.mjs';

const require = createRequire(new URL('../../modelingweb/app/package.json', import.meta.url));
const postcss = require('postcss');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const variants = [
  { directory: 'color', name: '@aibiz/studio-theme', rootClass: 'studio_dark', provide: 'aibiz.studioColorTheme' },
  { directory: 'icon', name: '@aibiz/studio-icon', rootClass: 'studio_icon', provide: 'aibiz.studioIconTheme' },
];
const outputs = variants.flatMap(({ directory }) =>
  ['package.json', 'index.mjs', 'index.system.js', 'style.css'].map(name => `${directory}/${name}`)).sort();
const receipt = JSON.parse(await readFile(join(pluginRoot, 'dist/build-receipt.json'), 'utf8'));
const color = postcss.parse(await readFile(join(pluginRoot, 'src/color.css'), 'utf8'));
const icon = postcss.parse(await readFile(join(pluginRoot, 'src/icon.css'), 'utf8'));
const tokens = new Map();
color.walkDecls(declaration => {
  if (declaration.prop.startsWith('--')) {
    assert.equal(tokens.has(declaration.prop), false, `Duplicate token: ${declaration.prop}`);
    tokens.set(declaration.prop, declaration.value);
  }
});

async function files(root, prefix = '') {
  const paths = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.equal(entry.isSymbolicLink(), false, path);
    if (entry.isDirectory()) paths.push(...await files(root, path));
    else paths.push(path);
  }
  return paths.sort();
}

async function buildFixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'studio-theme-build-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const root = join(workspace, 'modelingweb/local-plugins/studio-theme');
  const app = join(workspace, 'modelingweb/app');
  await mkdir(dirname(root), { recursive: true });
  await cp(pluginRoot, root, { recursive: true });
  await mkdir(app, { recursive: true });
  await symlink(new URL('../../modelingweb/app/node_modules', import.meta.url).pathname,
    join(app, 'node_modules'), 'dir');
  const { buildLocalStudioTheme: build } = await import(pathToFileURL(join(root, 'build.mjs')));
  const outside = join(workspace, 'outside');
  await mkdir(outside);
  const output = join(root, 'dist');
  const names = [...outputs, 'build-receipt.json'].sort();
  const before = new Map(await Promise.all(names.map(async name =>
    [name, await readFile(join(output, name))])));
  return { root, outside, output, names, before, build };
}

async function assertUnchangedOutputs(data, excluded = []) {
  for (const [name, bytes] of data.before) {
    if (!excluded.includes(name)) assert.deepEqual(await readFile(join(data.output, name)), bytes, name);
  }
}

function resolvedToken(name, visiting = new Set()) {
  assert.equal(visiting.has(name), false, `Circular CSS token: ${name}`);
  assert.ok(tokens.has(name), `Missing CSS token: ${name}`);
  const value = tokens.get(name);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (!reference) return value;
  return resolvedToken(reference[1], new Set([...visiting, name]));
}

function luminance(value) {
  assert.match(value, /^#[\da-f]{6}$/i);
  const rgb = [1, 3, 5].map(index => {
    const channel = parseInt(value.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('studio bundle retains the exact editable source and dual-variant delivery file sets', async () => {
  assert.deepEqual([...inputNames].sort(),
    ['build.mjs', 'package.json', 'src/color.css', 'src/icon.css', 'src/index.ts']);
  assert.deepEqual(await files(pluginRoot),
    [...inputNames, 'README.md', 'dist/build-receipt.json', ...outputs.map(path => `dist/${path}`)].sort());
  assert.deepEqual(await files(join(pluginRoot, 'dist')), ['build-receipt.json', ...outputs].sort());
  for (const { directory } of variants) {
    assert.deepEqual(await readFile(join(pluginRoot, 'dist', directory, 'style.css')),
      await readFile(join(pluginRoot, 'src', `${directory}.css`)));
  }
});

test('build receipt binds real input, output and pinned toolchain hashes without original or native claims', async () => {
  assert.equal(receipt.schemaVersion, 1);
  assert.deepEqual(receipt.package, { name: '@aibiz/studio-theme-bundle', version: '0.1.0' });
  assert.equal(receipt.sourceStatus, 'independent-local-implementation');
  assert.equal(receipt.originalSourceRecovered, false);
  assert.equal(receipt.nativeCompatibilityVerified, false);
  assert.deepEqual(receipt.runtimeImports, []);
  assert.match(receipt.compilerChecks, /strict isolated-plugin/);
  assert.deepEqual(receipt.inputs.map(input => input.path).sort(), [...inputNames].sort());
  assert.deepEqual(receipt.outputs.map(output => output.path).sort(), outputs);
  for (const input of receipt.inputs) {
    assert.equal(input.sha256, hash(await readFile(join(pluginRoot, input.path))), input.path);
  }
  for (const output of receipt.outputs) {
    assert.equal(output.sha256, hash(await readFile(join(pluginRoot, 'dist', output.path))), output.path);
  }
  const rollupRequire = createRequire(require.resolve('vite'));
  assert.deepEqual(receipt.toolchain, {
    typescript: {
      version: '5.3.3', sha256: hash(await readFile(require.resolve('typescript'))),
    },
    rollup: {
      version: '4.9.3', sha256: hash(await readFile(rollupRequire.resolve('rollup'))),
    },
  });
});

test('manifests use independent identities and real relative SystemJS stylesheet and ESM entries', async () => {
  const root = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'));
  assert.equal(root.name, '@aibiz/studio-theme-bundle');
  assert.equal(root.version, '0.1.0');
  assert.equal(root.private, true);
  assert.deepEqual(root.devDependencies, { rollup: '4.9.3', typescript: '5.3.3' });
  assert.deepEqual(root.peerDependencies, { '@ibiz-template/runtime': '0.7.41-alpha.86', vue: '^3.3.8' });
  for (const { directory, name } of variants) {
    const manifest = JSON.parse(await readFile(join(pluginRoot, 'dist', directory, 'package.json'), 'utf8'));
    assert.deepEqual(manifest, {
      name, version: '0.1.0', private: true, type: 'module',
      main: 'index.mjs', module: 'index.mjs', system: 'index.system.js',
      styles: ['style.css'],
      exports: { '.': './index.mjs', './style.css': './style.css' },
      files: ['index.mjs', 'index.system.js', 'style.css'],
      peerDependencies: root.peerDependencies,
    });
  }
});

for (const variant of variants) {
  test(`${variant.directory} ESM and SystemJS default plugins provide accurate metadata without touching runtime or DOM`, async () => {
    const esm = await import(pathToFileURL(join(pluginRoot, 'dist', variant.directory, 'index.mjs')));
    const exported = {};
    let registrations = 0;
    runInNewContext(await readFile(join(pluginRoot, 'dist', variant.directory, 'index.system.js'), 'utf8'), {
      System: {
        register(dependencies, declare) {
          registrations += 1;
          assert.equal(dependencies.length, 0);
          const context = declare((name, value) => {
            if (typeof name === 'object') {
              Object.assign(exported, name);
              return name;
            }
            exported[name] = value;
            return value;
          });
          assert.equal(context.setters?.length ?? 0, 0);
          assert.equal(typeof context.execute, 'function');
          context.execute();
        },
      },
      document: new Proxy({}, { get() { throw new Error('Plugin must not mutate theme classes or inject CSS'); } }),
      ibiz: new Proxy({}, { get() { throw new Error('Theme must not patch framework state'); } }),
    });
    assert.equal(registrations, 1);
    for (const plugin of [esm, exported]) {
      assert.deepEqual(Object.keys(plugin).sort(), ['default', 'metadata']);
      assert.deepEqual(JSON.parse(JSON.stringify(plugin.metadata)), {
        name: variant.name, version: '0.1.0', variant: variant.directory, rootClass: variant.rootClass,
        sourceStatus: 'independent-local-implementation',
        originalSourceRecovered: false, nativeCompatibilityVerified: false,
      });
      assert.equal(Object.isFrozen(plugin.metadata), true);
      assert.equal(Object.isFrozen(plugin.default), true);
      const calls = [];
      const app = { provide(key, value) { assert.equal(this, app); calls.push([key, value]); } };
      plugin.default.install(app);
      plugin.default.install(app);
      assert.deepEqual(calls, [[variant.provide, plugin.metadata], [variant.provide, plugin.metadata]]);
    }
  });
}

test('color CSS is substantive, strictly root-class scoped and covers actual iBiz color/editor tokens', async () => {
  assert.deepEqual(color.nodes.map(node => node.type), ['rule']);
  assert.equal(color.first.selector, ':root.studio_dark');
  assert.equal(color.first.nodes.every(node => node.type === 'decl'), true);
  const declarations = new Map(color.first.nodes.map(node => [node.prop, node.value]));
  assert.equal(declarations.get('color-scheme'), 'dark');
  assert.equal(declarations.get('color'), 'var(--ibiz-color-text-0)');
  assert.equal(declarations.get('background-color'), 'var(--ibiz-color-bg-0)');
  const upstream = postcss.parse(await readFile(new URL(
    '../../modelingweb/packages/@ibiz-template/web-theme/es/theme/theme/dark/dark-theme.css', import.meta.url), 'utf8'));
  const editor = postcss.parse(await readFile(new URL(
    '../../modelingweb/packages/@ibiz-template/web-theme/es/theme/var.css', import.meta.url), 'utf8'));
  upstream.walkDecls(declaration => {
    if (declaration.prop.startsWith('--ibiz-color-')) assert.ok(tokens.has(declaration.prop), declaration.prop);
  });
  editor.walkDecls(declaration => {
    if (declaration.prop.startsWith('--ibiz-editor-') && declaration.prop.endsWith('-color')) {
      assert.ok(tokens.has(declaration.prop), declaration.prop);
    }
  });
  for (const [name, value] of tokens) {
    assert.equal(value.includes('!important'), false, name);
    for (const reference of value.matchAll(/var\((--[\w-]+)\)/g)) resolvedToken(reference[1]);
  }
});

test('foreground and primary/status text have usable contrast on independent dark surfaces', () => {
  for (const foreground of ['text-0', 'text-1', 'text-2', 'text-3']) {
    for (const background of ['bg-0', 'bg-1']) {
      assert.ok(contrast(resolvedToken(`--ibiz-color-${foreground}`),
        resolvedToken(`--ibiz-color-${background}`)) >= 4.5, `${foreground} on ${background}`);
    }
  }
  const colors = ['primary', 'success', 'warning', 'danger', 'info'];
  assert.equal(new Set(colors.map(color => resolvedToken(`--ibiz-color-${color}`))).size, colors.length);
  for (const color of colors) {
    for (const state of ['', '-hover', '-active']) {
      assert.ok(contrast(resolvedToken(`--ibiz-color-${color}${state}-text`),
        resolvedToken(`--ibiz-color-${color}${state}`)) >= 4.5, `${color}${state}`);
    }
  }
});

test('ElementPlus backgrounds, states and input variables reference the scoped iBiz tokens', () => {
  for (const [suffix, token] of [
    ['color-primary', 'color-primary'], ['color-success', 'color-success'],
    ['color-warning', 'color-warning'], ['color-danger', 'color-danger'], ['color-error', 'color-danger'],
    ['bg-color', 'color-bg-0'], ['bg-color-overlay', 'color-bg-3'],
    ['text-color-primary', 'color-text-0'], ['text-color-placeholder', 'color-text-3'],
    ['border-color', 'color-border'], ['fill-color-blank', 'color-bg-1'],
    ['disabled-bg-color', 'color-disabled-bg'],
    ['input-bg-color', 'editor-default-bg-color'],
    ['input-border-color', 'editor-default-border-color'],
    ['input-focus-border-color', 'editor-focus-border-color'],
  ]) {
    assert.equal(tokens.get(`--el-${suffix}`), `var(--ibiz-${token})`, suffix);
  }
  for (const [name, value] of tokens) {
    if (name.startsWith('--el-')) assert.match(value, /^var\(--ibiz-[\w-]+\)$/);
  }
});

test('the two scoped icon glyphs match the already available FontAwesome 4.7 font', async () => {
  const expected = new Map([
    [':root.studio_icon .studio-icon.pssysapp::before', '.fa-desktop:before'],
    [':root.studio_icon .studio-icon.psdeserviceapi::before', '.fa-exchange:before'],
  ]);
  const font = postcss.parse(await readFile(new URL(
    '../../modelingweb/app/public/assets/font-awesome-4.7.0/css/font-awesome.min.css', import.meta.url), 'utf8'));
  const fontRules = new Map();
  font.walkRules(rule => {
    for (const selector of rule.selectors) fontRules.set(selector, rule);
  });
  const actual = new Map();
  icon.walkRules(rule => {
    for (const selector of rule.selectors) {
      assert.ok(expected.has(selector), `Unscoped or unrelated icon: ${selector}`);
      const declarations = actual.get(selector) ?? new Map();
      rule.walkDecls(declaration => declarations.set(declaration.prop, declaration.value));
      actual.set(selector, declarations);
    }
  });
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort());
  for (const [selector, fontSelector] of expected) {
    const fontContent = fontRules.get(fontSelector).nodes.find(node => node.prop === 'content').value;
    const declarations = actual.get(selector);
    assert.equal(declarations.get('font-family'), 'FontAwesome');
    assert.equal(declarations.get('content'), fontContent);
    assert.equal(declarations.get('display'), 'inline-block');
    assert.equal(declarations.get('font-weight'), 'normal');
    assert.equal(declarations.get('font-style'), 'normal');
    assert.equal(declarations.get('line-height'), '1');
  }
  assert.ok(font.nodes.some(node => node.type === 'atrule' && node.name === 'font-face' &&
    node.nodes.some(declaration => declaration.prop === 'font-family' && declaration.value === "'FontAwesome'")));
});

test('local CSS has no global font override, imports, network URLs or unscoped declarations', () => {
  for (const stylesheet of [color, icon]) {
    stylesheet.walkAtRules(rule => assert.fail(`Unexpected at-rule: ${rule.name}`));
    stylesheet.walkDecls(declaration => {
      assert.equal(declaration.parent.type, 'rule');
      assert.doesNotMatch(declaration.value, /url\s*\(/i);
      for (const selector of declaration.parent.selectors) {
        assert.ok(selector.startsWith(stylesheet === color ? ':root.studio_dark' : ':root.studio_icon '));
      }
    });
  }
});

test('read-only strict builds are reproducible and do not change local source, delivery or receipt', async () => {
  const paths = await files(pluginRoot);
  const before = await Promise.all(paths.map(path => readFile(join(pluginRoot, path))));
  assert.deepEqual(await buildLocalStudioTheme({ writeOutputs: false }), receipt);
  assert.deepEqual(await files(pluginRoot), paths);
  assert.deepEqual(await Promise.all(paths.map(path => readFile(join(pluginRoot, path)))), before);
});

test('build refuses output outside the plugin and non-boolean write flags', async () => {
  for (const outputDir of [pluginRoot, '/tmp/studio-theme-output', join(pluginRoot, '../outside')]) {
    await assert.rejects(buildLocalStudioTheme({ outputDir }), /inside the local plugin/);
  }
  await assert.rejects(buildLocalStudioTheme({ writeOutputs: 'false' }), /must be boolean/);
});

for (const [name, path, dangling] of [
  ['output directory', '', false],
  ['output ancestor', 'nested/dist', false],
  ['dangling output directory', '', true],
  ['dangling output ancestor', 'nested/dist', true],
]) {
  test(`build rejects a ${name} symlink without creating or changing outside artifacts`, async t => {
    const data = await buildFixture(t);
    const alias = join(data.root, 'output-alias');
    const sentinel = join(data.outside, 'sentinel');
    await writeFile(sentinel, 'unchanged');
    const target = dangling ? join(data.outside, 'missing') : data.outside;
    await symlink(target, alias, 'dir');
    await assert.rejects(data.build({ outputDir: path ? join(alias, path) : alias }), /non-symlink/);
    assert.equal(await readFile(sentinel, 'utf8'), 'unchanged');
    assert.deepEqual(await readdir(data.outside), ['sentinel']);
    await assertUnchangedOutputs(data);
  });
}

for (const variant of variants) {
  for (const dangling of [false, true]) {
    test(`build rejects ${dangling ? 'dangling ' : ''}${variant.directory} output symlinks before changing the other variant`,
      async t => {
        const data = await buildFixture(t);
        await rm(join(data.output, variant.directory), { recursive: true });
        const sentinel = join(data.outside, 'sentinel');
        await writeFile(sentinel, 'unchanged');
        await symlink(dangling ? join(data.outside, 'missing') : data.outside,
          join(data.output, variant.directory), 'dir');
        await assert.rejects(data.build({ outputDir: data.output }), /non-symlink/);
        await assertUnchangedOutputs(data, outputs.filter(name => name.startsWith(`${variant.directory}/`)));
        assert.equal(await readFile(sentinel, 'utf8'), 'unchanged');
        assert.deepEqual(await readdir(data.outside), ['sentinel']);
      });
  }
}

for (const name of [...outputs, 'build-receipt.json']) {
  for (const kind of ['symlink', 'hardlink']) {
    test(`build rejects ${kind} ${name} before overwriting any sibling or link target`, async t => {
      const data = await buildFixture(t);
      const destination = join(data.output, name);
      const sentinel = join(data.outside, 'sentinel');
      await writeFile(sentinel, 'unchanged');
      await rm(destination);
      await (kind === 'symlink' ? symlink(sentinel, destination) : link(sentinel, destination));
      await assert.rejects(data.build({ outputDir: data.output }), /non-symlink, single-link regular file/);
      assert.equal(await readFile(sentinel, 'utf8'), 'unchanged');
      await assertUnchangedOutputs(data, [name]);
      assert.deepEqual(await readdir(data.outside), ['sentinel']);
    });
  }
}

test('build rejects a dangling receipt symlink before changing either complete variant', async t => {
  const data = await buildFixture(t);
  await rm(join(data.output, 'build-receipt.json'));
  await symlink(join(data.outside, 'missing'), join(data.output, 'build-receipt.json'));
  await assert.rejects(data.build({ outputDir: data.output }), /non-symlink, single-link regular file/);
  await assertUnchangedOutputs(data, ['build-receipt.json']);
  assert.deepEqual(await readdir(data.outside), []);
});

for (const name of ['color/style.css', 'icon/package.json', 'build-receipt.json']) {
  test(`build rejects non-regular ${name} before changing sibling outputs`, async t => {
    const data = await buildFixture(t);
    await rm(join(data.output, name));
    await mkdir(join(data.output, name));
    await assert.rejects(data.build({ outputDir: data.output }), /single-link regular file/);
    await assertUnchangedOutputs(data, [name]);
    assert.deepEqual(await readdir(join(data.output, name)), []);
  });
}

test('safe build creates nested output and reproducibly replaces both complete regular variants and receipt', async t => {
  const data = await buildFixture(t);
  const source = await Promise.all(inputNames.map(name => readFile(join(data.root, name))));
  const outputDir = join(data.root, 'nested', 'build', 'dist');
  const first = await data.build({ outputDir });
  assert.deepEqual(first, receipt);
  assert.deepEqual(await files(outputDir), data.names);
  const expected = await Promise.all(data.names.map(name => readFile(join(outputDir, name))));
  for (const name of data.names) await writeFile(join(outputDir, name), `previous-${name}`);
  assert.deepEqual(await data.build({ outputDir }), first);
  assert.deepEqual(await Promise.all(data.names.map(name => readFile(join(outputDir, name)))), expected);
  assert.deepEqual(await Promise.all(inputNames.map(name => readFile(join(data.root, name)))), source);
  await assertUnchangedOutputs(data);
});
