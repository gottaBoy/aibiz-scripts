import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  CLI_SOURCE_API, CLI_SOURCE_RELEASES, fetchNativeCliSource, gitObjectHash,
  protectedSourcePath, publicRawUrl,
} from '../fetch-native-cli-source.mjs';
import {
  runNativeCliSourceBuild, verifyNativeCliFetchReport, verifyNativeCliSourceBuild,
} from '../harness-native-cli-source-build.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function write(path, bytes) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, bytes);
}
function json(path, value) { write(path, `${JSON.stringify(value, null, 2)}\n`); }
function updateReport(path, mutate) {
  const value = JSON.parse(fs.readFileSync(path));
  mutate(value);
  json(path, value);
  write(join(dirname(path), 'report.sha256'), `${hash(fs.readFileSync(path))}\n`);
}

async function fixture(t, version = '0.3.30', extra = {}, {
  transport = 'blob-api', rawRedirect = false, executablePaths = [],
  coreDependencies = {},
} = {}) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'native-cli-build-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const templates = version !== '0.3.0';
  const core = {
    name: '@ibiz-template/cli-core', version, main: 'dist/index.js', types: 'dist/index.d.ts',
    dependencies: { eslint: '8.0.0', runtime: '1.0.0', ...coreDependencies },
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
  const cli = {
    name: '@ibiz-template/cli', version, main: 'dist/exports.js', types: 'dist/exports.d.ts',
    bin: { 'ibiz-temp': 'dist/bin.js' },
    dependencies: { '@ibiz-template/cli-core': 'workspace:*', eslint: '8.0.0', runtime: '1.0.0' },
    scripts: { build: 'npm run lint && tsc --build', lint: "eslint 'src/**/*.ts'" },
  };
  const files = {
    LICENSE: 'MIT fixture license\n',
    'package.json': JSON.stringify({ name: 'fixture-cli-root', private: true,
      devDependencies: { typescript: '5.2.2', eslint: '8.0.0', husky: '8.0.0' } }),
    'tsconfig.json': '{"compilerOptions":{"strict":true}}\n',
    '.eslintrc.js': 'module.exports = {};\n',
    'pnpm-lock.yaml': 'lockfileVersion: 6\n',
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    '.npmrc': 'protected, never fetched or read',
    'packages/core/package.json': JSON.stringify(core),
    'packages/core/tsconfig.json': '{"extends":"../../tsconfig.json"}\n',
    'packages/core/src/index.ts': 'export const core = true;\n',
    'packages/core/src/build/build.ts': 'export const build = true;\n',
    'packages/cli/package.json': JSON.stringify(cli),
    'packages/cli/tsconfig.json': '{"extends":"../../tsconfig.json"}\n',
    'packages/cli/src/index.ts': 'export const cli = true;\n',
    'packages/cli/src/exports.ts': 'export const api = true;\n',
    'packages/cli/src/bin.ts': 'export const bin = true;\n',
    ...(templates ? {
      'packages/core/src/create-plugin/template/src/index.ts': 'export const plugin = true;\n',
      'packages/core/src/create-plugin/template/.gitignore': 'node_modules\n',
    } : {}),
    ...extra,
  };
  const blobs = new Map();
  const entries = new Map();
  for (const [path, text] of Object.entries(files)) {
    const bytes = Buffer.from(text);
    const sha = gitObjectHash('blob', bytes);
    blobs.set(sha, bytes);
    entries.set(path, { path, type: 'blob', mode: executablePaths.includes(path) ? '100755' : '100644',
      sha, size: bytes.length });
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
  const commit = gitObjectHash('commit', Buffer.from(`fixture ${version} ${tree}`));
  const pins = [{ version, commit, tree }];
  const documents = new Map([
    [CLI_SOURCE_API, { public: true, private: false }],
    [`${CLI_SOURCE_API}/commits/${commit}`, { sha: commit, commit: { tree: { sha: tree } } }],
    [`${CLI_SOURCE_API}/git/trees/${tree}?recursive=1`,
      { sha: tree, truncated: false, tree: [...entries.values()] }],
    ...[...blobs].map(([sha, bytes]) => [`${CLI_SOURCE_API}/git/blobs/${sha}`,
      { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }]),
    ...Object.entries(files).map(([path, bytes]) => [publicRawUrl(commit, path), Buffer.from(bytes)]),
  ]);
  const fetched = await fetchNativeCliSource({
    workspace, output: join(workspace, '.artifacts/native-cli-source-fetch/fixture'),
    releases: pins, transport, fetchImpl: async url => {
      if (url.startsWith('https://raw.giteeusercontent.com/')) {
        const initial = url.replace('https://raw.giteeusercontent.com', 'https://gitee.com');
        assert.ok(Buffer.isBuffer(documents.get(initial)), 'Unknown mocked raw redirect');
        return new Response(documents.get(initial), { status: 200 });
      }
      assert.ok(documents.has(url), `Unknown mocked endpoint: ${url}`);
      if (Buffer.isBuffer(documents.get(url))) {
        return rawRedirect ? new Response('official redirect fixture\n', {
          status: 302, headers: { location: url.replace('https://gitee.com', 'https://raw.giteeusercontent.com') },
        }) : new Response(documents.get(url), { status: 200 });
      }
      return new Response(JSON.stringify(documents.get(url)), { status: 200 });
    },
    attempts: 1, concurrency: 1, retryDelayMs: 0, requestIntervalMs: 0,
  });
  assert.equal(fetched.exitCode, 2, JSON.stringify(fetched.report.errors));
  const owner = join(workspace, 'installed-owner');
  json(join(owner, 'package.json'), { name: 'third-party-owner', version: '1.0.0' });
  const installed = new Map();
  function install(name, options = {}) {
    const root = join(owner, 'node_modules', name);
    json(join(root, 'package.json'), {
      name, version: '1.0.0', license: 'MIT', bin: { [name === 'typescript' ? 'tsc' : name]: 'bin/tool.cjs' },
      ...options,
    });
    write(join(root, 'bin/tool.cjs'), '// mocked installed open-source tool\n');
    installed.set(name, root);
    return root;
  }
  for (const name of ['typescript', 'eslint', 'runtime', ...(templates ? ['cpx'] : [])]) install(name);
  const options = {
    workspace, version, pins, fetchReport: fetched.reportPath,
    output: join(workspace, '.artifacts/native-cli-source-build/fixture'),
    thirdPartyOwners: { root: owner, core: owner, cli: owner },
  };
  return { ...options, options, fetched, files, pins, installed, install, owner,
    original: fetched.report.releases[0].sourceDirectory };
}

async function fetchFromFixtureCache(f, {
  output = 'cached', cacheFrom = [f.fetched.destination],
  fetchImpl = async () => assert.fail('Cache fixture must not make any live request'),
} = {}) {
  const cached = await fetchNativeCliSource({
    workspace: f.workspace, releases: f.pins, transport: f.fetched.report.requestPolicy.transport,
    output: join(f.workspace, '.artifacts/native-cli-source-fetch', output),
    cacheFrom, fetchImpl,
    attempts: 1, concurrency: 1, retryDelayMs: 0, requestIntervalMs: 0,
  });
  assert.equal(cached.exitCode, 2, JSON.stringify(cached.report.errors));
  return cached;
}

async function cachedFixture(t, { transport = 'public-raw', rawRedirect = true } = {}) {
  const f = await fixture(t, '0.3.30', {}, { transport, rawRedirect });
  return { f, cached: await fetchFromFixtureCache(f) };
}

function installAliasToolkit(f) {
  const parser = fs.realpathSync(fileURLToPath(new URL(
    '../../ibiz-app-hub/node_modules/.pnpm/node_modules/npm-package-arg', import.meta.url)));
  const copied = new Map();
  function copy(source, destination) {
    if (copied.has(source)) {
      fs.symlinkSync(copied.get(source), destination, 'dir');
      return;
    }
    copied.set(source, destination);
    const manifest = JSON.parse(fs.readFileSync(join(source, 'package.json')));
    fs.cpSync(source, destination, {
      recursive: true,
      filter: path => {
        const name = relative(source, path);
        return !name.split(sep).includes('node_modules') && !protectedSourcePath(name);
      },
    });
    const req = createRequire(join(source, 'package.json'));
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      assert.ok(!range.startsWith('npm:'), 'Alias parser fixture dependencies must be direct');
      const path = req.resolve.paths('__native_cli_fixture_lookup__')
        .map(root => join(root, name, 'package.json')).find(candidate => fs.existsSync(candidate));
      assert.ok(path, `Installed alias parser fixture dependency missing: ${name}`);
      const target = join(destination, 'node_modules', name);
      fs.mkdirSync(dirname(target), { recursive: true });
      copy(fs.realpathSync(dirname(path)), target);
    }
  }
  const root = join(f.owner, 'node_modules/npm-package-arg');
  copy(parser, root);
  return root;
}

