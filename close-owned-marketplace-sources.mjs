#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { collectPluginReferences } from './harness-plugin-audit.mjs';

const workspaceDefault = path.resolve(import.meta.dirname, '..');
const inventoryPath = 'scripts/docs/MARKETPLACE-SOURCE-INVENTORY-20261103.json';
const exportId = 'BASE.ibizmodeling.logicdesign.logicdesign';
const unresolvedIds = ['EXTENSION.ibizmodeling.ibizmodellibrary',
  'EXTENSION.ibizmodeling.ibizmodelincrementpackage'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const objectHash = (type, bytes) => createHash('sha1')
  .update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const maxSourceBytes = 256 * 1024 * 1024;
const modelLibraryRevision = '9b0ffe7abd675767a14881a3524fde0709b97437';

function metadataTools() {
  const require = createRequire(import.meta.url);
  const roots = [
    path.join(workspaceDefault, 'ibiz-app-hub/node_modules/.pnpm/@xmldom+xmldom@0.8.11/node_modules/@xmldom/xmldom'),
    path.join(workspaceDefault, 'plm-web/node_modules/.pnpm/yaml@2.3.3/node_modules/yaml'),
  ];
  const xml = require(roots[0]), yaml = require(roots[1]);
  const versions = roots.map(root => JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
  assert.deepEqual(versions, ['0.8.11', '2.3.3']);
  return { DOMParser: xml.DOMParser, yaml, versions, files: roots.flatMap(root =>
    readTree(root, { jsonOnly: false }).entries.map(row => path.join(root, row.path))) };
}

export function inspectMarketplaceSourceDeclarations(source, tools = metadataTools()) {
  const tree = readTree(source, { jsonOnly: false });
  const children = (node, name) => Array.from(node.childNodes).filter(child =>
    child.nodeType === 1 && (!name || child.localName === name));
  const field = (node, name) => children(node, name)[0]?.textContent.trim() ?? null;
  const coordinates = node => Object.fromEntries(['groupId', 'artifactId', 'version', 'scope', 'type',
    'classifier', 'optional', 'relativePath'].map(name => [name, field(node, name)]));
  const poms = [], generatorInputs = [], npmDeclarations = [], appModels = [], packages = new Set();
  for (const file of tree.contents) {
    const binding = { path: file.path, bytes: file.bytes, sha256: file.sha256 };
    if (path.basename(file.path) === 'pom.xml') {
      const diagnostics = [];
      const document = new tools.DOMParser({ errorHandler: {
        warning: message => diagnostics.push(message), error: message => diagnostics.push(message),
        fatalError: message => diagnostics.push(message),
      } }).parseFromString(file.data.toString(), 'application/xml');
      assert.ok(document.documentElement?.localName === 'project' && !document.doctype && !diagnostics.length,
        'Maven source declaration must be valid XML without a DOCTYPE');
      const project = document.documentElement;
      const properties = children(project, 'properties')[0];
      const dependencies = Array.from(document.getElementsByTagNameNS('*', 'dependency')).map(node => ({
        ...coordinates(node),
        context: [node.parentNode?.parentNode?.localName, node.parentNode?.localName].join('/'),
      }));
      poms.push({ ...binding, project: coordinates(project),
        parent: children(project, 'parent').map(coordinates),
        properties: properties ? Object.fromEntries(children(properties).map(node =>
          [node.localName, node.textContent.trim()])) : {},
        modules: children(project, 'modules').flatMap(node => children(node, 'module').map(child => child.textContent.trim())),
        dependencies, plugins: Array.from(document.getElementsByTagNameNS('*', 'plugin')).map(coordinates),
        unresolvedPropertyExpressions: [...new Set(dependencies.flatMap(row =>
          Object.values(row).filter(value => typeof value === 'string')
            .flatMap(value => value.match(/\$\{[^}]+\}/g) ?? [])))],
        transitiveDependenciesResolved: false });
    } else if (path.basename(file.path) === 'ibizmodel.yaml') {
      generatorInputs.push({ ...binding, format: 'yaml',
        declaration: tools.yaml.parse(file.data.toString(), { strict: true, uniqueKeys: true }),
        generatorImplementationRebuilt: false });
    } else if (path.basename(file.path) === '.ibizproject') {
      generatorInputs.push({ ...binding, format: 'opaque-project-metadata',
        generatorImplementationRebuilt: false });
    } else if (path.basename(file.path) === 'package.json') {
      const value = JSON.parse(file.data);
      npmDeclarations.push({ ...binding, name: value.name ?? null, version: value.version ?? null,
        dependencies: value.dependencies ?? {}, devDependencies: value.devDependencies ?? {},
        peerDependencies: value.peerDependencies ?? {}, optionalDependencies: value.optionalDependencies ?? {},
        scripts: value.scripts ?? {}, scriptsExecuted: false, dependencySourcesRetrieved: false });
    }
    if (/(?:^|\/)PSSYSAPP(?:\.[^/]+)?\.json$/.test(file.path)) {
      const references = collectPluginReferences(JSON.parse(file.data));
      assert.deepEqual(references.invalidReferences, [], 'A generated app contains an invalid exact PF reference');
      for (const reference of references.packages) packages.add(reference.repo);
      appModels.push({ ...binding, referenceCount: references.referenceCount,
        directPackages: references.packages.map(row => row.repo) });
    }
  }
  return { poms, generatorInputs, npmDeclarations, appModels, directPfPackages: [...packages].sort(),
    recursiveDependenciesRetrieved: false, recursiveLicensesVerified: false,
    repositoryScriptsExecuted: false };
}

function environment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('GIT_') && !['SSH_ASKPASS', 'TAR_OPTIONS'].includes(key)));
  return { ...env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/false', SSH_ASKPASS: '/bin/false',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
}

