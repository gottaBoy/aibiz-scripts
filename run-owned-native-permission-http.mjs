#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createNativeMatrix, validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { validateFixtureReceipt } from './provision-run-owned-native-application-accounts.mjs';
import {
  mysqlFixtureProfile, verifyMysqlFixtureStorage, mysqlFixtureReadyProcess,
} from './mysql-fixture-profiles.mjs';
import {
  OWNED_VOLUME_PROFILE, inspectMysqlFixtureVolumes, inspectOwnedMysqlDiskBacking,
} from './owned-mysql-volume.mjs';
import { verifyOwnedServiceTmpfs, verifyOwnedZookeeper } from './owned-backend-resources.mjs';
import { recreateOwnedMysql, mysqlRecreationWitness } from './owned-mysql-recreation.mjs';
import { ownedMysqlColdState, restoreOwnedMysqlColdBackup } from './owned-mysql-backup-restore.mjs';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const toolPath = 'scripts/run-owned-native-permission-http.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const idPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const apiPrefix = '/api/ibizmodeling__modeldesign';

function privateWrite(path, bytes) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
}

function readJSON(path, { privateInput = false } = {}) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Input must be a regular non-symlink file');
  if (privateInput) assert.equal(stat.mode & 0o077, 0, 'Credentials must not be group/world readable');
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes), binding: { path, bytes: bytes.length, sha256: digest(bytes) } };
}

function runDirectory(workspace, runId) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  let base = resolve(workspace);
  for (const part of ['.artifacts', 'native-nonadmin-fixtures', runId]) {
    base = join(base, part);
    const stat = lstatSync(base);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Fixture ancestors must be real directories');
  }
  return base;
}

function docker(args, input) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ok(!result.error && result.status === 0, 'Owned Docker command failed; raw output suppressed');
  return result.stdout;
}

function ipv4Number(address) {
  assert.equal(isIP(address), 4, 'Inspected transport requires an unambiguous IPv4 literal');
  return address.split('.').reduce((value, byte) => value * 256 + Number(byte), 0);
}

function privateIPv4(number) {
  return [[167772160, 184549375], [2886729728, 2887778303], [3232235520, 3232301055]]
    .some(([start, end]) => number >= start && number <= end);
}

export function validatePrivateEndpoint(endpoint, services, containers, network) {
  assert.equal(endpoint.transport, 'private-inspected-ipv4');
  assert.ok(!Object.hasOwn(endpoint, 'origin'), 'Private transport derives origin from inspect; no supplied origin');
  assert.ok(['uaa', 'gateway'].includes(endpoint.service), 'Only declared auth/gateway private HTTP services');
  assert.equal(endpoint.containerPort, endpoint.service === 'uaa' ? 32666 : 30086);
  assert.ok(Object.hasOwn(services, endpoint.service));
  assert.match(endpoint.containerId, idPattern);
  assert.match(endpoint.networkId, idPattern);
  assert.match(endpoint.endpointId, idPattern);
  assert.equal(endpoint.containerId, services[endpoint.service].containerId);
  const matches = containers.filter(row => row.Id === endpoint.containerId);
  assert.equal(matches.length, 1);
  const target = matches[0];
  assert.equal(target.State?.Running, true);
  assert.equal(target.Image, services[endpoint.service].imageId);
  assert.equal(network?.Internal, true);
  assert.equal(network.Driver, 'bridge');
  assert.equal(endpoint.networkId, network.Id);
  assert.deepEqual(Object.keys(target.NetworkSettings.Networks), [network.Name]);
  const attachment = target.NetworkSettings.Networks[network.Name];
  assert.equal(attachment.NetworkID, endpoint.networkId);
  assert.equal(attachment.EndpointID, endpoint.endpointId);
  assert.equal(attachment.IPAddress, endpoint.ipv4, 'Private IP must match the deployment input pin');
  const address = attachment.IPAddress;
  const ip = ipv4Number(address);
  assert.ok(privateIPv4(ip), 'Only RFC1918 container addresses are allowed');
  const prefix = attachment.IPPrefixLen;
  assert.ok(Number.isInteger(prefix) && prefix > 0 && prefix <= 30);
  const peer = network.Containers?.[target.Id];
  assert.ok(peer);
  assert.equal(peer.Name, target.Name.slice(1));
  assert.equal(peer.EndpointID, endpoint.endpointId);
  assert.equal(peer.IPv4Address, `${address}/${prefix}`);
  const block = 2 ** (32 - prefix);
  const subnets = (network.IPAM?.Config ?? []).filter(row => {
    if (typeof row.Subnet !== 'string') return false;
    const parts = row.Subnet.split('/');
    if (parts.length !== 2 || parts[1] !== String(prefix) || isIP(parts[0]) !== 4) return false;
    const base = ipv4Number(parts[0]);
    return base % block === 0 && Math.floor(ip / block) === base / block;
  });
  assert.equal(subnets.length, 1, 'Require one exact inspected IPAM subnet');
  const subnet = subnets[0];
  const base = ipv4Number(subnet.Subnet.split('/')[0]);
  assert.ok(privateIPv4(base) && privateIPv4(base + block - 1), 'Whole inspected subnet must be private');
  assert.ok(ip > base && ip < base + block - 1, 'Network/broadcast address cannot be a service');
  assert.equal(isIP(subnet.Gateway), 4);
  const gateway = ipv4Number(subnet.Gateway);
  assert.ok(gateway > base && gateway < base + block - 1);
  // Docker reports an empty attachment gateway for this internal bridge while
  // the network-level IPAM gateway remains populated. Any non-empty value
  // must still agree with IPAM so stale or cross-network inspect data fails.
  assert.ok(attachment.Gateway === '' || attachment.Gateway === subnet.Gateway,
    'Attachment gateway must be empty or match the inspected IPAM gateway');
  assert.notEqual(address, subnet.Gateway, 'Bridge gateway cannot be a service');
  for (const entries of [target.HostConfig.PortBindings, target.NetworkSettings.Ports]) {
    assert.ok(entries == null || (typeof entries === 'object' && !Array.isArray(entries)));
    assert.ok(Object.values(entries ?? {}).every(row => row === null),
      'Private transport cannot have requested or actual host publications');
  }
  return `http://${address}:${endpoint.containerPort}`;
}

export function validateEndpoint(endpoint, services, containers, network, { allowPrivate = false } = {}) {
  if (endpoint.transport === 'private-inspected-ipv4') {
    assert.equal(allowPrivate, true, 'Private transport requires the explicit v2 deployment contract');
    return validatePrivateEndpoint(endpoint, services, containers, network);
  }
  assert.ok(endpoint.transport === undefined || endpoint.transport === 'loopback-publication');
  const url = new URL(endpoint.origin);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1', 'Only an inspected loopback publication is allowed');
  assert.equal(url.pathname, '/');
  assert.equal(url.search + url.hash + url.username + url.password, '');
  assert.match(url.port, /^[1-9][0-9]*$/);
  assert.ok(Number(url.port) <= 65535);
  assert.ok(Number.isSafeInteger(endpoint.containerPort) && endpoint.containerPort > 0
    && endpoint.containerPort <= 65535);
  assert.ok(Object.hasOwn(services, endpoint.service));
  const target = containers.find(row => row.Id === services[endpoint.service].containerId);
  assert.ok(target);
  const bindings = target.NetworkSettings.Ports?.[`${endpoint.containerPort}/tcp`];
  assert.deepEqual(bindings, [{ HostIp: '127.0.0.1', HostPort: url.port }],
    'Endpoint must match exactly one loopback Docker port binding');
  return url.origin;
}