function fakeBuild(t, fixture, callback = () => {}) {
  const calls = [];
  const mock = t.mock.method(childProcess, 'spawnSync', (executable, args, options) => {
    calls.push({ executable, args, options });
    const entry = args[0];
    const cwd = options.cwd;
    const id = args.includes('--help') ? 'cli-help' :
      entry.includes('/cpx/') ? 'core-template' :
        `${posix.basename(cwd)}-${args.includes('--build') ? 'tsc' : 'lint'}`;
    if (id === 'core-template') {
      write(join(cwd, 'dist/template/src/index.ts'), 'export const plugin = true;\n');
    }
    if (id === 'core-tsc') {
      write(join(cwd, 'dist/index.js'), 'exports.core = true;\n');
      write(join(cwd, 'dist/index.d.ts'), 'export declare const core: boolean;\n');
    }
    if (id === 'cli-tsc') {
      write(join(cwd, 'dist/exports.js'), 'exports.cli = true;\n');
      write(join(cwd, 'dist/exports.d.ts'), 'export declare const cli: boolean;\n');
      write(join(cwd, 'dist/bin.js'), 'console.log("Usage: ibiz-temp");\n');
    }
    fs.writeSync(options.stdio[1], id === 'cli-help' ? 'Usage: ibiz-temp [options]\n' : `${id} OK\n`);
    const override = callback({ id, executable, args, options, fixture, calls });
    return override ?? { status: 0, signal: null };
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  return calls;
}

const verify = (fixture, result) => verifyNativeCliSourceBuild({
  workspace: fixture.workspace, sourceReport: result.reportPath, pins: fixture.pins,
});

for (const version of ['0.3.0', '0.3.23', '0.3.30']) {
  test(`${version}: complete isolated build, original inputs unchanged and read-only verification`, async t => {
    const f = await fixture(t, version);
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    assert.equal(calls.length, version === '0.3.0' ? 5 : 6);
    assert.equal(result.report.sourceBuildsCompleted, true);
    for (const key of ['nativeAccepted', 'acceptedForProduction', 'fullLocalization',
      'originalVersionReproductionVerified', 'dependencySourcesBuilt', 'cliSourceBuildVerified']) {
      assert.equal(result.report[key], false);
    }
    assert.equal(result.report.source.sourceComplete, false);
    assert.equal(result.report.source.exclusions.length, 1);
    assert.ok(!fs.existsSync(join(result.report.stage, '.npmrc')));
    for (const [path, bytes] of Object.entries(f.files)) {
      if (path !== '.npmrc') {
        assert.equal(fs.readFileSync(join(f.original, path), 'utf8'), bytes);
        assert.equal(fs.readFileSync(join(result.report.stage, path), 'utf8'), bytes);
      }
    }
    const before = fs.readFileSync(result.reportPath);
    const outputBefore = fs.readFileSync(join(result.report.stage, 'packages/core/dist/index.js'));
    const verified = verify(f, result);
    assert.equal(verified.reportSha256, hash(before));
    assert.equal(verified.version, version);
    assert.equal(verified.core.path, join(result.report.stage, 'packages/core'));
    assert.equal(verified.core.entry, join(verified.core.path, 'dist/index.js'));
    assert.equal(verified.cli.bin, join(verified.cli.path, 'dist/bin.js'));
    assert.equal(verified.cliSourceBuildVerified, false, 'Synthetic pins must not establish authentic builds');
    assert.deepEqual(fs.readFileSync(result.reportPath), before);
    assert.deepEqual(fs.readFileSync(join(result.report.stage, 'packages/core/dist/index.js')), outputBefore);
    assert.equal(calls.length, version === '0.3.0' ? 5 : 6, 'Verifier must never run a build');
    assert.throws(() => verifyNativeCliSourceBuild({
      workspace: f.workspace, sourceReport: result.reportPath,
    }), /Pinned commit mismatch/);
    for (const call of calls) {
      assert.equal(call.executable, process.execPath);
      assert.equal(call.options.shell, false);
      assert.ok(call.options.cwd.startsWith(result.report.stage));
      assert.ok(call.options.env.HOME.startsWith(result.destination));
      assert.equal(call.options.env.NODE_OPTIONS, undefined);
      assert.equal(call.options.env.NODE_PATH, undefined);
      assert.equal(call.options.env.npm_config_offline, 'true');
      assert.ok(!call.args.some(arg => /^(?:npm|pnpm|install|publish)$/.test(arg)));
    }
  });
}

test('exact production pins are mandatory outside explicitly injected fixtures', async t => {
  assert.equal(CLI_SOURCE_RELEASES.length, 3);
  const f = await fixture(t);
  const calls = fakeBuild(t, f);
  const result = runNativeCliSourceBuild({ ...f.options, pins: undefined });
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /Pinned commit mismatch/);
  assert.equal(calls.length, 0);
  assert.ok(fs.existsSync(result.reportPath));
});

for (const rawRedirect of [false, true]) {
  test(`public raw bytes ${rawRedirect ? 'with one redirect' : 'without redirect'} retain honest evidence`, async t => {
    const f = await fixture(t, '0.3.30', {
      'packages/core/src/fixture.dat': Buffer.from([0, 255, 128, 10]),
    }, { transport: 'public-raw', rawRedirect });
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    assert.equal(calls.length, 6);
    assert.ok(f.fetched.report.blobs.every(item =>
      item.transport === 'public-raw' && item.rawFormat === 'bytes' && item.raw.endsWith('.bin')));
    const requests = f.fetched.report.requests.filter(item => item.label.startsWith('blob-'));
    assert.ok(requests.every(item => Boolean(item.initialResponse) === rawRedirect));
    if (rawRedirect) {
      assert.ok(result.report.source.rawEvidence.some(item =>
        item.path.endsWith('.redirect.response.bin')));
    }
    verify(f, result);
  });
}

for (const transport of ['blob-api', 'public-raw']) {
  test(`${transport}: cachedMetadata and cached blob evidence verify without live requests`, async t => {
    const { f, cached } = await cachedFixture(t, { transport });
    assert.equal(cached.report.requests.length, 0);
    assert.equal(cached.report.cachedMetadata.length, 3);
    assert.equal(cached.report.cachedBlobRequests.length, cached.report.blobs.length);
    assert.deepEqual(cached.report.cacheMisses, []);
    assert.ok(cached.report.blobs.every(item => item.raw.includes('-cache.response.')));
    fakeBuild(t, f);
    const result = runNativeCliSourceBuild({ ...f.options, fetchReport: cached.reportPath });
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    for (const capture of cached.report.cachedBlobRequests) {
      assert.ok(result.report.source.rawEvidence.some(item => item.path === capture.raw &&
        item.bytes === capture.bytes && item.sha256 === capture.sha256));
      if (capture.initialResponse) {
        assert.ok(result.report.source.rawEvidence.some(item => item.path === capture.initialResponse.raw &&
          item.bytes === capture.initialResponse.bytes && item.sha256 === capture.initialResponse.sha256));
      }
    }
    verify(f, result);
  });

  test(`${transport}: chained cache HTTP provenance supports read-only build verification`, async t => {
    const { f, cached } = await cachedFixture(t, { transport });
    const chained = await fetchFromFixtureCache(f, { output: 'chained', cacheFrom: [cached.destination] });
    assert.equal(chained.report.requests.length, 0);
    assert.ok(chained.report.cachedBlobRequests.every(item =>
      item.cacheSource === cached.destination && item.cacheReportSha256 === hash(fs.readFileSync(cached.reportPath))));
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild({ ...f.options, fetchReport: chained.reportPath });
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    const before = fs.readFileSync(chained.reportPath);
    verify(f, result);
    assert.equal(calls.length, 6);
    assert.deepEqual(fs.readFileSync(chained.reportPath), before);
  });

  for (const cachedReport of [false, true]) {
    test(`${transport}: legacy ${cachedReport ? 'cached' : 'direct'} report without new cache fields stays compatible`, async t => {
      const { f, cached } = await cachedFixture(t, { transport });
      const reportPath = cachedReport ? cached.reportPath : f.fetchReport;
      updateReport(reportPath, report => {
        delete report.cachedBlobRequests;
        delete report.cacheMisses;
      });
      fakeBuild(t, f);
      const result = runNativeCliSourceBuild({ ...f.options, fetchReport: reportPath });
      assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
      verify(f, result);
    });
  }
}

test('cacheMisses with a genuinely reacquired blob retain mixed live and cached HTTP evidence', async t => {
  const f = await fixture(t);
  const blob = f.fetched.report.blobs[0];
  updateReport(f.fetchReport, report => {
    report.requests = report.requests.filter(item => item.label !== `blob-${blob.sha}`);
  });
  let requests = 0;
  const cached = await fetchFromFixtureCache(f, {
    fetchImpl: async url => {
      requests++;
      assert.equal(url, `${CLI_SOURCE_API}/git/blobs/${blob.sha}`);
      const bytes = Buffer.from(Object.values(f.files).find(value =>
        gitObjectHash('blob', Buffer.from(value)) === blob.sha));
      return new Response(JSON.stringify({
        sha: blob.sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64'),
      }), { status: 200 });
    },
  });
  assert.equal(requests, 1);
  assert.equal(cached.report.requests.length, 1);
  assert.equal(cached.report.cachedBlobRequests.length, cached.report.blobs.length - 1);
  assert.deepEqual(cached.report.cacheMisses, [{
    cacheSource: f.fetched.destination, sha: blob.sha, reason: 'missing-successful-http-provenance',
  }]);
  fakeBuild(t, f);
  const result = runNativeCliSourceBuild({ ...f.options, fetchReport: cached.reportPath });
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  verify(f, result);
});

for (const field of ['cachedMetadata', 'cachedBlobRequests', 'cacheMisses']) {
  test(`builder rejects malformed ${field} instead of ignoring its evidence`, async t => {
    const f = await fixture(t);
    updateReport(f.fetchReport, report => { report[field] = {}; });
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors[0], new RegExp(`Invalid ${field} evidence`));
    assert.equal(calls.length, 0);
  });
}

