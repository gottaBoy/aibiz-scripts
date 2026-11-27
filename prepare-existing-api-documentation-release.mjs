#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { acquireNotificationDeploymentLock } from './deploy-existing-plm-notification-style.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hostDoc = path.join(workspace, 'plm-web/dist/doc');
const prefix = '/ibizplm-plmweb/doc/';
const containerId = '70327c269425370bed8648bcaa90feadf441ff7a6c5f75b975889cf4c5416612';
const imageId = 'sha256:027de06a1f8d8d5e44e17b849d44d39a421c6fe0787433b5e229ba00655ca99c';
const generatedPath = /^api-reference\/(?:manifest\.json|(?:en|zh-CN)\/(?:ServiceAPI\.md|_sidebar\.md|search\.json|entities\/[A-Za-z_][A-Za-z0-9_-]*\.md))$/;
const critical = ['index.html', 'script/aibiz-api-reference.js', 'script/docsify.js',
  'css/local-theme.css', 'api-reference/manifest.json',
  'api-reference/zh-CN/ServiceAPI.md', 'api-reference/en/ServiceAPI.md',
  'api-reference/zh-CN/search.json', 'api-reference/en/search.json'];

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { timeout: 120_000, maxBuffer: 256 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${program} command failed; output kept private by the caller`);
  return Buffer.from(result.stdout ?? '');
}
function safe(relative) {
  assert.ok(typeof relative === 'string' && relative && !path.isAbsolute(relative) && !/[\0\\\r\n]/.test(relative));
  assert.ok(relative.split('/').every(part => part && part !== '.' && part !== '..'));
}
function write(root, relative, bytes) {
  safe(relative);
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return { path: relative, bytes: bytes.length, sha256: hash(bytes) };
}
function inventory(root) {
  assert.equal(fs.realpathSync(root), root);
  const rows = [];
  const visit = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      safe(name);
      assert.equal(entry.isSymbolicLink(), false, 'Documentation inputs cannot traverse symlinks');
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file, name);
      else {
        assert.ok(entry.isFile());
        const before = fs.lstatSync(file);
        const bytes = fs.readFileSync(file);
        const after = fs.lstatSync(file);
        for (const key of ['dev', 'ino', 'mtimeMs', 'ctimeMs', 'size']) assert.equal(before[key], after[key]);
        rows.push({ path: name, sha256: hash(bytes), bytes: bytes.length, uid: String(before.uid),
          gid: String(before.gid), mode: (before.mode & 0o7777).toString(8),
          dev: String(before.dev), ino: String(before.ino) });
      }
    }
  };
  visit(root);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function apiDocumentationRuntimeWitness(value, root = workspace) {
  assert.equal(value.Id, containerId);
  assert.equal(value.Image, imageId);
  assert.equal(value.Name, '/plmweb');
  assert.equal(value.State.Status, 'running');
  const mounts = [...value.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination));
  for (const [source, destination] of [
    ['plm-web/dist', '/opt/aibiz/local-dist'], ['plm-web/public/plugins', '/opt/aibiz/local-plugins'],
    ['plm/model', '/app/model'],
  ]) {
    const matches = mounts.filter(row => row.Destination === destination);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].Type, 'bind');
    assert.equal(matches[0].Source, path.join(root, source));
    assert.equal(matches[0].RW, false);
  }
  assert.ok(value.HostConfig.Tmpfs?.['/dist']);
  assert.ok(value.Config.Env.includes('LOCAL_DIST_SOURCE=/opt/aibiz/local-dist'));
  return { id: value.Id, image: value.Image, startedAt: value.State.StartedAt,
    restartCount: value.RestartCount, status: value.State.Status,
    configurationSha256: hash(json(value.Config)), hostConfigurationSha256: hash(json(value.HostConfig)),
    mountsSha256: hash(json(mounts)) };
}

export function apiDocumentationDelta(candidate, host, container) {
  const delta = {};
  assert.equal(new Set(candidate.map(row => row.path)).size, candidate.length);
  for (const rows of [candidate, host, container]) for (const row of rows) {
    safe(row.path);
    assert.match(row.sha256 ?? '', /^[a-f0-9]{64}$/);
  }
  for (const [scope, rows] of [['host', host], ['container', container]]) {
    const old = new Map(rows.map(row => [row.path, row]));
    delta[scope] = candidate.filter(row => old.get(row.path)?.sha256 !== row.sha256)
      .map(row => ({ path: row.path, candidate: { bytes: row.bytes, sha256: row.sha256 },
        previous: old.get(row.path) ?? { exists: false } }))
      .sort((a, b) => Number(a.path === 'index.html') - Number(b.path === 'index.html') || a.path.localeCompare(b.path));
  }
  return delta;
}

async function headCandidate(output) {
  const revisions = Object.fromEntries(['plm', 'plm-web'].map(repo =>
    [repo, run('git', ['rev-parse', 'HEAD'], { cwd: path.join(workspace, repo) }).toString().trim()]));
  const source = path.join(output, 'source-workspace');
  fs.mkdirSync(source, { mode: 0o700 });
  const readHead = (repo, relative, optional = false) => {
    safe(relative);
    const options = { cwd: path.join(workspace, repo) };
    const result = spawnSync('git', ['show', `${revisions[repo]}:${relative}`],
      { timeout: 30_000, maxBuffer: 32 * 1024 * 1024, ...options });
    if (optional && result.status !== 0) return null;
    assert.equal(result.status, 0, `Required committed documentation input missing: ${relative}`);
    return Buffer.from(result.stdout);
  };
  const docTree = run('git', ['ls-tree', '-rz', revisions.plm, '--', 'doc/docsify'],
    { cwd: path.join(workspace, 'plm') }).toString().split('\0').filter(Boolean);
  assert.ok(docTree.length > 0);
  for (const row of docTree) assert.match(row, /^100(?:644|755) blob [a-f0-9]{40}\t/);
  const archive = run('git', ['archive', '--format=tar', revisions.plm, 'doc/docsify'],
    { cwd: path.join(workspace, 'plm') });
  fs.mkdirSync(path.join(source, 'plm'), { mode: 0o700 });
  run('tar', ['-xf', '-', '-C', path.join(source, 'plm')], { input: archive });
  const inputs = [];
  const stage = (repo, relative, optional = false) => {
    const bytes = readHead(repo, relative, optional);
    if (!bytes) return null;
    write(source, `${repo}/${relative}`, bytes);
    inputs.push({ repository: repo, revision: revisions[repo], path: relative, bytes: bytes.length, sha256: hash(bytes) });
    return bytes;
  };
  for (const name of ['api-reference.mjs', 'api-reference-dto.mjs', 'api-reference-logic.mjs']) stage('plm', `doc/tools/${name}`);
  stage('plm-web', 'src/locale/en.json');
  stage('plm-web', 'vite-plugins/local-documentation.ts');
  const service = JSON.parse(stage('plm', 'model/PSSYSSERVICEAPIS/ServiceAPI.json'));
  const dto = await import(pathToFileURL(path.join(source, 'plm/doc/tools/api-reference-dto.mjs')));
  const logic = await import(pathToFileURL(path.join(source, 'plm/doc/tools/api-reference-logic.mjs')));
  const pending = dto.directDtoRequests(service), seen = new Set(), models = new Map(), missing = new Set();
  for (let index = 0; index < pending.length; index++) {
    const request = pending[index], key = `${request.modelPath}#${request.dto}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!models.has(request.modelPath) && !missing.has(request.modelPath)) {
      const bytes = stage('plm', `model/${dto.dtoAuthorityPath(request.modelPath)}`, true);
      if (bytes) models.set(request.modelPath, JSON.parse(bytes)); else missing.add(request.modelPath);
    }
    if (models.has(request.modelPath)) pending.push(...dto.dtoDependencies(models.get(request.modelPath),
      request.dto, { system: request.modelPath === 'PSSYSTEM.json' }));
  }
  for (const relative of logic.logicOutputRequests(models)) stage('plm', `model/${relative}`, true);
  const generator = await import(pathToFileURL(path.join(source, 'plm/doc/tools/api-reference.mjs')));
  const docs = path.join(source, 'plm/doc/docsify');
  const generated = await generator.buildApiReferenceFiles({ sourceDirectory: docs });
  assert.equal(generated.size, 365);
  assert.deepEqual(await generator.buildApiReferenceFiles({ sourceDirectory: docs }), generated);
  const require = createRequire(path.join(workspace, 'ibiz-app-hub/package.json'));
  const tsPath = require.resolve('typescript'), ts = require('typescript');
  const publisher = ts.transpileModule(fs.readFileSync(path.join(source, 'plm-web/vite-plugins/local-documentation.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  write(output, 'executed-publisher.private.mjs', Buffer.from(publisher));
  const { publishDocumentation } = await import(pathToFileURL(path.join(output, 'executed-publisher.private.mjs')));
  const payload = path.join(output, 'payload/doc');
  await publishDocumentation(docs, payload, async () => generated);
  const files = inventory(payload);
  for (const [relative, bytes] of generated) {
    assert.ok(generatedPath.test(relative));
    assert.equal(hash(fs.readFileSync(path.join(payload, relative))), hash(bytes));
  }
  for (const relative of ['index.html', 'script/docsify.js', 'script/aibiz-api-reference.js', 'css/local-theme.css']) {
    assert.equal(hash(fs.readFileSync(path.join(payload, relative))), hash(readHead('plm', `doc/docsify/${relative}`)));
  }
  return { revisions, sourceDirectory: source, payloadDirectory: payload, files, inputs,
    generated: { files: generated.size, manifestSha256: hash(generated.get('api-reference/manifest.json')),
      manifest: JSON.parse(generated.get('api-reference/manifest.json')) },
    sourceDocumentation: { trackedFiles: docTree.length, archiveSha256: hash(archive) },
    toolchain: { path: tsPath, sha256: hash(fs.readFileSync(tsPath)) } };
}

export const apiDocumentationContainerMetadataProgram = `set -efu
test -d /dist/doc
test -z "$(find /dist/doc ! -type f ! -type d -print -quit)"
find /dist/doc -type f -exec sh -c 'set -efu
for input do
  meta=$(stat -c "%u:%g:%a:%d:%i:%s:%Y:%Z" "$input")
  printf "%s\\000%s\\000" "$input" "$meta"
done' documentation-metadata {} +
`;
function containerRows(raw, backup) {
  const parts = raw.toString().split('\0');
  assert.equal(parts.pop(), '');
  assert.equal(parts.length % 2, 0);
  const rows = [];
  for (let index = 0; index < parts.length; index += 2) {
    assert.ok(parts[index].startsWith('/dist/doc/'));
    const relative = parts[index].slice('/dist/doc/'.length);
    safe(relative);
    const values = parts[index + 1].split(':');
    assert.equal(values.length, 8);
    assert.ok(values.every(value => /^\d+$/.test(value)));
    const bytes = fs.readFileSync(path.join(backup, relative));
    assert.equal(bytes.length, Number(values[5]));
    rows.push({ path: relative, sha256: hash(bytes), bytes: bytes.length,
      ...Object.fromEntries(['uid', 'gid', 'mode', 'dev', 'ino'].map((key, i) => [key, values[i]])) });
  }
  assert.equal(new Set(rows.map(row => row.path)).size, rows.length);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export async function prepareExistingApiDocumentationRelease(output) {
  output = path.resolve(output);
  assert.equal(fs.realpathSync(path.dirname(output)), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^api-documentation-release-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  const preparer = fs.readFileSync(fileURLToPath(import.meta.url));
  const lock = acquireNotificationDeploymentLock();
  try {
    const inspect = () => apiDocumentationRuntimeWitness(JSON.parse(run('docker', ['inspect', containerId]))[0]);
    const before = inspect();
    const guarded = {};
    for (const relative of ['index.html', 'environments/environment.js']) {
      guarded[`host/${relative}`] = hash(fs.readFileSync(path.join(workspace, 'plm-web/dist', relative)));
      guarded[`container/${relative}`] = hash(run('docker', ['exec', containerId, 'cat', `/dist/${relative}`]));
    }
    for (const file of ['/start.sh', '/etc/nginx/conf.d/nginx.conf']) guarded[file] = hash(run('docker', ['exec', containerId, 'cat', file]));
    const host = inventory(hostDoc);
    const hostArchive = run('tar', ['-cf', '-', '-C', path.dirname(hostDoc), 'doc']);
    write(output, 'rollback/host-doc.private.tar', hostArchive);
    const metadata = run('docker', ['exec', containerId, 'sh', '-c', apiDocumentationContainerMetadataProgram]);
    const containerArchive = run('docker', ['exec', containerId, 'tar', '-cf', '-', '-C', '/dist', 'doc']);
    write(output, 'rollback/container-doc.private.tar', containerArchive);
    const backup = path.join(output, 'rollback/container');
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    run('tar', ['-xf', '-', '-C', backup], { input: containerArchive });
    const container = containerRows(metadata, path.join(backup, 'doc'));
    const candidate = await headCandidate(output);
    const delta = apiDocumentationDelta(candidate.files, host, container);
    const observations = [];
    for (const relative of critical) {
      const response = await fetch(`http://127.0.0.1:30250${prefix}${relative}`, {
        redirect: 'manual', signal: AbortSignal.timeout(10_000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      observations.push({ path: `${prefix}${relative}`, status: response.status,
        contentType: response.headers.get('content-type'), bytes: bytes.length, sha256: hash(bytes),
        snapshot: write(output, `rollback/http/${relative}.private.body`, bytes).path });
    }
    assert.deepEqual(inventory(hostDoc), host, 'Host documentation changed while preparing');
    assert.deepEqual(run('docker', ['exec', containerId, 'sh', '-c', apiDocumentationContainerMetadataProgram]), metadata);
    assert.equal(hash(run('docker', ['exec', containerId, 'tar', '-cf', '-', '-C', '/dist', 'doc'])), hash(containerArchive),
      'Container documentation bytes changed while preparing');
    assert.deepEqual(inspect(), before);
    for (const [relative, expected] of Object.entries(guarded)) {
      const current = relative.startsWith('host/')
        ? fs.readFileSync(path.join(workspace, 'plm-web/dist', relative.slice('host/'.length)))
        : run('docker', ['exec', containerId, 'cat', relative.startsWith('container/')
          ? `/dist/${relative.slice('container/'.length)}` : relative]);
      assert.equal(hash(current), expected, 'A preserved document host input changed');
    }
    for (const [repo, revision] of Object.entries(candidate.revisions)) {
      assert.equal(run('git', ['rev-parse', 'HEAD'], { cwd: path.join(workspace, repo) }).toString().trim(), revision);
    }
    const plan = { contract: 'existing-api-documentation-release-v1', status: 'PREPARED-NOT-PUBLISHED',
      preparedAt: new Date().toISOString(), runtime: before, prefix, candidate, delta,
      rollback: { host: { path: 'rollback/host-doc.private.tar', sha256: hash(hostArchive), files: host.length },
        container: { path: 'rollback/container-doc.private.tar', sha256: hash(containerArchive), files: container.length },
        policy: 'Restore only exact applied-file hashes/metadata from the apply receipt; remove only exact owned new files and then empty owned directories. Never recursively delete either doc tree.' },
      existingInventories: { host, container }, guarded, observations,
      operationPlan: {
        lock: 'acquireNotificationDeploymentLock from deploy-existing-plm-notification-style.mjs',
        phases: ['recheck runtime, HEAD revisions, candidate hashes, all affected old metadata and guarded inputs',
          'create only needed doc subdirectories and stage only listed delta paths on their own filesystem',
          'compare staged hash and recheck original before each rename; preserve existing uid/gid/mode',
          'install all non-index delta files in host and container, then each doc/index.html last',
          'read every listed delta through exact HTTP prefix and verify candidate hashes; verify preserved inputs',
          'record exact post-install uid/gid/mode/dev/ino and source seal for conditional rollback'],
        hostRoot: hostDoc, containerRoot: '/dist/doc', existingContainer: containerId,
        expectedNewFileMode: '644', expectedNewDirectoryMode: '755',
        nginxReloadRequired: false, containerLifecycleRequired: false,
        publisherSource: 'plm-web/vite-plugins/local-documentation.ts',
        executableMutationToolProvided: false,
        reason: 'This preparer is read-only for shared output. A reviewed executor must consume this exact delta/rollback plan before any installation.',
        forbid: ['whole-doc replacement', 'existing-only file deletion', 'root-index change',
          'plugin/model/environment/startup/nginx edits', 'Docker pull/create/restart'] },
      parentAcceptance: { B03: false, L03: false, actualHostUI: false, apiExecution: false,
        pending: ['normal host Development/API Reference UI embedding and role flows',
          'controlled own-object API positive/negative execution and exact cleanup',
          'two DTO method declarations, one nested source and real mapper/serialization'] } };
    assert.equal(hash(fs.readFileSync(fileURLToPath(import.meta.url))), hash(preparer));
    write(output, 'executed-preparer.private.mjs', preparer);
    write(output, 'plan.private.json', json(plan));
    return plan;
  } finally { lock.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' } }, strict: true });
  try {
    const report = await prepareExistingApiDocumentationRelease(values.output);
    console.log(JSON.stringify({ status: report.status, files: report.candidate.files.length,
      generated: report.candidate.generated.files, delta: Object.fromEntries(Object.entries(report.delta).map(([scope, rows]) => [scope, rows.length])),
      sharedOutputChanged: false, apiExecutionAcceptance: false }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
