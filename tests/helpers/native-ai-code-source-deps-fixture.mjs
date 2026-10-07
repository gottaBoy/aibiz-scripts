import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_CODE_SOURCE, SOURCE_PACKAGES } from '../../harness-native-ai-code-source-deps.mjs';
import { AI_CODE_PUBLISHED } from '../../prepare-native-ai-code-deployment.mjs';
import {
  CLI_SOURCE_API, fetchNativeCliSource, gitObjectHash,
} from '../../fetch-native-cli-source.mjs';
import { runNativeCliSourceBuild } from '../../harness-native-cli-source-build.mjs';

const aliasParser = fs.realpathSync(fileURLToPath(new URL(
  '../../../ibiz-app-hub/node_modules/.pnpm/node_modules/npm-package-arg', import.meta.url)));
export const hash = data => createHash('sha256').update(data).digest('hex');
export function write(path, data) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
}
export const json = (path, data) => write(path, `${JSON.stringify(data, null, 2)}\n`);
export const fakeBuild = `
const fs = require('node:fs');
const path = require('node:path');
const value = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const emit = (name, data = 'fresh ' + value.name) => {
  fs.mkdirSync(path.dirname(name), {recursive: true});
  fs.writeFileSync(name, data);
};
const mode = path.basename(process.argv[1]) === 'bin.js' ? 'cli.cjs' : path.basename(process.argv[1]);
console.log('explicit node fixture tool', mode, process.cwd(), process.argv.slice(2));
if (mode === 'tsc.cjs') {
  emit('out/index.js'); emit('out/index.d.ts');
} else if (mode === 'unbuild.cjs') {
  emit('es/index.mjs'); emit('es/index.d.ts'); emit('lib/index.js');
} else if (mode === 'rollup.cjs') {
  emit('dist/index.system.min.js');
} else if (mode === 'cli.cjs') {
  emit('es/index.mjs'); emit('lib/index.cjs'); emit('dist/index.system.min.js');
} else if (mode === 'vue-tsc.cjs') {
  emit('es/index.d.ts');
}
`;
export const sourceBuild = `
import fs from 'node:fs';
fs.mkdirSync('dist', {recursive: true});
fs.writeFileSync('dist/index.esm.js', 'fresh esm');
fs.writeFileSync('dist/ibiz-rt-model-api.umd.js', 'fresh umd');
`;