for (const transport of ['blob-api', 'public-raw']) {
  for (const mutation of ['status', 'error', 'partial', 'bytes', 'hash', 'endpoint', 'raw-path',
    'format', 'duplicate', 'missing-record', 'attempt', 'cache-source', 'cache-report-hash', 'capture-time']) {
    test(`${transport}: cached HTTP ${mutation} is rejected before commands`, async t => {
      const { f, cached } = await cachedFixture(t, { transport });
      updateReport(cached.reportPath, report => {
        const capture = report.cachedBlobRequests[0];
        if (mutation === 'status') capture.status = 401;
        if (mutation === 'error') capture.error = 'mock prior HTTP failure';
        if (mutation === 'partial') capture.partial = true;
        if (mutation === 'bytes') capture.bytes++;
        if (mutation === 'hash') capture.sha256 = 'a'.repeat(64);
        if (mutation === 'endpoint') capture.url = 'https://example.invalid/source';
        if (mutation === 'raw-path') capture.raw = 'evidence/../report.json';
        if (mutation === 'format') capture.rawFormat = 'unreviewed-format';
        if (mutation === 'duplicate') report.cachedBlobRequests.push(structuredClone(capture));
        if (mutation === 'missing-record') report.cachedBlobRequests.shift();
        if (mutation === 'attempt') capture.attempt = 0;
        if (mutation === 'cache-source') capture.cacheSource =
          join(f.workspace, '.artifacts/native-cli-source-fetch/unrelated');
        if (mutation === 'cache-report-hash') capture.cacheReportSha256 = 'a'.repeat(40);
        if (mutation === 'capture-time') capture.capturedAt = '2000-01-01T00:00:00.000Z';
      });
      const calls = fakeBuild(t, f);
      const result = runNativeCliSourceBuild({ ...f.options, fetchReport: cached.reportPath });
      assert.equal(result.exitCode, 1);
      assert.equal(calls.length, 0);
      assert.match(result.report.errors[0], /cached|capture|raw|format|evidence/i);
      assert.equal(result.report.sourceBuildsCompleted, false);
      assert.equal(result.report.cliSourceBuildVerified, false);
    });
  }
}

for (const generation of ['second', 'third']) {
  test(`${generation}-generation public raw cached redirect body tampering fails before commands and retains bytes`, async t => {
    const { f, cached } = await cachedFixture(t);
    const current = generation === 'second' ? cached :
      await fetchFromFixtureCache(f, { output: 'chained', cacheFrom: [cached.destination] });
    const capture = current.report.cachedBlobRequests[0];
    assert.equal(capture.initialResponse.status, 302);
    assert.equal(capture.status, 200);
    const prior = fs.readFileSync(f.fetchReport);
    const target = join(current.destination, capture.initialResponse.raw);
    const bytes = fs.readFileSync(target);
    bytes[0] ^= 1;
    write(target, bytes);
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild({ ...f.options, fetchReport: current.reportPath });
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors[0], /Raw evidence hash mismatch/);
    assert.equal(calls.length, 0);
    assert.equal(result.report.sourceBuildsCompleted, false);
    assert.equal(result.report.cliSourceBuildVerified, false);
    assert.deepEqual(fs.readFileSync(target), bytes);
    assert.deepEqual(fs.readFileSync(f.fetchReport), prior);
  });
}