function command(program, args, { cwd, input, timeout = 30000, maxBuffer = 4 * 1024 * 1024 } = {}) {
  const result = spawnSync(program, args, { cwd, input, env: environment(), timeout, maxBuffer });
  assert.ok(!result.error && !result.signal && result.status === 0,
    `${program} command failed; inspect the retained private evidence`);
  return result.stdout;
}

function git(repository, args, options = {}) {
  return command('git', ['--no-pager', '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=/dev/null', '-C', repository, ...args], options);
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && value.length < 1024
    && !path.isAbsolute(value) && !/[\0\r\n\\]/.test(value)
    && value.split('/').every(part => part && !['.', '..', '.git'].includes(part.toLowerCase()));
}

export function parseMarketplaceGitTree(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.at(-1) === 0, 'Git tree must be NUL terminated');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const paths = new Set();
  const rows = text.slice(0, -1).split('\0').map(line => {
    const tab = line.indexOf('\t');
    const match = /^100644 blob ([a-f0-9]{40}) +([0-9]+)$/.exec(line.slice(0, tab));
    const relative = line.slice(tab + 1);
    assert.ok(tab > 0 && match && safeRelative(relative),
      'Only safe regular non-executable committed files enter this reviewed exporter');
    assert.ok(!paths.has(relative), 'Duplicate committed path');
    paths.add(relative);
    const size = Number(match[2]);
    assert.ok(Number.isSafeInteger(size) && size <= 64 * 1024 * 1024);
    return { path: relative, mode: '100644', oid: match[1], bytes: size };
  });
  assert.ok(rows.length > 0 && rows.length <= 10000);
  assert.ok(rows.reduce((sum, row) => sum + row.bytes, 0) <= maxSourceBytes);
  return rows;
}

export function parseMarketplaceBlobBatch(bytes, expected) {
  const contents = new Map();
  let offset = 0;
  for (const row of expected) {
    const end = bytes.indexOf(10, offset);
    assert.ok(end >= offset, 'Missing Git blob header');
    assert.equal(bytes.subarray(offset, end).toString(), `${row.oid} blob ${row.bytes}`);
    const start = end + 1, finish = start + row.bytes;
    assert.ok(finish < bytes.length && bytes[finish] === 10, 'Truncated Git blob');
    const data = bytes.subarray(start, finish);
    assert.equal(objectHash('blob', data), row.oid, 'Git blob contents differ from their object ID');
    contents.set(row.oid, data);
    offset = finish + 1;
  }
  assert.equal(offset, bytes.length, 'Undeclared data follows the Git blob batch');
  return contents;
}