export function validateDeployment(manifest, resources, deployment, containers, network, imageReceipt, volumes = []) {
  validateMatrixFixture(manifest);
  assert.equal(resources.contract, 'run-owned-native-fixture-resources-v1');
  assert.equal(resources.runId, manifest.runId);
  assert.equal(resources.mysqlName, manifest.ownership.mysqlContainer);
  assert.equal(resources.networkName, manifest.ownership.network);
  assert.deepEqual(resources.schemas, manifest.schemas);
  assert.ok(['run-owned-native-permission-deployment-input-v1',
    'run-owned-native-permission-deployment-input-v2'].includes(deployment.contract));
  const allowPrivate = deployment.contract === 'run-owned-native-permission-deployment-input-v2';
  assert.equal(deployment.runId, manifest.runId);
  assert.equal(network.Id, resources.networkId);
  assert.equal(network.Name, manifest.ownership.network);
  assert.equal(network.Internal, true);
  assert.equal(network.Driver, 'bridge');
  assert.equal(network.Labels?.[manifest.ownership.label], manifest.runId);
  assert.equal(imageReceipt.contract, 'isolated-backend-source-images-v1');
  assert.equal(imageReceipt.status, 'passed-image-artifact-binding-only');
  assert.equal(imageReceipt.imageArtifactBindingVerified, true);
  const services = deployment.services;
  assert.deepEqual(Object.keys(services).sort(), ['allinone', 'gateway', 'provider', 'uaa']);
  const peers = [
    { containerId: resources.mysqlId, imageId: resources.mysqlImage, role: 'mysql' },
    ...Object.entries(services).map(([role, row]) => ({ ...row, role })),
    ...(deployment.auxiliaryContainers ?? []),
  ];
  assert.ok((deployment.auxiliaryContainers ?? []).every(row =>
    ['redis', 'nacos', 'zookeeper'].includes(row.role)), 'Unreviewed auxiliary role');
  assert.equal(new Set(peers.map(row => row.role)).size, peers.length, 'Duplicate deployment role');
  assert.equal(new Set(peers.map(row => row.containerId)).size, peers.length);
  assert.deepEqual(Object.keys(network.Containers).sort(), peers.map(row => row.containerId).sort(),
    'No undeclared or shared peers may be attached');
  assert.equal(containers.length, peers.length);
  for (const peer of peers) {
    assert.match(peer.containerId, idPattern);
    assert.match(peer.imageId, imagePattern);
    assert.match(peer.role, /^[a-z][a-z0-9-]*$/);
    const container = containers.find(row => row.Id === peer.containerId);
    assert.ok(container?.State.Running, 'All declared peers must be running');
    assert.equal(container.Image, peer.imageId);
    assert.equal(container.Config.Labels?.[manifest.ownership.label], manifest.runId);
    assert.equal(container.HostConfig.Privileged, false);
    assert.ok(!container.HostConfig.CapAdd?.length, 'Additional capabilities are not allowed');
    assert.ok(!container.HostConfig.PidMode || container.HostConfig.PidMode !== 'host');
    assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [manifest.ownership.network]);
    assert.equal(container.NetworkSettings.Networks[manifest.ownership.network].NetworkID, network.Id);
    if (peer.role === 'zookeeper') {
      verifyOwnedZookeeper(container, manifest.runId, container.Config.Labels?.['aibiz.native-backend.launch']);
    }
    const reviewedTmpfs = peer.role !== 'mysql' && (Object.keys(container.HostConfig.Tmpfs ?? {}).length > 0
      || (container.Mounts ?? []).some(mount => mount.Type === 'tmpfs'));
    if (reviewedTmpfs) verifyOwnedServiceTmpfs(container, peer.role);
    for (const mounts of container.Mounts ?? []) {
      if (peer.role === 'mysql' && resources.databaseProfile !== undefined) continue;
      if (mounts.Type === 'tmpfs' && reviewedTmpfs) continue;
      assert.equal(mounts.Type, 'bind', 'Undeclared volumes are not allowed');
      assert.equal(mounts.RW, false, 'Application input binds must be read-only');
      validateInputBind(workspaceRoot, manifest.runId, mounts.Source);
    }
    for (const bindings of Object.values(container.HostConfig.PortBindings ?? {})) {
      for (const binding of bindings ?? []) assert.equal(binding.HostIp, '127.0.0.1');
    }
    if (peer.role === 'mysql') {
      assert.equal(container.Name, `/${manifest.ownership.mysqlContainer}`);
      if (resources.databaseProfile === undefined) {
        assert.equal(resources.databaseStorage, undefined);
        assert.equal(volumes.length, 0);
        assert.deepEqual(container.HostConfig.Tmpfs, { '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824' });
      } else {
        assert.deepEqual(Object.keys(resources.databaseProfile).sort(), ['imageId', 'name']);
        const profile = mysqlFixtureProfile(resources.databaseProfile.name);
        assert.equal(resources.databaseProfile.imageId, profile.imageId);
        verifyMysqlFixtureStorage(profile, container, { storage: resources.databaseStorage, volumes });
      }
      assert.ok(Object.values(container.NetworkSettings.Ports).every(row => row === null));
    }
    if (['allinone', 'gateway', 'provider'].includes(peer.role)) {
      const image = imageReceipt.components.find(row => row.name === peer.role);
      assert.equal(peer.imageId, image?.image.id, 'Do not use a stale or label-only source image');
    }
  }
  assert.equal(deployment.endpoints.uaa.service, 'uaa');
  assert.equal(deployment.endpoints.backend.service, 'gateway');
  if (allowPrivate) for (const endpoint of Object.values(deployment.endpoints)) {
    assert.ok(['loopback-publication', 'private-inspected-ipv4'].includes(endpoint.transport),
      'v2 must explicitly select each endpoint transport');
  }
  return Object.fromEntries(['uaa', 'backend'].map(name => [
    name, validateEndpoint(deployment.endpoints[name], services, containers, network, { allowPrivate }),
  ]));
}

export function validateInputBind(workspace, runId, source) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  const base = join(workspace, '.artifacts', 'native-nonadmin-fixtures', runId);
  const child = relative(base, source);
  assert.ok(child && !child.startsWith('..') && !child.startsWith('/'),
    'Only individual run-owned input files/directories may be bound');
  let current = resolve(workspace);
  for (const part of ['.artifacts', 'native-nonadmin-fixtures', runId, ...child.split('/')]) {
    current = join(current, part);
    assert.ok(!lstatSync(current).isSymbolicLink(), 'Input binds must not traverse symlinks');
  }
  return true;
}

export function moduleRequest(root, operation, recordId, data) {
  const collection = `${apiPrefix}/psdevslnsys/${encodeURIComponent(root.rootId)}/psmodules`;
  switch (operation) {
    case 'FETCH_CUR_SYS': return { method: 'POST', path: `${collection}/fetchcursys`,
      data: { pssystemid: root.logicalSystemId, size: 1000, ...data } };
    case 'GET': return { method: 'GET', path: `${collection}/${encodeURIComponent(recordId)}` };
    case 'CREATE': return { method: 'POST', path: collection, data };
    case 'UPDATE': return { method: 'PUT', path: `${collection}/${encodeURIComponent(recordId)}`, data };
    case 'REMOVE': return { method: 'DELETE', path: `${collection}/${encodeURIComponent(recordId)}` };
    default: assert.fail('Unknown native module operation');
  }
}

export function createModuleProbe(runId, root, label, nonce = randomBytes(4).toString('hex')) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.match(nonce, /^[a-f0-9]{8}$/);
  assert.ok(['a', 'b'].includes(root.side));
  assert.equal(root.rootId, `nf_${runId}_root_${root.side}`);
  assert.equal(root.logicalSystemId, `nf_${runId}_system`);
  return {
    psmoduleid: `nf_${runId}_${root.side}_http_${nonce}`,
    codename: `NativeProbe${nonce}`, pssystemid: root.logicalSystemId,
    psmodulename: `Native relogin ${label} ${root.side}`,
    modtag: `nf_${runId}_${root.side}_created`,
  };
}

