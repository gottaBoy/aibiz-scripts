#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { nativeActorRuntimeIdentity } from './probe-existing-native-actor-contract.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const services = ['ibizlab-uaa-api', 'plmweb', 'ibiz-ebsx-allinone', 'nacos'];
const privateCredentialPath = '.artifacts/current-business-actors-20261122-r1/credentials.private.json';
const classEvidenceRoot = '.artifacts/native-actor-contract-20261123-r2';
const jarPath = '/opt/uaa/packages/uaa-api-reconstructed.jar';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sourcePaths = [
  'plm-web/nginx-local.conf',
  'ibiz-service-hub/libs/ibiz-cloud-uaa-core/src/main/java/net/ibizsys/central/cloud/uaa/core/spring/controller/UAARestController.java',
  'ibiz-service-hub/libs/ibiz-cloud-uaa-core/src/main/java/net/ibizsys/central/cloud/uaa/core/cloudutil/CloudUAAUtilRuntimeBase.java',
  'standalone-uaa/source/uaa-user/src/main/java/cn/ibizlab/api/rest/AuthResourceImpl.java',
];
export const REVIEWED_NACOS_CONFIGS = Object.freeze([
  { dataId: 'common.yaml', group: 'ibiz_config_group' },
  { dataId: 'deploysystem-gateway', group: 'ibiz_config_group' },
  { dataId: 'servicehub-allinone', group: 'ibiz_config_group' },
]);

export function inspectNativeHttpBootstrap(bytes) {
  const properties = new Map();
  for (const line of bytes.toString().split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const at = line.indexOf('=');
    assert.ok(at > 0, 'Unreviewed bootstrap properties syntax');
    const key = line.slice(0, at).trim();
    if (!/^spring\.cloud\.nacos\.config\.(?:extension-configs|namespace|file-extension)/.test(key)) continue;
    assert.ok(!properties.has(key), 'Duplicate relevant bootstrap property');
    properties.set(key, line.slice(at + 1).trim());
  }
  assert.equal(properties.get('spring.cloud.nacos.config.namespace'), '');
  assert.equal(properties.get('spring.cloud.nacos.config.file-extension'), 'yaml');
  const entries = [...properties.keys()].filter(key => key.endsWith('.data-id'));
  assert.equal(entries.length, 3, 'The reviewed extension configuration set changed');
  const configs = REVIEWED_NACOS_CONFIGS.map((expected, index) => {
    const base = `spring.cloud.nacos.config.extension-configs[${index}]`;
    const actual = { dataId: properties.get(`${base}.data-id`), group: properties.get(`${base}.group`) };
    assert.deepEqual(actual, expected, 'The exact declared Nacos ID/group changed');
    assert.equal(properties.get(`${base}.refresh`), 'true');
    return { ...actual };
  });
  return { configs, namespace: '', refreshEnabled: true, completePropertySourceGraphVerified: false };
}

const yamlProjectionScript = String.raw`
import json, re, sys, yaml
class UniqueLoader(yaml.SafeLoader):
    pass
def mapping(loader, node, deep=False):
    values = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str) or key in values:
            raise ValueError("ambiguous mapping")
        values[key] = loader.construct_object(value_node, deep=deep)
    return values
UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
def visit(node, path, ancestors, result):
    if isinstance(node, (dict, list)):
        if id(node) in ancestors or len(path) > 64:
            raise ValueError("cyclic or excessive YAML")
        ancestors = ancestors | {id(node)}
    if isinstance(node, dict):
        for key, value in node.items():
            visit(value, path + (key,), ancestors, result)
    elif not isinstance(node, list):
        normalized = re.sub(r"[._-]", "", "".join(path)).lower()
        if normalized == "ibizrestbasepathapi":
            if isinstance(node, str) and re.fullmatch(r"/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]*", node):
                result["prefixCandidates"].append(node)
            else:
                result["unresolvedPrefixPresent"] = True
        elif normalized == "ibizauthpasswordstoragemode":
            result["passwordModeCandidates"].append(node if node in ("sm3", "none") else "unreviewed-mode")
try:
    raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("too large")
    documents = list(yaml.load_all(raw, Loader=UniqueLoader))
    if len(documents) > 100:
        raise ValueError("too many documents")
    result = {"prefixCandidates": [], "passwordModeCandidates": [], "unresolvedPrefixPresent": False}
    for document in documents:
        visit(document, (), set(), result)
    print(json.dumps(result))
except Exception:
    sys.exit(23)
`;

