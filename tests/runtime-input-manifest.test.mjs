import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  captureRuntimeInputs, main, measureRuntimePath, verifyRuntimeInputs,
} from '../runtime-input-manifest.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = t => {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'runtime-inputs-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = join(workspace, 'component/dist');
  fs.mkdirSync(join(source, 'empty'), { recursive: true });
  fs.writeFileSync(join(source, 'index.js'), 'bound bytes');
  const report = {
    contract: 'aibiz-docker-version-inventory-v2',
    running: [{
      kind: 'shared-runtime', running: true, id: 'a'.repeat(64), name: 'plmweb',
      imageId: `sha256:${'b'.repeat(64)}`, configurationSha256: 'c'.repeat(64),
      hostConfigurationSha256: 'd'.repeat(64), labels: {},
      mounts: [{ type: 'bind', source, destination: '/opt/aibiz/local-dist', writable: false }],
    }],
  };
  return { workspace, source, report, inspect: () => structuredClone(report) };
};
const capture = f => captureRuntimeInputs({ workspace: f.workspace, inspect: f.inspect });
const verify = (f, report) => verifyRuntimeInputs(report, { workspace: f.workspace, inspect: f.inspect });
const git = (f, args) => execFileSync('git', ['-C', join(f.workspace, 'component'), ...args], {
  encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
});
const initializeGit = f => {
  git(f, ['init', '-q', '--initial-branch=main']);
  git(f, ['add', '.']);
  git(f, ['-c', 'user.name=Runtime Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-qm', 'initial']);
};

test('tree hashes bind relative names, bytes, modes and empty directories without exporting contents', t => {
  const f = fixture(t);
  fs.writeFileSync(join(f.source, 'unicode-\u4e2d\u6587.txt'), 'private quoted "\'\\\n\u{1f642}');
  const first = measureRuntimePath(f.source);
  assert.equal(first.files, 2);
  assert.ok(first.entries.some(entry => entry.path === 'empty' && entry.kind === 'directory'));
  assert.equal(first.entries.find(entry => entry.path === 'index.js').sha256, hash('bound bytes'));
  assert.equal(first.entries.find(entry => entry.path === 'index.js').uid,
    fs.statSync(join(f.source, 'index.js')).uid);
  assert.equal(first.entries.find(entry => entry.path === '.').gid, fs.statSync(f.source).gid);
  assert.doesNotMatch(JSON.stringify(first), /private quoted|bound bytes/);
  assert.deepEqual(measureRuntimePath(f.source), first);
  fs.chmodSync(join(f.source, 'index.js'), 0o755);
  assert.notEqual(measureRuntimePath(f.source).fingerprint, first.fingerprint);
});

test('single large binary files are streamed and deterministically bound', t => {
  const f = fixture(t);
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 7, 0x81);
  const path = join(f.source, 'binary.jar');
  fs.writeFileSync(path, bytes);
  const measured = measureRuntimePath(path);
  assert.equal(measured.files, 1);
  assert.equal(measured.bytes, bytes.length);
  assert.equal(measured.entries[0].sha256, hash(bytes));
});

test('shared inputs are deduplicated across containers but retain every mount use', t => {
  const f = fixture(t);
  f.report.running.push({ ...structuredClone(f.report.running[0]), id: 'e'.repeat(64), name: 'modelingweb' });
  const report = capture(f);
  assert.equal(report.inputs.length, 1);
  assert.equal(report.inputs[0].uses.length, 2);
  assert.equal(report.containers.length, 2);
  assert.equal(report.acceptedRelease, false);
  assert.equal(report.contentsFrozen, false);
  assert.equal(report.atomicSnapshot, false);
  assert.equal(report.fullSourceClosure, false);
  assert.equal(report.servedHTTPBytesVerified, false);
  f.report.running.reverse();
  assert.equal(verify(f, report).status, 'MATCH');
});

test('only actual shared runtime binds are selected, including ignored generated files and hidden inputs', t => {
  const f = fixture(t);
  fs.writeFileSync(join(f.source, '.env'), 'SECRET_KEY=private-value');
  f.report.running.push({
    ...structuredClone(f.report.running[0]), name: 'unrelated', kind: 'historical-or-other',
    mounts: [{ type: 'bind', source: '/unrelated-project', destination: '/data' }],
  });
  const report = capture(f);
  assert.equal(report.containers.length, 1);
  assert.ok(report.inputs[0].entries.some(entry => entry.path === '.env'));
  assert.doesNotMatch(JSON.stringify(report), /SECRET_KEY|private-value|unrelated-project/);
});

test('Compose and environment file inputs are bound along with runtime directories', t => {
  const f = fixture(t);
  const config = join(f.workspace, 'compose.yml');
  const env = join(f.workspace, 'runtime.env');
  fs.writeFileSync(config, 'services: {}');
  fs.writeFileSync(env, 'PASSWORD=not-exported');
  f.report.running[0].labels = {
    'com.docker.compose.project.config_files': config,
    'com.docker.compose.project.environment_file': env,
  };
  const report = capture(f);
  assert.equal(report.inputs.length, 3);
  fs.writeFileSync(env, 'PASSWORD=changed-not-exported');
  assert.throws(() => verify(f, report), /Mounted inputs differ/);
});