for (const mutation of ['status', 'missing-location', 'foreign-location', 'wrong-path', 'partial',
  'attempt-path', 'unbound-final-url']) {
  test(`cached public raw redirect ${mutation} cannot bypass builder evidence validation`, async t => {
    const { f, cached } = await cachedFixture(t);
    updateReport(cached.reportPath, report => {
      const capture = report.cachedBlobRequests[0];
      if (mutation === 'status') capture.initialResponse.status = 200;
      if (mutation === 'missing-location') delete capture.initialResponse.location;
      if (mutation === 'foreign-location') capture.initialResponse.location = 'https://example.invalid/source';
      if (mutation === 'wrong-path') capture.initialResponse.location += '/extra';
      if (mutation === 'partial') capture.initialResponse.partial = true;
      if (mutation === 'attempt-path') capture.initialResponse.raw =
        capture.initialResponse.raw.replace('attempt-1', 'attempt-2');
      if (mutation === 'unbound-final-url') delete capture.initialResponse;
    });
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild({ ...f.options, fetchReport: cached.reportPath });
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.match(result.report.errors[0], /raw|redirect/i);
  });
}

for (const mutation of ['bytes', 'rehash-bytes', 'source-url', 'source-path',
  'format', 'redirect-host', 'redirect-path', 'redirect-body', 'unbound-final-url']) {
  test(`public raw ${mutation} fails closed before commands`, async t => {
    const f = await fixture(t, '0.3.30', {}, { transport: 'public-raw', rawRedirect: true });
    const blob = f.fetched.report.blobs[0];
    const request = f.fetched.report.requests.find(item => item.label === `blob-${blob.sha}`);
    if (mutation === 'bytes' || mutation === 'rehash-bytes') {
      const changed = Buffer.alloc(blob.bytes, 97);
      write(join(f.fetched.destination, blob.raw), changed);
      if (mutation === 'rehash-bytes') updateReport(f.fetchReport, report => {
        report.blobs.find(item => item.sha === blob.sha).rawSha256 = hash(changed);
        report.requests.find(item => item.label === request.label).sha256 = hash(changed);
      });
    } else if (mutation === 'redirect-body') {
      write(join(f.fetched.destination, request.initialResponse.raw), 'changed redirect bytes');
    } else updateReport(f.fetchReport, report => {
      const item = report.blobs.find(item => item.sha === blob.sha);
      const capture = report.requests.find(item => item.label === request.label);
      if (mutation === 'source-url') item.sourceUrl = 'https://example.invalid/source';
      if (mutation === 'source-path') item.sourcePath = 'packages/cli/src/unknown.ts';
      if (mutation === 'format') item.rawFormat = 'json';
      if (mutation === 'redirect-host') capture.initialResponse.location =
        capture.initialResponse.location.replace('raw.giteeusercontent.com', 'example.invalid');
      if (mutation === 'redirect-path') capture.initialResponse.location += '/extra';
      if (mutation === 'unbound-final-url') delete capture.initialResponse;
    });
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.match(result.report.errors.join(' '), /raw|redirect|evidence|source tree|format/i);
  });
}

test('partial acquisition is rejected before commands and failed evidence is retained', async t => {
  const f = await fixture(t);
  updateReport(f.fetchReport, report => { report.status = 'source-fetch-failed'; report.exitCode = 1; });
  const calls = fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /Fetch did not complete/);
  assert.equal(calls.length, 0);
  assert.ok(fs.existsSync(result.reportPath));
  assert.throws(() => verify(f, result), /did not complete/);
});

for (const mutation of ['alter', 'delete', 'extra', 'symlink', 'protected']) {
  test(`original ${mutation} is rejected before compilation`, async t => {
    const f = await fixture(t);
    const path = join(f.original, 'packages/core/src/index.ts');
    if (mutation === 'alter') write(path, 'changed\n');
    if (mutation === 'delete') fs.unlinkSync(path);
    if (mutation === 'extra') write(join(f.original, 'unexpected.ts'), 'extra\n');
    if (mutation === 'symlink') {
      fs.unlinkSync(path);
      fs.symlinkSync(join(f.original, 'LICENSE'), path);
    }
    if (mutation === 'protected') write(join(f.original, '.npmrc'), 'must not read\n');
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.match(result.report.errors[0], /blob|inventory|Symlink|Protected/i);
  });
}

for (const path of ['lib/parse-error/credentials.js', 'lib/parse-error/credentials.js.map']) {
  test(`original source still rejects Babel-like protected path ${path} before reading`, async t => {
    const f = await fixture(t);
    const target = join(f.original, path);
    write(target, 'protected fixture bytes must not be read\n');
    const originalRead = fs.readFileSync;
    let reads = 0;
    t.mock.method(fs, 'readFileSync', (file, ...args) => {
      if (file === target || (typeof file === 'number' &&
        fs.readlinkSync(`/proc/self/fd/${file}`) === target)) reads++;
      return originalRead(file, ...args);
    });
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors[0], /Protected input must not be read/);
    assert.equal(reads, 0);
    assert.equal(calls.length, 0);
  });
}

test('staged source does not inherit the installed Babel protected-path exception', async t => {
  const f = await fixture(t);
  const calls = fakeBuild(t, f, ({ id, options }) => {
    if (id === 'core-template') {
      write(join(options.cwd, '../../lib/parse-error/credentials.js'), 'staged protected fixture\n');
    }
  });
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /Protected input must not be read/);
  assert.equal(calls.length, 1);
  assert.equal(result.report.nativeAccepted, false);
});

test('installed Babel parse-error modules are regular files with complete hash-bound inventory', async t => {
  const f = await fixture(t);
  f.install('runtime', { dependencies: { '@babel/parser': '7.22.5' } });
  const root = f.install('@babel/parser', { version: '7.22.5' });
  const files = {
    'lib/parse-error/credentials.js': 'exports.ParseErrorCode = { SyntaxError: "BABEL_PARSER_SYNTAX_ERROR" };\n',
    'lib/parse-error/credentials.js.map': '{"version":3,"sources":["parse-error/credentials.ts"],"mappings":""}\n',
  };
  for (const [path, bytes] of Object.entries(files)) write(join(root, path), bytes);
  const calls = fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(calls.length, 6);
  const pkg = result.report.dependencies.packages.find(item => item.name === '@babel/parser');
  for (const [path, bytes] of Object.entries(files)) {
    assert.ok(pkg.entries.some(item => item.path === path && item.bytes === Buffer.byteLength(bytes) &&
      item.sha256 === hash(bytes)));
  }
  assert.equal(pkg.sourceVerified, false);
  verify(f, result);
  write(join(root, 'lib/parse-error/credentials.js'), 'changed parser module\n');
  assert.throws(() => verify(f, result), /third-party\/tool drift/);
});

