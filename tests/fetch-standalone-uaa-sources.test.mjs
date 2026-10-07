import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  UAA_PARENT_PIN, UAA_STARTER_SOURCE_PINS, fetchStandaloneUaaParent,
  fetchStandaloneUaaSources, parseUaaParentPom, parseUaaStarterSource, uaaStarterSourceUrl,
} from '../fetch-standalone-uaa-sources.mjs';

const pin = UAA_STARTER_SOURCE_PINS[0];
const pomPath = `META-INF/maven/cn.ibizlab.plugin/${pin.artifact}/pom.xml`;
const pom = `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>cn.ibizlab.plugin</groupId><artifactId>ibizlab-boot-starter-parent</artifactId><version>${pin.version}</version></parent><artifactId>${pin.artifact}</artifactId></project>`;
const javaPath = 'cn/ibizlab/util/security/AuthenticationUser.java';
function archive(extra = [], replacements = {}) {
  const files = [
    [pomPath, replacements.pom ?? pom],
    [javaPath, 'package cn.ibizlab.util.security; public class AuthenticationUser {}'],
    ...extra,
  ];
  const result = spawnSync('python3', ['-I', '-c', `
import io, json, stat, sys, zipfile
result = io.BytesIO()
with zipfile.ZipFile(result, "w") as archive:
    for item in json.loads(sys.stdin.read()):
        name, content = item[:2]
        info = zipfile.ZipInfo(name)
        if len(item) > 2 and item[2] == "symlink":
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, content)
sys.stdout.buffer.write(result.getvalue())
`], { input: JSON.stringify(files), maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0);
  return result.stdout;
}

test('production pins retain standalone starter releases, not the unrelated Cloud UAA namespace', () => {
  assert.deepEqual(UAA_STARTER_SOURCE_PINS.map(item => [item.artifact, item.version]), [
    ['ibizlab-boot-starter', '2.6.12.10'], ['ibizlab-boot-starter-data', '2.6.12.10'],
  ]);
  for (const item of UAA_STARTER_SOURCE_PINS) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.match(uaaStarterSourceUrl(item), /^https:\/\/repo\.maven\.apache\.org\/maven2\//);
  }
  assert.throws(() => uaaStarterSourceUrl({ ...pin, version: '2.6.12.11' }), /Unpinned/);
});

test('structured archive parser extracts Java and POM only, preserving coordinates and bytes', () => {
  const result = parseUaaStarterSource(archive([
    ['keypair/private.key', 'DO NOT EXTRACT'], ['application.yml', 'DO NOT EXTRACT'],
  ]), pin);
  assert.deepEqual(result.coordinate, {
    group: 'cn.ibizlab.plugin', artifact: pin.artifact, version: pin.version,
  });
  assert.equal(result.files.length, 2);
  assert.equal(result.files.find(item => item.path === 'pom.xml').bytes, Buffer.byteLength(pom));
  assert.deepEqual(result.excludedEntries.map(item => item.path), ['application.yml', 'keypair/private.key']);
  assert.ok(!JSON.stringify(result).includes('DO NOT EXTRACT'));
});

for (const path of ['../out.java', '/tmp/out.java', 'cn//out.java', 'cn/./out.java',
  'cn\\out.java', 'cn/out:\u0000.java']) {
  test(`source archive rejects unsafe entry ${JSON.stringify(path)}`, () => {
    assert.throws(() => parseUaaStarterSource(archive([[path, 'bad']]), pin), /Unsafe archive/);
  });
}

test('source archive rejects duplicate entries including excluded files', () => {
  assert.throws(() => parseUaaStarterSource(archive([[javaPath, 'duplicate']]), pin), /Duplicate/);
  assert.throws(() => parseUaaStarterSource(archive([
    ['application.yml', 'a'], ['application.yml', 'b'],
  ]), pin), /Duplicate/);
});

test('source archive rejects symlink and compiled own fallback', () => {
  assert.throws(() => parseUaaStarterSource(archive([['link', 'target', 'symlink']]), pin), /Symlink/);
  for (const path of ['cn/ibizlab/Own.class', 'lib/own.jar', 'lib/own.war']) {
    assert.throws(() => parseUaaStarterSource(archive([[path, 'compiled']]), pin), /Compiled input/);
  }
});

test('source archive rejects coordinate mismatch and DTD instead of trusting filenames', () => {
  assert.throws(() => parseUaaStarterSource(archive([], {
    pom: pom.replace(`<artifactId>${pin.artifact}</artifactId>`, '<artifactId>cloud-uaa</artifactId>'),
  }), pin), /coordinate mismatch/);
  assert.throws(() => parseUaaStarterSource(archive([], {
    pom: '<!DOCTYPE project [<!ENTITY injected "text">]>' + pom,
  }), pin), /DTD\/entities/);
});

test('source archive rejects oversized, empty and malformed inputs', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(4 * 1024 * 1024 + 1)]) {
    assert.throws(() => parseUaaStarterSource(bytes, pin), /size/);
  }
  assert.throws(() => parseUaaStarterSource(Buffer.from('not a ZIP'), pin), /Invalid source archive/);
  assert.throws(() => parseUaaStarterSource(archive([['cn/ibizlab/Empty.java', '']]), pin), /Empty/);
});