for (const [name, mutate] of [
  ['file bytes', f => fs.writeFileSync(join(f.source, 'index.js'), 'different')],
  ['file deletion', f => fs.unlinkSync(join(f.source, 'index.js'))],
  ['new file', f => fs.writeFileSync(join(f.source, 'new.js'), 'new')],
  ['empty directory rename', f => fs.renameSync(join(f.source, 'empty'), join(f.source, 'renamed'))],
  ['file mode', f => fs.chmodSync(join(f.source, 'index.js'), 0o755)],
  ['setuid bit', f => fs.chmodSync(join(f.source, 'index.js'), 0o4644)],
  ['directory sticky bit', f => fs.chmodSync(join(f.source, 'empty'), 0o1755)],
]) {
  test(`verification rejects mounted ${name} drift`, t => {
    const f = fixture(t);
    const report = capture(f);
    mutate(f);
    assert.throws(() => verify(f, report), /Mounted inputs differ/);
  });
}

test('symlink roots, ancestors, entries and hardlinks are refused without following their targets', t => {
  const f = fixture(t);
  const outside = join(f.workspace, 'secret');
  fs.writeFileSync(outside, 'private secret');
  fs.symlinkSync(outside, join(f.source, 'escape'));
  assert.throws(() => measureRuntimePath(f.source), /Symlink/);
  fs.unlinkSync(join(f.source, 'escape'));
  fs.symlinkSync(f.source, join(f.workspace, 'alias'));
  assert.throws(() => measureRuntimePath(join(f.workspace, 'alias')), /Symlink/);
  assert.throws(() => measureRuntimePath(join(f.workspace, 'alias/index.js')), /Symlink/);
  fs.linkSync(outside, join(f.source, 'hardlink'));
  assert.throws(() => measureRuntimePath(f.source), /single-link/);
});

test('special files and missing inputs fail rather than hanging or producing partial acceptance', t => {
  const f = fixture(t);
  const fifo = join(f.source, 'pipe');
  execFileSync('mkfifo', [fifo], { timeout: 10000 });
  assert.throws(() => measureRuntimePath(f.source), /regular files/);
  fs.unlinkSync(fifo);
  fs.unlinkSync(join(f.source, 'index.js'));
  f.report.running[0].mounts[0].source = join(f.source, 'index.js');
  assert.throws(() => capture(f), { code: 'ENOENT' });
});

test('byte and entry budgets fail closed, including bounds across distinct mount roots', t => {
  const f = fixture(t);
  assert.throws(() => captureRuntimeInputs({ ...f, budgets: { maxBytes: 3 } }), /byte budget/);
  assert.throws(() => captureRuntimeInputs({ ...f, budgets: { maxEntries: 1 } }), /entry budget/);
  for (const maxBytes of [0, -1, NaN, 1.5]) {
    assert.throws(() => captureRuntimeInputs({ ...f, budgets: { maxBytes } }));
  }
  const extra = join(f.workspace, 'extra.js');
  fs.writeFileSync(extra, '12345');
  f.report.running[0].mounts.push({ type: 'bind', source: extra, destination: '/extra.js' });
  assert.throws(() => captureRuntimeInputs({ ...f, budgets: { maxBytes: 15 } }), /byte budget/);
});

test('foreign workspace mounts and self-referential receipt output require separate review', t => {
  const f = fixture(t);
  assert.throws(() => captureRuntimeInputs({
    ...f, outputPath: join(f.source, 'runtime-inputs-test/report.json'),
  }), /overlaps/);
  f.report.running[0].mounts[0].source = '/etc/passwd';
  assert.throws(() => capture(f), /outside this workspace/);
});

test('Git commit, dirty status and index are measured without claiming unmounted-source closure', t => {
  const f = fixture(t);
  initializeGit(f);
  const clean = capture(f);
  assert.equal(clean.repositories.length, 1);
  assert.equal(clean.repositories[0].dirty, false);
  assert.equal(clean.repositories[0].unmountedSourceContentsBound, false);
  fs.writeFileSync(join(f.workspace, 'component/notes.txt'), 'unmounted first');
  assert.throws(() => verify(f, clean), /Repository identities differ/);
  const dirty = capture(f);
  assert.equal(dirty.repositories[0].dirty, true);
  fs.writeFileSync(join(f.workspace, 'component/notes.txt'), 'unmounted second');
  assert.equal(verify(f, dirty).status, 'MATCH',
    'This explicitly is not a hash of unmounted dirty source contents');
  git(f, ['add', 'notes.txt']);
  assert.throws(() => verify(f, dirty), /Repository identities differ/);
});