for (const path of ['.npmrc', '.env', '.env.production', '.netrc', '.git-credentials',
  'config/credentials.json', 'config/id_rsa', 'config/server.key', 'config/server.pem',
  'lib/parse-error/credentials.json', 'lib/parse-error/credentials.js.backup']) {
  test(`installed Babel still rejects sensitive path ${path} without reading it`, async t => {
    const f = await fixture(t);
    f.install('runtime', { dependencies: { '@babel/parser': '7.22.5' } });
    const root = f.install('@babel/parser', { version: '7.22.5' });
    write(join(root, 'lib/parse-error/credentials.js'), 'exports.ParseErrorCode = {};\n');
    const target = join(root, path);
    write(target, 'protected fixture bytes must not be read\n');
    const originalRead = fs.readFileSync;
    let reads = 0;
    t.mock.method(fs, 'readFileSync', (file, ...args) => {
      if (file === target || (typeof file === 'number' &&
        fs.readlinkSync(`/proc/self/fd/${file}`) === target)) reads++;
      return originalRead(file, ...args);
    });
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors[0], /Protected input must not be read/);
    assert.equal(reads, 0);
    assert.equal(calls.length, 0);
  });
}

for (const mutation of ['wrong-package', 'wrong-version', 'symlink', 'directory']) {
  test(`installed parse-error exception rejects ${mutation}`, async t => {
    const f = await fixture(t);
    const name = mutation === 'wrong-package' ? 'unreviewed-parser' : '@babel/parser';
    f.install('runtime', { dependencies: { [name]: '*' } });
    const root = f.install(name, { version: mutation === 'wrong-version' ? '7.22.6' : '7.22.5' });
    const path = join(root, 'lib/parse-error/credentials.js');
    fs.mkdirSync(dirname(path), { recursive: true });
    if (mutation === 'symlink') fs.symlinkSync(join(f.original, 'LICENSE'), path);
    else if (mutation === 'directory') fs.mkdirSync(path);
    else write(path, 'exports.ParseErrorCode = {};\n');
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors[0], /Protected input|Symlink input|must be a regular file/);
    assert.equal(calls.length, 0);
  });
}

test('prebuilt outputs are independently Git-verified but never copied as fresh outputs', async t => {
  const f = await fixture(t, '0.3.0', {
    'packages/core/dist/index.js': 'old compiled core\n',
    'packages/cli/dist/bin.js': 'old compiled cli\n',
  });
  fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(result.report.stagingExclusions.length, 2);
  assert.equal(fs.readFileSync(join(f.original, 'packages/core/dist/index.js'), 'utf8'), 'old compiled core\n');
  assert.equal(fs.readFileSync(join(result.report.stage, 'packages/core/dist/index.js'), 'utf8'),
    'exports.core = true;\n');
  verify(f, result);
});

for (const kind of ['raw-tree', 'raw-blob', 'cache', 'receipt', 'report-hash', 'exclusion']) {
  test(`fetch ${kind} tampering fails closed`, async t => {
    const f = await fixture(t);
    if (kind === 'raw-tree' || kind === 'raw-blob') {
      const record = f.fetched.report.requests.find(item =>
        item.label.startsWith(kind === 'raw-tree' ? 'tree-' : 'blob-'));
      write(join(f.fetched.destination, record.raw), '{}\n');
    }
    if (kind === 'cache') write(join(f.fetched.destination, f.fetched.report.blobs[0].cached), 'changed\n');
    if (kind === 'receipt') write(f.fetched.report.releases[0].receipt, '{}\n');
    if (kind === 'report-hash') write(f.fetchReport, '{}\n');
    if (kind === 'exclusion') {
      const receipt = f.fetched.report.releases[0].receipt;
      const value = JSON.parse(fs.readFileSync(receipt));
      value.sourceComplete = true;
      json(receipt, value);
      updateReport(f.fetchReport, report => {
        report.releases[0].receiptSha256 = hash(fs.readFileSync(receipt));
      });
    }
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.match(result.report.errors[0],
      /hash mismatch|size mismatch|Cached blob mismatch|sourceComplete overclaim/i);
  });
}

test('missing required direct or transitive third parties fail before compilation', async t => {
  for (const transitive of [false, true]) {
    const f = await fixture(t);
    if (transitive) {
      f.install('runtime', { dependencies: { 'missing-transitive': '1.0.0' } });
    } else fs.rmSync(f.installed.get('runtime'), { recursive: true });
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors[0], /Required dependency unavailable/);
    assert.equal(calls.length, 0);
    calls.length = 0;
  }
});

test('optional missing transitive packages are recorded without skipping build commands', async t => {
  const f = await fixture(t);
  f.install('runtime', { optionalDependencies: { 'optional-missing': '1.0.0' },
    peerDependencies: { 'peer-missing': '*' }, peerDependenciesMeta: { 'peer-missing': { optional: true } } });
  const calls = fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(calls.length, 6);
  assert.deepEqual(result.report.dependencies.unavailablePackages.map(item => item.name),
    ['optional-missing', 'peer-missing']);
  verify(f, result);
});

test('npm packages sharing a Node builtin name are resolved through npm lookup', async t => {
  const f = await fixture(t);
  f.install('runtime', { dependencies: { string_decoder: '*' } });
  f.install('string_decoder');
  fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.ok(result.report.dependencies.packages.some(item => item.name === 'string_decoder'));
  verify(f, result);
});

for (const supplemental of [false, true]) {
  test(`direct third-party supplemental owner via ${supplemental ? 'dependencyOwners' : 'owner arrays'} is bound`, async t => {
    const f = await fixture(t);
    const owner = join(f.workspace, 'supplemental');
    json(join(owner, 'package.json'), { name: 'third-party-supplemental', private: true });
    const moved = join(owner, 'node_modules/runtime');
    fs.mkdirSync(dirname(moved), { recursive: true });
    fs.renameSync(f.installed.get('runtime'), moved);
    const options = supplemental ? { ...f.options, dependencyOwners: [owner] } :
      { ...f.options, thirdPartyOwners: { root: [f.owner], core: [f.owner, owner], cli: [f.owner, owner] } };
    fakeBuild(t, f);
    const result = runNativeCliSourceBuild(options);
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    assert.ok(result.report.dependencies.packages.some(item => item.realpath === moved));
    assert.ok(result.report.dependencies.ownerManifests.some(item => item.path === owner));
    verify(f, result);
    json(join(owner, 'package.json'), { name: 'changed-owner-manifest' });
    assert.throws(() => verify(f, result), /third-party\/tool drift/);
  });
}

test('supplemental owner cannot hide a transitive package unreachable from installed realpath', async t => {
  const f = await fixture(t);
  f.install('runtime', { dependencies: { 'not-runtime-resolvable': '*' } });
  const owner = join(f.workspace, 'supplemental');
  json(join(owner, 'package.json'), { name: 'supplemental' });
  json(join(owner, 'node_modules/not-runtime-resolvable/package.json'), {
    name: 'not-runtime-resolvable', version: '1.0.0', license: 'MIT',
  });
  const calls = fakeBuild(t, f);
  const result = runNativeCliSourceBuild({ ...f.options, dependencyOwners: [owner] });
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /Required dependency unavailable/);
  assert.equal(calls.length, 0);
});

test('published own CLI/core and transitive framework fallback cannot be reused', async t => {
  const f = await fixture(t);
  f.install('runtime', { dependencies: { '@ibiz-template/cli-core': '0.3.30' } });
  f.install('@ibiz-template/cli-core');
  const calls = fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /Published own\/framework dependency rejected/);
  assert.equal(calls.length, 0);
});