export function bindUnresolvedCatalogSources(inventory, observations) {
  assert.equal(inventory.contract, 'marketplace-local-source-observations-v1');
  assert.equal(inventory.entries.length, 23);
  assert.equal(new Set(inventory.entries.map(row => row.catalogId)).size, 23);
  assert.ok(Array.isArray(observations) && observations.length > 0);
  return unresolvedIds.map(id => {
    const declared = inventory.entries.find(row => row.catalogId === id);
    assert.ok(declared && declared.localPath === null && declared.gitCommit === null);
    const matches = observations.map(batch => {
      assert.equal(batch.status, 200);
      assert.equal(batch.total, 23);
      assert.equal(batch.items.length, 23);
      assert.equal(new Set(batch.items.map(row => row.pscoreprdfuncid)).size, 23);
      const matching = batch.items.filter(row => row.pscoreprdfuncid === id);
      assert.equal(matching.length, 1);
      const item = matching[0];
      assert.equal(item.httpurltorepo, declared.repository);
      assert.equal(item.funcstate, declared.catalogState);
      assert.match(item.path, /^\/modeling_addons\/[a-z0-9_]+$/);
      return { repository: item.httpurltorepo, catalogPath: item.path, catalogState: item.funcstate };
    });
    matches.forEach(value => assert.deepEqual(value, matches[0]));
    const upstream = new URL(matches[0].repository);
    assert.ok(['https:', 'http:'].includes(upstream.protocol)
      && !upstream.username && !upstream.password && !upstream.search && !upstream.hash);
    return { catalogId: id, ...matches[0], expectedLocalPath: declared.expectedLocalPath,
      observationCount: matches.length, revision: null, license: null,
      implementationSourceLocated: false, generatorInputsLocated: false,
      sourceClosure: false, status: 'catalog-repository-and-model-path-only' };
  });
}

function read(directories, filename) {
  return readPinnedFile(directories, directories.open(path.dirname(filename)), path.basename(filename)).data;
}

function inputDigest(directories, filename) {
  const parent = directories.open(path.dirname(filename));
  directories.verify(parent);
  const access = directories.entry(parent, path.basename(filename));
  const fd = fs.openSync(access, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    assert.ok(before.isFile() && before.size <= maxSourceBytes);
    const digest = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let offset = 0, size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      digest.update(buffer.subarray(0, size));
      offset += size;
    }
    const after = fs.fstatSync(fd), current = fs.lstatSync(access);
    assert.equal(offset, before.size);
    for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
      assert.equal(after[key], before[key], 'Execution input changed while reading');
      assert.equal(current[key], after[key], 'Execution input path changed');
    }
    directories.verify(parent);
    return digest.digest('hex');
  } finally { fs.closeSync(fd); }
}

function put(directories, root, relative, bytes) {
  assert.ok(safeRelative(relative));
  const filename = path.join(root, relative);
  const parent = directories.open(path.dirname(filename), { create: true });
  directories.write(parent, path.basename(filename), bytes);
}

function sourceState(repository) {
  const value = args => git(repository, args, { maxBuffer: 16 * 1024 * 1024 });
  const root = value(['rev-parse', '--absolute-git-dir']).toString().trim();
  assert.equal(fs.realpathSync(root), path.join(fs.realpathSync(repository), '.git'));
  const optional = filename => fs.existsSync(filename) ? hash(fs.readFileSync(filename)) : null;
  return { head: value(['rev-parse', 'HEAD']).toString().trim(),
    statusSha256: hash(value(['status', '--porcelain=v1', '-z', '--untracked-files=normal'])),
    indexSha256: optional(path.join(root, 'index')),
    configSha256: optional(path.join(root, 'config')) };
}