export function projectNativeConfiguration(bytes, execute = (program, args, input) =>
  spawnSync(program, args, { input, timeout: 5000, maxBuffer: 65536 })) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 2 * 1024 * 1024);
  const result = execute('python3', ['-c', yamlProjectionScript], bytes);
  assert.ok(!result.error && !result.signal && result.status === 0,
    'Structured configuration projection failed; raw configuration withheld');
  const projected = JSON.parse(Buffer.from(result.stdout).toString());
  assert.deepEqual(Object.keys(projected).sort(),
    ['passwordModeCandidates', 'prefixCandidates', 'unresolvedPrefixPresent']);
  return { ...projected, effectiveConfigurationVerified: false,
    completePropertySourceGraphVerified: false, rawConfigurationRetained: false };
}

function port(row, internal) {
  const mapped = [...new Set((row.NetworkSettings?.Ports?.[`${internal}/tcp`] ?? [])
    .map(value => value.HostPort))];
  assert.equal(mapped.length, 1, 'An exact existing mapped port is required');
  assert.match(mapped[0], /^[0-9]{1,5}$/);
  assert.ok(Number(mapped[0]) > 0 && Number(mapped[0]) < 65536);
  return Number(mapped[0]);
}

function orderedRecord(value) {
  if (Array.isArray(value)) return value.map(orderedRecord);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, orderedRecord(value[key])]));
  return value;
}

function unorderedRecords(values) {
  return values.map(orderedRecord).sort((left, right) => json(left).localeCompare(json(right)));
}

export function nativeHttpRuntimeIdentity(row, root = workspace) {
  const name = row.Name?.slice(1);
  assert.ok(services.includes(name), 'An unreviewed service cannot be used');
  assert.match(row.Id, /^[a-f0-9]{64}$/);
  assert.match(row.Image, /^sha256:[a-f0-9]{64}$/);
  assert.equal(row.State?.Status, 'running');
  assert.equal(row.Config?.Labels?.['com.docker.compose.service'], name);
  assert.equal(row.Config.Labels['com.docker.compose.project.working_dir'], join(root, 'plm/deploy/compose'));
  const inputs = row.Config.Labels['com.docker.compose.project.config_files']?.split(',');
  assert.ok(inputs?.length && inputs.every(path => dirname(path) === join(root, 'plm/deploy/compose')));
  const mounts = unorderedRecords(row.Mounts);
  const ports = Object.fromEntries(Object.keys(row.NetworkSettings.Ports).sort().map(key =>
    [key, row.NetworkSettings.Ports[key] === null ? null : unorderedRecords(row.NetworkSettings.Ports[key])]));
  return { containerId: row.Id, imageId: row.Image, startedAt: row.State.StartedAt,
    restartCount: row.RestartCount, configurationSha256: sha(json(row.Config)),
    mountsSha256: sha(json(mounts)), portsSha256: sha(json(ports)),
    rawArrayHashes: { mountsSha256: sha(json(row.Mounts)), portsSha256: sha(json(row.NetworkSettings.Ports)) } };
}

export function nativeHttpRuntimeComparable(identity) {
  const { rawArrayHashes, ...comparable } = identity;
  assert.ok(rawArrayHashes);
  return comparable;
}

export function nativeActorHttpPlan(frontendPort, nacosPort, bootstrap) {
  for (const value of [frontendPort, nacosPort]) assert.ok(Number.isInteger(value) && value > 0 && value < 65536);
  assert.deepEqual(bootstrap.configs, REVIEWED_NACOS_CONFIGS);
  const base = `http://127.0.0.1:${frontendPort}/api/ibizplm__plmweb`;
  return [
    ...bootstrap.configs.map(config => ({ label: `configuration-${config.dataId}`,
      method: 'GET', url: `http://127.0.0.1:${nacosPort}/nacos/v1/cs/configs?`
        + new URLSearchParams({ dataId: config.dataId, group: config.group }).toString(),
      authorization: 'none', nativeBusinessOperation: false })),
    { label: 'normal-login', method: 'POST', url: `${base}/v7/login`,
      authorization: 'credential-body-only', nativeBusinessOperation: false },
    { label: 'bearer-userinfo', method: 'GET', url: `${base}/uaa/oauth/userinfo`,
      authorization: 'normal-login-bearer-only', nativeBusinessOperation: false },
  ];
}

