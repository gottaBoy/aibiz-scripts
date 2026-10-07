import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildStandaloneUaaStarters, inspectStarterJar, main, starterDockerCommand,
} from '../harness-standalone-uaa-starter-build.mjs';
import { PINNED_MAVEN_IMAGE } from '../harness-modeling-permission-regression.mjs';

const options = {
  source: '/tmp/run/source', repository: '/tmp/run/repository',
  settingsPath: '/tmp/run/settings.xml', containerName: 'uaa-starters-00000000-0000-4000-8000-000000000000',
  uid: 1000, gid: 1000,
};

test('Docker command compiles in the pinned Java 8 image with isolated source/repository and no skips', () => {
  const { executable, args } = starterDockerCommand(options);
  assert.equal(executable, 'docker');
  assert.ok(args.includes(PINNED_MAVEN_IMAGE));
  assert.ok(args.includes('--pull=never'));
  assert.ok(args.includes('--rm'));
  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('--cap-drop=ALL'));
  assert.ok(args.includes('type=bind,source=/tmp/run/repository,target=/repository'));
  assert.ok(args.includes('type=bind,source=/tmp/run/source,target=/workspace'));
  assert.ok(args.includes('type=bind,source=/tmp/run/settings.xml,target=/settings.xml,readonly'));
  assert.ok(args.includes('-DskipTests=false'));
  assert.ok(args.includes('-Dmaven.test.skip=false'));
  assert.ok(args.includes('-Dmaven.test.failure.ignore=false'));
  assert.deepEqual(args.slice(-2), ['clean', 'install']);
  assert.ok(!args.some(value => value.includes('.m2/repository') || value === '-c'));
});

test('Docker command rejects unsafe bind values, shared paths, invalid users and container options', () => {
  for (const field of ['source', 'repository', 'settingsPath']) {
    for (const value of ['relative', '/tmp/a,b', '/tmp/a\nb']) {
      assert.throws(() => starterDockerCommand({ ...options, [field]: value }), /bind path/);
    }
  }
  assert.throws(() => starterDockerCommand({ ...options, repository: options.source }), /separate/);
  assert.throws(() => starterDockerCommand({ ...options, containerName: '--privileged' }), /container name/);
  for (const uid of [-1, '0', 0.5, NaN]) {
    assert.throws(() => starterDockerCommand({ ...options, uid }), /container user/);
  }
});

function archive(files) {
  const result = spawnSync('python3', ['-I', '-c', `
import base64, io, json, sys, zipfile
output = io.BytesIO()
with zipfile.ZipFile(output, "w") as jar:
    for name, encoded in json.load(sys.stdin):
        jar.writestr(name, base64.b64decode(encoded))
sys.stdout.buffer.write(output.getvalue())
`], { input: JSON.stringify(files.map(([name, bytes]) => [name, Buffer.from(bytes).toString('base64')])),
    maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0);
  return result.stdout;
}
const classBytes = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52, 0]);
const sourcePath = 'src/main/java/cn/ibizlab/Own.java';
const classPath = 'cn/ibizlab/Own.class';
const pomPath = 'META-INF/maven/cn.ibizlab.plugin/ibizlab-boot-starter/pom.xml';
const artifact = 'ibizlab-boot-starter';

test('output audit requires Java 8 bytecode for every editable source plus output Maven identity', () => {
  const result = inspectStarterJar(archive([[classPath, classBytes], [pomPath, '<project/>']]),
    [sourcePath], artifact);
  assert.deepEqual(result.classes, [classPath]);
  assert.equal(result.entries.length, 2);
  assert.throws(() => inspectStarterJar(archive([[classPath, classBytes]]), [sourcePath], artifact),
    /Maven identity/);
  assert.throws(() => inspectStarterJar(archive([[classPath, classBytes], [pomPath, '<project/>']]),
    ['src/main/java/cn/ibizlab/Missing.java'], artifact), /Missing compiled/);
});

test('output audit rejects malformed archives, bytecode, nested binaries, unsafe and duplicate paths', () => {
  for (const bytes of [Buffer.from('not ZIP'), archive([[classPath, Buffer.from('not bytecode')]]),
    archive([[classPath, Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61])]]),
    archive([[classPath, classBytes], ['lib/own.jar', 'binary']]),
    archive([[classPath, classBytes], ['../Own.class', classBytes]]),
    archive([[classPath, classBytes], [classPath, classBytes]])]) {
    assert.throws(() => inspectStarterJar(bytes, [sourcePath], artifact), /Invalid source-built/);
  }
  assert.throws(() => inspectStarterJar(Buffer.alloc(0), [sourcePath], artifact), /Missing/);
  assert.throws(() => inspectStarterJar(archive([[pomPath, '<project/>']]), [sourcePath], artifact), /No compiled/);
});

test('build rejects missing receipts, wrong contracts and unsafe output before invoking Docker', t => {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'uaa-starter-build-'));
  t.after(() => fs.rmSync(workspace, { force: true, recursive: true }));
  let invoked = false;
  const execute = () => { invoked = true; throw new Error('must not run'); };
  assert.throws(() => buildStandaloneUaaStarters({ workspace, execute }), /reports are required/);
  const sourceReport = join(workspace, 'source.json');
  const parentReport = join(workspace, 'parent.json');
  fs.writeFileSync(sourceReport, JSON.stringify({ contract: 'legacy-cloud-uaa' }));
  fs.writeFileSync(parentReport, JSON.stringify({ contract: 'legacy-cloud-uaa' }));
  assert.throws(() => buildStandaloneUaaStarters({ workspace, sourceReport, parentReport, execute }),
    /standalone-uaa-starter-source-acquisition/);
  assert.throws(() => buildStandaloneUaaStarters({
    workspace, sourceReport, parentReport, output: join(workspace, 'source'), execute,
  }), /new standalone UAA starter build directory/);
  assert.equal(invoked, false);
});

test('build CLI has no receipt promotion, arbitrary compiler/image, or implicit skip flags', () => {
  for (const flag of ['--skip', '--image', '--compiler', '--accepted', '--source-ready']) {
    assert.throws(() => main([flag]), /Unknown option/);
  }
});