test('owner directories are explicit, contained and non-symlink', async t => {
  const f = await fixture(t);
  const calls = fakeBuild(t, f);
  for (const [label, owners, expected] of [
    ['missing', null, /Explicit third-party owners/],
    ['outside', { root: tmpdir(), core: f.owner, cli: f.owner }, /outside artifacts/],
    ['artifact', { root: f.fetched.destination, core: f.owner, cli: f.owner }, /outside artifacts/],
  ]) {
    const result = runNativeCliSourceBuild({ ...f.options, thirdPartyOwners: owners,
      output: join(dirname(f.output), label) });
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors[0], expected);
  }
  json(join(f.owner, 'package.json'), { name: '@ibiz-template/cli', version: '0.3.30' });
  const link = join(f.workspace, 'linked-owner');
  fs.symlinkSync(f.owner, link);
  const linked = runNativeCliSourceBuild({ ...f.options, thirdPartyOwners: {
    root: link, core: f.owner, cli: f.owner,
  }, output: join(dirname(f.output), 'symlink-owner') });
  assert.equal(linked.exitCode, 1);
  assert.match(linked.report.errors[0], /Symlink directory/);
  assert.equal(calls.length, 0);
  write(join(f.owner, 'dist/forbidden.js'), 'published own compiled bytes are not an input\n');
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(calls.length, 6);
  assert.ok(!result.report.dependencies.packages.some(item => item.realpath === f.owner));
  assert.ok(result.report.dependencies.ownerManifests.every(item => item.compiledOwnFilesRead === false));
  write(join(f.owner, 'dist/forbidden.js'), 'changing unpublished-to-harness owner output is irrelevant\n');
  verify(f, result);
});

test('unknown third-party licenses are conservatively rejected', async t => {
  const f = await fixture(t);
  f.install('runtime', { license: 'UNLICENSED' });
  const calls = fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /open-source license/);
  assert.equal(calls.length, 0);
});

for (const [name, version, declarations] of [
  ['ansi-wrap', '0.1.0', { license: { type: 'MIT', url: 'https://example.org/LICENSE' } }],
  ['array-unique', '0.2.1', { license: { type: 'MIT' } }],
  ['glob-base', '0.3.0', { license: { type: 'MIT' } }],
  ['is-primitive', '2.0.0', { license: { type: 'MIT' } }],
  ['preserve', '0.2.0', { license: { type: 'MIT' } }],
  ['rechoir', '0.6.2', { license: null, licenses: [{ type: 'MIT', url: 'http://example.org/LICENSE' }] }],
  ['svg-tags', '1.0.0', { license: null, licenses: [{ type: 'MIT' }] }],
  ['glob2base', '0.0.12', { license: null, licenses: [{ type: 'MIT' }] }],
  ['jsesc', '0.5.0', { license: undefined, licenses: [{ type: 'MIT' }] }],
]) {
  test(`structured legacy license for ${name}@${version} preserves explicit declarations`, async t => {
    const f = await fixture(t);
    f.install('runtime', { dependencies: { [name]: '*' } });
    f.install(name, { version, ...declarations });
    fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    const pkg = result.report.dependencies.packages.find(item => item.name === name);
    assert.equal(pkg.licensePolicy.id, 'structured-legacy-license-allowlist');
    assert.deepEqual(pkg.licensePolicy.declarations.map(item => item.id), ['MIT']);
    assert.equal(pkg.sourceVerified, false);
    verify(f, result);
  });
}

for (const [label, declarations] of [
  ['unknown-type', { license: { type: 'UNLICENSED' } }],
  ['missing-type', { license: { name: 'MIT' } }],
  ['nested-type', { license: { type: { name: 'MIT' } } }],
  ['unexpected-key', { license: { type: 'MIT', trusted: true } }],
  ['unsafe-url', { license: { type: 'MIT', url: 'javascript:trust-me' } }],
  ['credential-url', { license: { type: 'MIT', url: 'https://user:secret@example.org/LICENSE' } }],
  ['wrong-array', { license: null, licenses: 'MIT' }],
  ['empty-array', { license: null, licenses: [] }],
  ['unknown-array-entry', { license: null, licenses: [{ type: 'MIT' }, { type: 'UNLICENSED' }] }],
  ['conflicting-modern', { license: 'UNLICENSED', licenses: [{ type: 'MIT' }] }],
  ['missing-declaration', { license: null, licenses: null }],
]) {
  test(`structured legacy license rejects ${label} without guessing from files`, async t => {
    const f = await fixture(t);
    const root = f.install('runtime', declarations);
    write(join(root, 'LICENSE'), 'MIT License\nnot a replacement for an explicit declaration\n');
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.match(result.report.errors[0], /license/i);
  });
}

test('caniuse-lite CC-BY-4.0 data reuse retains bound license evidence and conservative claims', async t => {
  const f = await fixture(t);
  f.install('runtime', { dependencies: { 'caniuse-lite': '*' } });
  const root = f.install('caniuse-lite', { license: 'CC-BY-4.0' });
  const license = 'Attribution 4.0 International\n\n' +
    'Creative Commons Attribution 4.0 International Public License\n';
  write(join(root, 'LICENSE'), license);
  const calls = fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(calls.length, 6);
  const pkg = result.report.dependencies.packages.find(item => item.name === 'caniuse-lite');
  assert.equal(pkg.license, 'CC-BY-4.0');
  assert.equal(pkg.sourceVerified, false);
  assert.deepEqual(pkg.licensePolicy, {
    id: 'caniuse-lite-cc-by-4.0-data-reuse', scope: 'installed-third-party-data-reuse',
    licenseFile: 'LICENSE', licenseSha256: hash(license),
    attributionAndLicenseRetentionRequired: true, redistributionComplianceVerified: false,
  });
  assert.equal(result.report.dependencySourcesBuilt, false);
  assert.equal(result.report.nativeAccepted, false);
  verify(f, result);
  write(join(root, 'LICENSE'), `${license}\nchanged retained license\n`);
  assert.throws(() => verify(f, result), /third-party\/tool drift/);
});

for (const mutation of ['unknown-package', 'noncommercial', 'missing-license', 'wrong-license', 'license-symlink']) {
  test(`CC data reuse rejects ${mutation} before commands`, async t => {
    const f = await fixture(t);
    const name = mutation === 'unknown-package' ? 'unreviewed-data' : 'caniuse-lite';
    f.install('runtime', { dependencies: { [name]: '*' } });
    const root = f.install(name, {
      license: mutation === 'noncommercial' ? 'CC-BY-NC-4.0' : 'CC-BY-4.0',
    });
    if (mutation === 'wrong-license') write(join(root, 'LICENSE'), 'MIT, not CC-BY-4.0\n');
    if (mutation === 'license-symlink') fs.symlinkSync(join(f.original, 'LICENSE'), join(root, 'LICENSE'));
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.match(result.report.errors[0], /license|Symlink resource/);
    assert.equal(result.report.nativeAccepted, false);
  });
}