function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'uaa-source-fetch-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  return { workspace, output: join(workspace, '.artifacts/standalone-uaa-source-fetch/run') };
}

test('acquisition rejects changed published bytes before extracting editable sources', async t => {
  const options = fixture(t);
  await assert.rejects(fetchStandaloneUaaSources({
    ...options, fetchImpl: async (url, request) => {
      assert.equal(url, uaaStarterSourceUrl(pin));
      assert.equal(request.credentials, 'omit');
      assert.equal(request.redirect, 'error');
      return new Response(archive(), { status: 200 });
    },
  }), /hash mismatch/);
  assert.ok(!fs.existsSync(join(options.output, 'sources')));
  assert.ok(!fs.existsSync(join(options.output, 'report.json')));
});

test('acquisition fails on HTTP errors, rejects reuse and cannot target a source repository', async t => {
  const options = fixture(t);
  await assert.rejects(fetchStandaloneUaaSources({
    ...options, fetchImpl: async () => new Response('missing', { status: 404 }),
  }), /download failed/);
  await assert.rejects(fetchStandaloneUaaSources(options), /exist|exclusive/i);
  await assert.rejects(fetchStandaloneUaaSources({
    ...options, output: join(options.workspace, 'ibiz-service-hub'),
  }), /new standalone UAA acquisition directory/);
});

const parentPom = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId>
    <version>2.6.14</version></parent><modelVersion>4.0.0</modelVersion>
  <groupId>cn.ibizlab.plugin</groupId><artifactId>ibizlab-boot-starter-parent</artifactId>
  <version>2.6.12.10</version><packaging>pom</packaging></project>`;

test('parent parser requires the matching standalone coordinates and Boot 2.6.14', () => {
  const parsed = parseUaaParentPom(Buffer.from(parentPom));
  assert.equal(parsed.coordinate.artifact, UAA_PARENT_PIN.artifact);
  assert.equal(parsed.parent.version, '2.6.14');
  assert.throws(() => parseUaaParentPom(Buffer.from(parentPom.replace('2.6.14', '2.4.0'))), /version mismatch/);
  assert.throws(() => parseUaaParentPom(Buffer.from(parentPom.replace('2.6.12.10', '2.6.12.11'))), /coordinate mismatch/);
  assert.throws(() => parseUaaParentPom(Buffer.from(parentPom.replace('<packaging>pom', '<packaging>jar'))), /Invalid/);
});

test('parent parser rejects DTD, malformed, duplicate fields and empty input', () => {
  for (const value of ['<!DOCTYPE project [<!ENTITY x "y">]>' + parentPom, 'not XML',
    parentPom.replace('<packaging>', '<version>2.6.12.10</version><packaging>')]) {
    assert.throws(() => parseUaaParentPom(Buffer.from(value)), /Invalid/);
  }
  assert.throws(() => parseUaaParentPom(Buffer.alloc(0)), /size/);
});

test('parent acquisition requires pinned hash, rejects HTTP errors and exclusive output reuse', async t => {
  const { workspace } = fixture(t);
  const output = join(workspace, '.artifacts/standalone-uaa-parent-fetch/run');
  await assert.rejects(fetchStandaloneUaaParent({
    workspace, output, fetchImpl: async (url, request) => {
      assert.equal(url, UAA_PARENT_PIN.url);
      assert.equal(request.credentials, 'omit');
      assert.equal(request.redirect, 'error');
      return new Response(parentPom);
    },
  }), /hash mismatch/);
  assert.ok(!fs.existsSync(join(output, 'pom.xml')));
  await assert.rejects(fetchStandaloneUaaParent({ workspace, output }), /exist|exclusive/i);
  await assert.rejects(fetchStandaloneUaaParent({
    workspace, output: join(workspace, 'source'),
  }), /new standalone UAA parent acquisition directory/);
  await assert.rejects(fetchStandaloneUaaParent({
    workspace, output: join(workspace, '.artifacts/standalone-uaa-parent-fetch/missing'),
    fetchImpl: async () => new Response('missing', { status: 404 }),
  }), /download failed/);
});