function inspectExport(root, entries) {
  const tree = readTree(root, { jsonOnly: false });
  assert.equal(tree.contents.length, entries.length, 'Exported file set differs from the full commit tree');
  const expected = new Map(entries.map(row => [row.path, row]));
  for (const file of tree.contents) {
    const original = expected.get(file.path);
    assert.ok(original && file.bytes === original.bytes);
    assert.equal(objectHash('blob', file.data), original.oid, 'Exported source blob changed');
    assert.equal(fs.statSync(path.join(root, file.path)).mode & 0o111, 0);
  }
  return { files: tree.files, bytes: tree.bytes, fingerprint: tree.fingerprint, entries: tree.entries };
}

export function rebuildMarketplaceTree({ source, repository, entries }) {
  command('git', ['init', '--bare', '--object-format=sha1', repository]);
  const quoted = entries.map(row => `"${row.path.replaceAll('"', '\\"')}"`).join('\n') + '\n';
  const ids = command('git', [`--git-dir=${repository}`, '--no-pager', 'hash-object',
    '--no-filters', '-w', '--stdin-paths'], { cwd: source, input: quoted }).toString().trim().split('\n');
  assert.deepEqual(ids, entries.map(row => row.oid), 'Physical export files differ from the source Git blobs');
  const index = Buffer.from(entries.map((row, i) => `${row.mode} ${ids[i]}\t${row.path}\0`).join(''));
  command('git', [`--git-dir=${repository}`, 'update-index', '-z', '--index-info'], { input: index });
  return command('git', [`--git-dir=${repository}`, 'write-tree']).toString().trim();
}