for (const version of ['2.3.0', '2.5.0']) {
  test(`spdx-exceptions@${version} CC-BY-3.0 data reuse binds README attribution and inventory`, async t => {
    const f = await fixture(t);
    f.install('runtime', { dependencies: { 'spdx-exceptions': '*' } });
    const root = f.install('spdx-exceptions', { version, license: 'CC-BY-3.0' });
    const readme = 'The Linux Foundation\nCreative Commons Attribution License 3.0 Unported\n';
    write(join(root, 'README.md'), readme);
    json(join(root, 'index.json'), ['GCC-exception-3.1', 'LLVM-exception']);
    fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    const pkg = result.report.dependencies.packages.find(item => item.name === 'spdx-exceptions');
    assert.equal(pkg.licensePolicy.id, 'spdx-exceptions-cc-by-3.0-data-reuse');
    assert.equal(pkg.licensePolicy.licenseFile, 'README.md');
    assert.equal(pkg.licensePolicy.licenseSha256, hash(readme));
    assert.equal(pkg.licensePolicy.attributionAndLicenseRetentionRequired, true);
    assert.equal(pkg.licensePolicy.redistributionComplianceVerified, false);
    verify(f, result);
    json(join(root, 'index.json'), ['changed-exception']);
    assert.throws(() => verify(f, result), /third-party\/tool drift/);
  });
}

for (const mutation of ['unknown-package', 'unreviewed-version', 'missing-readme',
  'wrong-readme', 'malformed-data', 'symlink-readme']) {
  test(`CC-BY-3.0 SPDX exception rejects ${mutation} before commands`, async t => {
    const f = await fixture(t);
    const name = mutation === 'unknown-package' ? 'unreviewed-spdx-data' : 'spdx-exceptions';
    f.install('runtime', { dependencies: { [name]: '*' } });
    const root = f.install(name, {
      version: mutation === 'unreviewed-version' ? '2.4.0' : '2.5.0', license: 'CC-BY-3.0',
    });
    if (mutation === 'symlink-readme') {
      fs.symlinkSync(join(f.original, 'LICENSE'), join(root, 'README.md'));
    } else if (mutation !== 'missing-readme') {
      write(join(root, 'README.md'), mutation === 'wrong-readme' ? 'No licensing statement\n' :
        'The Linux Foundation\nCreative Commons Attribution License 3.0 Unported\n');
    }
    json(join(root, 'index.json'), mutation === 'malformed-data' ? { license: 'MIT' } : ['LLVM-exception']);
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.match(result.report.errors[0], /license|Symlink|data inventory/);
  });
}

test('explicit npm registry aliases bind requested names, installed identities, versions and parser bytes', async t => {
  const declarations = { 'string-width-cjs': 'npm:string-width@^4.2.0',
    'wrap-ansi-cjs': 'npm:wrap-ansi@^7.0.0' };
  const f = await fixture(t, '0.3.30', {}, { coreDependencies: declarations });
  const parser = installAliasToolkit(f);
  for (const [name, version] of [['string-width', '4.2.3'], ['wrap-ansi', '7.0.0']]) {
    const target = f.install(name, { version });
    fs.symlinkSync(target, join(f.owner, 'node_modules', `${name}-cjs`), 'dir');
  }
  fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.deepEqual(result.report.dependencies.aliases.map(item => item.name).sort(),
    ['string-width-cjs', 'wrap-ansi-cjs']);
  for (const alias of result.report.dependencies.aliases) {
    assert.equal(alias.declaration, declarations[alias.name]);
    assert.equal(alias.actualName, alias.name.slice(0, -4));
    assert.equal(alias.targetRangeVerified, true);
    assert.ok(result.report.dependencies.links.some(item =>
      item.name === alias.name && item.target === alias.realpath));
  }
  assert.deepEqual(result.report.dependencies.aliasTools.map(item => item.name),
    ['npm-package-arg', 'semver']);
  for (const tool of result.report.dependencies.aliasTools) {
    assert.equal(tool.entrySha256, hash(fs.readFileSync(tool.entry)));
    assert.equal(tool.sourceVerified, false);
  }
  assert.equal(result.report.dependencySourcesBuilt, false);
  verify(f, result);
  write(join(parser, 'changed-parser.js'), 'parser inventory drift\n');
  assert.throws(() => verify(f, result), /third-party\/tool drift/);
});

test('transitive npm alias parser resolves from an explicit supplemental owner', async t => {
  const f = await fixture(t);
  const supplemental = join(f.workspace, 'supplemental-owner');
  json(join(supplemental, 'package.json'), { name: 'third-party-alias-owner', version: '1.0.0' });
  installAliasToolkit({ ...f, owner: supplemental });
  f.options.dependencyOwners = [supplemental];
  f.install('runtime', { dependencies: { 'string-width-cjs': 'npm:string-width@^4.2.0' } });
  const target = f.install('string-width', { version: '4.2.3' });
  fs.symlinkSync(target, join(f.owner, 'node_modules/string-width-cjs'), 'dir');
  fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.deepEqual(result.report.dependencies.dependencyOwners, [supplemental]);
  assert.equal(result.report.dependencies.aliases[0].owner, f.installed.get('runtime'));
  assert.equal(result.report.dependencies.aliasTools.find(item => item.name === 'npm-package-arg')
    .realpath, join(supplemental, 'node_modules/npm-package-arg'));
  verify(f, result);
});

for (const mutation of ['missing-parser', 'missing-alias-link', 'undeclared-alias',
  'wrong-target', 'range-mismatch', 'framework-target', 'framework-name', 'tag', 'url']) {
  test(`npm alias ${mutation} fails closed before commands`, async t => {
    const f = await fixture(t);
    let name = 'string-width-cjs';
    let range = 'npm:string-width@^4.2.0';
    if (mutation === 'framework-target') range = 'npm:@ibiz-template/cli@0.3.0';
    if (mutation === 'framework-name') name = '@ibiz-template/width';
    if (mutation === 'undeclared-alias') range = '^4.2.0';
    if (mutation === 'tag') range = 'npm:string-width@latest';
    if (mutation === 'url') range = 'npm:string-width@https://example.invalid/package.tgz';
    f.install('runtime', { dependencies: { [name]: range } });
    if (mutation !== 'missing-parser') installAliasToolkit(f);
    const target = f.install(mutation === 'wrong-target' ? 'unrelated-width' : 'string-width', {
      version: mutation === 'range-mismatch' ? '5.1.2' : '4.2.3',
    });
    if (mutation !== 'missing-alias-link') {
      fs.mkdirSync(dirname(join(f.owner, 'node_modules', name)), { recursive: true });
      fs.symlinkSync(target, join(f.owner, 'node_modules', name), 'dir');
    }
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.match(result.report.errors[0], /alias|identity mismatch|framework|Required dependency unavailable/i);
    assert.equal(result.report.nativeAccepted, false);
  });
}

test('original Git executable modes are preserved and their drift is rejected', async t => {
  const path = 'packages/cli/src/bin.ts';
  const f = await fixture(t, '0.3.30', {}, { executablePaths: [path] });
  fakeBuild(t, f);
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(fs.statSync(join(result.report.stage, path)).mode & 0o111, 0o111);
  verify(f, result);
  fs.chmodSync(join(result.report.stage, path), 0o600);
  assert.throws(() => verify(f, result), /executable mode drift/);
});

test('template copy must preserve the complete non-dotfile original input set', async t => {
  const f = await fixture(t);
  fakeBuild(t, f, ({ id, options }) => {
    if (id === 'core-template') write(join(options.cwd, 'dist/template/src/index.ts'), 'fake template\n');
  });
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors.join(' '), /Template output differs from original inputs/);
  assert.equal(fs.readFileSync(join(result.report.stage, 'packages/core/dist/template/src/index.ts'), 'utf8'),
    'fake template\n');
});