export function verifyUAAIdentity(data, user) {
  assert.ok(data && typeof data === 'object' && !Array.isArray(data));
  assert.equal(data.id ?? data.userid, user.personId, 'Authenticated person must match PSDevUserObj ID');
  assert.equal(data.dc, user.centerId, 'Authenticated center must match the fixture center');
  for (const key of ['superuser', 'super_user', 'apiuser', 'api_user', 'adminmode']) {
    if (Object.hasOwn(data, key)) assert.ok([0, '0', false, null].includes(data[key]), 'No privileged principal');
  }
  const grants = data.grants ?? data.roles ?? [];
  assert.ok(Array.isArray(grants) && grants.length > 0);
  for (const grant of grants) {
    assert.equal(grant.system_id ?? grant.systemId, 'ibizmodeling');
    assert.equal(grant.deploy_system_id ?? grant.deploySystemId, `${user.centerId}_deploy`);
  }
  const roles = grants.flatMap(row => row.roles ?? []);
  assert.ok(roles.length > 0, 'Require the actual non-reserved modeling system role');
  for (const role of roles) {
    assert.equal(role.authority, 'ROLE_NATIVE_FIXTURE', 'Reserved or unexpected roles are forbidden');
    assert.equal(role.role_id ?? role.roleId, `${user.centerId}_ordinary_role`,
      'The database role ID is distinct from its authority tag');
  }
  return true;
}

export function modelingContextFromIdentity(data, user) {
  verifyUAAIdentity(data, user);
  assert.equal(data.organization_id, `${user.centerId}_org`, 'Require actual owned UAA organization');
  return { system: 'ibizmodeling', organization: data.organization_id };
}

export function verifyModelingAppData(response, user, applicationContext) {
  assert.equal(response.status, 200);
  assert.equal(response.error, null);
  const context = response.data?.context;
  assert.ok(context && typeof context === 'object' && !Array.isArray(context));
  assert.equal(context.srfsystemid, applicationContext.system);
  assert.equal(context.srforgid, applicationContext.organization);
  assert.equal(context.srfuserid, user.personId);
  assert.equal(context.srfpersonid, user.personId);
  assert.equal(context.srfdcid, user.centerId);
  for (const key of ['superuser', 'apiuser', 'adminmode']) {
    for (const object of [context, response.data]) {
      if (Object.hasOwn(object, key)) assert.ok([0, '0', false, null].includes(object[key]));
    }
  }
}

export function verifyDenied(response, before, after, roots = []) {
  assert.equal(response.status, 403, 'Only HTTP 403 is authenticated authorization denial; 401/404/500 are not proof');
  assert.equal(response.error, null);
  assert.deepEqual(after, before, 'Denied request must not mutate either physical database');
  for (const root of Array.isArray(roots) ? roots : [roots]) {
    const body = JSON.stringify(response.data);
    assert.ok(!body?.includes(root.sentinelName) && !body?.includes(root.sentinelSystemName),
      'Denied response must not expose either physical sentinel name');
  }
}

export function verifyBaseline(manifest, rows) {
  validateMatrixFixture(manifest);
  assert.equal(rows.length, manifest.roots.length * 2, 'Require exactly the four original sentinel rows');
  for (const root of manifest.roots) {
    const modules = rows.filter(item => item.database === root.database && item.table === 't_srfpsmodule');
    const systems = rows.filter(item => item.database === root.database && item.table === 't_srfpssystem');
    assert.equal(modules.length, 1);
    assert.equal(systems.length, 1);
    const module = modules[0].row;
    const system = systems[0].row;
    for (const [field, expected] of [
      ['PSMODULEID', root.sentinelId], ['PSSYSTEMID', root.logicalSystemId],
      ['PSMODULENAME', root.sentinelName], ['MODTAG', root.sentinelTag],
    ]) assert.equal(module[field], expected, 'Physical module baseline does not match the original fixture');
    for (const [field, expected] of [
      ['PSSYSTEMID', root.logicalSystemId], ['PSSYSTEMNAME', root.sentinelSystemName],
      ['PSDEVSLNSYSID', root.rootId], ['PSSYSMODELINSTID', root.modelInstanceId],
      ['PSDEVCENTERID', root.centerId], ['PSDEVSLNID', root.schemeId], ['MODELVER', root.modelVersion],
    ]) assert.equal(system[field], expected, 'Physical system baseline does not match the original fixture');
  }
  return true;
}

export function verifyRestoration(baseline, final, { modelVersionDeltas = {} } = {}) {
  const databases = baseline.filter(row => row.table === 't_srfpssystem').map(row => row.database);
  assert.ok(Object.keys(modelVersionDeltas).every(database => databases.includes(database)));
  for (const delta of Object.values(modelVersionDeltas)) assert.ok(Number.isSafeInteger(delta) && delta > 0);
  const normalize = rows => rows.map(item => {
    if (item.table === 't_srfpssystem' && Object.hasOwn(modelVersionDeltas, item.database)) {
      const copy = structuredClone(item);
      delete copy.row.MODELVER;
      return copy;
    }
    return item;
  });
  assert.deepEqual(normalize(final), normalize(baseline),
    'All original physical module/system columns except model-version audit must be restored');
  for (const [database, delta] of Object.entries(modelVersionDeltas)) {
    const before = baseline.find(row => row.database === database && row.table === 't_srfpssystem');
    const after = final.find(row => row.database === database && row.table === 't_srfpssystem');
    assert.equal(after.row.MODELVER, before.row.MODELVER + delta,
      'Only the exact observed model-version audit increments are permitted');
  }
  return true;
}

export function verifyRead(response, root, operation, recordId = root.sentinelId) {
  assert.equal(response.status, 200);
  assert.equal(response.error, null);
  const rows = operation === 'FETCH_CUR_SYS' ? response.data : [response.data];
  assert.ok(Array.isArray(rows) && rows.length > 0, 'A successful empty response is not read proof');
  assert.ok(rows.every(row => row && row.pssystemid === root.logicalSystemId));
  const row = rows.find(value => value.psmoduleid === recordId);
  assert.ok(row, 'Expected native record not returned');
  if (recordId === root.sentinelId) {
    assert.equal(row.psmodulename, root.sentinelName, 'Wrong physical database sentinel');
    assert.equal(row.pssystemname, root.sentinelSystemName, 'Wrong physical system join');
  }
  return row;
}

export function validateRequestPath(spec) {
  assert.ok(spec && typeof spec.path === 'string');
  const authMethod = {
    '/auths/login': 'POST', '/auths/user-info/self': 'GET',
    '/v7/login': 'POST', '/uaa/oauth/userinfo': 'GET',
    '/appdata': 'GET',
  }[spec.path];
  if (authMethod) assert.equal(spec.method, authMethod);
  else {
    assert.ok(['GET', 'POST', 'PUT', 'DELETE'].includes(spec.method));
    assert.match(spec.path,
      /^\/api\/ibizmodeling__modeldesign\/psdevslnsys\/[A-Za-z0-9_-]+\/psmodules(?:\/[A-Za-z0-9_-]+)?$/);
  }
  if (spec.applicationContext !== undefined) {
    const context = spec.applicationContext;
    assert.ok(context && typeof context === 'object' && !Array.isArray(context));
    assert.deepEqual(Object.keys(context).sort(), ['organization', 'system']);
    assert.equal(context.system, 'ibizmodeling');
    assert.match(context.organization, /^nf_[a-f0-9]{12}_center(?:_[ab])?_org$/);
    assert.ok(spec.path === '/appdata' || spec.path.startsWith(`${apiPrefix}/`),
      'Application context cannot accompany auth/token requests');
  }
  if (spec.path === '/appdata') assert.ok(spec.applicationContext, 'Explicit application context is required');
  return true;
}

export async function request(origin, spec, token, { fetchImplementation = fetch } = {}) {
  validateRequestPath(spec);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const metadata = { status: null, bytes: 0, error: null };
  try {
    const response = await fetchImplementation(`${origin}${spec.path}`, {
      method: spec.method, redirect: 'manual', signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json',
        ...(spec.applicationContext ? {
          srfsystemid: spec.applicationContext.system, srforgid: spec.applicationContext.organization,
        } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(spec.data === undefined ? {} : { body: JSON.stringify(spec.data) }),
    });
    metadata.status = response.status;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return { ...metadata, error: 'redirect-refused' };
    }
    const reader = response.body?.getReader();
    const chunks = [];
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      metadata.bytes += value.length;
      if (metadata.bytes > 2 * 1024 * 1024) {
        controller.abort();
        return { ...metadata, error: 'response-too-large' };
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return { ...metadata, data: null };
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
      return { ...metadata, error: 'non-json-response' };
    }
    return { ...metadata, data: JSON.parse(text) };
  } catch {
    return { ...metadata, error: controller.signal.aborted ? 'timeout' : 'transport-or-json-error' };
  } finally { clearTimeout(timer); }
}

