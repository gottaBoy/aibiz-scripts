import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACE } from './harness-modeling-core-audit.mjs';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

export const runtimeModelRepo = '@ibiz-template-plugin/runtime-model@0.2.2-local.2';
export const runtimeLoaderImport = '@ibiz-template-plugin/runtime-model/loader';
export const runtimeBridgeAsset = `plugins/${runtimeModelRepo}/index.system.js`;
export const pluralizeAsset = 'extras/js/pluralize/8.0.0/index.system.js';
const implementationPath = fileURLToPath(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function runtimeLoaderBridge() {
  // Native import retains Stencil's import.meta.url and relative lazy chunks.
  return Buffer.from([
    'System.register([], function (exports, context) {',
    '  return { execute: async function () {',
    '    const loader = await import(new URL("./loader/index.js", context.meta.url).href);',
    '    if (typeof loader.applyPolyfills !== "function" || typeof loader.defineCustomElements !== "function") {',
    '      throw new Error("Source-built runtime loader contract differs");',
    '    }',
    '    exports(loader);',
    '  } };',
    '});',
    '',
  ].join('\n'));
}

export function modelDesignRuntimeImportMap(importMap) {
  const result = structuredClone(importMap);
  assert.ok(result.imports && typeof result.imports === 'object');
  for (const [name, target] of [
    [runtimeLoaderImport, `../../${runtimeBridgeAsset}`],
    ['pluralize', '../js/pluralize/8.0.0/index.system.js'],
  ]) {
    assert.ok(!Object.hasOwn(result.imports, name) || result.imports[name] === target,
      `Do not silently replace a host import: ${name}`);
    result.imports[name] = target;
  }
  return result;
}

export function modelDesignRuntimeNginx(nginx) {
  const anchor = '    location ^~ /nativeappcode/plugins/ {';
  assert.equal(nginx.split(anchor).length, 2, 'Expected exactly one candidate plugin route');
  return nginx.replace(anchor, [
    `    location ^~ /nativeappcode/plugins/${runtimeModelRepo}/ {`,
    `        alias /opt/aibiz/native-ai-code-runtime-assets/plugins/${runtimeModelRepo}/;`,
    '        add_header Cache-Control no-store;',
    '    }',
    '',
    '    location ^~ /nativeappcode/extras/js/pluralize/8.0.0/ {',
    '        alias /opt/aibiz/native-ai-code-runtime-assets/extras/js/pluralize/8.0.0/;',
    '        add_header Cache-Control no-store;',
    '    }',
    '',
    anchor,
  ].join('\n'));
}

export async function compileNativePluralize({ workspace = WORKSPACE, root } = {}) {
  const directories = new PinnedDirectories();
  let bundle;
  try {
    const parent = directories.open(root);
    const manifest = readPinnedFile(directories, parent, 'package.json');
    const pkg = JSON.parse(manifest.data);
    assert.equal(pkg.name, 'pluralize');
    assert.equal(pkg.version, '8.0.0');
    assert.equal(pkg.main, 'pluralize.js');
    assert.deepEqual(pkg.dependencies ?? {}, {}, 'Pluralize bridge must be dependency-free');
    const input = readPinnedFile(directories, parent, pkg.main);
    const require = createRequire(join(workspace, 'ibiz-app-hub/package.json'));
    const { rollup } = require('rollup');
    const commonjs = require('@rollup/plugin-commonjs');
    const entry = join(root, pkg.main);
    bundle = await rollup({
      input: entry,
      plugins: [
        commonjs(),
        {
          name: 'pinned-pluralize-input',
          load(path) {
            if (path.startsWith('\0')) return null;
            assert.equal(path, entry, 'Unexpected pluralize build input');
            this.addWatchFile(path);
            return input.data.toString();
          },
        },
      ],
      onwarn(warning) { throw new Error(warning.message); },
    });
    const output = await bundle.generate({ format: 'system', compact: true, sourcemap: false });
    assert.equal(output.output.length, 1);
    assert.equal(output.output[0].type, 'chunk');
    assert.deepEqual(output.output[0].imports, [], 'Pluralize bundle must leave no externals');
    assert.deepEqual([...new Set(bundle.watchFiles)].sort(), [entry]);
    assert.deepEqual(readPinnedFile(directories, parent, pkg.main, input.identity).data, input.data);
    assert.deepEqual(readPinnedFile(directories, parent, 'package.json', manifest.identity).data, manifest.data);
    return { data: Buffer.from(output.output[0].code), inputs: [
      { path: entry, bytes: input.data.length, sha256: hash(input.data) },
      { path: join(root, 'package.json'), bytes: manifest.data.length, sha256: hash(manifest.data) },
    ] };
  } finally {
    try { if (bundle) await bundle.close(); }
    finally { directories.close(); }
  }
}

export function replayNativePluralize(options) {
  const script = [
    `import { compileNativePluralize } from ${JSON.stringify(import.meta.url)};`,
    'const result = await compileNativePluralize(JSON.parse(process.argv[1]));',
    'process.stdout.write(JSON.stringify({inputs:result.inputs,data:result.data.toString("base64")}));',
  ].join('\n');
  const result = JSON.parse(execFileSync(process.execPath, [
    '--input-type=module', '--eval', script, JSON.stringify(options),
  ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  return { inputs: result.inputs, data: Buffer.from(result.data, 'base64') };
}

export function modelDesignRuntimeDelivery(replacement, compiled) {
  const { plugin, runtimeFiles, pluralizeFiles } = replacement;
  assert.equal(plugin.consumedRuntime.version, '0.2.2-local.2', 'This bridge pins runtime .2');
  assert.ok(runtimeFiles.entries.some(file => file.path === 'loader/index.js'));
  const directories = new PinnedDirectories();
  let implementation;
  try {
    const path = implementationPath.slice(0, implementationPath.lastIndexOf('/'));
    implementation = readPinnedFile(directories, directories.open(path), 'native-model-design-runtime.mjs').data;
  } finally { directories.close(); }
  return {
    files: [
      ...runtimeFiles.contents.map(file => ({ path: `plugins/${runtimeModelRepo}/${file.path}`, data: file.data })),
      { path: runtimeBridgeAsset, data: runtimeLoaderBridge() },
      ...pluralizeFiles.contents.map(file => ({ path: `extras/js/pluralize/8.0.0/${file.path}`, data: file.data })),
      { path: pluralizeAsset, data: compiled.data },
    ],
    evidence: {
      sourceBuildReport: plugin.sourceBuildReport, runtime: plugin.consumedRuntime,
      runtimeEntries: runtimeFiles.entries, pluralizeEntries: pluralizeFiles.entries,
      bridge: {
        path: runtimeBridgeAsset, sha256: hash(runtimeLoaderBridge()),
        nativeEsmEntry: `plugins/${runtimeModelRepo}/loader/index.js`,
        implementationPath: 'scripts/native-model-design-runtime.mjs', implementationSha256: hash(implementation),
      },
      pluralizeBuild: { delivery: pluralizeAsset, inputs: compiled.inputs, sha256: hash(compiled.data) },
      nativeAccepted: false, acceptedForProduction: false,
    },
  };
}