test('command entry read failure closes its log descriptor and retains the actual failure', async t => {
  const f = await fixture(t);
  const calls = fakeBuild(t, f);
  const originalOpen = fs.openSync;
  const originalRead = fs.readFileSync;
  const originalClose = fs.closeSync;
  const expectedEntry = join(f.installed.get('cpx'), 'bin/tool.cjs');
  let logDescriptor;
  let logClosed = false;
  let injected = false;
  t.mock.method(fs, 'openSync', (...args) => {
    const descriptor = originalOpen(...args);
    if (typeof args[0] === 'string' && args[0].endsWith('/core-template.log') &&
      (args[1] & fs.constants.O_APPEND)) logDescriptor = descriptor;
    return descriptor;
  });
  t.mock.method(fs, 'readFileSync', (...args) => {
    if (!injected && logDescriptor !== undefined && !logClosed &&
      typeof args[0] === 'number' && fs.readlinkSync(`/proc/self/fd/${args[0]}`) === expectedEntry) {
      injected = true;
      throw new Error('mock command entry read failed');
    }
    return originalRead(...args);
  });
  t.mock.method(fs, 'closeSync', descriptor => {
    if (descriptor === logDescriptor) logClosed = true;
    return originalClose(descriptor);
  });
  const result = runNativeCliSourceBuild(f.options);
  assert.equal(injected, true);
  assert.equal(logClosed, true, 'The command log descriptor must close after entry read failure');
  assert.equal(calls.length, 0);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /mock command entry read failed/);
  assert.equal(result.report.commands.length, 0);
  assert.equal(result.report.sourceBuildsCompleted, false);
  assert.equal(result.report.nativeAccepted, false);
  assert.equal(fs.readFileSync(join(result.destination, 'logs/core-template.log'), 'utf8'), '');
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)).errors, result.report.errors);
  assert.throws(() => verify(f, result), /CLI source build did not complete/);
});

for (const mutation of ['change-core', 'delete-core', 'change-input', 'change-original', 'throw', 'exit', 'help']) {
  test(`build ${mutation} retains actual failure and does not confer acceptance`, async t => {
    const f = await fixture(t);
    fakeBuild(t, f, ({ id, options }) => {
      if (mutation === 'throw' && id === 'core-lint') throw new Error('mock spawn failed');
      if (mutation === 'exit' && id === 'core-tsc') return { status: 7, signal: null };
      if (mutation === 'help' && id === 'cli-help') {
        fs.ftruncateSync(options.stdio[1], 0);
        fs.writeSync(options.stdio[1], 'not help\n');
      }
      if (id !== 'cli-tsc') return;
      const root = join(dirname(options.cwd), 'core');
      if (mutation === 'change-core') write(join(root, 'dist/index.js'), 'later overwritten\n');
      if (mutation === 'delete-core') fs.unlinkSync(join(root, 'dist/index.js'));
      if (mutation === 'change-input') write(join(root, 'src/index.ts'), 'changed staged\n');
      if (mutation === 'change-original') write(join(f.original, 'packages/core/src/index.ts'), 'changed original\n');
    });
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.sourceBuildsCompleted, false);
    assert.equal(result.report.toolchainSourceBuilt, false);
    assert.equal(result.report.nativeAccepted, false);
    assert.ok(result.report.commands.length > 0);
    assert.ok(fs.existsSync(result.reportPath));
    if (mutation === 'change-core' || mutation === 'delete-core') {
      assert.match(result.report.errors.join(' '), /Build output drift/);
      const actual = result.report.outputs.entries.find(item =>
        item.path === 'packages/core/dist/index.js');
      if (mutation === 'change-core') assert.equal(actual.sha256, hash(Buffer.from('later overwritten\n')));
      else assert.equal(actual, undefined);
      assert.ok(result.report.outputDrift.length > 0);
    }
    assert.throws(() => verify(f, result), /did not complete/);
  });
}

for (const mutation of ['output', 'delete-output', 'extra-output', 'input', 'original',
  'manifest', 'log', 'tool', 'dependency', 'fallback', 'missing-command', 'command-output', 'acceptance']) {
  test(`read-only verifier rejects ${mutation} drift`, async t => {
    const f = await fixture(t);
    const calls = fakeBuild(t, f);
    const result = runNativeCliSourceBuild(f.options);
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    const stage = result.report.stage;
    if (mutation === 'output') write(join(stage, 'packages/core/dist/index.js'), 'changed\n');
    if (mutation === 'delete-output') fs.unlinkSync(join(stage, 'packages/core/dist/index.js'));
    if (mutation === 'extra-output') write(join(stage, 'packages/core/dist/extra.js'), 'extra\n');
    if (mutation === 'input') write(join(stage, 'packages/core/src/index.ts'), 'changed\n');
    if (mutation === 'original') write(join(f.original, 'packages/core/src/index.ts'), 'changed\n');
    if (mutation === 'manifest') json(join(stage, 'packages/cli/package.json'), { name: 'changed' });
    if (mutation === 'log') write(join(result.destination, 'logs/core-lint.log'), 'changed\n');
    if (mutation === 'tool') write(join(f.installed.get('typescript'), 'bin/tool.cjs'), 'changed\n');
    if (mutation === 'dependency') write(join(f.installed.get('runtime'), 'changed.js'), 'changed\n');
    if (mutation === 'fallback') {
      const link = join(stage, 'packages/cli/node_modules/@ibiz-template/cli-core');
      fs.unlinkSync(link);
      fs.symlinkSync(f.owner, link);
    }
    if (mutation === 'missing-command') updateReport(result.reportPath, report => { report.commands.pop(); });
    if (mutation === 'command-output') updateReport(result.reportPath, report => {
      report.commands.find(item => item.id === 'core-tsc').outputs.entries = [];
    });
    if (mutation === 'acceptance') updateReport(result.reportPath, report => { report.nativeAccepted = true; });
    const before = fs.readFileSync(result.reportPath);
    assert.throws(() => verify(f, result),
      /drift|changed|mismatch|Missing fresh|incomplete|Unsupported acceptance/i);
    assert.deepEqual(fs.readFileSync(result.reportPath), before);
    assert.equal(calls.length, 6, 'Verification must remain read-only');
  });
}

test('output/report containment and symlink ancestors reject without overwrite', async t => {
  const f = await fixture(t);
  fakeBuild(t, f);
  assert.throws(() => runNativeCliSourceBuild({ ...f.options, output: join(f.workspace, 'outside') }),
    /direct child/);
  fs.mkdirSync(f.output, { recursive: true });
  write(join(f.output, 'keep.txt'), 'keep');
  assert.throws(() => runNativeCliSourceBuild(f.options), /must not be overwritten/);
  assert.equal(fs.readFileSync(join(f.output, 'keep.txt'), 'utf8'), 'keep');
  const outside = join(f.workspace, 'outside');
  fs.mkdirSync(outside);
  const root = dirname(f.output);
  const link = join(root, 'linked');
  fs.symlinkSync(outside, link);
  assert.throws(() => runNativeCliSourceBuild({ ...f.options, output: link }), /must not be overwritten/);
  const reportLink = join(dirname(f.fetchReport), 'report-link.json');
  fs.symlinkSync(f.fetchReport, reportLink);
  assert.throws(() => verifyNativeCliFetchReport({ ...f.options, fetchReport: reportLink }), /Expected report.json/);
});
