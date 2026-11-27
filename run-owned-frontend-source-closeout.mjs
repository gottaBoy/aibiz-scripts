#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { patchScssCollectionOrder } from './fixtures/frontend-scss-order-patch.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const excluded = new Set(['node_modules', 'dist', 'out', 'es', 'lib', '.git', '.artifacts', 'target']);
const rootSupportFiles = ['package.json', 'tsconfig.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  '.eslintrc.cjs', '.eslintignore', '.prettierrc.yaml', '.stylelintrc.yaml', '.editorconfig', 'LICENSE'];
export const frontendSourcePackages = Object.freeze({
  core: 'packages/core',
  runtime: 'packages/runtime',
  'model-helper': 'packages/model-helper',
  'vue3-util': 'packages/vue3-util',
  'vue3-components': 'components/ibiz-next-vue3',
  devtool: 'plugins/ibiz-template-devtools',
  'web-theme': 'components/web-theme',
});

export function ownedFrontendOutput(value, root = workspace) {
  assert.equal(typeof value, 'string');
  const output = path.resolve(root, value);
  assert.equal(path.dirname(output), path.join(root, '.artifacts'));
  assert.match(path.basename(output), /^d01-frontend-source-[a-z0-9][a-z0-9-]{0,69}$/);
  assert.equal(fs.existsSync(output), false, 'A new private build directory is required');
  for (let directory = path.dirname(output); ; directory = path.dirname(directory)) {
    const stat = fs.lstatSync(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    if (path.dirname(directory) === directory) break;
  }
  return output;
}

export function sourceTree(root, { ignore = excluded } = {}) {
  const entries = [];
  const visit = (directory, prefix = '') => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignore.has(item.name) || item.name.endsWith('.tsbuildinfo')) continue;
      const relative = path.posix.join(prefix, item.name);
      const filename = path.join(directory, item.name);
      assert.ok(!item.isSymbolicLink(), `Source symlink requires separate review: ${relative}`);
      if (item.isDirectory()) visit(filename, relative);
      else {
        assert.ok(item.isFile(), 'Only regular source files may enter a build snapshot');
        const bytes = fs.readFileSync(filename);
        entries.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) });
      }
    }
  };
  visit(root);
  return { files: entries.length, bytes: entries.reduce((sum, row) => sum + row.bytes, 0),
    fingerprint: sha(json(entries)), entries };
}

function write(root, relative, bytes) {
  assert.ok(relative && !path.isAbsolute(relative) && !relative.split('/').includes('..'));
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
}

function copyTree(source, target, inventory, { ignore = excluded } = {}) {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const entry of inventory.entries) {
    const bytes = fs.readFileSync(path.join(source, entry.path));
    assert.equal(sha(bytes), entry.sha256, 'Source changed before it entered the snapshot');
    write(target, entry.path, bytes);
  }
  assert.deepEqual(sourceTree(target, { ignore }), inventory);
}

function packageRoot(resolver, name) {
  let directory = path.dirname(resolver.resolve(name));
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest)).name === name) return directory;
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `Package root missing: ${name}`);
    directory = parent;
  }
}

export function compareFrontendOutputs(first, second) {
  const bytewise = first.entries.length === second.entries.length &&
    first.entries.every((entry, index) => entry.path === second.entries[index].path &&
      entry.sha256 === second.entries[index].sha256 && entry.bytes === second.entries[index].bytes);
  return { bytewise, first: first.fingerprint, second: second.fingerprint,
    files: first.entries.length, differences: [...new Set([
      ...first.entries.map(entry => entry.path), ...second.entries.map(entry => entry.path),
    ])].filter(relative => {
      const a = first.entries.find(entry => entry.path === relative);
      const b = second.entries.find(entry => entry.path === relative);
      return a?.sha256 !== b?.sha256 || a?.bytes !== b?.bytes;
    }) };
}

function cachedInputs(roots) {
  const entries = [], directories = new Set();
  const visit = filename => {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(filename);
      entries.push({ path: filename, link: fs.readlinkSync(filename), resolved: target });
      visit(target);
    } else if (stat.isDirectory()) {
      const actual = fs.realpathSync(filename);
      if (directories.has(actual)) return;
      directories.add(actual);
      for (const entry of fs.readdirSync(actual).sort()) {
        if (['.git', '.artifacts', '.cache'].includes(entry)) continue;
        visit(path.join(actual, entry));
      }
    } else {
      assert.ok(stat.isFile(), 'Dependency inputs must be regular files or explicit links');
      const bytes = fs.readFileSync(filename);
      entries.push({ path: filename, bytes: bytes.length, sha256: sha(bytes) });
    }
  };
  roots.forEach(visit);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { files: entries.filter(entry => entry.sha256).length, links: entries.filter(entry => entry.link).length,
    bytes: entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
    fingerprint: sha(json(entries)), entries };
}