export function nativeActorHttpRequest(entry, credentials, token) {
  const headers = { accept: 'application/json' };
  const init = { method: entry.method, headers, redirect: 'error',
    signal: AbortSignal.timeout(8000) };
  if (entry.label === 'normal-login') {
    assert.equal(entry.method, 'POST');
    assert.ok(typeof credentials?.username === 'string' && credentials.username
      && typeof credentials.password === 'string' && credentials.password);
    assert.notEqual(credentials.status, 'NOT_CREATED', 'Planned actors are not login credentials');
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify({ loginname: credentials.username, password: credentials.password });
  } else if (entry.label === 'bearer-userinfo') {
    assert.equal(entry.method, 'GET');
    assert.ok(typeof token === 'string' && token.length > 0 && token.length < 32768
      && !/[\u0000-\u0020\u007f]/.test(token));
    headers.authorization = `Bearer ${token}`;
  } else {
    assert.ok(REVIEWED_NACOS_CONFIGS.some(config => entry.label === `configuration-${config.dataId}`));
    assert.equal(entry.method, 'GET');
  }
  return init;
}

export function assessNativeActorUserInfo(data, expectedUsername) {
  assert.ok(data && typeof data === 'object' && !Array.isArray(data), 'A native OIDC object is required');
  assert.equal(data.sub, expectedUsername, 'The normal login and userinfo subject do not match');
  return { normalLoginSubjectMatched: true, subjectRetained: false, emailRetained: false,
    sourceContract: 'platform-OIDC-sub-and-email-only',
    administratorAuthorityVerified: false, realmVerified: false, organizationVerified: false,
    ordinaryOrganizationRoleVerified: false, nativePersonIdVerified: false,
    userinfoRoleDeclarationsTreatedAsEffectiveAuthorities: false };
}