function tokenOf(response) {
  assert.equal(response.status, 200, 'Native login must succeed');
  assert.equal(response.error, null);
  const token = response.data?.token ?? response.data?.access_token;
  assert.ok(typeof token === 'string' && token.trim() && !/[\u0000\r\n]/.test(token));
  return token;
}

export function requiresFreshBackendLogin(token, now = Date.now()) {
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.ok(Number.isSafeInteger(claims.exp) && claims.exp > 0, 'Actual backend token needs an expiry claim');
  return claims.exp * 1000 - now <= 5000;
}

function inspectTarget(manifest, resources, deployment, imageReceipt) {
  const ids = [resources.mysqlId, ...Object.values(deployment.services).map(row => row.containerId),
    ...(deployment.auxiliaryContainers ?? []).map(row => row.containerId)];
  for (const id of ids) assert.match(id, idPattern);
  assert.match(resources.networkId, idPattern);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  const network = JSON.parse(docker(['network', 'inspect', resources.networkId]))[0];
  return validateDeployment(manifest, resources, deployment, containers, network, imageReceipt,
    inspectMysqlFixtureVolumes(resources));
}

function rootSQL(resources, sql) {
  return docker(['exec', '-i', resources.mysqlId, 'sh', '-c',
    'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names',
  ], sql).trim();
}

function snapshotBuilder(manifest, resources) {
  const statements = manifest.roots.flatMap(root => ['t_srfpsmodule', 't_srfpssystem'].map(table => {
    const columns = rootSQL(resources, `SHOW COLUMNS FROM \`${root.database}\`.\`${table}\`;`)
      .split('\n').map(line => line.split('\t')[0]);
    assert.ok(columns.length > 0 && columns.every(column => /^[a-z][a-z0-9_]*$/i.test(column)));
    const fields = columns.map(column => `'${column}',\`${column}\``).join(',');
    const key = table === 't_srfpsmodule' ? 'PSMODULEID' : 'PSSYSTEMID';
    return `SELECT JSON_OBJECT('database','${root.database}','table','${table}',`
      + `'row',JSON_OBJECT(${fields})) FROM \`${root.database}\`.\`${table}\` ORDER BY \`${key}\`;`;
  }));
  return () => {
    const text = rootSQL(resources, statements.join('\n') + '\n');
    return text ? text.split('\n').map(row => JSON.parse(row)) : [];
  };
}

export function verifyMutation(before, after, root, operation, probe) {
  assert.ok(['CREATE', 'UPDATE', 'REMOVE'].includes(operation));
  const matches = item => item.database === root.database && item.table === 't_srfpsmodule'
    && item.row.PSMODULEID === probe.psmoduleid;
  const compareRows = rows => rows.map(item => {
    if (item.database === root.database && item.table === 't_srfpssystem') {
      const copy = structuredClone(item);
      delete copy.row.MODELVER;
      return copy;
    }
    return item;
  });
  assert.deepEqual(compareRows(after.filter(row => !matches(row))),
    compareRows(before.filter(row => !matches(row))),
    'Only the selected case-owned module may change; the foreign schema and system rows must remain equal');
  const systemBefore = before.find(row => row.database === root.database && row.table === 't_srfpssystem');
  const systemAfter = after.find(row => row.database === root.database && row.table === 't_srfpssystem');
  assert.ok(Number.isSafeInteger(systemBefore?.row.MODELVER) && Number.isSafeInteger(systemAfter?.row.MODELVER));
  assert.equal(systemAfter.row.MODELVER, systemBefore.row.MODELVER + 1,
    'Exactly one model version increment is required per native mutation');
  const previous = before.filter(matches);
  const current = after.filter(matches);
  if (operation === 'REMOVE') {
    assert.equal(previous.length, 1);
    assert.equal(current.length, 0);
  } else {
    assert.equal(previous.length, operation === 'CREATE' ? 0 : 1);
    assert.equal(current.length, 1);
    assert.equal(current[0].row.PSSYSTEMID, root.logicalSystemId);
    assert.equal(current[0].row.PSMODULENAME, probe.psmodulename);
    assert.equal(current[0].row.MODTAG, probe.modtag);
  }
}

export function bindCreatedModule(response, probe, root, before) {
  const data = response.data;
  const createdId = data?.psmoduleid;
  assert.match(createdId ?? '', /^[a-f0-9]{1,32}$/);
  for (const field of ['codename', 'psmodulename', 'modtag']) assert.equal(data[field], probe[field]);
  assert.equal(data.pssystemid, root.logicalSystemId);
  assert.ok(!before.some(item => item.database === root.database && item.table === 't_srfpsmodule'
    && item.row.PSMODULEID === createdId), 'Server cannot adopt an existing record as the new probe');
  probe.psmoduleid = createdId;
  return createdId;
}