export function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'source-deps-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const hub = join(workspace, 'ibiz-app-hub');
  const source = join(workspace, AI_CODE_SOURCE);
  const roots = new Map();
  json(join(hub, 'package.json'), { name: 'fixture-hub', version: '1.0.0' });
  json(join(hub, 'tsconfig.json'), { compilerOptions: { strict: true } });
  for (const pkg of SOURCE_PACKAGES) {
    const root = join(hub, pkg.path);
    roots.set(pkg.id, root);
    json(join(root, 'package.json'), {
      name: pkg.name, version: `1.0.0-${pkg.id}`, type: 'module',
      ...(pkg.id === 'runtime' ? { dependencies: { '@ibiz-template/core': 'workspace:*' } } : {}),
    });
    if (pkg.kind === 'scss-input') write(join(root, 'style/global.scss'), '$color: red;');
    else {
      write(join(root, 'src/index.ts'), 'export const source = true;\n');
      json(join(root, 'tsconfig.json'), {});
    }
    if (pkg.kind === 'library') write(join(root, 'scripts/build.js'), sourceBuild);
    if (pkg.kind === 'unbuild') write(join(root, 'scripts/build.mjs'), sourceBuild);
    for (const output of ['out', 'es', 'lib', 'dist', 'types', '.cache', '.artifacts', 'node_modules/.cache']) {
      write(join(root, output, 'old-output.js'), 'old must never be reused');
    }
    write(join(root, 'tsconfig.tsbuildinfo'), 'old incremental build');
  }
  roots.set('ai-code', source);
  json(join(source, 'package.json'), {
    name: '@ibiz-template-plugin/ai-code', version: '0.0.3-alpha.141', type: 'module',
    dependencies: Object.fromEntries(SOURCE_PACKAGES.map(pkg => [pkg.name, '0.0.1-published'])),
    devDependencies: { '@ibiz-template/cli': '0.3.30' },
  });
  write(join(source, 'src/index.ts'), 'export const ai = true;\n');
  json(join(source, 'tsconfig.json'), {});
  const installed = join(hub, 'node_modules');
  const toolDirs = {};
  for (const [name, bin, entry, version] of [
    ['typescript', 'tsc', 'tsc.cjs', '5.4.5'],
    ['unbuild', 'unbuild', 'unbuild.cjs', '2.0.0'],
    ['rollup', 'rollup', 'rollup.cjs', '4.44.1'],
    ['vue-tsc', 'vue-tsc', 'vue-tsc.cjs', '1.8.27'],
    ['@ibiz-template/cli', 'ibiz-temp', 'cli.cjs', '0.3.30'],
  ]) {
    const root = join(installed, name);
    toolDirs[name] = root;
    json(join(root, 'package.json'), {
      name, version, bin: { [bin]: entry },
      ...(name === '@ibiz-template/cli' ? { dependencies: { '@ibiz-template/cli-core': version } } : {}),
    });
    write(join(root, entry), fakeBuild);
  }
  json(join(installed, '@ibiz-template/cli-core/package.json'),
    { name: '@ibiz-template/cli-core', version: '0.3.30' });
  json(join(installed, 'third-party/package.json'), { name: 'third-party', version: '2.3.4' });
  fs.symlinkSync(aliasParser, join(installed, 'npm-package-arg'), 'dir');
  for (const [name, target] of Object.entries(toolDirs)) {
    const path = join(source, 'node_modules', name);
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.symlinkSync(target, path, 'dir');
  }
  for (const pkg of SOURCE_PACKAGES) {
    json(join(source, 'node_modules', pkg.name, 'package.json'), {
      name: pkg.name, version: '0.0.1-published',
      ...(pkg.id === 'model-helper' ? { dependencies: { '@ibiz-template/core': '0.0.2-nested' } } : {}),
    });
  }
  json(join(source, 'node_modules/@ibiz-template/model-helper/node_modules/@ibiz-template/core/package.json'),
    { name: '@ibiz-template/core', version: '0.0.2-nested' });
  return {
    workspace, hub, source, roots, toolDirs,
    output: join(workspace, '.artifacts/native-ai-code-source-deps/run'),
  };
}

// Opt-in complete plugin fixture; the original dependency tests keep their minimal inputs.
export function deploymentFixture(t) {
  const options = fixture(t);
  const { workspace, source, toolDirs } = options;
  const path = join(source, 'package.json');
  json(path, {
    ...JSON.parse(fs.readFileSync(path)),
    system: 'dist/index.system.min.js', module: 'es/index.mjs', main: 'lib/index.cjs',
    types: 'es/index.d.ts', styles: ['dist/index.min.css'], gitHead: 'a'.repeat(40),
  });
  for (const [name, contents] of [
    ['CHANGELOG.md', '# Fixture changelog\n'],
    ['README.md', '# Fixture source plugin\n'],
    ['SOURCE-EVIDENCE.md', 'Synthetic fixture, not authentic upstream source.\n'],
    ['ibiz.config.cjs', 'module.exports = {};\n'],
    ['pnpm-lock.yaml', "lockfileVersion: '9.0'\n"],
    ['pnpm-workspace.yaml', 'packages: []\n'],
    ['record-build.mjs', 'export const fixture = true;\n'],
  ]) write(join(source, name), contents);
  for (let index = 1; index <= 19; index++) {
    write(join(source, `src/modules/fixture-${index}.ts`), `export const value${index} = ${index};\n`);
  }
  write(join(source, 'public/assets/type/types.txt'), 'declare const fixture: boolean;\n');
  write(join(source, 'public/assets/images/scene.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9x8AAAAASUVORK5CYII=',
    'base64'));
  write(join(toolDirs['@ibiz-template/cli'], 'cli.cjs'), `${fakeBuild}
if (mode === 'cli.cjs' && value.name === '@ibiz-template-plugin/ai-code') {
  emit('dist/index.system.min.js', 'System.register([], function (_export) { return { execute: function () { _export("fixture", true); } }; });\\n');
  emit('dist/index.min.css', '.fixture { color: red; }\\n');
  for (const format of ['dist', 'es', 'lib']) {
    for (const asset of ['type/types.txt', 'images/scene.png']) {
      emit(format + '/assets/' + asset, fs.readFileSync('public/assets/' + asset));
    }
  }
}
`);
  const published = join(workspace, AI_CODE_PUBLISHED);
  write(join(published, 'package.json'), fs.readFileSync(path));
  fs.cpSync(join(source, 'src'), join(published, 'src'), { recursive: true });
  fs.cpSync(join(source, 'public/assets'), join(published, 'dist/assets'), { recursive: true });
  return { ...options, published };
}