function executable(name) {
  for (const root of process.env.PATH.split(path.delimiter)) {
    const candidate = path.join(root, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  throw new Error(`Missing executable: ${name}`);
}

function refsProbe(repository, cwd) {
  const address = new URL(repository);
  if (address.protocol !== 'https:') return {
    status: 'not-queried-catalog-advertises-http', transportAuthenticated: false,
    commitAuthenticated: false, sourceRetrieved: false,
  };
  const args = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
    '-c', 'credential.helper=', 'ls-remote', '--symref', repository,
    'HEAD', 'refs/heads/*', 'refs/tags/*'];
  const result = spawnSync('git', args, { cwd, env: environment(), timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
  const rows = result.stdout?.toString().split('\n').filter(Boolean) ?? [];
  return { status: result.status === 0 && !result.error && rows.length ? 'refs-observed' : 'refs-unavailable',
    exitCode: result.status, signal: result.signal, errorCode: result.error?.code ?? null,
    outputSha256: hash(result.stdout ?? Buffer.alloc(0)), errorSha256: hash(result.stderr ?? Buffer.alloc(0)),
    rawOutput: result.stdout?.toString() ?? '', rawError: result.stderr?.toString() ?? '',
    refs: rows, transportAuthenticated: result.status === 0 && !result.error && rows.length > 0,
    commitAuthenticated: false, sourceRetrieved: false };
}

function exportMarketplaceCommit({ directories, output, repository, revision, expectedFiles, catalogId, origin }) {
  assert.equal(git(repository, ['rev-parse', `${revision}^{commit}`]).toString().trim(), revision);
  const expectedTree = git(repository, ['rev-parse', `${revision}^{tree}`]).toString().trim();
  const committed = parseMarketplaceGitTree(git(repository,
    ['ls-tree', '-rz', '--long', '--full-tree', revision], { maxBuffer: 16 * 1024 * 1024 }));
  if (expectedFiles !== undefined) assert.equal(committed.length, expectedFiles);
  const unique = [...new Map(committed.map(row => [row.oid, row])).values()];
  console.log(JSON.stringify({ stage: 'committed-blobs-export', catalogId, files: committed.length,
    bytes: committed.reduce((sum, row) => sum + row.bytes, 0) }));
  const blobs = parseMarketplaceBlobBatch(git(repository, ['cat-file', '--batch'], {
    input: unique.map(row => row.oid).join('\n') + '\n',
    maxBuffer: maxSourceBytes + 4 * 1024 * 1024,
  }), unique);
  const source = directories.open(path.join(output, 'source'), { create: true, exclusive: true });
  for (const file of committed) put(directories, source.path, file.path, blobs.get(file.oid));
  const exported = inspectExport(source.path, committed);
  const rebuiltTree = rebuildMarketplaceTree({ source: source.path,
    repository: path.join(output, 'reconstructed.git'), entries: committed });
  assert.equal(rebuiltTree, expectedTree, 'The complete tree reconstructed from exported files differs');
  const tarArgs = filename => ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '--format=gnu', '--create', '--file', filename, '--directory', source.path, '.'];
  command('tar', tarArgs(path.join(output, 'source-bundle.tar')));
  command('tar', tarArgs(path.join(output, 'source-bundle-replay.tar')));
  const archive = read(directories, path.join(output, 'source-bundle.tar'));
  assert.equal(hash(archive), hash(read(directories, path.join(output, 'source-bundle-replay.tar'))));
  const restored = directories.open(path.join(output, 'restored-source'), { create: true, exclusive: true });
  command('tar', ['--extract', '--file', path.join(output, 'source-bundle.tar'),
    '--directory', restored.path, '--no-same-owner', '--no-same-permissions']);
  assert.deepEqual(inspectExport(restored.path, committed), exported);
  const restoredTree = rebuildMarketplaceTree({ source: restored.path,
    repository: path.join(output, 'restored.git'), entries: committed });
  assert.equal(restoredTree, expectedTree);
  const collisionMap = new Map();
  for (const row of committed) {
    const key = row.path.toLowerCase();
    collisionMap.set(key, [...(collisionMap.get(key) ?? []), row.path]);
  }
  const license = read(directories, path.join(source.path, 'LICENSE'));
  return { catalogId, repository: origin, revision, tree: expectedTree, rebuiltTree, restoredTree, ...exported,
    caseCollisionGroups: [...collisionMap.values()].filter(rows => rows.length > 1),
    license: { path: 'LICENSE', bytes: license.length, sha256: hash(license),
      observedFirstLine: license.toString().split(/\r?\n/, 1)[0],
      legalReview: false, transitiveLicenseClosure: false },
    archive: { path: 'source-bundle.tar', bytes: archive.length, sha256: hash(archive),
      replayBytewise: true, extractionBytewise: true },
    upstreamAuthenticated: false, completeDependencySources: false,
    sourceBuildExecuted: false, nativeMarketplaceAcceptance: false };
}

function directoryBytes(root) {
  let total = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    assert.ok(!entry.isSymbolicLink());
    try { total += entry.isDirectory() ? directoryBytes(filename) : fs.statSync(filename).size; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return total;
}

async function retrieveModelLibrary({ directories, destination, repository, origin, journal }) {
  assert.equal(origin, 'https://gitee.com/ibizlab-appstore/model-library.git');
  command('git', ['init', '--bare', '--object-format=sha1', repository]);
  const args = [`--git-dir=${repository}`, '-c', 'protocol.allow=never',
    '-c', 'protocol.https.allow=always', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null',
    'fetch', '--progress', '--depth=1', '--no-tags', '--no-recurse-submodules', origin, modelLibraryRevision];
  const startedAt = Date.now();
  const child = spawn('git', args, { cwd: destination.path, env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
  journal({ stage: 'model-library-pinned-fetch-start', pid: child.pid, revision: modelLibraryRevision });
  let bytes = 0, reason = null, forceKill;
  const stdout = [], stderr = [];
  const stop = value => {
    if (reason) return;
    reason = value;
    child.kill('SIGTERM');
    forceKill = setTimeout(() => child.kill('SIGKILL'), 3000);
  };
  const collect = chunks => data => {
    bytes += data.length;
    if (bytes > 4 * 1024 * 1024) stop('git-output-budget-exceeded');
    else chunks.push(data);
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  const monitor = setInterval(() => {
    try {
      if (directoryBytes(repository) > 192 * 1024 * 1024) stop('git-object-budget-exceeded');
      if (Date.now() - startedAt > 90000) stop('git-fetch-time-budget-exceeded');
    } catch { stop('git-budget-monitor-failed'); }
  }, 500);
  const progress = setInterval(() => journal({ stage: 'model-library-pinned-fetch-running',
    pid: child.pid, elapsedMs: Date.now() - startedAt, gitDirectoryBytes: directoryBytes(repository) }), 25000);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
  } finally {
    clearInterval(monitor);
    clearInterval(progress);
    clearTimeout(forceKill);
  }
  directories.write(destination, 'model-library-fetch.private.log',
    Buffer.concat([...stdout, ...stderr]));
  const evidence = { ...result, pid: child.pid, reason, elapsedMs: Date.now() - startedAt,
    gitDirectoryBytes: directoryBytes(repository), revision: modelLibraryRevision,
    shallow: true, depth: 1, tagsRetrieved: false, repositoryScriptsExecuted: false };
  journal({ stage: 'model-library-pinned-fetch-finish', ...evidence });
  assert.ok(result.exitCode === 0 && !result.signal && !reason, 'Pinned model-library source fetch failed');
  assert.equal(git(repository, ['rev-parse', 'FETCH_HEAD^{commit}']).toString().trim(), modelLibraryRevision);
  return evidence;
}

export async function closeOwnedMarketplaceSources({
  workspace = workspaceDefault, output, upstreamRefs = false, retrieveLibrary = false,
} = {}) {
  workspace = path.resolve(workspace);
  output = path.resolve(workspace, output);
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^k01-marketplace-source-[a-z0-9][a-z0-9-]{0,69}$/);
  const directories = new PinnedDirectories();
  const startedAt = new Date().toISOString();
  let destination;
  try {
    destination = directories.open(output, { create: true, exclusive: true });
    let phase = 0;
    const journal = value => {
      directories.write(destination, `${String(++phase).padStart(3, '0')}-phase.private.json`,
        json({ ...value, at: new Date().toISOString() }));
      console.log(JSON.stringify(value));
    };
    const inputFiles = [fileURLToPath(import.meta.url),
      fileURLToPath(new URL('./native-candidate-files.mjs', import.meta.url)),
      fileURLToPath(new URL('./harness-plugin-audit.mjs', import.meta.url)),
      process.execPath, executable('git'), executable('tar')];
    const parsers = retrieveLibrary ? metadataTools() : null;
    if (parsers) inputFiles.push(...parsers.files);
    const implementationBindings = inputFiles.map(filename => ({
      path: filename, sha256: inputDigest(directories, filename),
    }));
    directories.write(destination, 'executed-tool.private.mjs', read(directories, fileURLToPath(import.meta.url)));
    const manifestBytes = read(directories, path.join(workspace, inventoryPath));
    const inventory = JSON.parse(manifestBytes);
    assert.ok(safeRelative(inventory.catalogEvidence));
    const catalogBytes = read(directories, path.join(workspace, inventory.catalogEvidence));
    const unresolved = bindUnresolvedCatalogSources(inventory, JSON.parse(catalogBytes));
    const entry = inventory.entries.find(row => row.catalogId === exportId);
    assert.equal(entry.checkoutStatus, 'git-objects-only-no-worktree-files');
    assert.equal(entry.localPath, 'extensions/upstream/logic-design-standard');
    assert.match(entry.gitCommit, /^[a-f0-9]{40}$/);
    const repository = path.join(workspace, entry.localPath);
    directories.open(repository);
    const before = sourceState(repository);
    const origin = git(repository, ['config', '--get', 'remote.origin.url']).toString().trim();
    assert.equal(origin, entry.repository);
    const exported = exportMarketplaceCommit({ directories, output, repository, revision: entry.gitCommit,
      expectedFiles: entry.treeFiles, catalogId: exportId, origin: entry.repository });
    const result = {
      contract: 'owned-marketplace-complete-git-source-export-v1', startedAt,
      status: 'exact-source-tree-exported-rebuilt-and-restored-not-native-marketplace-acceptance',
      source: exported,
      unresolved, manifestSha256: hash(manifestBytes), catalogEvidenceSha256: hash(catalogBytes),
      sourceStateBefore: before, sourceStateAfter: sourceState(repository),
      implementationBindings, tools: {
        git: command('git', ['--version']).toString().trim(),
        tar: command('tar', ['--version']).toString().split('\n', 1)[0],
        node: process.version,
      },
      upstreamRefsRequested: upstreamRefs, upstreamRefs: [],
      fullK01Acceptance: false, dockerOperations: false, dependencyInstallation: false,
      sharedWrites: false, nativeRegistration: false,
    };
    if (retrieveLibrary) {
      const declared = unresolved.find(row => row.catalogId === unresolvedIds[0]);
      const libraryRoot = directories.open(path.join(output, 'model-library'), { create: true, exclusive: true });
      const libraryRepository = path.join(libraryRoot.path, 'upstream.git');
      const retrieval = await retrieveModelLibrary({ directories, destination,
        repository: libraryRepository, origin: declared.repository, journal });
      result.modelLibrary = exportMarketplaceCommit({ directories, output: libraryRoot.path,
        repository: libraryRepository, revision: modelLibraryRevision,
        catalogId: declared.catalogId, origin: declared.repository });
      result.modelLibrary.retrieval = retrieval;
      result.source.declarations = inspectMarketplaceSourceDeclarations(path.join(output, 'source'), parsers);
      result.modelLibrary.declarations = inspectMarketplaceSourceDeclarations(
        path.join(libraryRoot.path, 'source'), parsers);
      result.declarationParserVersions = parsers.versions;
      result.modelLibrary.transportAuthenticated = true;
      result.modelLibrary.commitSignatureVerified = false;
      declared.status = 'exact-upstream-source-exported-rebuilt-and-restored-dependencies-open';
      declared.revision = modelLibraryRevision;
      declared.license = result.modelLibrary.license;
      declared.implementationSourceLocated = true;
      declared.generatorInputsLocated = result.modelLibrary.declarations.generatorInputs.length > 0;
    }
    assert.deepEqual(result.sourceStateAfter, before, 'The original repository state changed');
    if (upstreamRefs) {
      for (const item of [{ catalogId: exportId, repository: entry.repository }, ...unresolved]) {
        console.log(JSON.stringify({ stage: 'official-refs-probe', catalogId: item.catalogId }));
        result.upstreamRefs.push({ catalogId: item.catalogId, ...refsProbe(item.repository, output) });
      }
    }
    assert.deepEqual(result.sourceStateAfter, sourceState(repository), 'Original source state changed after probes');
    assert.equal(hash(read(directories, path.join(workspace, inventoryPath))), hash(manifestBytes));
    assert.equal(hash(read(directories, path.join(workspace, inventory.catalogEvidence))), hash(catalogBytes));
    for (const binding of implementationBindings) {
      assert.equal(inputDigest(directories, binding.path), binding.sha256, 'An execution input changed');
    }
    result.executionInputsUnchanged = true;
    result.finishedAt = new Date().toISOString();
    directories.write(destination, 'report.private.json', json(result));
    const summary = { contract: result.contract, status: result.status,
      exportedCatalogId: exportId, revision: entry.gitCommit, tree: exported.tree,
      files: exported.files, bytes: exported.bytes, fingerprint: exported.fingerprint,
      licenseSha256: exported.license.sha256, archiveSha256: exported.archive.sha256,
      modelLibrary: result.modelLibrary ? { revision: result.modelLibrary.revision,
        tree: result.modelLibrary.tree, files: result.modelLibrary.files, bytes: result.modelLibrary.bytes } : null,
      unresolvedCatalogIds: unresolved.map(row => row.catalogId), fullK01Acceptance: false,
      reportSha256: hash(json(result)) };
    directories.write(destination, 'summary.json', json(summary));
    console.log(JSON.stringify(summary, null, 2));
    return result;
  } catch (error) {
    if (destination) directories.write(destination, 'failure.private.json',
      json({ startedAt, failedAt: new Date().toISOString(), name: error.name, message: error.message }));
    throw error;
  } finally { directories.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    output: { type: 'string' }, 'upstream-refs': { type: 'boolean', default: false },
    'retrieve-model-library': { type: 'boolean', default: false },
  }, strict: true });
  await closeOwnedMarketplaceSources({ output: values.output, upstreamRefs: values['upstream-refs'],
    retrieveLibrary: values['retrieve-model-library'] });
}