export function verifyOwnedMysqlRestart(before, after, stateBefore, stateAfter, snapshotBefore, snapshotAfter) {
  assert.equal(after.Id, before.Id, 'This contract is same-container restart, not recreation');
  assert.equal(after.Image, before.Image);
  assert.equal(after.Name, before.Name);
  assert.deepEqual(after.Config, before.Config);
  assert.deepEqual(after.HostConfig, before.HostConfig);
  const mounts = value => [...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(mounts(after.Mounts), mounts(before.Mounts));
  assert.equal(after.State.Running, true);
  assert.notEqual(after.State.StartedAt, before.State.StartedAt);
  assert.match(stateBefore.serverUuid, /^[a-f0-9-]{36}$/);
  assert.equal(stateBefore.datadir, '/bitnami/mysql/data/');
  assert.equal(stateBefore.innodbFlushLogAtTrxCommit, 1);
  assert.deepEqual(stateAfter, stateBefore, 'The original database identity and durability settings must survive');
  assert.deepEqual(snapshotAfter, snapshotBefore, 'Every physical module/system field must survive the database restart');
}

export async function executeOwnedMatrix({ runId, deploymentInput, label = randomBytes(6).toString('hex'),
  allowOwnedProbeMutations = false, restartOwnedProvider = false, restartOwnedMysql = false,
  recreateOwnedMysql: allowMysqlRecreation = false, restoreOwnedMysqlBackup = false, workspace = workspaceRoot }) {
  assert.equal(typeof restartOwnedProvider, 'boolean');
  assert.ok(!restartOwnedProvider || allowOwnedProbeMutations, 'Provider restart requires an active owned CRUD probe');
  assert.equal(typeof restartOwnedMysql, 'boolean');
  assert.ok(!restartOwnedMysql || allowOwnedProbeMutations, 'Database restart requires an active owned CRUD probe');
  assert.equal(typeof allowMysqlRecreation, 'boolean');
  assert.ok(!allowMysqlRecreation || allowOwnedProbeMutations, 'Database recreation requires an active owned CRUD probe');
  assert.ok(!(allowMysqlRecreation && restartOwnedMysql), 'Select restart or recreation, never ambiguous combined MySQL modes');
  assert.equal(typeof restoreOwnedMysqlBackup, 'boolean');
  assert.ok(!restoreOwnedMysqlBackup || allowOwnedProbeMutations, 'Backup recovery requires an active owned CRUD probe');
  assert.ok(!restoreOwnedMysqlBackup || (!allowMysqlRecreation && !restartOwnedMysql),
    'Select exactly one MySQL lifecycle verification mode');
  const base = runDirectory(workspace, runId);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,63}$/);
  const manifestInput = readJSON(join(base, 'manifest.json'));
  const sqlInput = readJSON(join(base, 'isolated-sql-report.json'));
  const resourcesInput = readJSON(join(base, 'owned-resources.json'));
  const credentials = readJSON(join(base, 'credentials.private.json'), { privateInput: true }).value;
  const deploymentFile = readJSON(resolve(deploymentInput));
  const manifest = manifestInput.value;
  validateFixtureReceipt(manifest, sqlInput.value, manifestInput.binding.sha256);
  assert.equal(sqlInput.value.inputs.modelSchemaSources?.length, 3, 'Explicit model-schema source bindings required');
  for (const source of sqlInput.value.inputs.modelSchemaSources) {
    assert.ok(['DEFAULT', 'DB2', 'DB3'].includes(source.link));
    assert.equal(source.path,
      `vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSDBSCHEMES/${source.link}.json`);
    assert.equal(digest(readFileSync(join(workspace, source.path))), source.sha256,
      'Fixture model-schema source changed after SQL evidence');
  }
  assert.equal(manifest.runId, runId);
  for (const row of sqlInput.value.inputs.fixtureTools) {
    assert.match(row.path, /^scripts\/(?:tests\/)?[a-z0-9.-]+\.mjs$/);
    assert.equal(digest(readFileSync(join(workspace, row.path))), row.sha256,
      'Fixture source/test changed since retained SQL evidence');
  }
  const resources = resourcesInput.value;
  if (restartOwnedMysql || allowMysqlRecreation || restoreOwnedMysqlBackup) assert.equal(resources.databaseProfile?.name, OWNED_VOLUME_PROFILE,
    'Database restart requires the explicit owned disk-volume profile, never a tmpfs fixture');
  assert.equal(resources.mysqlId, sqlInput.value.ownedMysqlId);
  assert.equal(resources.networkId, sqlInput.value.ownedNetworkId);
  // Older resource journals call the pinned MySQL image `mysqlImage`.
  resources.mysqlImage ??= sqlInput.value.mysqlImage;
  if (allowMysqlRecreation || restoreOwnedMysqlBackup) {
    assert.equal(resourcesInput.binding.sha256, sqlInput.value.outputs['owned-resources.json'].sha256);
    assert.deepEqual(resources.databaseStorage, sqlInput.value.databaseStorage);
  }
  const deployment = deploymentFile.value;
  const imageInput = readJSON(resolve(deployment.imageReceipt.path));
  assert.equal(imageInput.binding.sha256, deployment.imageReceipt.sha256);
  const packageInput = readJSON(imageInput.value.packageReceipt.path);
  assert.equal(packageInput.binding.sha256, imageInput.value.packageReceipt.sha256);
  assert.equal(packageInput.value.status, 'passed-package-and-unit-only');
  const endpoints = inspectTarget(manifest, resources, deployment, imageInput.value);
  const snapshot = snapshotBuilder(manifest, resources);
  const matrix = createNativeMatrix(manifest);
  const output = join(base, `native-http-${label}`);
  mkdirSync(output, { mode: 0o700 });
  const report = {
    contract: 'run-owned-native-permission-http-v1', runId, scenario: manifest.scenario,
    status: 'running-native-matrix', startedAt: new Date().toISOString(),
    nativeAcceptance: false, permissionAcceptance: false, sourceNativeAcceptance: false,
    actualUAALoginVerified: false, actualBackendHTTPVerified: false, boundedRoleRootAcceptance: false,
    inputs: [manifestInput.binding, sqlInput.binding, resourcesInput.binding,
      deploymentFile.binding, imageInput.binding, packageInput.binding],
    generator: { path: toolPath, sha256: digest(readFileSync(join(workspace, toolPath))) },
    sourceFingerprint: imageInput.value.packageReceipt.sourceFingerprint,
    endpoints, services: deployment.services, checks: [], unresolved: [], cleanup: [],
    allowOwnedProbeMutations,
    restartOwnedProvider, providerRestarts: [], providerRestartReadbackVerified: false,
    restartOwnedMysql, mysqlRestarts: [], ownedMysqlVolumeRestartVerified: false,
    recreateOwnedMysql: allowMysqlRecreation, mysqlRecreations: [], ownedMysqlContainerRecreationVerified: false,
    restoreOwnedMysqlBackup, mysqlBackupRestores: [], ownedMysqlBackupRestoreVerified: false,
    boundary: 'Real HTTP observations only for this owned deployment/scenario; not global source closure, browser or release acceptance',
    uaaSourceBoundary: 'UAA source provenance is not certified by this runner; do not promote a legacy or reconstructed UAA to exact-source',
    durableRestartAcceptance: false,
  };
  let serial = 0;
  let baseline;
  const observe = async (id, operation, verify) => {
    const result = { id, status: 'failed', httpStatus: null, error: null, stage: 'owned-preflight' };
    report.checks.push(result);
    inspectTarget(manifest, resources, deployment, imageInput.value);
    result.stage = 'before-snapshot';
    const before = snapshot();
    result.stage = 'http-request';
    const response = await operation();
    result.httpStatus = response.status;
    result.error = response.error;
    result.stage = 'after-snapshot';
    const after = snapshot();
    const path = `${String(++serial).padStart(3, '0')}-snapshots.private.json`;
    const bytes = json({ before, after });
    privateWrite(join(output, path), bytes);
    result.snapshot = { path, sha256: digest(bytes) };
    result.stage = 'verify';
    // Do not put response bodies, tokens, passwords or assertion actual/expected values in reports.
    verify(response, before, after);
    result.status = 'passed';
    result.stage = 'complete';
    return response;
  };
  const applicationContexts = new Map();
  const modelVersionDeltas = {};
  const tokenContexts = new Map();
  const tokenUsers = new Map();
  const backendRequest = async (spec, token) => {
    assert.ok(tokenContexts.has(token), 'Model request requires a verified appdata bootstrap');
    if (requiresFreshBackendLogin(token)) token = await backendLogin(tokenUsers.get(token));
    return request(endpoints.backend, { ...spec, applicationContext: tokenContexts.get(token) }, token);
  };
  let previousRecreation = null;
  let previousBackupRestore = null;
  const restoreMysqlBackup = async root => {
    inspectTarget(manifest, resources, deployment, imageInput.value);
    const sequence = report.mysqlBackupRestores.length + 1;
    const journalRoot = join(output, 'mysql-backup-restores');
    if (sequence === 1) mkdirSync(journalRoot, { mode: 0o700 });
    const directory = join(journalRoot, `step-${String(sequence).padStart(4, '0')}`);
    mkdirSync(directory, { mode: 0o700 });
    const write = (name, value) => {
      const bytes = json(value);
      privateWrite(join(directory, name), bytes);
      return { path: relative(workspace, join(directory, name)), bytes: Buffer.byteLength(bytes), sha256: digest(bytes) };
    };
    const snapshotBefore = snapshot();
    const diskBefore = inspectOwnedMysqlDiskBacking(resources.databaseStorage);
    const event = { rootId: root.rootId, previousMysqlId: resources.mysqlId, sourceVolume: resources.databaseStorage,
      journal: relative(workspace, directory), status: 'failed' };
    report.mysqlBackupRestores.push(event);
    const peerIds = [...Object.values(deployment.services), ...deployment.auxiliaryContainers].map(row => row.containerId);
    const peers = () => JSON.parse(docker(['inspect', ...peerIds])).map(row => ({
      id: row.Id, image: row.Image, name: row.Name, config: row.Config, hostConfig: row.HostConfig,
      mounts: [...row.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination)),
      startedAt: row.State.StartedAt, restartCount: row.RestartCount, networks: row.NetworkSettings.Networks,
    }));
    const peersBefore = peers();
    const transition = restoreOwnedMysqlColdBackup({
      workspace, directory, manifest, resources, sequence, previous: previousBackupRestore,
      context: { manifestSha256: manifestInput.binding.sha256, sqlSha256: sqlInput.binding.sha256,
        resourcesSha256: resourcesInput.binding.sha256, deploymentSha256: deploymentFile.binding.sha256 },
      guard: () => inspectTarget(manifest, resources, deployment, imageInput.value),
      write, onCurrent: next => { Object.assign(resources, next); },
    });
    previousBackupRestore = transition.created;
    const deadline = Date.now() + 180000;
    for (;;) {
      let ready = false;
      try {
        ready = mysqlFixtureReadyProcess(docker(['exec', resources.mysqlId, 'cat', '/proc/1/comm']))
          && rootSQL(resources, 'SELECT 1;') === '1';
      } catch { /* Only the restored final server can satisfy readiness. */ }
      if (ready) break;
      assert.ok(Date.now() < deadline, 'Restored owned MySQL failed to become ready');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    inspectTarget(manifest, resources, deployment, imageInput.value);
    const stateAfter = ownedMysqlColdState(resources);
    const diskAfter = inspectOwnedMysqlDiskBacking(resources.databaseStorage);
    const snapshotAfter = snapshot();
    assert.deepEqual(stateAfter, transition.stateBefore);
    assert.deepEqual(diskAfter, diskBefore);
    assert.deepEqual(snapshotAfter, snapshotBefore);
    assert.deepEqual(peers(), peersBefore, 'Restoring MySQL must not restart or reconfigure other service peers');
    const evidence = write('readback.private.json', { stateBefore: transition.stateBefore, stateAfter,
      diskBefore, diskAfter, before: snapshotBefore, after: snapshotAfter });
    const verified = write('verified.json', { contract: 'owned-mysql-cold-restore-verified-v1',
      created: transition.created, mysqlId: resources.mysqlId, everyPhysicalFileEqual: true,
      completePhysicalRowsUnchanged: true, evidence,
      witness: mysqlRecreationWitness(JSON.parse(docker(['inspect', resources.mysqlId]))[0]) });
    Object.assign(event, { status: 'passed-owned-mysql-cold-backup-restore', currentMysqlId: resources.mysqlId,
      targetVolume: resources.databaseStorage, created: transition.created, verified, evidence,
      archive: transition.backup, physicalFiles: transition.files, expandedBytes: transition.expandedBytes });
  };
  const recreateMysql = async root => {
    inspectTarget(manifest, resources, deployment, imageInput.value);
    const sequence = report.mysqlRecreations.length + 1;
    const journalRoot = join(output, 'mysql-recreations');
    if (sequence === 1) mkdirSync(journalRoot, { mode: 0o700 });
    const directory = join(journalRoot, `step-${String(sequence).padStart(4, '0')}`);
    mkdirSync(directory, { mode: 0o700 });
    const write = (name, value) => {
      const bytes = json(value);
      privateWrite(join(directory, name), bytes);
      return { path: relative(workspace, join(directory, name)), bytes: Buffer.byteLength(bytes), sha256: digest(bytes) };
    };
    const state = () => JSON.parse(rootSQL(resources, [
      "SELECT JSON_OBJECT('serverUuid',@@server_uuid,'datadir',@@datadir,",
      "'innodbFlushLogAtTrxCommit',@@innodb_flush_log_at_trx_commit,'syncBinlog',@@sync_binlog);",
    ].join('')));
    const stateBefore = state();
    assert.match(stateBefore.serverUuid, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    assert.equal(stateBefore.datadir, '/bitnami/mysql/data/');
    assert.equal(stateBefore.innodbFlushLogAtTrxCommit, 1);
    const diskBefore = inspectOwnedMysqlDiskBacking(resources.databaseStorage);
    const snapshotBefore = snapshot();
    const peerIds = [...Object.values(deployment.services), ...(deployment.auxiliaryContainers ?? [])]
      .map(row => row.containerId);
    const peerWitness = () => JSON.parse(docker(['inspect', ...peerIds])).map(row => ({
      id: row.Id, image: row.Image, name: row.Name, config: row.Config, hostConfig: row.HostConfig,
      mounts: [...row.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination)),
      startedAt: row.State.StartedAt, restartCount: row.RestartCount, networks: row.NetworkSettings.Networks,
    }));
    const peersBefore = peerWitness();
    const witness = { rootId: root.rootId, previousMysqlId: resources.mysqlId, status: 'failed',
      journal: relative(workspace, directory) };
    report.mysqlRecreations.push(witness);
    const transition = recreateOwnedMysql({
      manifest, resources, sequence, previous: previousRecreation,
      context: { manifestSha256: manifestInput.binding.sha256, sqlSha256: sqlInput.binding.sha256,
        resourcesSha256: resourcesInput.binding.sha256, deploymentSha256: deploymentFile.binding.sha256 },
      guard: () => inspectTarget(manifest, resources, deployment, imageInput.value),
      write, onCurrent: next => { Object.assign(resources, next); },
    });
    witness.currentMysqlId = resources.mysqlId;
    witness.created = transition.created;
    previousRecreation = transition.created;
    const deadline = Date.now() + 180000;
    for (;;) {
      let ready = false;
      try {
        ready = mysqlFixtureReadyProcess(docker(['exec', resources.mysqlId, 'cat', '/proc/1/comm']))
          && rootSQL(resources, 'SELECT 1;') === '1';
      } catch { /* Readiness requires the final server, not its initialization child. */ }
      if (ready) break;
      assert.ok(Date.now() < deadline, 'Recreated owned MySQL did not become ready');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    inspectTarget(manifest, resources, deployment, imageInput.value);
    const stateAfter = state();
    const diskAfter = inspectOwnedMysqlDiskBacking(resources.databaseStorage);
    const snapshotAfter = snapshot();
    assert.deepEqual(stateAfter, stateBefore, 'Original database UUID and durability settings must survive recreation');
    assert.deepEqual(diskAfter, diskBefore);
    assert.deepEqual(snapshotAfter, snapshotBefore, 'Every physical module/system field must survive recreation');
    assert.deepEqual(peerWitness(), peersBefore, 'Recreation must not change other owned service lifecycles or configuration');
    const evidence = write('readback.private.json', { stateBefore, stateAfter, diskBefore, diskAfter,
      before: snapshotBefore, after: snapshotAfter });
    const verified = write('verified.json', { contract: 'owned-mysql-recreation-verified-v1',
      created: transition.created, mysqlId: resources.mysqlId, completePhysicalRowsUnchanged: true, evidence,
      witness: mysqlRecreationWitness(JSON.parse(docker(['inspect', resources.mysqlId]))[0]) });
    Object.assign(witness, { status: 'passed-owned-mysql-container-recreation', verified, evidence, diskBacking: diskAfter });
  };
  const restartMysql = async root => {
    inspectTarget(manifest, resources, deployment, imageInput.value);
    const before = JSON.parse(docker(['inspect', resources.mysqlId]))[0];
    const databaseState = () => JSON.parse(rootSQL(resources, [
      "SELECT JSON_OBJECT('serverUuid',@@server_uuid,'datadir',@@datadir,",
      "'innodbFlushLogAtTrxCommit',@@innodb_flush_log_at_trx_commit,'syncBinlog',@@sync_binlog);",
    ].join('')));
    const stateBefore = databaseState();
    const diskBefore = inspectOwnedMysqlDiskBacking(resources.databaseStorage);
    const snapshotBefore = snapshot();
    const witness = { rootId: root.rootId, containerId: before.Id, imageId: before.Image,
      volume: resources.databaseStorage, beforeStartedAt: before.State.StartedAt, status: 'failed' };
    report.mysqlRestarts.push(witness);
    docker(['restart', '--time', '60', resources.mysqlId]);
    const deadline = Date.now() + 180000;
    for (;;) {
      let ready = false;
      try {
        ready = mysqlFixtureReadyProcess(docker(['exec', resources.mysqlId, 'cat', '/proc/1/comm']))
          && rootSQL(resources, 'SELECT 1;') === '1';
      } catch { /* The entrypoint may not have handed PID 1 to mysqld yet. */ }
      if (ready) break;
      assert.ok(Date.now() < deadline, 'Owned disk-backed MySQL failed to become ready after restart');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    inspectTarget(manifest, resources, deployment, imageInput.value);
    const after = JSON.parse(docker(['inspect', resources.mysqlId]))[0];
    const stateAfter = databaseState();
    const diskAfter = inspectOwnedMysqlDiskBacking(resources.databaseStorage);
    assert.deepEqual(diskAfter, diskBefore, 'Owned volume must remain on the same actual local disk filesystem');
    const snapshotAfter = snapshot();
    verifyOwnedMysqlRestart(before, after, stateBefore, stateAfter, snapshotBefore, snapshotAfter);
    const bytes = json({ before: snapshotBefore, after: snapshotAfter, stateBefore, stateAfter, diskBefore, diskAfter });
    const path = `mysql-restart-${root.side}.private.json`;
    privateWrite(join(output, path), bytes);
    Object.assign(witness, { afterStartedAt: after.State.StartedAt,
      diskBacking: diskAfter,
      snapshot: { path, sha256: digest(bytes) }, status: 'passed-owned-volume-mysql-restart' });
  };
  const restartProvider = async () => {
    inspectTarget(manifest, resources, deployment, imageInput.value);
    const peer = deployment.services.provider;
    const before = JSON.parse(docker(['inspect', peer.containerId]))[0];
    assert.equal(before.Image, peer.imageId);
    assert.equal(before.Config.Labels?.[manifest.ownership.label], runId);
    const witness = { containerId: peer.containerId, imageId: peer.imageId,
      beforeStartedAt: before.State.StartedAt, beforeRestartCount: before.RestartCount, status: 'failed' };
    report.providerRestarts.push(witness);
    docker(['restart', peer.containerId]);
    const deadline = Date.now() + 180000;
    for (;;) {
      const current = JSON.parse(docker(['inspect', peer.containerId]))[0];
      assert.equal(current.Id, before.Id);
      assert.equal(current.Image, before.Image);
      assert.deepEqual(current.Config, before.Config);
      const mounts = value => [...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      assert.deepEqual(mounts(current.Mounts), mounts(before.Mounts));
      assert.equal(current.State.Running, true);
      assert.notEqual(current.State.StartedAt, before.State.StartedAt);
      const log = docker(['logs', '--since', current.State.StartedAt, '--tail', '20000', peer.containerId]);
      assert.doesNotMatch(log, /Application run failed|APPLICATION FAILED TO START|Error starting ApplicationContext/);
      if (log.includes('/ibizmodeling/modelapi/psdevslnsys/{pkey}/psmodules/fetchcursys')) {
        witness.afterStartedAt = current.State.StartedAt;
        witness.afterRestartCount = current.RestartCount;
        witness.readyLogSha256 = digest(log);
        witness.status = 'passed-owned-provider-route-ready';
        inspectTarget(manifest, resources, deployment, imageInput.value);
        return;
      }
      assert.ok(Date.now() < deadline, 'Owned provider did not restore its canonical mapping after restart');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  };
  const backendLogin = async user => {
    const response = await observe(`${user.loginname}-backend-fresh-login`, () => request(endpoints.backend,
      { method: 'POST', path: '/v7/login', data: { loginname: user.loginname, password: credentials.users[user.loginname] } }),
    (response, before, after) => { tokenOf(response); assert.deepEqual(after, before); });
    const token = tokenOf(response);
    await observe(`${user.loginname}-backend-token-self`, () => request(endpoints.backend,
      { method: 'GET', path: '/uaa/oauth/userinfo' }, token), (response, before, after) => {
      assert.equal(response.status, 200);
      assert.equal(response.error, null);
      assert.equal(response.data?.sub, user.loginname);
      assert.deepEqual(after, before);
    });
    const applicationContext = applicationContexts.get(user.loginname);
    assert.ok(applicationContext, 'Verified UAA context is required before appdata bootstrap');
    await observe(`${user.loginname}-backend-appdata`, () => request(endpoints.backend,
      { method: 'GET', path: '/appdata', applicationContext }, token), (response, before, after) => {
      verifyModelingAppData(response, user, applicationContext);
      assert.deepEqual(after, before);
    });
    tokenContexts.set(token, applicationContext);
    tokenUsers.set(token, user);
    return token;
  };
  try {
    baseline = snapshot();
    privateWrite(join(output, 'baseline.private.json'), json(baseline));
    report.checks.push({ id: 'original-physical-baseline', status: 'failed' });
    verifyBaseline(manifest, baseline);
    report.checks.at(-1).status = 'passed';
    const tokens = new Map();
    for (const user of manifest.users) {
      const login = await observe(`${user.loginname}-uaa-login`, () => request(endpoints.uaa,
        { method: 'POST', path: '/auths/login', data: {
          loginname: user.loginname, password: credentials.users[user.loginname], dc: user.centerId,
        } }), (response, before, after) => {
        tokenOf(response);
        verifyUAAIdentity(response.data.user, user);
        assert.deepEqual(after, before);
      });
      applicationContexts.set(user.loginname, modelingContextFromIdentity(login.data.user, user));
      await observe(`${user.loginname}-uaa-self`, () => request(endpoints.uaa,
        { method: 'GET', path: '/auths/user-info/self' }, tokenOf(login)), (response, before, after) => {
        assert.equal(response.status, 200);
        assert.equal(response.error, null);
        verifyUAAIdentity(response.data, user);
        assert.deepEqual(after, before);
      });
      for (const kind of ['wrong-password', 'wrong-dc']) {
        await observe(`${user.loginname}-uaa-${kind}`, () => request(endpoints.uaa,
          { method: 'POST', path: '/auths/login', data: { loginname: user.loginname,
            password: kind === 'wrong-password' ? randomBytes(18).toString('hex') : credentials.users[user.loginname],
            dc: kind === 'wrong-dc' ? manifest.roots.find(root => root.centerId !== user.centerId)?.centerId
              ?? `nf_${runId}_unknown_center` : user.centerId,
          } }), (response, before, after) => {
          assert.ok([400, 401, 403].includes(response.status), 'Authentication rejection must not be a server/route error');
          assert.equal(response.error, null);
          assert.ok(!response.data?.token && !response.data?.access_token);
          assert.deepEqual(after, before);
        });
      }
      tokens.set(user.loginname, await backendLogin(user));
    }
    report.actualUAALoginVerified = true;
    report.actualBackendHTTPVerified = true;
    for (const row of matrix.roleRootCases.filter(row => ['GET', 'FETCH_CUR_SYS'].includes(row.operation)
      || (row.expected.authorization === 'deny' && allowOwnedProbeMutations))) {
      const root = manifest.roots.find(root => root.rootId === row.target.rootId);
      const data = { psmoduleid: row.operation === 'UPDATE' ? row.requestRecordId : row.createRecordId,
        pssystemid: root.logicalSystemId,
        psmodulename: `Denied probe ${label}`, modtag: `nf_${runId}_denied` };
      await observe(row.id, () => backendRequest(
        moduleRequest(root, row.operation, row.requestRecordId, data), tokens.get(row.principal.loginname)),
      (response, before, after) => {
        if (row.expected.authorization === 'deny') verifyDenied(response, before, after, manifest.roots);
        else { verifyRead(response, root, row.operation); assert.deepEqual(after, before); }
      });
    }
    for (const row of matrix.forgedSystemCases) {
      const user = manifest.users.find(user => user.loginname === row.principal.loginname);
      const root = manifest.roots.find(root => root.rootId === user.rootId);
      await observe(row.id, () => backendRequest(moduleRequest(root, 'FETCH_CUR_SYS', null,
        { pssystemid: row.submittedSystemId }), tokens.get(user.loginname)), (response, before, after) => {
        verifyRead(response, root, 'FETCH_CUR_SYS');
        assert.deepEqual(after, before);
      });
    }
    if (allowOwnedProbeMutations) {
      for (const root of manifest.roots) {
        const editor = manifest.users.find(user => user.rootId === root.rootId && user.role === 'editor');
        const probe = createModuleProbe(runId, root, label);
        const cleanup = { rootId: root.rootId, recordId: probe.psmoduleid, status: 'not-needed' };
        report.cleanup.push(cleanup);
        try {
          cleanup.status = 'required';
          for (const operation of ['CREATE', 'UPDATE']) {
            if (operation === 'UPDATE') probe.modtag = `nf_${runId}_${root.side}_updated`;
            await observe(`${root.side}-editor-${operation}`, () => backendRequest(
              moduleRequest(root, operation, probe.psmoduleid, probe), tokens.get(editor.loginname)),
            (response, before, after) => {
              assert.ok([200, 201].includes(response.status));
              assert.equal(response.error, null);
              if (operation === 'CREATE') {
                cleanup.recordId = bindCreatedModule(response, probe, root, before);
              }
              verifyMutation(before, after, root, operation, probe);
              modelVersionDeltas[root.database] = (modelVersionDeltas[root.database] ?? 0) + 1;
            });
          }
          if (restartOwnedMysql) await restartMysql(root);
          if (allowMysqlRecreation) await recreateMysql(root);
          if (restoreOwnedMysqlBackup) await restoreMysqlBackup(root);
          if (restartOwnedProvider) await restartProvider();
          for (const user of manifest.users) {
            const token = await backendLogin(user);
            await observe(`${user.loginname}-${root.side}-persisted-probe-fresh-login`, () => backendRequest(
              moduleRequest(root, 'GET', probe.psmoduleid), token), (response, before, after) => {
              if (user.rootId !== root.rootId || user.role === 'no-access') verifyDenied(response, before, after, manifest.roots);
              else {
                const persisted = verifyRead(response, root, 'GET', probe.psmoduleid);
                assert.equal(persisted.modtag, probe.modtag);
                assert.deepEqual(after, before);
              }
            });
          }
          const freshEditorToken = await backendLogin(editor);
          await observe(`${root.side}-editor-REMOVE`, () => backendRequest(
            moduleRequest(root, 'REMOVE', probe.psmoduleid), freshEditorToken), (response, before, after) => {
            assert.ok([200, 204].includes(response.status));
            assert.equal(response.error, null);
            verifyMutation(before, after, root, 'REMOVE', probe);
            modelVersionDeltas[root.database] = (modelVersionDeltas[root.database] ?? 0) + 1;
          });
          cleanup.status = 'removed-via-native-editor';
          await observe(`${root.side}-probe-absent-after-native-remove`, () => backendRequest(
            moduleRequest(root, 'FETCH_CUR_SYS'), freshEditorToken), (response, before, after) => {
            verifyRead(response, root, 'FETCH_CUR_SYS');
            assert.ok(!response.data.some(row => row.psmoduleid === probe.psmoduleid));
            assert.deepEqual(after, before);
          });
        } finally {
          if (cleanup.status === 'required') {
            // Cleanup remains native and case-specific. Never replace a permission failure with root SQL writes.
            try {
              inspectTarget(manifest, resources, deployment, imageInput.value);
              const cleanupToken = await backendLogin(editor);
              const response = await backendRequest(
                moduleRequest(root, 'REMOVE', probe.psmoduleid), cleanupToken);
              cleanup.httpStatus = response.status;
              cleanup.status = snapshot().some(item => item.database === root.database
                && item.table === 't_srfpsmodule' && item.row.PSMODULEID === probe.psmoduleid)
                ? 'blocked-owned-probe-remains' : 'removed-or-never-created';
            } catch {
              cleanup.status = 'blocked-cleanup-preflight-or-snapshot';
            }
          }
        }
      }
    } else report.unresolved.push('CREATE/UPDATE/REMOVE and fresh-login persistence not executed; enable explicit owned-probe mutation option');
    report.unresolved.push(
      'Invalid/null/number root AppContext variants need a proven HTTP binding; no header transport is invented',
      'Session/holder frames, zero/negative/expired grants and canonical remap/rotation remain separate acceptance items',
      'The other center topology requires its own complete isolated deployment and receipt',
      'UAA editable-source/build provenance is not established by this fixture runner',
    );
    report.status = 'passed-bounded-native-observations';
    report.boundedRoleRootAcceptance = allowOwnedProbeMutations;
    report.providerRestartReadbackVerified = restartOwnedProvider
      && report.providerRestarts.length === manifest.roots.length
      && report.providerRestarts.every(row => row.status === 'passed-owned-provider-route-ready');
    report.ownedMysqlVolumeRestartVerified = restartOwnedMysql
      && report.mysqlRestarts.length === manifest.roots.length
      && report.mysqlRestarts.every(row => row.status === 'passed-owned-volume-mysql-restart');
    report.ownedMysqlContainerRecreationVerified = allowMysqlRecreation
      && report.mysqlRecreations.length === manifest.roots.length
      && report.mysqlRecreations.every(row => row.status === 'passed-owned-mysql-container-recreation');
    report.ownedMysqlBackupRestoreVerified = restoreOwnedMysqlBackup
      && report.mysqlBackupRestores.length === manifest.roots.length
      && report.mysqlBackupRestores.every(row => row.status === 'passed-owned-mysql-cold-backup-restore');
    // nativeAcceptance is deliberately false: this bounded matrix does not cover all mandatory N01/N02 dimensions.
  } catch {
    report.status = 'failed-native-matrix';
    report.unresolved.push('Execution stopped at the first failed check; inspect its ID/status and owner-private service logs');
  }
  report.completedAt = new Date().toISOString();
  try {
    inspectTarget(manifest, resources, deployment, imageInput.value);
    const final = snapshot();
    privateWrite(join(output, 'final.private.json'), json(final));
    report.checks.push({ id: 'original-physical-baseline-restored', status: 'failed' });
    assert.ok(baseline, 'A verified initial snapshot is required');
    report.modelVersionDeltas = modelVersionDeltas;
    verifyRestoration(baseline, final, { modelVersionDeltas });
    report.checks.at(-1).status = 'passed';
  } catch {
    report.status = 'failed-native-matrix';
    report.boundedRoleRootAcceptance = false;
    report.providerRestartReadbackVerified = false;
    report.ownedMysqlVolumeRestartVerified = false;
    report.ownedMysqlContainerRecreationVerified = false;
    report.ownedMysqlBackupRestoreVerified = false;
    report.unresolved.push('Final owned preflight, snapshot or full-column baseline restoration failed; no acceptance');
  }
  const reportPath = join(output, 'report.json');
  report.activeMysqlId = resources.mysqlId;
  if (restoreOwnedMysqlBackup) report.activeDatabaseStorage = resources.databaseStorage;
  privateWrite(reportPath, json(report));
  return { report, reportPath };
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--execute-owned-native-matrix') { assert.ok(!options.execute); options.execute = true; continue; }
    if (arg === '--allow-owned-probe-mutations') { assert.ok(!options.mutations); options.mutations = true; continue; }
    if (arg === '--restart-owned-provider') { assert.ok(!options.restart); options.restart = true; continue; }
    if (arg === '--restart-owned-mysql') { assert.ok(!options.mysqlRestart); options.mysqlRestart = true; continue; }
    if (arg === '--recreate-owned-mysql') { assert.ok(!options.mysqlRecreation); options.mysqlRecreation = true; continue; }
    if (arg === '--restore-owned-mysql-backup') { assert.ok(!options.mysqlBackup); options.mysqlBackup = true; continue; }
    const match = /^--(run-id|deployment-input|label)=(.+)$/.exec(arg);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Explicit, non-duplicate options required');
    options[match[1]] = match[2];
  }
  assert.ok(options.execute && options['deployment-input'], 'Explicit execution and deployment input required; no defaults');
  const result = await executeOwnedMatrix({ runId: options['run-id'], deploymentInput: options['deployment-input'],
    label: options.label, allowOwnedProbeMutations: options.mutations ?? false,
    restartOwnedProvider: options.restart ?? false, restartOwnedMysql: options.mysqlRestart ?? false,
    recreateOwnedMysql: options.mysqlRecreation ?? false, restoreOwnedMysqlBackup: options.mysqlBackup ?? false });
  console.log(json({ reportPath: result.reportPath, status: result.report.status,
    checks: result.report.checks.length, nativeAcceptance: result.report.nativeAcceptance }));
  if (result.report.status === 'failed-native-matrix') process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error('Owned native matrix preflight failed; no public credential-bearing diagnostics.');
    process.exitCode = 1;
  });
}