function cliFixtureTree(version) {
  const templates = version !== '0.3.0';
  const core = {
    name: '@ibiz-template/cli-core', version, main: 'dist/index.js', types: 'dist/index.d.ts',
    dependencies: { eslint: '8.0.0' },
    devDependencies: templates ? { cpx: '1.5.0' } : {},
    scripts: {
      build: templates ? 'npm run sync:plugin && npm run lint && tsc --build' :
        'npm run lint && tsc --build',
      lint: templates ? "eslint 'src/**/*.ts' --ignore-pattern 'src/create-plugin/template/**'" :
        "eslint 'src/**/*.ts'",
      ...(templates ? { 'sync:plugin': (version === '0.3.30' ? 'rm -rf dist/template && ' : '') +
        "cpx 'src/create-plugin/template/**/*' 'dist/template'" } : {}),
    },
  };
  const files = {
    LICENSE: 'MIT synthetic fixture, not authentic upstream source\n',
    'package.json': JSON.stringify({ name: 'synthetic-cli-root', private: true,
      devDependencies: { typescript: '5.2.2', eslint: '8.0.0' } }),
    'tsconfig.json': '{"compilerOptions":{"strict":true}}\n',
    '.eslintrc.js': 'module.exports = {};\n',
    'pnpm-lock.yaml': 'lockfileVersion: 6\n',
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    'packages/core/package.json': JSON.stringify(core),
    'packages/core/tsconfig.json': '{"extends":"../../tsconfig.json"}\n',
    'packages/core/src/index.ts': `export const version = '${version}';\n`,
    'packages/core/src/build/build.ts': 'export const build = true;\n',
    'packages/cli/package.json': JSON.stringify({
      name: '@ibiz-template/cli', version, main: 'dist/exports.js', types: 'dist/exports.d.ts',
      bin: { 'ibiz-temp': 'dist/bin.js' },
      dependencies: { '@ibiz-template/cli-core': 'workspace:*', eslint: '8.0.0' },
      scripts: { build: 'npm run lint && tsc --build', lint: "eslint 'src/**/*.ts'" },
    }),
    'packages/cli/tsconfig.json': '{"extends":"../../tsconfig.json"}\n',
    'packages/cli/src/index.ts': 'export const fixture = true;\n',
    'packages/cli/src/bin.ts': `export const cli = '${version}';\n`,
    'packages/cli/src/exports.ts': 'export const fixture = true;\n',
    ...(templates ? {
      'packages/core/src/create-plugin/template/src/index.ts': 'export const plugin = true;\n',
    } : {}),
  };
  const blobs = new Map();
  const entries = new Map();
  for (const [path, contents] of Object.entries(files)) {
    const bytes = Buffer.from(contents);
    const sha = gitObjectHash('blob', bytes);
    blobs.set(sha, bytes);
    entries.set(path, { path, type: 'blob', mode: '100644', sha, size: bytes.length });
    for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent)) {
      if (!entries.has(parent)) entries.set(parent, { path: parent, type: 'tree', mode: '40000' });
    }
  }
  let tree;
  for (const parent of ['', ...[...entries.values()].filter(item =>
    item.type === 'tree').map(item => item.path)].sort((a, b) => b.length - a.length)) {
    const children = [...entries.values()].filter(item =>
      (posix.dirname(item.path) === '.' ? '' : posix.dirname(item.path)) === parent);
    children.sort((a, b) => Buffer.compare(Buffer.from(posix.basename(a.path) +
      (a.type === 'tree' ? '/' : '')), Buffer.from(posix.basename(b.path) + (b.type === 'tree' ? '/' : ''))));
    const sha = gitObjectHash('tree', Buffer.concat(children.flatMap(item => [
      Buffer.from(`${item.mode} ${posix.basename(item.path)}\0`), Buffer.from(item.sha, 'hex'),
    ])));
    if (parent) entries.get(parent).sha = sha;
    else tree = sha;
  }
  const commit = gitObjectHash('commit', Buffer.from(`synthetic source-deps CLI ${version} ${tree}`));
  return { pin: { version, commit, tree }, entries: [...entries.values()], blobs };
}