test('foreign GIT_DIR, GIT_WORK_TREE and temporary GIT_INDEX_FILE cannot substitute repository identity', t => {
  const f = fixture(t), foreign = fixture(t);
  initializeGit(f);
  fs.writeFileSync(join(foreign.workspace, 'component/foreign.txt'), 'different repository');
  initializeGit(foreign);
  const expected = git(f, ['rev-parse', 'HEAD']).trim();
  assert.notEqual(expected, git(foreign, ['rev-parse', 'HEAD']).trim());
  const module = new URL('../runtime-input-manifest.mjs', import.meta.url).href;
  const program = `import {captureRuntimeInputs} from ${JSON.stringify(module)};
const report=captureRuntimeInputs({workspace:${JSON.stringify(f.workspace)},
inspect:()=>(${JSON.stringify(f.report)})});
console.log(JSON.stringify(report.repositories));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, GIT_DIR: join(foreign.workspace, 'component/.git'),
      GIT_WORK_TREE: join(foreign.workspace, 'component'),
      GIT_INDEX_FILE: join(foreign.workspace, 'component/.git/index') },
  });
  assert.equal(result.status, 0, result.stderr);
  const repositories = JSON.parse(result.stdout);
  assert.equal(repositories[0].commit, expected);
  assert.equal(repositories[0].path, 'component');
  assert.equal(repositories[0].dirty, false);
});

test('changing image/configuration identity during capture or after capture prevents a match', t => {
  const f = fixture(t);
  let calls = 0;
  const inspect = () => {
    const value = f.inspect();
    if (++calls === 2) value.running[0].configurationSha256 = 'e'.repeat(64);
    return value;
  };
  assert.throws(() => captureRuntimeInputs({ ...f, inspect }), /configuration changed/);
  const report = capture(f);
  f.report.running[0].imageId = `sha256:${'f'.repeat(64)}`;
  assert.throws(() => verify(f, report), /Container bindings differ/);
  f.report.running[0].imageId = 'mutable-tag';
  assert.throws(() => capture(f));
});

test('tampered fingerprints and fabricated release/frozen/source-closure claims are refused', t => {
  const f = fixture(t);
  const report = capture(f);
  assert.throws(() => verify(f, { ...report, fingerprint: '0'.repeat(64) }), /inconsistent/);
  for (const field of ['acceptedRelease', 'contentsFrozen', 'atomicSnapshot', 'fullSourceClosure', 'servedHTTPBytesVerified']) {
    assert.throws(() => verify(f, { ...report, [field]: true }), /acceptance/);
  }
});

test('CLI writes exclusive private artifacts and verifies exact observed bindings', t => {
  const f = fixture(t);
  const output = '.artifacts/runtime-inputs-cli/report.json';
  const result = main(['--capture', `--output=${output}`], f);
  assert.equal(result.status, 'OBSERVED');
  const path = join(f.workspace, output);
  assert.equal(fs.statSync(path).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dirname(path)).mode & 0o777, 0o700);
  assert.equal(main([`--verify=${output}`], f).status, 'MATCH');
  assert.throws(() => main(['--capture', `--output=${output}`], f), /overwritten/);
  fs.symlinkSync(dirname(path), join(f.workspace, '.artifacts/runtime-inputs-link'));
  assert.throws(() => main(['--verify=.artifacts/runtime-inputs-link/report.json'], f), /Symlink/);
});

test('CLI invalid arguments and paths are rejected before inspection; help is side-effect free', t => {
  const f = fixture(t);
  let inspections = 0;
  const inspect = () => { inspections++; return f.inspect(); };
  for (const args of [
    [], ['--unknown'], ['--capture'], ['--output=.artifacts/runtime-inputs-x/report.json'],
    ['--capture', '--output=/tmp/runtime-inputs-x/report.json'],
    ['--verify=../runtime-inputs-x/report.json'],
    ['--capture', '--output=.artifacts/runtime-inputs-x/report.json', '--output=.artifacts/runtime-inputs-y/report.json'],
    ['--verify=.artifacts/runtime-inputs-x/report.json', '--capture'],
  ]) assert.throws(() => main(args, { ...f, inspect }));
  assert.equal(inspections, 0);
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../runtime-input-manifest.mjs', import.meta.url)), '--help',
  ], { cwd: f.workspace, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--capture/);
  assert.equal(fs.existsSync(join(f.workspace, '.artifacts')), false);
});

test('a FIFO receipt is refused before open/read instead of blocking verification', t => {
  const f = fixture(t);
  const output = join(f.workspace, '.artifacts/runtime-inputs-fifo/report.json');
  fs.mkdirSync(dirname(output), { recursive: true });
  execFileSync('mkfifo', [output], { timeout: 10000 });
  const module = new URL('../runtime-input-manifest.mjs', import.meta.url).href;
  const program = `import {main} from ${JSON.stringify(module)};
try { main(['--verify=.artifacts/runtime-inputs-fifo/report.json'], {
  workspace: ${JSON.stringify(f.workspace)},
  inspect() { throw new Error('Docker must not be inspected for a non-regular receipt'); }
}); process.exitCode=2; } catch { process.exitCode=1; }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8', timeout: 2000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
});
