import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { caseCollisions, repositorySlug } from '../fetch-modeling-upstream.mjs';

const script = fileURLToPath(new URL('../fetch-modeling-upstream.mjs', import.meta.url));

function isolatedScript(t, inventorySource) {
  const root = mkdtempSync(join(tmpdir(), 'fetch-modeling-upstream-'));
  const scriptDir = join(root, 'scripts');
  const copiedScript = join(scriptDir, 'fetch-modeling-upstream.mjs');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(script, copiedScript);
  writeFileSync(join(scriptDir, 'harness-modeling-extension-inventory.mjs'), inventorySource);
  return { root, copiedScript };
}

test('importing helpers and requesting help do not start the filesystem audit', t => {
  const fixture = isolatedScript(t, 'throw new Error("inventory import should be deferred");\n');
  const result = spawnSync(process.execPath, [fixture.copiedScript, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: node scripts\/fetch-modeling-upstream\.mjs/);
  assert.equal(result.stderr, '');
});

test('the real fetch path still fails closed when the inventory audit cannot load', t => {
  const fixture = isolatedScript(t, 'throw new Error("inventory audit failed");\n');
  const result = spawnSync(process.execPath, [fixture.copiedScript], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /inventory audit failed/);
  assert.equal(result.stdout, '');
  assert.equal(existsSync(join(fixture.root, '.artifacts')), false);
  assert.equal(existsSync(join(fixture.root, 'extensions')), false);
});

test('source fetch accepts only the registered public repository URL shape', () => {
  assert.equal(repositorySlug('https://gitee.com/ibizlab-appstore/logic-design-standard.git'), 'logic-design-standard');
  for (const url of [
    'http://gitee.com/ibizlab-appstore/logic-design-standard.git',
    'https://user:secret@gitee.com/ibizlab-appstore/logic-design-standard.git',
    'https://gitee.com/other/logic-design-standard.git',
    'https://gitee.com/ibizlab-appstore/../other.git',
    'https://gitee.com/ibizlab-appstore/logic-design-standard.git?token=secret',
    'https://untrusted.invalid/ibizlab-appstore/logic-design-standard.git',
  ]) assert.throws(() => repositorySlug(url));
});

test('case and Unicode-normalization collisions are kept visible instead of silently losing files', () => {
  assert.deepEqual(caseCollisions([
    'model/PSDEMSLOGIC.json', 'model/PSDEMSLogic.json', 'README.md',
    'model/caf\u00e9.json', 'model/cafe\u0301.json',
  ]), [
    ['model/PSDEMSLOGIC.json', 'model/PSDEMSLogic.json'],
    ['model/caf\u00e9.json', 'model/cafe\u0301.json'],
  ]);
  assert.deepEqual(caseCollisions(['model/One.json', 'model/Two.json']), []);
});

test('pom.xml summaries expose the ibiz platform version properties and ibiz dependencies', async () => {
  const { summarizePom, declaredVersions } = await import('../fetch-modeling-upstream.mjs');
  const pom = `<?xml version="1.0"?>
<project>
    <!-- <version>9.9.9</version> commented out -->
    <artifactId>modelapi</artifactId>
    <groupId>net.ibizsys.modelapi</groupId>
    <version>1.0.0.0</version>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>2.4.0</version>
    </parent>
    <properties>
        <java.version>1.8</java.version>
        <ibiz.cloud.version>8.1.0.542</ibiz.cloud.version>
        <other.thing>x</other.thing>
    </properties>
    <dependencies>
        <dependency>
            <groupId>net.ibizsys.plugin</groupId>
            <artifactId>ibiz-plugin-cloud</artifactId>
            <version>\${ibiz.cloud.version}</version>
        </dependency>
        <dependency>
            <groupId>org.bouncycastle</groupId>
            <artifactId>bcprov-jdk15on</artifactId>
            <version>1.70</version>
        </dependency>
    </dependencies>
</project>`;
  const summary = summarizePom(pom);
  assert.deepEqual(summary, {
    kind: 'pom.xml', groupId: 'net.ibizsys.modelapi', artifactId: 'modelapi', version: '1.0.0.0',
    parent: { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-parent', version: '2.4.0' },
    versionProperties: { 'java.version': '1.8', 'ibiz.cloud.version': '8.1.0.542' },
    ibizDependencies: [{ groupId: 'net.ibizsys.plugin', artifactId: 'ibiz-plugin-cloud', version: '${ibiz.cloud.version}' }],
  });
  assert.deepEqual(declaredVersions([summary]), { ibizTemplatePackages: {}, ibizMavenVersionProperties: ['ibiz.cloud.version=8.1.0.542'] });
});

test('package.json summaries keep only string dependency specs and collect @ibiz-template-plugin versions', async () => {
  const { summarizePackageManifest, declaredVersions } = await import('../fetch-modeling-upstream.mjs');
  const summary = summarizePackageManifest(JSON.stringify({
    name: '@ibiz-template-plugin/md-design', version: '0.1.0',
    dependencies: { '@ibiz-template-plugin/core': '1.2.3', vue: '^3.3.0', broken: { not: 'a-spec' } },
    peerDependencies: { '@ibiz-template/runtime': '0.5.0' },
    devDependencies: 'not-an-object',
  }));
  assert.deepEqual(summary, {
    kind: 'package.json', name: '@ibiz-template-plugin/md-design', version: '0.1.0',
    dependencies: { '@ibiz-template-plugin/core': '1.2.3', vue: '^3.3.0' },
    devDependencies: {}, peerDependencies: { '@ibiz-template/runtime': '0.5.0' },
  });
  assert.deepEqual(declaredVersions([summary]).ibizTemplatePackages, {
    '@ibiz-template-plugin/core': ['1.2.3'], '@ibiz-template/runtime': ['0.5.0'],
  });
  assert.throws(() => summarizePackageManifest('[]'));
  assert.throws(() => summarizePackageManifest('{ not json'));
});