// All transport/compiler work is mocked; these pins can never authenticate a production toolchain.
export async function cliSourceFixture(t, options = fixture(t)) {
  const { workspace } = options;
  const releases = ['0.3.0', '0.3.23', '0.3.30'].map(cliFixtureTree);
  const cliSourcePins = releases.map(release => release.pin);
  const documents = new Map([[CLI_SOURCE_API, { public: true, private: false }]]);
  for (const { pin, entries, blobs } of releases) {
    documents.set(`${CLI_SOURCE_API}/commits/${pin.commit}`,
      { sha: pin.commit, commit: { tree: { sha: pin.tree } } });
    documents.set(`${CLI_SOURCE_API}/git/trees/${pin.tree}?recursive=1`,
      { sha: pin.tree, truncated: false, tree: entries });
    for (const [sha, bytes] of blobs) {
      documents.set(`${CLI_SOURCE_API}/git/blobs/${sha}`,
        { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
    }
  }
  const fetched = await fetchNativeCliSource({
    workspace, output: join(workspace, '.artifacts/native-cli-source-fetch/synthetic'),
    releases: cliSourcePins, transport: 'blob-api',
    fetchImpl: async url => {
      assert.ok(documents.has(url), `Unexpected fixture transport endpoint: ${url}`);
      return new Response(JSON.stringify(documents.get(url)), { status: 200 });
    },
    attempts: 1, concurrency: 1, retryDelayMs: 0, requestIntervalMs: 0,
  });
  assert.equal(fetched.exitCode, 2, JSON.stringify(fetched.report.errors));
  const owner = join(workspace, 'synthetic-cli-third-parties');
  json(join(owner, 'package.json'), { name: 'synthetic-third-party-owner', version: '1.0.0' });
  for (const name of ['typescript', 'eslint', 'cpx']) {
    const root = join(owner, 'node_modules', name);
    json(join(root, 'package.json'), { name, version: '1.0.0', license: 'MIT',
      bin: { [name === 'typescript' ? 'tsc' : name]: 'bin/tool.cjs' } });
    write(join(root, 'bin/tool.cjs'), '// synthetic compiler, never executed\n');
  }
  const program = fs.readFileSync(join(options.toolDirs['@ibiz-template/cli'], 'cli.cjs'), 'utf8');
  let version;
  const mock = t.mock.method(childProcess, 'spawnSync', (_executable, args, spawnOptions) => {
    const cwd = spawnOptions.cwd;
    const id = args.includes('--help') ? 'cli-help' : args[0].includes('/cpx/') ?
      'core-template' : `${posix.basename(cwd)}-${args.includes('--build') ? 'tsc' : 'lint'}`;
    if (id === 'core-template') {
      write(join(cwd, 'dist/template/src/index.ts'), 'export const plugin = true;\n');
    }
    if (id === 'core-tsc') {
      write(join(cwd, 'dist/index.js'), `exports.version = '${version}';\n`);
      write(join(cwd, 'dist/index.d.ts'), 'export declare const version: string;\n');
    }
    if (id === 'cli-tsc') {
      write(join(cwd, 'dist/exports.js'), 'exports.fixture = true;\n');
      write(join(cwd, 'dist/exports.d.ts'), 'export declare const fixture: boolean;\n');
      write(join(cwd, 'dist/bin.js'), `
if (process.argv.includes('--help')) { console.log('Usage: synthetic ibiz-temp'); process.exit(0); }
if (require('@ibiz-template/cli-core').version !== '${version}') throw new Error('CLI/core fixture version mismatch');
${program}`);
    }
    fs.writeSync(spawnOptions.stdio[1], id === 'cli-help' ?
      'Usage: synthetic ibiz-temp\n' : `${id} synthetic OK\n`);
    return { status: 0, signal: null };
  });
  syncBuiltinESMExports();
  const cliBuilds = [];
  try {
    for (const pin of cliSourcePins) {
      version = pin.version;
      const result = runNativeCliSourceBuild({
        workspace, version, pins: cliSourcePins, fetchReport: fetched.reportPath,
        output: join(workspace, `.artifacts/native-cli-source-build/synthetic-${version}`),
        thirdPartyOwners: { root: owner, core: owner, cli: owner },
      });
      assert.equal(result.exitCode, 2, result.report.errors.join('\n'));
      assert.equal(result.report.cliSourceBuildVerified, false);
      cliBuilds.push(result);
    }
  } finally {
    mock.mock.restore();
    syncBuiltinESMExports();
  }
  return { ...options, cliSourcePins, cliBuilds,
    cliSourceReports: cliBuilds.map(build => build.reportPath) };
}

export function setConsumerCliVersion(options, id, version, coreVersion = version) {
  const root = options.roots.get(id);
  const cli = join(options.workspace, 'synthetic-consumer-cli', id);
  json(join(cli, 'package.json'), {
    name: '@ibiz-template/cli', version, bin: { 'ibiz-temp': 'cli.cjs' },
    dependencies: { '@ibiz-template/cli-core': coreVersion },
  });
  write(join(cli, 'cli.cjs'), 'throw new Error("Published own CLI must never execute");\n');
  json(join(cli, 'node_modules/@ibiz-template/cli-core/package.json'),
    { name: '@ibiz-template/cli-core', version: coreVersion });
  const path = join(root, 'node_modules/@ibiz-template/cli');
  fs.mkdirSync(dirname(path), { recursive: true });
  if (fs.existsSync(path)) fs.unlinkSync(path);
  fs.symlinkSync(cli, path, 'dir');
}

export function updateCliBuildReport(build, change) {
  const report = JSON.parse(fs.readFileSync(build.reportPath));
  change(report);
  json(build.reportPath, report);
  write(join(build.destination, 'report.sha256'), `${hash(fs.readFileSync(build.reportPath))}\n`);
}

export function fixtureSnapshot(root) {
  const entries = [];
  function visit(path, name = '') {
    const info = fs.lstatSync(path, { bigint: true });
    const entry = {
      path: name, mode: info.mode.toString(), inode: info.ino.toString(),
      mtimeNs: info.mtimeNs.toString(),
    };
    if (info.isSymbolicLink()) entries.push({ ...entry, target: fs.readlinkSync(path) });
    else if (info.isDirectory()) {
      entries.push({ ...entry, directory: true });
      for (const child of fs.readdirSync(path).sort()) {
        visit(join(path, child), name ? `${name}/${child}` : child);
      }
    } else entries.push({ ...entry, bytes: info.size.toString(), sha256: hash(fs.readFileSync(path)) });
  }
  visit(root);
  return entries;
}