async function executeBuild(plan, pass) {
  assert.ok(['first', 'second'].includes(pass));
  const output = plan.output;
  const run = path.join(output, pass);
  const work = path.join(run, 'workspace/ibiz-app-hub');
  const report = { contract: 'owned-complete-framework-source-build-v1', pass,
    startedAt: new Date().toISOString(), packages: [], status: 'building',
    currentSourceSnapshot: true, sourceRepository: 'ibiz-app-hub',
    thirdPartyDependencySourcesRebuilt: false, toolchainSourcesRebuilt: false,
    repairedPrivateCssCollector: true, upstreamToolDistributionsModified: false };
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  report.isolation = { noNewPrivs: /^NoNewPrivs:\s+1$/m.test(status),
    seccompMode2: /^Seccomp:\s+2$/m.test(status) };
  assert.ok(report.isolation.noNewPrivs && report.isolation.seccompMode2,
    'The full build must run beneath the existing offline guard');
  const journal = event => {
    fs.appendFileSync(path.join(output, `${pass}-journal.private.jsonl`),
      `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, { mode: 0o600 });
    console.log(json({ pass, ...event }).trim());
  };
  const roots = new Map(Object.values(frontendSourcePackages).map(relative => [
    fs.realpathSync(path.join(plan.workspace, 'ibiz-app-hub', relative)),
    path.join(work, relative),
  ]));
  const linkDependencies = (source, target) => {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const filename = path.join(source, entry.name);
      const destination = path.join(target, entry.name);
      if ((entry.name.startsWith('@') || entry.name === '.bin') && entry.isDirectory()) {
        linkDependencies(filename, destination);
      }
      else {
        const actual = fs.realpathSync(filename);
        fs.symlinkSync(roots.get(actual) ?? actual, destination);
      }
    }
  };
  const command = (name, program, args, cwd) => {
    const result = spawnSync(program, args, {
      cwd, env: process.env, encoding: 'utf8', timeout: 8 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const bytes = Buffer.from(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    write(output, `${pass}/commands/${name}.private.log`, bytes);
    const evidence = { program, args, exitCode: result.status, signal: result.signal,
      outputSha256: sha(bytes), timeout: result.error?.code === 'ETIMEDOUT' };
    assert.ok(!result.error && !result.signal && result.status === 0,
      `Canonical package command failed: ${name}; inspect its private command log`);
    return evidence;
  };
  try {
    fs.mkdirSync(work, { recursive: true, mode: 0o700 });
    for (const record of plan.sources) {
      copyTree(record.snapshot, path.join(work, path.relative(
        path.join(output, 'snapshot/ibiz-app-hub'), record.snapshot)), record.inventory);
    }
    for (const relative of rootSupportFiles) {
      write(work, relative, fs.readFileSync(path.join(output, 'snapshot/ibiz-app-hub', relative)));
    }
    linkDependencies(path.join(plan.workspace, 'ibiz-app-hub/node_modules'), path.join(work, 'node_modules'));
    for (const relative of Object.values(frontendSourcePackages)) {
      linkDependencies(path.join(plan.workspace, 'ibiz-app-hub', relative, 'node_modules'),
        path.join(work, relative, 'node_modules'));
    }
    for (const [name, relative] of Object.entries(frontendSourcePackages)) {
      const bin = path.join(work, relative, 'node_modules/.bin/ibiz-temp');
      if (!fs.existsSync(bin)) continue;
      fs.unlinkSync(bin);
      fs.symlinkSync(path.join(output, 'toolchain', name, 'cli/dist/bin.js'), bin);
    }
    // The canonical CLI resolves Babel presets from its configured package root.
    const babel = path.join(work, 'components/ibiz-next-vue3/node_modules/@babel');
    fs.mkdirSync(babel, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(path.join(babel, 'preset-env'))) {
      fs.symlinkSync(path.join(plan.workspace,
        'ibiz-app-hub/node_modules/.pnpm/@babel+preset-env@7.27.2_@babel+core@7.27.4/node_modules/@babel/preset-env'),
      path.join(babel, 'preset-env'));
    }
    for (const [name, relative] of Object.entries(frontendSourcePackages)) {
      journal({ stage: 'package-start', name });
      const root = path.join(work, relative);
      const item = { name, source: relative, status: 'building', outputs: null, commands: [] };
      report.packages.push(item);
      for (const record of plan.sources) {
        assert.deepEqual(sourceTree(record.snapshot), record.inventory, 'Build source snapshot changed');
      }
      const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
      item.canonicalBuildScript = packageJson.scripts.build;
      item.declarationCommandExplicit = /(?:vue-)?tsc/.test(packageJson.scripts.build);
      item.commands.push(command(name, plan.npm, ['run', 'build'], root));
      item.outputs = sourceTree(path.join(root, 'dist'), { ignore: new Set() });
      assert.ok(item.outputs.files > 0, 'Canonical build must emit nonempty distribution files');
      item.declarations = ['out', 'es'].filter(directory => fs.existsSync(path.join(root, directory)))
        .map(directory => ({ directory, inventory: sourceTree(path.join(root, directory), { ignore: new Set() }) }));
      fs.mkdirSync(path.join(run, 'packages'), { recursive: true, mode: 0o700 });
      copyTree(path.join(root, 'dist'), path.join(run, 'packages', name), item.outputs);
      item.status = 'built';
      journal({ stage: 'package-finish', name, outputs: item.outputs.files });
    }
    report.status = 'built-not-published';
  } catch (error) {
    report.status = 'failed';
    report.failure = { name: error.name, message: error.message };
    const current = report.packages.at(-1);
    if (current?.status === 'building') current.status = 'failed';
  } finally {
    report.finishedAt = new Date().toISOString();
    write(output, `${pass}-report.private.json`, json(report));
  }
  return report;
}

export async function runOwnedFrontendSourceCloseout({ output, root = workspace } = {}) {
  root = path.resolve(root);
  output = ownedFrontendOutput(output, root);
  fs.mkdirSync(output, { mode: 0o700 });
  const plan = { contract: 'owned-framework-complete-source-build-plan-v1',
    workspace: root, output, sources: [], originalDistributions: [], tools: [],
    importMap: path.join(root, 'modelingweb/app/public/extras/json/system-import.json') };
  const report = { contract: 'owned-framework-complete-source-closeout-v1',
    startedAt: new Date().toISOString(), status: 'preparing', component: 'app-framework',
    packages: Object.keys(frontendSourcePackages), sourceBuildComplete: false, offlineReproducible: false,
    fullD01Acceptance: false, fullD02Acceptance: false, fullD03Acceptance: false, fullO01Acceptance: false,
    published: false, dockerOperations: 0, apiOperations: 0 };
  const bind = filename => {
    const bytes = fs.readFileSync(filename);
    return { path: filename, bytes: bytes.length, sha256: sha(bytes) };
  };
  const execute = fileURLToPath(import.meta.url);
  const executed = fs.readFileSync(execute);
  write(output, 'executed-runner.private.mjs', executed);
  write(output, 'fixtures/frontend-scss-order-patch.mjs',
    fs.readFileSync(path.join(root, 'scripts/fixtures/frontend-scss-order-patch.mjs')));
  const journal = event => {
    fs.appendFileSync(path.join(output, 'journal.private.jsonl'),
      `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, { mode: 0o600 });
    console.log(json(event).trim());
  };
  try {
    for (const [name, relative] of [...Object.entries(frontendSourcePackages), ['theme', 'packages/theme']]) {
      const source = path.join(root, 'ibiz-app-hub', relative);
      const inventory = sourceTree(source);
      const snapshot = path.join(output, 'snapshot/ibiz-app-hub', relative);
      copyTree(source, snapshot, inventory);
      plan.sources.push({ name, source, snapshot, inventory });
      const dist = path.join(source, 'dist');
      if (fs.existsSync(dist)) plan.originalDistributions.push({ path: dist,
        inventory: sourceTree(dist, { ignore: new Set() }) });
    }
    for (const relative of rootSupportFiles) {
      write(output, `snapshot/ibiz-app-hub/${relative}`,
        fs.readFileSync(path.join(root, 'ibiz-app-hub', relative)));
    }
    const appRequire = createRequire(path.join(root, 'modelingweb/app/package.json'));
    const hubRequire = createRequire(path.join(root, 'ibiz-app-hub/package.json'));
    const viteRequire = createRequire(path.join(packageRoot(appRequire, 'vite'), 'package.json'));
    for (const [name, resolver] of [
      ['vite', appRequire], ['esbuild', viteRequire], ['typescript', appRequire],
      ['@vitejs/plugin-vue', appRequire], ['@vitejs/plugin-vue-jsx', appRequire],
      ['sass', appRequire], ['@rollup/plugin-node-resolve', hubRequire],
    ]) {
      const directory = packageRoot(resolver, name);
      plan.tools.push({ name, root: directory, inventory: sourceTree(directory,
        { ignore: new Set(['node_modules']) }) });
    }
    const esbuildRequire = createRequire(path.join(packageRoot(viteRequire, 'esbuild'), 'package.json'));
    const esbuildBinary = esbuildRequire.resolve(`@esbuild/${process.platform}-${process.arch}/bin/esbuild`);
    plan.npm = path.join(path.dirname(process.execPath), 'npm');
    plan.inputFiles = [
      plan.importMap, ...rootSupportFiles.map(relative => path.join(root, 'ibiz-app-hub', relative)),
      path.join(root, 'modelingweb/app/package.json'), path.join(root, 'modelingweb/app/pnpm-lock.yaml'),
      process.execPath, execute, esbuildBinary, plan.npm,
      path.join(root, 'scripts/fixtures/frontend-scss-order-patch.mjs'),
    ].map(bind);
    plan.privateToolchain = [];
    plan.cssOrderingRepairs = [];
    fs.mkdirSync(path.join(output, 'toolchain'), { recursive: true, mode: 0o700 });
    fs.symlinkSync(path.join(root, 'ibiz-app-hub/node_modules/.pnpm/node_modules'),
      path.join(output, 'toolchain/node_modules'));
    for (const packageName of ['vue3-util', 'vue3-components', 'devtool', 'web-theme']) {
      const packageRequire = createRequire(path.join(root, 'ibiz-app-hub', frontendSourcePackages[packageName], 'package.json'));
      const cli = path.dirname(packageRequire.resolve('@ibiz-template/cli/package.json'));
      const cliRequire = createRequire(path.join(cli, 'package.json'));
      const core = path.dirname(cliRequire.resolve('@ibiz-template/cli-core/package.json'));
      const coreRequire = createRequire(path.join(core, 'package.json'));
      const scss = path.dirname(coreRequire.resolve('rollup-plugin-scss/package.json'));
      assert.equal(JSON.parse(fs.readFileSync(path.join(scss, 'package.json'))).version, '4.0.1');
      const overrides = new Map([
        ['@ibiz-template/cli-core', path.join(output, 'toolchain', packageName, 'cli-core')],
        ['rollup-plugin-scss', path.join(output, 'toolchain', packageName, 'scss')],
      ]);
      for (const [name, original] of [['cli', cli], ['cli-core', core], ['scss', scss]]) {
        const target = path.join(output, 'toolchain', packageName, name);
        const inventory = sourceTree(original, { ignore: new Set(['node_modules']) });
        copyTree(original, target, inventory, { ignore: new Set(['node_modules']) });
        const resolver = createRequire(path.join(original, 'package.json'));
        const manifest = JSON.parse(fs.readFileSync(path.join(original, 'package.json')));
        for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
          const actual = resolver.resolve.paths(dependency)?.map(directory => path.join(directory, dependency))
            .find(directory => fs.existsSync(path.join(directory, 'package.json')));
          if (!actual) continue;
          const link = path.join(target, 'node_modules', dependency);
          fs.mkdirSync(path.dirname(link), { recursive: true, mode: 0o700 });
          fs.symlinkSync(overrides.get(dependency) ?? fs.realpathSync(actual), link);
        }
        plan.privateToolchain.push({ packageName, name, original, target, before: inventory });
      }
      const plugin = path.join(output, 'toolchain', packageName, 'scss/index.cjs.js');
      const originalPlugin = fs.readFileSync(plugin, 'utf8');
      fs.writeFileSync(plugin, patchScssCollectionOrder(originalPlugin), { mode: 0o600 });
      fs.chmodSync(path.join(output, 'toolchain', packageName, 'cli/dist/bin.js'), 0o700);
      plan.cssOrderingRepairs.push({ contract: 'source-static-import-order-scss-collector-v1', packageName,
        upstreamPackage: 'rollup-plugin-scss@4.0.1', beforeSha256: sha(originalPlugin),
        afterSha256: sha(fs.readFileSync(plugin)), source: 'scripts/fixtures/frontend-scss-order-patch.mjs',
        cascadeOrder: 'Static importedIds in depth-first source order, then deferred dynamicallyImportedIds graphs in declaration order; shared and cyclic modules visited once',
        outputSorting: false, sharedToolCacheModified: false });
    }
    for (const entry of plan.privateToolchain) {
      entry.after = sourceTree(entry.target, { ignore: new Set(['node_modules']) });
    }
    plan.dependencyRoots = [path.join(root, 'ibiz-app-hub/node_modules')];
    for (const relative of Object.values(frontendSourcePackages)) {
      plan.dependencyRoots.push(path.join(root, 'ibiz-app-hub', relative, 'node_modules'));
    }
    journal({ stage: 'cached-build-input-inventory-start' });
    plan.cachedDependencyInputs = cachedInputs(plan.dependencyRoots);
    journal({ stage: 'cached-build-input-inventory-finish', files: plan.cachedDependencyInputs.files,
      bytes: plan.cachedDependencyInputs.bytes });
    const offline = JSON.parse(fs.readFileSync(path.join(root, 'scripts/records/aibiz-offline-implementation-20261122.json')));
    plan.guard = { ...offline.networkIsolation.wrapperBinary,
      path: path.join(root, offline.networkIsolation.wrapperBinary.path) };
    assert.equal(bind(plan.guard.path).sha256, plan.guard.sha256, 'Existing offline guard changed');
    write(output, 'plan.private.json', json(plan));
    journal({ stage: 'source-snapshot-ready', packages: Object.keys(frontendSourcePackages).length,
      sources: plan.sources.reduce((sum, source) => sum + source.inventory.files, 0) });
    const build = async pass => {
      for (const name of ['home', 'tmp', 'cache']) fs.mkdirSync(path.join(output, pass, name), { recursive: true, mode: 0o700 });
      const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: path.join(output, pass, 'home'), TMPDIR: path.join(output, pass, 'tmp'),
        XDG_CACHE_HOME: path.join(output, pass, 'cache'), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
        NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=8192',
        npm_config_offline: 'true', npm_config_cache: path.join(output, pass, 'cache/npm') };
      const log = fs.openSync(path.join(output, `${pass}-build.private.log`), 'wx', 0o600);
      let child;
      journal({ stage: 'build-start', pass });
      try {
        await new Promise((resolve, reject) => {
          child = spawn(plan.guard.path, [process.execPath, path.join(output, 'executed-runner.private.mjs'),
            '--internal-build', path.join(output, 'plan.private.json'), '--pass', pass], {
            cwd: path.join(output, pass), env, stdio: ['ignore', log, log],
          });
          const progress = setInterval(() => journal({ stage: 'build-running', pass, pid: child.pid }), 25000);
          const timeout = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000);
          child.once('error', error => { clearInterval(progress); clearTimeout(timeout); reject(error); });
          child.once('close', (code, signal) => {
            clearInterval(progress); clearTimeout(timeout);
            code === 0 ? resolve() : reject(new Error(`Full source build ${pass} failed (exit ${code}, signal ${signal})`));
          });
        });
      } finally { fs.closeSync(log); }
      journal({ stage: 'build-finish', pass, pid: child?.pid });
      return JSON.parse(fs.readFileSync(path.join(output, `${pass}-report.private.json`)));
    };
    report.first = await build('first');
    assert.equal(report.first.status, 'built-not-published');
    report.second = await build('second');
    assert.equal(report.second.status, 'built-not-published');
    report.outputComparison = compareFrontendOutputs(
      sourceTree(path.join(output, 'first/packages'), { ignore: new Set() }),
      sourceTree(path.join(output, 'second/packages'), { ignore: new Set() }),
    );
    const allGenerated = pass => {
      const entries = [];
      for (const item of report[pass].packages) {
        for (const directory of ['dist', 'out', 'es', 'lib']) {
          const base = path.join(output, pass, 'workspace/ibiz-app-hub', item.source, directory);
          if (!fs.existsSync(base)) continue;
          entries.push(...sourceTree(base, { ignore: new Set() }).entries
            .map(row => ({ ...row, path: `${item.name}/${directory}/${row.path}` })));
        }
      }
      entries.sort((a, b) => a.path.localeCompare(b.path));
      return { entries, fingerprint: sha(json(entries)) };
    };
    report.allGeneratedOutputComparison = compareFrontendOutputs(allGenerated('first'), allGenerated('second'));
    report.sourceBuildComplete = report.first.packages.length === 7 && report.second.packages.length === 7;
    const ts = createRequire(path.join(root, 'ibiz-app-hub/package.json'))('typescript');
    const importMap = JSON.parse(fs.readFileSync(plan.importMap));
    report.systemEntryBindings = report.first.packages.map(item => {
      const packageManifest = JSON.parse(fs.readFileSync(path.join(output, 'snapshot/ibiz-app-hub', item.source, 'package.json')));
      const filename = path.join(output, 'first/packages', item.name, 'index.system.min.js');
      const bytes = fs.readFileSync(filename);
      const source = ts.createSourceFile(filename, bytes.toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      assert.equal(source.parseDiagnostics.length, 0);
      const dependencies = [];
      const visit = node => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(source) === 'System' && node.expression.name.text === 'register') {
          const array = node.arguments.find(argument => ts.isArrayLiteralExpression(argument));
          assert.ok(array, 'SystemJS entry must declare its dependency array');
          for (const element of array.elements) {
            assert.ok(ts.isStringLiteral(element), 'SystemJS dependency must be a literal');
            dependencies.push(element.text);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return { name: packageManifest.name, packageVersion: packageManifest.version, path: filename,
        sha256: sha(bytes), dependencies, currentImportMapContainsPackage: Object.hasOwn(importMap.imports, packageManifest.name),
        dependenciesWithoutMapEntry: dependencies.filter(name => !Object.hasOwn(importMap.imports, name)) };
    });
    report.offlineReproducible = report.outputComparison.bytewise && report.allGeneratedOutputComparison.bytewise;
    report.status = report.offlineReproducible ? 'complete-own-source-built-twice-not-published'
      : 'complete-own-source-build-output-difference';
  } catch (error) {
    report.status = 'failed';
    report.failure = { name: error.name, message: error.message };
  } finally {
    report.sourceInputsUnchanged = plan.sources.every(record => {
      try { assert.deepEqual(sourceTree(record.source), record.inventory); return true; } catch { return false; }
    });
    report.originalDistributionsUnchanged = plan.originalDistributions.every(record => {
      try { assert.deepEqual(sourceTree(record.path, { ignore: new Set() }), record.inventory); return true; } catch { return false; }
    });
    report.toolsUnchanged = plan.tools.every(record => {
      try { assert.deepEqual(sourceTree(record.root, { ignore: new Set(['node_modules']) }), record.inventory); return true; } catch { return false; }
    });
    report.cachedDependenciesUnchanged = !plan.cachedDependencyInputs || (() => {
      try { assert.deepEqual(cachedInputs(plan.dependencyRoots), plan.cachedDependencyInputs); return true; } catch { return false; }
    })();
    report.privateToolchainUnchanged = (plan.privateToolchain ?? []).every(record => {
      try { assert.deepEqual(sourceTree(record.target, { ignore: new Set(['node_modules']) }), record.after); return true; } catch { return false; }
    });
    report.executionSourceUnchanged = sha(fs.readFileSync(execute)) === sha(executed);
    report.inputsUnchanged = (plan.inputFiles ?? []).every(record => bind(record.path).sha256 === record.sha256);
    report.finishedAt = new Date().toISOString();
    report.remaining = ['recursive third-party dependency source rebuilds', 'Node/compiler/toolchain source rebuilds',
      'complete application and plugin source builds', 'source-to-image-and-served-byte binding',
      'clean-host 12-component reconstruction and full-stack recovery'];
    if (![report.sourceInputsUnchanged, report.originalDistributionsUnchanged, report.toolsUnchanged, report.cachedDependenciesUnchanged,
      report.privateToolchainUnchanged,
      report.executionSourceUnchanged, report.inputsUnchanged].every(Boolean)) report.status = 'failed-input-or-original-output-drift';
    write(output, 'report.private.json', json(report));
  }
  console.log(json({ output, status: report.status, sourceBuildComplete: report.sourceBuildComplete,
    offlineReproducible: report.offlineReproducible, failure: report.failure ?? null }).trim());
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    output: { type: 'string' }, 'internal-build': { type: 'string' }, pass: { type: 'string' },
  }, strict: true });
  if (values['internal-build']) {
    const plan = JSON.parse(fs.readFileSync(values['internal-build']));
    const result = await executeBuild(plan, values.pass);
    if (result.status !== 'built-not-published') process.exitCode = 1;
  } else {
    const result = await runOwnedFrontendSourceCloseout({ output: values.output });
    if (result.status !== 'complete-own-source-built-twice-not-published') process.exitCode = 1;
  }
}
