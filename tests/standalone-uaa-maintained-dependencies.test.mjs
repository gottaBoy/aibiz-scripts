import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PREPARE_THIRD_PARTY } from '../../standalone-uaa/tools/dependencies.mjs';

function archive(entries) {
  return execFileSync('python3', ['-I', '-c', String.raw`
import io, json, stat, sys, warnings, zipfile
warnings.simplefilter("ignore", UserWarning)
output = io.BytesIO()
with zipfile.ZipFile(output, "w") as jar:
    for entry in json.load(sys.stdin):
        info = zipfile.ZipInfo(entry["path"])
        if entry.get("symlink"):
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
        jar.writestr(info, entry.get("data", "controlled fixture"))
sys.stdout.buffer.write(output.getvalue())
`], { input: JSON.stringify(entries) });
}

function fixture(t, entries, dependencies = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'maintained-uaa-deps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputs = join(root, 'inputs');
  const output = join(root, 'output');
  fs.mkdirSync(inputs);
  fs.mkdirSync(output);
  const bytes = archive(entries);
  fs.writeFileSync(join(inputs, 'dependency.jar'), bytes);
  const request = { dependencies: { excludedOriginalOwn: ['controlled-original-own.jar'],
    thirdParty: [{ path: 'third-party/dependency.jar', bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') }], ...dependencies } };
  const run = () => spawnSync('python3',
    ['-I', '-c', PREPARE_THIRD_PARTY, inputs, output],
    { input: JSON.stringify(request), encoding: 'utf8' });
  return { inputs, output, bytes, request, run };
}

function transformFixture(t, manifest, fields = {}) {
  const entries = [
    { path: 'META-INF/MANIFEST.MF', data: manifest },
    { path: 'org/fixture/Example.class' },
  ];
  const bytes = archive(entries);
  const dependencies = { compilerInputTransforms: [{
    path: 'third-party/dependency.jar',
    operation: 'remove-manifest-class-path',
    reason: 'controlled fixture transform',
    originalSha256: createHash('sha256').update(bytes).digest('hex'),
    originalBytes: bytes.length,
    ...fields,
  }] };
  return { ...fixture(t, entries, dependencies), bytes };
}

test('retains the JAR name and bytes after inspecting its final class entry', t => {
  const data = fixture(t, [
    { path: 'META-INF/MANIFEST.MF' }, { path: 'org/fixture/Last.class' },
  ]);
  const result = data.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(join(data.output, 'third-party/dependency.jar')), data.bytes);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.thirdParty[0].path, 'third-party/dependency.jar');
  assert.equal(receipt.thirdParty[0].classes, 1);
  assert.deepEqual(receipt.starters, []);
});

test('removes an exactly declared manifest Class-Path and preserves original dependency identity', t => {
  const manifest = 'Manifest-Version: 1.0\r\nClass-Path: forbidden.jar\r\n\r\n';
  const data = transformFixture(t, manifest);
  const sanitized = archive([
    { path: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\r\n\r\n' },
    { path: 'org/fixture/Example.class' },
  ]);
  data.request.dependencies.compilerInputTransforms[0]
    .compilerInputSha256 = createHash('sha256').update(sanitized).digest('hex');
  data.request.dependencies.compilerInputTransforms[0].compilerInputBytes = sanitized.length;
  const result = data.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(join(data.output, 'third-party/dependency.jar')), sanitized);
  const receipt = JSON.parse(result.stdout).thirdParty[0];
  assert.equal(receipt.sha256, createHash('sha256').update(sanitized).digest('hex'));
  assert.equal(receipt.bytes, sanitized.length);
  assert.equal(receipt.originalSha256, createHash('sha256').update(data.bytes).digest('hex'));
  assert.equal(receipt.originalBytes, data.bytes.length);
  assert.equal(receipt.compilerInputTransform.operation, 'remove-manifest-class-path');
});

test('rejects an undeclared manifest Class-Path before it can enter the compiler input', t => {
  const data = fixture(t, [
    { path: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\r\nClass-Path: forbidden.jar\r\n\r\n' },
    { path: 'org/fixture/Example.class' },
  ]);
  const result = data.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Undeclared manifest Class-Path/);
  assert.equal(fs.existsSync(join(data.output, 'third-party/dependency.jar')), false);
});

for (const [name, fields, message] of [
  ['unsupported operation', { operation: 'unknown', compilerInputSha256: '0'.repeat(64),
    compilerInputBytes: 0 }, /Unsupported compiler input transform/],
  ['original hash mismatch', { compilerInputSha256: '0'.repeat(64), compilerInputBytes: 0,
    originalSha256: '1'.repeat(64) }, /Unsupported compiler input transform/],
  ['transform hash drift', { compilerInputSha256: '0'.repeat(64), compilerInputBytes: 1 }, /compiler input drift/],
  ['transform bytes drift', { compilerInputSha256: '0'.repeat(64), compilerInputBytes: 0 }, /compiler input drift/],
]) {
  test(`rejects ${name}`, t => {
    const data = transformFixture(t,
      'Manifest-Version: 1.0\r\nClass-Path: forbidden.jar\r\n\r\n', fields);
    const result = data.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(fs.existsSync(join(data.output, 'third-party/dependency.jar')), false);
  });
}

for (const path of [
  'cn/ibizlab/Own.class', 'net/ibizsys/Own.class',
  'BOOT-INF/classes/cn/ibizlab/Own.class', 'WEB-INF/classes/net/ibizsys/Own.class',
  'META-INF/versions/9/cn/ibizlab/Own.class',
]) {
  test(`rejects compiled-own fallback ${path}`, t => {
    const result = fixture(t, [{ path }]).run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Compiled-own fallback/);
  });
}

for (const path of ['../x.class', '/x.class', 'org//x.class', 'org\\x.class', 'lib/nested.jar',
  'META-INF/versions/bad/org/Example.class']) {
  test(`rejects unsafe or nested dependency entry ${path}`, t => {
    const result = fixture(t, [{ path }]).run();
    assert.notEqual(result.status, 0);
  });
}

test('rejects duplicate ZIP entries and symlink entries', t => {
  for (const entries of [
    [{ path: 'org/Example.class' }, { path: 'org/Example.class' }],
    [{ path: 'org/Example.class', symlink: true }],
  ]) {
    const result = fixture(t, entries).run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsafe third-party ZIP/);
  }
});

test('rejects dependency drift before copying bytes', t => {
  const data = fixture(t, [{ path: 'org/Example.class' }]);
  data.request.dependencies.thirdParty[0].sha256 = 'a'.repeat(64);
  assert.notEqual(data.run().status, 0);
  assert.deepEqual(fs.readdirSync(join(data.output, 'third-party')), []);
});

for (const path of ['third-party/../dependency.jar', 'third-party/x:dependency.jar',
  'third-party/dependency.class', 'third-party/x\\dependency.jar']) {
  test(`rejects declared dependency path ${path}`, t => {
    const data = fixture(t, [{ path: 'org/Example.class' }]);
    data.request.dependencies.thirdParty[0].path = path;
    assert.notEqual(data.run().status, 0);
  });
}
