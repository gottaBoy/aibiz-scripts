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

export function validateDeployment(manifest, resources, deployment, containers, network, imageReceipt) {
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
    for (const mounts of container.Mounts ?? []) {
      assert.equal(mounts.Type, 'bind', 'Undeclared volumes are not allowed');
      assert.equal(mounts.RW, false, 'Application input binds must be read-only');
      validateInputBind(workspaceRoot, manifest.runId, mounts.Source);
    }
    for (const bindings of Object.values(container.HostConfig.PortBindings ?? {})) {
      for (const binding of bindings ?? []) assert.equal(binding.HostIp, '127.0.0.1');
    }
    if (peer.role === 'mysql') {
      assert.equal(container.Name, `/${manifest.ownership.mysqlContainer}`);
      assert.deepEqual(container.HostConfig.Tmpfs, { '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824' });
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

export function verifyRestoration(baseline, final) {
  assert.deepEqual(final, baseline, 'All original physical module/system columns must be restored');
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
  }[spec.path];
  if (authMethod) assert.equal(spec.method, authMethod);
  else {
    assert.ok(['GET', 'POST', 'PUT', 'DELETE'].includes(spec.method));
    assert.match(spec.path,
      /^\/api\/ibizmodeling__modeldesign\/psdevslnsys\/[A-Za-z0-9_-]+\/psmodules(?:\/[A-Za-z0-9_-]+)?$/);
  }
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

function inspectTarget(manifest, resources, deployment, imageReceipt) {
  const ids = [resources.mysqlId, ...Object.values(deployment.services).map(row => row.containerId),
    ...(deployment.auxiliaryContainers ?? []).map(row => row.containerId)];
  for (const id of ids) assert.match(id, idPattern);
  assert.match(resources.networkId, idPattern);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  const network = JSON.parse(docker(['network', 'inspect', resources.networkId]))[0];
  return validateDeployment(manifest, resources, deployment, containers, network, imageReceipt);
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
  const matches = item => item.database === root.database && item.table === 't_srfpsmodule'
    && item.row.PSMODULEID === probe.psmoduleid;
  assert.deepEqual(after.filter(row => !matches(row)), before.filter(row => !matches(row)),
    'Only the selected case-owned module may change; the foreign schema and system rows must remain equal');
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

export async function executeOwnedMatrix({ runId, deploymentInput, label = randomBytes(6).toString('hex'),
  allowOwnedProbeMutations = false, workspace = workspaceRoot }) {
  const base = runDirectory(workspace, runId);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,63}$/);
  const manifestInput = readJSON(join(base, 'manifest.json'));
  const sqlInput = readJSON(join(base, 'isolated-sql-report.json'));
  const resourcesInput = readJSON(join(base, 'owned-resources.json'));
  const credentials = readJSON(join(base, 'credentials.private.json'), { privateInput: true }).value;
  const deploymentFile = readJSON(resolve(deploymentInput));
  const manifest = manifestInput.value;
  validateFixtureReceipt(manifest, sqlInput.value, manifestInput.binding.sha256);
  assert.equal(manifest.runId, runId);
  for (const row of sqlInput.value.inputs.fixtureTools) {
    assert.match(row.path, /^scripts\/(?:tests\/)?[a-z0-9.-]+\.mjs$/);
    assert.equal(digest(readFileSync(join(workspace, row.path))), row.sha256,
      'Fixture source/test changed since retained SQL evidence');
  }
  const resources = resourcesInput.value;
  assert.equal(resources.mysqlId, sqlInput.value.ownedMysqlId);
  assert.equal(resources.networkId, sqlInput.value.ownedNetworkId);
  // Older resource journals call the pinned MySQL image `mysqlImage`.
  resources.mysqlImage ??= sqlInput.value.mysqlImage;
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
      await observe(row.id, () => request(endpoints.backend,
        moduleRequest(root, row.operation, row.requestRecordId, data), tokens.get(row.principal.loginname)),
      (response, before, after) => {
        if (row.expected.authorization === 'deny') verifyDenied(response, before, after, manifest.roots);
        else { verifyRead(response, root, row.operation); assert.deepEqual(after, before); }
      });
    }
    for (const row of matrix.forgedSystemCases) {
      const user = manifest.users.find(user => user.loginname === row.principal.loginname);
      const root = manifest.roots.find(root => root.rootId === user.rootId);
      await observe(row.id, () => request(endpoints.backend, moduleRequest(root, 'FETCH_CUR_SYS', null,
        { pssystemid: row.submittedSystemId }), tokens.get(user.loginname)), (response, before, after) => {
        verifyRead(response, root, 'FETCH_CUR_SYS');
        assert.deepEqual(after, before);
      });
    }
    if (allowOwnedProbeMutations) {
      for (const root of manifest.roots) {
        const editor = manifest.users.find(user => user.rootId === root.rootId && user.role === 'editor');
        const probe = { psmoduleid: `nf_${runId}_${root.side}_http_${randomBytes(4).toString('hex')}`,
          pssystemid: root.logicalSystemId, psmodulename: `Native relogin ${label} ${root.side}`,
          modtag: `nf_${runId}_${root.side}_created` };
        const cleanup = { rootId: root.rootId, recordId: probe.psmoduleid, status: 'not-needed' };
        report.cleanup.push(cleanup);
        try {
          cleanup.status = 'required';
          for (const operation of ['CREATE', 'UPDATE']) {
            if (operation === 'UPDATE') probe.modtag = `nf_${runId}_${root.side}_updated`;
            await observe(`${root.side}-editor-${operation}`, () => request(endpoints.backend,
              moduleRequest(root, operation, probe.psmoduleid, probe), tokens.get(editor.loginname)),
            (response, before, after) => {
              assert.ok([200, 201].includes(response.status));
              assert.equal(response.error, null);
              verifyMutation(before, after, root, operation, probe);
            });
          }
          for (const user of manifest.users) {
            const token = await backendLogin(user);
            await observe(`${user.loginname}-${root.side}-persisted-probe-fresh-login`, () => request(endpoints.backend,
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
          await observe(`${root.side}-editor-REMOVE`, () => request(endpoints.backend,
            moduleRequest(root, 'REMOVE', probe.psmoduleid), freshEditorToken), (response, before, after) => {
            assert.ok([200, 204].includes(response.status));
            assert.equal(response.error, null);
            verifyMutation(before, after, root, 'REMOVE', probe);
          });
          cleanup.status = 'removed-via-native-editor';
          await observe(`${root.side}-probe-absent-after-native-remove`, () => request(endpoints.backend,
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
              const response = await request(endpoints.backend,
                moduleRequest(root, 'REMOVE', probe.psmoduleid), tokens.get(editor.loginname));
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
    verifyRestoration(baseline, final);
    report.checks.at(-1).status = 'passed';
  } catch {
    report.status = 'failed-native-matrix';
    report.boundedRoleRootAcceptance = false;
    report.unresolved.push('Final owned preflight, snapshot or full-column baseline restoration failed; no acceptance');
  }
  const reportPath = join(output, 'report.json');
  privateWrite(reportPath, json(report));
  return { report, reportPath };
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--execute-owned-native-matrix') { assert.ok(!options.execute); options.execute = true; continue; }
    if (arg === '--allow-owned-probe-mutations') { assert.ok(!options.mutations); options.mutations = true; continue; }
    const match = /^--(run-id|deployment-input|label)=(.+)$/.exec(arg);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Explicit, non-duplicate options required');
    options[match[1]] = match[2];
  }
  assert.ok(options.execute && options['deployment-input'], 'Explicit execution and deployment input required; no defaults');
  const result = await executeOwnedMatrix({ runId: options['run-id'], deploymentInput: options['deployment-input'],
    label: options.label, allowOwnedProbeMutations: options.mutations ?? false });
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
