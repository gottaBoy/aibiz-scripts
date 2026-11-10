import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { main, verifyPlmIbizDependencyClosure } from '../harness-plm-ibiz-dependency-closure.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function write(path, data) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'plm-ibiz-closure-'));
  write(join(root, '.artifacts/tree.txt'), [
    'cn.ibizlab.plugin:ibiz-plugin-groovy:jar:8.1.0.584.1',
    '+- cn.ibizlab.plugin:ibiz-cloud-core:jar:8.1.0.584.1:compile',
    '|  \\- org.springframework.boot:spring-boot-starter-web:jar:2.4.0:compile',
    '\\- org.codehaus.groovy:groovy:jar:3.0.20:compile',
  ].join('\n'));
  const parentPom = `<parent><groupId>cn.ibizlab.plugin</groupId>
<artifactId>ibiz-plugin</artifactId><version>8.1.0.584.1</version></parent>`;
  write(join(root, 'libs/ibiz-plugin-groovy/pom.xml'), `<project>${parentPom}
<artifactId>ibiz-plugin-groovy</artifactId>
<dependencies><dependency><groupId>cn.ibizlab.plugin</groupId>
<artifactId>ibiz-cloud-core</artifactId><version>8.1.0.584.1</version></dependency>
</dependencies></project>`);
  write(join(root, 'libs/ibiz-plugin-groovy/src/main/java/Example.java'), 'class Example {}\n');
  write(join(root, 'libs/ibiz-cloud-core/pom.xml'), `<project>${parentPom}
<artifactId>ibiz-cloud-core</artifactId>
<dependencies><dependency><groupId>org.springframework.boot</groupId>
<artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>`);
  write(join(root, 'libs/ibiz-cloud-core/src/main/java/Core.java'), 'class Core {}\n');
  return {
    root,
    options: { workspace: root, dependencyTree: '.artifacts/tree.txt', modulesRoot: 'libs' },
  };
}

test('live PLM iBiz dependency closure binds all recursive modules to editable source', () => {
  const result = verifyPlmIbizDependencyClosure();
  assert.equal(result.status, 'passed');
  assert.equal(result.component, 'plm-backend');
  assert.equal(result.moduleCount, 6);
  assert.equal(result.sourceFileCount, 4386);
  assert.equal(result.ownDependencySourceClosureVerified, true);
  assert.equal(result.fullSourceClosureVerified, false);
  assert.equal(result.nativeAcceptance, false);
  assert.deepEqual(result.blockers, []);
});

test('controlled closure verifies recursive iBiz dependencies and ignores open source', () => {
  const result = verifyPlmIbizDependencyClosure(fixture().options);
  assert.equal(result.status, 'passed');
  assert.equal(result.moduleCount, 2);
  assert.equal(result.sourceFileCount, 2);
  assert.deepEqual(result.ibizDependencies.map(item => item.artifactId).sort(),
    ['ibiz-cloud-core', 'ibiz-plugin-groovy']);
});

test('missing editable source module blocks closure without promotion', () => {
  const f = fixture();
  fs.rmSync(join(f.root, 'libs/ibiz-cloud-core'), { recursive: true, force: true });
  const result = verifyPlmIbizDependencyClosure(f.options);
  assert.equal(result.status, 'blocked');
  assert.equal(result.ownDependencySourceClosureVerified, false);
  assert.equal(result.fullSourceClosureVerified, false);
  assert.ok(result.blockers.some(item => item.dependency.endsWith('ibiz-cloud-core:8.1.0.584.1')));
});

test('module version mismatch blocks closure', () => {
  const f = fixture();
  const pom = join(f.root, 'libs/ibiz-cloud-core/pom.xml');
  fs.writeFileSync(pom, fs.readFileSync(pom, 'utf8')
    .replace('8.1.0.584.1</version></parent>', '8.1.0.999.1</version></parent>'));
  const result = verifyPlmIbizDependencyClosure(f.options);
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.some(item => item.dependency === 'cn.ibizlab.plugin:ibiz-cloud-core:8.1.0.584.1'));
});

test('CLI help succeeds and malformed invocation fails', () => {
  assert.equal(main(['--help']), 0);
  assert.throws(() => main(['--unexpected']), /This harness takes no arguments/);
});
