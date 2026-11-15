import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { join } from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
export const CLOUD_UAA_SOURCE_PATHS = Object.freeze([
  'libs/ibiz-cloud-uaa-core/src/main/java/net/ibizsys/central/cloud/uaa/core/spring/controller/UAARestController.java',
  'ibiz-ebsx-runtime/src/main/java/net/ibizsys/ebsx/allinone/boot/EBSXAllInOneApplication.java',
]);

export function bindOwnedCloudUaaSource({ workspace, images, read }) {
  assert.equal(images.contract, 'isolated-backend-source-images-v1');
  assert.equal(images.status, 'passed-image-artifact-binding-only');
  assert.equal(images.imageArtifactBindingVerified, true);
  const packageBytes = read(images.packageReceipt.path);
  assert.equal(hash(packageBytes), images.packageReceipt.sha256);
  const build = JSON.parse(packageBytes);
  assert.equal(build.contract, 'isolated-backend-source-package-v1');
  assert.equal(build.status, 'passed-package-and-unit-only');
  assert.equal(build.sourcePackageVerified, true);
  assert.equal(build.unitRegression, true);
  assert.equal(images.packageReceipt.sourceFingerprint, build.sourceInputs.before.fingerprint);
  const component = images.components.filter(row => row.name === 'allinone');
  assert.equal(component.length, 1);
  const jar = component[0].imageFiles.filter(row => row.path === '/ibiz-ebsx-allinone-rt.jar');
  assert.equal(jar.length, 1);
  const archive = build.packages.archives.filter(row =>
    row.path === 'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar');
  assert.equal(archive.length, 1);
  assert.deepEqual([jar[0].sha256, jar[0].bytes], [archive[0].sha256, archive[0].bytes]);
  assert.deepEqual(archive[0].unknownOwnDependencies, []);
  const dependency = archive[0].embeddedLibraries.filter(row => row.module === 'libs/ibiz-cloud-uaa-core');
  assert.equal(dependency.length, 1);
  assert.equal(dependency[0].ownership, 'source-reactor');
  assert.equal(dependency[0].classification, 'reactor-source');
  assert.equal(dependency[0].sha256, dependency[0].targetSha256);
  assert.match(dependency[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(dependency[0].path, /^BOOT-INF\/lib\/ibiz-cloud-uaa-core-[A-Za-z0-9_.-]+\.jar$/);
  const entries = CLOUD_UAA_SOURCE_PATHS.map(path => {
    const entry = build.sourceInputs.before.entries.filter(row => row.path === path);
    assert.equal(entry.length, 1);
    const current = read(join(workspace, 'ibiz-service-hub', path));
    const packaged = read(join(build.worktree, path));
    assert.deepEqual([hash(current), current.length], [entry[0].sha256, entry[0].bytes]);
    assert.deepEqual(packaged, current);
    if (path === CLOUD_UAA_SOURCE_PATHS[0]) {
      assert.ok(current.toString().includes('@GetMapping(value = { "/appdata", "/appdata/{srfdcsystem}"})'));
      assert.ok(current.toString().includes('this.getCloudUAAUtilRuntime().getAppData(srfsystemid, srforgid)'));
    } else {
      assert.ok(current.toString().includes('"net.ibizsys.central.cloud.uaa.core.spring"'));
    }
    return { path, bytes: current.length, sha256: hash(current) };
  });
  return {
    entries, fingerprint: hash(JSON.stringify(entries)), imageId: component[0].image.id,
    packageReceipt: { path: images.packageReceipt.path, sha256: hash(packageBytes) },
    embeddedControllerLibrary: { path: dependency[0].path, sha256: dependency[0].sha256 },
  };
}

function privateOrigin(origin, port) {
  const url = new URL(origin);
  assert.equal(url.origin, origin);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.port, String(port));
  assert.equal(isIP(url.hostname), 4);
  const [a, b] = url.hostname.split('.').map(Number);
  assert.ok(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  return url;
}

export function ownedUaaAlias({ runId, origin }) {
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  const url = privateOrigin(origin, 32666);
  return {
    serviceName: 'uaa-api', groupName: `nf_${runId}`,
    ip: url.hostname, port: 32666, clusterName: 'DEFAULT',
    enabled: true, healthy: true, ephemeral: false,
    metadata: { 'aibiz.native-fixture.run': runId, 'aibiz.native-service.role': 'uaa' },
  };
}

export function ownedCloudUaaAlias({ runId, origin, target, sourceFingerprint }) {
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  const url = privateOrigin(origin, 30000);
  assert.deepEqual(Object.keys(target).sort(), ['containerId', 'imageId', 'name']);
  assert.match(target.containerId, /^[a-f0-9]{64}$/);
  assert.match(target.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.match(target.name, new RegExp(`^nf-${runId}-backend-[a-z0-9][a-z0-9-]{0,48}-allinone$`));
  assert.match(sourceFingerprint, /^[a-f0-9]{64}$/);
  return {
    serviceName: 'ibizcloud-uaa', groupName: `nf_${runId}`,
    ip: url.hostname, port: 30000, clusterName: 'DEFAULT',
    enabled: true, healthy: true, ephemeral: false,
    metadata: {
      'aibiz.native-fixture.run': runId, 'aibiz.native-service.role': 'allinone-cloud-uaa',
      'aibiz.native-service.container': target.containerId, 'aibiz.native-service.image': target.imageId,
      'aibiz.native-service.name': target.name, 'aibiz.native-service.source': sourceFingerprint,
    },
  };
}

function validateAlias(alias) {
  const runId = alias?.metadata?.['aibiz.native-fixture.run'];
  const origin = `http://${alias?.ip}:${alias?.port}`;
  if (alias?.serviceName === 'uaa-api') assert.deepEqual(alias, ownedUaaAlias({ runId, origin }));
  else {
    assert.equal(alias?.serviceName, 'ibizcloud-uaa', 'Only the two reviewed UAA service aliases are eligible');
    assert.deepEqual(alias, ownedCloudUaaAlias({ runId, origin,
      target: {
        containerId: alias.metadata['aibiz.native-service.container'],
        imageId: alias.metadata['aibiz.native-service.image'], name: alias.metadata['aibiz.native-service.name'],
      }, sourceFingerprint: alias.metadata['aibiz.native-service.source'] }));
  }
}

function query(alias) {
  return new URLSearchParams({ serviceName: alias.serviceName, groupName: alias.groupName,
    clusters: alias.clusterName, healthyOnly: 'false' });
}

export function verifyOwnedUaaAlias(body, alias, {
  allowMissing = false, allowPendingEphemeral = false,
} = {}) {
  validateAlias(alias);
  assert.equal(body?.name, `${alias.groupName}@@${alias.serviceName}`);
  assert.ok(Array.isArray(body.hosts) && body.hosts.length <= 1,
    'A run-owned alias cannot adopt multiple or foreign instances');
  if (!body.hosts.length) {
    assert.equal(allowMissing, true, 'Owned UAA alias is missing');
    return false;
  }
  const host = body.hosts[0];
  for (const key of ['ip', 'port', 'clusterName', 'enabled']) {
    assert.equal(host[key], alias[key], 'Owned UAA alias target or policy differs');
  }
  assert.deepEqual(host.metadata, alias.metadata, 'Owned UAA alias ownership differs');
  if (allowPendingEphemeral) assert.equal(typeof host.ephemeral, 'boolean');
  else assert.equal(host.ephemeral, alias.ephemeral, 'Owned UAA alias persistence policy differs');
  return true;
}

async function readAlias(origin, alias, request, guard, allowMissing, allowPendingEphemeral = false) {
  await guard();
  const result = await request(origin, `/nacos/v1/ns/instance/list?${query(alias)}`);
  assert.equal(result.status, 200, 'Owned Nacos alias listing failed');
  const body = JSON.parse(result.bytes.toString('utf8'));
  const present = verifyOwnedUaaAlias(body, alias, { allowMissing, allowPendingEphemeral });
  return { present, body };
}

export async function publishOwnedUaaAlias(origin, alias, {
  request, guard, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  readbackAttempts = 30, onCreated = () => {},
} = {}) {
  privateOrigin(origin, 8848);
  validateAlias(alias);
  assert.equal(typeof request, 'function');
  assert.equal(typeof guard, 'function', 'Live exact-peer inspection is mandatory');
  assert.equal(typeof onCreated, 'function');
  assert.ok(Number.isSafeInteger(readbackAttempts) && readbackAttempts > 0 && readbackAttempts <= 50);
  const before = await readAlias(origin, alias, request, guard, true);
  if (!before.present) {
    await guard();
    const body = new URLSearchParams(Object.entries(alias).map(([key, value]) => [
      key, key === 'metadata' ? JSON.stringify(value) : String(value),
    ]));
    const result = await request(origin, '/nacos/v1/ns/instance', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    assert.equal(result.status, 200, 'Owned Nacos alias registration failed');
    assert.equal(result.bytes.toString('utf8').trim(), 'ok', 'Owned Nacos rejected alias registration');
    onCreated();
  }
  for (let attempt = 1; attempt <= readbackAttempts; attempt++) {
    const current = await readAlias(origin, alias, request, guard, true, !before.present);
    if (current.present && current.body.hosts[0].healthy === true
        && current.body.hosts[0].ephemeral === alias.ephemeral) {
      return { contract: alias.serviceName === 'uaa-api' ? 'owned-nacos-uaa-alias-v1' : 'owned-nacos-cloud-uaa-alias-v1',
        status: 'passed-exact-owned-alias-readback',
        alias, created: !before.present, readbackAttempts: attempt,
        nativeAcceptance: false, refreshAcceptance: false };
    }
    assert.ok(attempt < readbackAttempts, 'Owned UAA alias did not become healthy');
    await delay(200);
  }
}

export async function removeOwnedUaaAlias(origin, alias, { request, guard } = {}) {
  privateOrigin(origin, 8848);
  validateAlias(alias);
  assert.equal(typeof request, 'function');
  assert.equal(typeof guard, 'function');
  const before = await readAlias(origin, alias, request, guard, true);
  if (!before.present) return { removed: false, absent: true };
  await guard();
  const parameters = new URLSearchParams({ serviceName: alias.serviceName, groupName: alias.groupName,
    clusterName: alias.clusterName, ip: alias.ip, port: String(alias.port), ephemeral: 'false' });
  const result = await request(origin, `/nacos/v1/ns/instance?${parameters}`, { method: 'DELETE' });
  assert.equal(result.status, 200, 'Owned Nacos alias removal failed');
  assert.equal(result.bytes.toString('utf8').trim(), 'ok', 'Owned Nacos rejected alias removal');
  const after = await readAlias(origin, alias, request, guard, true);
  assert.equal(after.present, false, 'Owned Nacos alias remains after removal');
  return { removed: true, absent: true };
}