function privateBytes(path, root) {
  const child = relative(join(root, '.artifacts'), resolve(path));
  assert.ok(child && !child.startsWith('..') && !child.startsWith('/'));
  for (let current = dirname(resolve(path)); ; current = dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Symlink private input ancestry is refused');
    if (dirname(current) === current) break;
  }
  const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0);
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function writePrivate(path, bytes) {
  const descriptor = fs.openSync(path,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

export async function probeExistingNativeActorHttpPreflight(options = {}) {
  assert.ok(Object.keys(options).every(key => ['output', 'root', 'execute', 'request'].includes(key)),
    'Only the reviewed read-only plan is supported; no identity, route or apply overrides');
  const { root = workspace, execute = (program, args, input) => spawnSync(program, args,
    { input, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }), request = fetch } = options;
  assert.equal(typeof options.output, 'string');
  const output = resolve(options.output);
  assert.equal(dirname(output), join(root, '.artifacts'));
  assert.match(basename(output), /^native-actor-http-preflight-[A-Za-z0-9-]+$/);
  assert.ok(!fs.existsSync(output), 'An exclusive new output is required');
  for (let current = dirname(output); ; current = dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Symlink output ancestry is refused');
    if (dirname(current) === current) break;
  }
  const run = (program, args, input) => {
    const result = execute(program, args, input);
    assert.ok(!result.error && !result.signal && result.status === 0,
      `Existing read-only ${program} operation failed; raw diagnostics withheld`);
    return Buffer.from(result.stdout);
  };
  const sources = [...sourcePaths,
    'scripts/probe-existing-native-actor-http-preflight.mjs',
    'scripts/tests/probe-existing-native-actor-http-preflight.test.mjs'].map(path => {
    const bytes = fs.readFileSync(join(root, path));
    return { path, bytes, sha256: sha(bytes) };
  });
  const sourceText = index => sources[index].bytes.toString();
  assert.ok(sourceText(0).includes('location ^~ /api/ibizplm__plmweb/v7/')
    && sourceText(0).includes('location ^~ /api/ibizplm__plmweb/uaa/'));
  assert.ok(sourceText(1).includes('value = "/uaa/oauth/userinfo", method = { RequestMethod.POST, RequestMethod.GET }'));
  assert.ok(sourceText(2).includes('map.put("sub", iAuthenticationUser.getUsername());')
    && sourceText(2).includes('map.put("email", iAuthenticationUser.getEmail());'));
  assert.ok(sourceText(3).includes('value = {"auths/user-info/self"}'));
  const inspect = () => {
    const rows = JSON.parse(run('docker', ['inspect', ...services]).toString());
    assert.equal(rows.length, services.length);
    const values = new Map(rows.map(row => [row.Name.slice(1), row]));
    assert.deepEqual([...values.keys()].sort(), [...services].sort());
    for (const row of values.values()) nativeHttpRuntimeIdentity(row, root);
    return values;
  };
  const initial = inspect();
  const identities = Object.fromEntries([...initial].map(([name, row]) =>
    [name, nativeHttpRuntimeIdentity(row, root)]));
  const uaa = initial.get('ibizlab-uaa-api');
  const classReportBytes = privateBytes(join(root, classEvidenceRoot, 'report.private.json'), root);
  const classReport = JSON.parse(classReportBytes);
  assert.equal(classReport.status, 'CLASS_SUBSET_MATCHED_AUTHORIZATION_NOT_TESTED');
  assert.equal(classReport.runtimeClassContractVerified, true);
  assert.equal(classReport.runtimeContractVerified, false);
  assert.deepEqual(nativeActorRuntimeIdentity(uaa, root), classReport.runtime,
    'The sealed class receipt no longer binds the existing UAA');
  const localJar = join(root, classEvidenceRoot, 'jars/uaa-api-reconstructed.jar');
  const jarBytes = privateBytes(localJar, root);
  const jarHash = sha(jarBytes);
  assert.equal(jarHash, classReport.bindings.find(binding => binding.runtimePath === jarPath)?.sha256);
  const assertJar = () => assert.equal(run('docker',
    ['exec', uaa.Id, 'sha256sum', jarPath]).toString().trim(), `${jarHash}  ${jarPath}`,
  'The actual runtime package JAR changed');
  assertJar();
  const bootstrapBytes = run('unzip', ['-p', localJar, 'bootstrap-local.properties']);
  const bootstrap = inspectNativeHttpBootstrap(bootstrapBytes);
  const env = Object.fromEntries(uaa.Config.Env.map(value => {
    const at = value.indexOf('=');
    return [value.slice(0, at), value.slice(at + 1)];
  }));
  const nacosEndpoint = new URL(env['SPRING_CLOUD_NACOS_CONFIG_SERVER-ADDR']);
  assert.equal(nacosEndpoint.origin, 'http://nacos:8848');
  assert.equal(nacosEndpoint.pathname, '/');
  assert.equal(nacosEndpoint.search + nacosEndpoint.hash + nacosEndpoint.username + nacosEndpoint.password, '');
  assert.equal(env.SPRING_CLOUD_NACOS_CONFIG_GROUP, 'ibiz_config_group');
  const frontend = initial.get('plmweb');
  const liveNginx = () => run('docker', ['exec', frontend.Id, 'cat', '/etc/nginx/conf.d/nginx.conf']);
  const nginxBytes = liveNginx();
  const nginx = nginxBytes.toString();
  for (const fragment of ['location ^~ /api/ibizplm__plmweb/v7/',
    'rewrite ^/api/ibizplm__plmweb/v7/(.*)$ /v7/$1 break;',
    'location ^~ /api/ibizplm__plmweb/uaa/',
    'rewrite ^/api/ibizplm__plmweb/uaa/(.*)$ /uaa/$1 break;',
    'set $allinone_upstream http://ibiz-ebsx-allinone:30000;']) {
    assert.ok(nginx.includes(fragment), 'The reviewed normal authentication route changed');
  }
  const plan = nativeActorHttpPlan(port(frontend, 8080), port(initial.get('nacos'), 8848), bootstrap);
  const credentialBytes = privateBytes(join(root, privateCredentialPath), root);
  const credentials = JSON.parse(credentialBytes);
  nativeActorHttpRequest(plan.find(entry => entry.label === 'normal-login'), credentials);
  fs.mkdirSync(output, { mode: 0o700 });
  fs.mkdirSync(join(output, 'source'), { mode: 0o700 });
  const report = { contract: 'existing-native-actor-http-readonly-preflight-v1',
    status: 'RUNNING', startedAt: new Date().toISOString(), runtime: identities,
    classReceiptSha256: sha(classReportBytes), runtimeJarSha256: jarHash,
    bootstrapSha256: sha(bootstrapBytes), liveNginxSha256: sha(nginxBytes),
    credentialInputSha256: sha(credentialBytes), credentialOrTokenPersisted: false,
    rawConfigurationRetained: false, rawUserinfoRetained: false,
    normalLoginRequests: 0, businessPostRequests: 0, directDatabaseRequests: 0,
    usersCreated: 0, rolesChanged: 0, runtimeChangedByProbe: false,
    preparedCandidatesModified: false, nativeReadsExecuted: 0,
    actualAuthorizationTested: false, runtimeContractVerified: false,
    authenticationAuditSideEffectsPossible: true, requests: [], configurations: [],
    runtimeRawArrayHashObservations: [{ phase: 'initial', hashes: Object.fromEntries(
      Object.entries(identities).map(([name, identity]) => [name, identity.rawArrayHashes])) }],
    sourceBindings: sources.map(file => ({ path: file.path, sha256: file.sha256 })) };
  const guard = () => {
    const current = inspect();
    const observed = Object.fromEntries([...current].map(([name, row]) =>
      [name, nativeHttpRuntimeIdentity(row, root)]));
    report.runtimeRawArrayHashObservations.push({ phase: 'guard', hashes: Object.fromEntries(
      Object.entries(observed).map(([name, identity]) => [name, identity.rawArrayHashes])) });
    assert.deepEqual(Object.fromEntries(Object.entries(observed).map(([name, identity]) =>
      [name, nativeHttpRuntimeComparable(identity)])),
    Object.fromEntries(Object.entries(identities).map(([name, identity]) =>
      [name, nativeHttpRuntimeComparable(identity)])), 'Existing service inputs changed');
    assert.equal(sha(liveNginx()), sha(nginxBytes), 'Live normal authentication route changed');
    assertJar();
    for (const file of sources) assert.equal(sha(fs.readFileSync(join(root, file.path))), file.sha256,
      'A bound source or probe implementation changed');
    assert.equal(sha(privateBytes(join(root, privateCredentialPath), root)), sha(credentialBytes));
  };
  let phase = 'source-snapshot';
  try {
    for (const [index, file] of sources.entries()) writePrivate(
      join(output, 'source', `${index}-${basename(file.path)}`), file.bytes);
    let token;
    for (const entry of plan) {
      phase = entry.label;
      guard();
      const init = nativeActorHttpRequest(entry, credentials, token);
      if (entry.label === 'normal-login') report.normalLoginRequests += 1;
      const response = await request(entry.url, init);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.length <= 2 * 1024 * 1024, 'Native response exceeded the private read budget');
      const summary = { label: entry.label, method: entry.method, url: entry.url,
        status: response.status, bytes: bytes.length, sha256: sha(bytes) };
      report.requests.push(summary);
      guard();
      if (entry.label.startsWith('configuration-')) {
        const config = REVIEWED_NACOS_CONFIGS.find(value => entry.label === `configuration-${value.dataId}`);
        report.configurations.push({ ...config, status: response.status,
          ...(response.status === 200 ? projectNativeConfiguration(bytes, execute)
            : { effectiveConfigurationVerified: false, rawConfigurationRetained: false }) });
      } else {
        assert.equal(response.status, 200, 'The normal authenticated read did not succeed');
        const data = JSON.parse(bytes.toString());
        if (entry.label === 'normal-login') {
          token = data?.token;
          nativeActorHttpRequest(plan.find(item => item.label === 'bearer-userinfo'), null, token);
          summary.tokenReturned = true;
        } else {
          report.userinfo = assessNativeActorUserInfo(data, credentials.username);
        }
      }
    }
    report.observedRuntimeIdentityStable = true;
    report.status = 'NORMAL_BEARER_SUBJECT_MATCHED_NATIVE_PREFLIGHT_BLOCKED';
  } catch (error) {
    report.status = 'BLOCKED_NATIVE_HTTP_PREFLIGHT_INCOMPLETE';
    report.failedPhase = phase;
    report.failureType = error.name;
    report.rawErrorWithheld = true;
  }
  report.gates = { normalBearerIdentityRead: report.userinfo?.normalLoginSubjectMatched === true,
    completeConfigurationSourceGraph: false, effectiveNativePrefix: false,
    effectivePasswordMode: false, administratorEffectiveAuthorities: false,
    nativePersonIdentity: false, realmAndOrganization: false, ordinaryOrganizationRole: false,
    nativeCreateRemoveAuthorization: false, accountCreationAllowed: false };
  report.remaining = [
    'Three extension configs do not establish all active profiles, source priority, dynamic refresh or native controller prefix',
    'Platform OIDC sub/email do not establish native Person ID, effective authorities, realm, organization or ordinary organization role',
    'No native resource GET was attempted without those verified bindings; no Create/Remove authorization was tested',
    'The prepared candidates remain NOT_CREATED and are not authentication inputs',
  ];
  report.finishedAt = new Date().toISOString();
  writePrivate(join(output, 'report.private.json'), json(report));
  for (const path of [join(output, 'source'), output]) {
    const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' } }, strict: true });
  try {
    const report = await probeExistingNativeActorHttpPreflight(values);
    console.log(JSON.stringify({ status: report.status, gates: report.gates,
      normalLoginRequests: report.normalLoginRequests, businessPostRequests: 0,
      nativeReadsExecuted: 0, usersCreated: 0, rolesChanged: 0 }));
    if (!report.gates.normalBearerIdentityRead) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', type: error.name, rawErrorWithheld: true }));
    process.exitCode = 1;
  }
}
