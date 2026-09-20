import assert from 'node:assert/strict';
import test from 'node:test';
import { caseCollisions, repositorySlug } from '../fetch-modeling-upstream.mjs';

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
