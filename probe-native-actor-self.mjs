#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { nativeActorRuntimeIdentity, parseNativeActorJavap } from './probe-existing-native-actor-contract.mjs';
import { nativeHttpRuntimeComparable, nativeHttpRuntimeIdentity } from './probe-existing-native-actor-http-preflight.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const services = ['ibizlab-uaa-api', 'plmweb', 'ibiz-ebsx-allinone'];
const credentialsPath = '.artifacts/current-business-actors-20261122-r1/credentials.private.json';
const classEvidence = '.artifacts/native-actor-contract-20261123-r2';
const classpath = '/opt/uaa/third-party/*:/opt/uaa/starters/*:/opt/uaa/packages/*';
const sourceRoot = 'standalone-uaa/source';
const prefix = 'cn.ibizlab.api.rest.';
const selfPath = '/auths/user-info/self';
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readSourcePaths = [
  `${sourceRoot}/uaa-api/src/main/java/cn/ibizlab/api/rest/AuthResource.java`,
  `${sourceRoot}/uaa-user/src/main/java/cn/ibizlab/api/rest/AuthResourceImpl.java`,
  `${sourceRoot}/uaa-user/src/main/java/cn/ibizlab/util/security/AuthUserServiceImpl.java`,
  `${sourceRoot}/uaa-user/src/main/java/cn/ibizlab/core/authentication/service/impl/AuthUserServiceImpl.java`,
  `${sourceRoot}/uaa-user/src/main/java/cn/ibizlab/core/authentication/mapping/AuthInfoMappingImpl.java`,
  'standalone-uaa/starters/ibizlab-boot-starter/src/main/java/cn/ibizlab/util/security/AuthUser20Impl.java',
  'plm-web/nginx-local.conf',
  'scripts/probe-native-actor-self.mjs', 'scripts/tests/probe-native-actor-self.test.mjs',
];
export const NATIVE_SELF_CLASSES = Object.freeze([
  `${prefix}AuthResource`, `${prefix}AuthResourceImpl`,
  ...['SysPerson', 'SysMember', 'SysOrganization', 'SysOrganizationalRole'].flatMap(entity =>
    [`${prefix}${entity}Resource`, `${prefix}${entity}ResourceImpl`, `${prefix}Abstract${entity}Resource`]),
]);

function nativeId(value) {
  assert.ok(typeof value === 'string' && value.length > 0 && value.length <= 100
    && !/[\u0000-\u0020\u007f/?#%\\]/.test(value) && !['.', '..'].includes(value),
  'Only a bounded ID returned by the current native response may be read');
  return value;
}

function optionalId(value) {
  return typeof value === 'string' && value.length ? nativeId(value) : null;
}

function nativeObject(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected one native object');
  return value;
}

export function classifyNativeSelfResponse(status, data) {
  return { httpStatus: status, classification: status === 200 ? 'native-response-requires-identity-validation'
    : status === 401 ? 'standalone-bearer-not-authenticated'
      : status === 403 ? 'standalone-read-forbidden'
        : status === 404 ? 'exact-native-path-not-found'
          : 'standalone-native-read-error',
  nativeCode: Number.isSafeInteger(data?.code) ? data.code : null,
  nativeErrorType: ['BadRequestAlertException', 'AccessDeniedException',
    'UnauthorizedException', 'SystemRuntimeException'].includes(data?.type) ? data.type : null,
  rawBodyRetained: false, routeHandlerProven: false };
}

export function nativeSelfRequest(token) {
  assert.ok(typeof token === 'string' && token.length > 0 && token.length < 32768
    && !/[\u0000-\u0020\u007f]/.test(token), 'Only a normal returned Bearer token is accepted');
  return { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    redirect: 'error', signal: AbortSignal.timeout(8000) };
}

export function projectNativeSelf(data, expectedUsername) {
  nativeObject(data);
  assert.equal(data.username, expectedUsername, 'Native self username must match the normal login');
  const memberships = data.member_of ?? [];
  assert.ok(Array.isArray(memberships) && memberships.length <= 100);
  const roles = data.roles ?? [];
  assert.ok(Array.isArray(roles) && roles.length <= 100);
  const reportedAuthorities = [...new Set(roles.flatMap(system => {
    assert.ok(Array.isArray(system.roles ?? []) && (system.roles ?? []).length <= 100);
    return (system.roles ?? []).flatMap(role => typeof role.authority === 'string'
      && /^[A-Za-z0-9_:.-]{1,200}$/.test(role.authority) ? [role.authority] : []);
  }))].sort();
  return { id: nativeId(data.id), usernameMatchesLogin: true, dc: optionalId(data.dc),
    organizationId: optionalId(data.organization_id),
    organizationalRoleId: optionalId(data.organizational_role_id),
    memberships: memberships.map(member => {
      nativeObject(member);
      return { organizationId: optionalId(member.organization_id),
        organizationalRoleId: optionalId(member.organizational_role_id), dc: optionalId(member.dc) };
    }),
    roleAuthoritiesReturnedByNativeSelf: reportedAuthorities,
    nativeSuperUserFlag: data.super_user === 1, nativeApiUserFlag: data.api_user === 1,
    effectiveAuthorityCollectionExposed: false,
    currentReadAuthorizationProven: false, createRemoveAuthorizationTested: false };
}

export function projectNativePerson(data, self, expectedUsername) {
  nativeObject(data);
  assert.equal(data.id, self.id, 'Only the currently authenticated person may be read');
  const loginUid = expectedUsername.split('|')[0].trim();
  assert.equal(data.uid, loginUid, 'Self Person UID differs from the normal login identity');
  const dc = optionalId(data.dc);
  if (self.dc !== null) assert.equal(dc, self.dc, 'Self realm differs from native Person');
  const organizationId = optionalId(data.organization_id);
  if (self.organizationId !== null) assert.equal(organizationId, self.organizationId,
    'Current self organization differs from native Person');
  const memberships = data.member_of ?? [];
  assert.ok(Array.isArray(memberships) && memberships.length <= 100);
  return { id: self.id, uidMatchesLogin: true, dc, organizationId,
    organizationalRoleId: optionalId(data.organizational_role_id),
    memberships: memberships.map(member => {
      nativeObject(member);
      const personId = optionalId(member.person_id);
      if (personId !== null) assert.equal(personId, self.id);
      return { id: optionalId(member.id), personId, dc: optionalId(member.dc),
        organizationId: optionalId(member.organization_id),
        organizationalRoleId: optionalId(member.organizational_role_id) };
    }), passwordOrContactFieldsRetained: false, getAuthorizationAccepted: true };
}

export async function readNativeSelfGraph({ read, expectedUsername }) {
  assert.equal(typeof read, 'function');
  const result = { status: 'NATIVE_SELF_NOT_VERIFIED', nativeSelfPath: selfPath,
    rootRouteProven: false, normalBearerAcceptedByStandalone: false,
    personReadVerified: false, organizationReadVerified: false, memberReadVerified: false,
    organizationalRoleReadVerified: false, ordinaryOrganizationRoleVerified: false,
    createRemoveAuthorizationTested: false, accountCreationAllowed: false,
    runtimeContractVerified: false, reads: [] };
  const get = async (path, label) => {
    assert.ok(path === selfPath
      || /^\/(?:sys_people|sys_members|sys_organizations|sys_organizational_roles)\/[^/]+$/.test(path));
    const response = await read(path, label);
    result.reads.push({ label, ...classifyNativeSelfResponse(response.status, response.data) });
    return response;
  };
  const selfResponse = await get(selfPath, 'native-self');
  if (selfResponse.status !== 200) {
    result.status = 'NATIVE_SELF_REJECTED_NO_ROUTE_FALLBACK';
    return result;
  }
  result.self = projectNativeSelf(selfResponse.data, expectedUsername);
  result.rootRouteProven = true;
  result.normalBearerAcceptedByStandalone = true;
  result.reads.at(-1).routeHandlerProven = true;
  const personResponse = await get(`/sys_people/${encodeURIComponent(result.self.id)}`, 'native-own-person');
  if (personResponse.status !== 200) {
    result.status = 'NATIVE_SELF_ACCEPTED_PERSON_READ_REJECTED';
    return result;
  }
  result.person = projectNativePerson(personResponse.data, result.self, expectedUsername);
  result.personReadVerified = true;
  result.reads.at(-1).routeHandlerProven = true;
  const ownOrganization = result.person.organizationId;
  if (ownOrganization) {
    const response = await get(`/sys_organizations/${encodeURIComponent(ownOrganization)}`, 'native-own-organization');
    if (response.status === 200) {
      nativeObject(response.data);
      assert.equal(response.data.id, ownOrganization);
      const dc = optionalId(response.data.dc);
      if (result.person.dc !== null && dc !== null) assert.equal(dc, result.person.dc);
      result.organization = { id: ownOrganization, dc, readAccepted: true };
      result.organizationReadVerified = true;
      result.reads.at(-1).routeHandlerProven = true;
    }
  }
  const memberships = result.person.memberships.filter(member =>
    member.organizationId === ownOrganization && member.id && member.personId === result.self.id);
  result.persistedOwnOrganizationMemberships = memberships.length;
  const primaryRole = result.person.organizationalRoleId ?? result.self.organizationalRoleId;
  const selected = primaryRole ? memberships.find(member => member.organizationalRoleId === primaryRole)
    : memberships.length === 1 ? memberships[0] : undefined;
  let roleId = selected?.organizationalRoleId ?? null;
  if (selected) {
    const response = await get(`/sys_members/${encodeURIComponent(selected.id)}`, 'native-own-member');
    if (response.status === 200) {
      nativeObject(response.data);
      assert.equal(response.data.id, selected.id);
      assert.equal(response.data.person_id, result.self.id);
      assert.equal(response.data.organization_id, ownOrganization);
      assert.equal(response.data.organizational_role_id, selected.organizationalRoleId);
      result.member = { id: selected.id, personId: result.self.id, organizationId: ownOrganization,
        organizationalRoleId: selected.organizationalRoleId, readAccepted: true };
      result.memberReadVerified = true;
      result.reads.at(-1).routeHandlerProven = true;
    } else roleId = null;
  }
  if (roleId) {
    const response = await get(`/sys_organizational_roles/${encodeURIComponent(roleId)}`, 'native-own-organizational-role');
    if (response.status === 200) {
      nativeObject(response.data);
      assert.equal(response.data.id, roleId);
      assert.equal(response.data.organization_id, ownOrganization);
      const dc = optionalId(response.data.dc);
      if (result.person.dc !== null && dc !== null) assert.equal(dc, result.person.dc);
      result.organizationalRole = { id: roleId, organizationId: ownOrganization, dc, readAccepted: true,
        ordinaryPrivilegePolicyVerified: false };
      result.organizationalRoleReadVerified = true;
      result.reads.at(-1).routeHandlerProven = true;
    }
  }
  result.status = 'NATIVE_SELF_AND_OWN_PERSON_READ_PROVEN';
  return result;
}

export function assessNativeSelfClasses(views) {
  const controller = views.get(`${prefix}AuthResource`);
  const implementation = views.get(`${prefix}AuthResourceImpl`);
  assert.equal(controller?.superclass, implementation?.name);
  assert.deepEqual(controller.annotations.get(
    'org.springframework.web.bind.annotation.RequestMapping')?.value, ['${ibiz.rest.basePath.api:/}']);
  const self = implementation.members.filter(member => member.name === 'userInfo'
    && member.descriptor === '()Lorg/springframework/http/ResponseEntity;');
  assert.equal(self.length, 1);
  assert.deepEqual(self[0].annotations.get(
    'org.springframework.web.bind.annotation.RequestMapping')?.value, ['auths/user-info/self']);
  assert.ok(self[0].text.includes('method=[Lorg/springframework/web/bind/annotation/RequestMethod;.GET]'));
  for (const fragment of ['AuthenticationUser.getAuthenticationUser:', 'AuthenticationUser.getUsername:',
    'AuthenticationUserService.loadUserByUsername:']) assert.ok(self[0].text.includes(fragment));
  assert.doesNotMatch(self[0].text, /\/\/ (?:InterfaceMethod|Method) .*\.(?:create|save|update|remove|delete|post|put):/);
  for (const [entity, collection] of [
    ['SysPerson', 'sys_people'], ['SysMember', 'sys_members'],
    ['SysOrganization', 'sys_organizations'], ['SysOrganizationalRole', 'sys_organizational_roles'],
  ]) {
    const leaf = views.get(`${prefix}${entity}Resource`);
    const impl = views.get(`${prefix}${entity}ResourceImpl`);
    const base = views.get(`${prefix}Abstract${entity}Resource`);
    assert.equal(leaf?.superclass, impl?.name);
    assert.equal(impl?.superclass, base?.name);
    assert.deepEqual(leaf.annotations.get(
      'org.springframework.web.bind.annotation.RequestMapping')?.value, ['${ibiz.rest.basePath.api:/}']);
    for (const view of [leaf, impl]) assert.ok(!view.members.some(member => member.name === 'getById'),
      'Native GET override requires a new review');
    const read = base.members.filter(member => member.name === 'getById'
      && member.descriptor === '(Ljava/lang/String;)Lorg/springframework/http/ResponseEntity;');
    assert.equal(read.length, 1);
    assert.deepEqual(read[0].annotations.get(
      'org.springframework.web.bind.annotation.GetMapping')?.value, [`${collection}/{id}`]);
    assert.ok(read[0].text.includes(`${entity}Service.get:`));
  }
  return { actualSelfGetMappingVerified: true, relatedGetMappingsVerified: true,
    selfReadsCurrentAuthenticationUsername: true, basePathPlaceholderEffectiveValueClaimed: false };
}

function privateRead(path, root) {
  const child = relative(join(root, '.artifacts'), resolve(path));
  assert.ok(child && !child.startsWith('..') && !child.startsWith('/'));
  for (let current = dirname(resolve(path)); ; current = dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    if (dirname(current) === current) break;
  }
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function writePrivate(path, value) {
  const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function mappedPort(row, internal) {
  const ports = [...new Set((row.NetworkSettings.Ports[`${internal}/tcp`] ?? []).map(item => item.HostPort))];
  assert.equal(ports.length, 1);
  assert.match(ports[0], /^[0-9]{1,5}$/);
  assert.ok(Number(ports[0]) > 0 && Number(ports[0]) <= 65535);
  return ports[0];
}

export async function probeNativeActorSelf(options = {}) {
  assert.ok(Object.keys(options).every(key => ['output', 'root', 'execute', 'request'].includes(key)),
    'No prefix, credentials, identity headers, account, or write overrides are accepted');
  const { root = workspace, execute = (program, args) => spawnSync(program, args,
    { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }), request = fetch } = options;
  assert.equal(typeof options.output, 'string');
  const output = resolve(options.output);
  assert.equal(dirname(output), join(root, '.artifacts'));
  assert.match(basename(output), /^native-actor-self-[A-Za-z0-9-]+$/);
  assert.ok(!fs.existsSync(output));
  for (let current = dirname(output); ; current = dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    if (dirname(current) === current) break;
  }
  const run = (program, args) => {
    const result = execute(program, args);
    assert.ok(result.status === 0 && !result.error && !result.signal,
      'Read-only inspection failed; raw diagnostics withheld');
    return Buffer.from(result.stdout);
  };
  const inspect = () => {
    const rows = JSON.parse(run('docker', ['inspect', ...services]));
    assert.equal(rows.length, services.length);
    const map = new Map(rows.map(row => [row.Name.slice(1), row]));
    assert.deepEqual([...map.keys()].sort(), [...services].sort());
    for (const row of rows) nativeHttpRuntimeIdentity(row, root);
    return map;
  };
  const initial = inspect();
  const identities = Object.fromEntries([...initial].map(([name, row]) =>
    [name, nativeHttpRuntimeComparable(nativeHttpRuntimeIdentity(row, root))]));
  const uaa = initial.get('ibizlab-uaa-api');
  const basisBytes = privateRead(join(root, classEvidence, 'report.private.json'), root);
  const basis = JSON.parse(basisBytes);
  assert.equal(basis.runtimeClassContractVerified, true);
  assert.deepEqual(nativeActorRuntimeIdentity(uaa, root), basis.runtime);
  const sources = readSourcePaths.map(path => ({ path, bytes: fs.readFileSync(join(root, path)) }));
  const jars = basis.bindings.filter(binding => binding.runtimePath);
  const guard = () => {
    const current = inspect();
    assert.deepEqual(Object.fromEntries([...current].map(([name, row]) =>
      [name, nativeHttpRuntimeComparable(nativeHttpRuntimeIdentity(row, root))])), identities);
    for (const binding of jars) assert.equal(run('docker',
      ['exec', uaa.Id, 'sha256sum', binding.runtimePath]).toString().trim(),
    `${binding.sha256}  ${binding.runtimePath}`, 'Actual UAA classpath JAR changed');
    for (const file of sources) assert.equal(sha(fs.readFileSync(join(root, file.path))), sha(file.bytes));
  };
  guard();
  fs.mkdirSync(output, { mode: 0o700 });
  fs.mkdirSync(join(output, 'source'), { mode: 0o700 });
  fs.mkdirSync(join(output, 'javap'), { mode: 0o700 });
  const report = { contract: 'native-actor-exact-self-read-v1', status: 'RUNNING',
    startedAt: new Date().toISOString(), runtime: identities, classReceiptSha256: sha(basisBytes),
    selfPath, nativeRequests: [], normalLoginRequests: 0, businessWriteRequests: 0,
    directDatabaseRequests: 0, usersCreated: 0, rolesChanged: 0, configurationChanged: false,
    credentialOrTokenPersisted: false, nativeRawResponseRetained: false,
    preparedCandidatesModified: false, accountCreationAllowed: false,
    runtimeContractVerified: false, authenticationAuditAndCacheEffectsPossible: true,
    sourceBindings: sources.map(file => ({ path: file.path, sha256: sha(file.bytes) })) };
  let phase = 'actual-native-classes';
  try {
    for (const [index, file] of sources.entries()) writePrivate(
      join(output, 'source', `${index}-${basename(file.path)}`), file.bytes);
    const views = new Map();
    report.classBindings = [];
    for (const name of NATIVE_SELF_CLASSES) {
      const bytes = run('docker', ['exec', uaa.Id, '/opt/java/openjdk/bin/javap',
        '-J-XX:-UsePerfData', '-v', '-p', '-c', '-classpath', classpath, name]);
      const view = parseNativeActorJavap(bytes.toString(), name);
      const binding = jars.find(jar => jar.runtimePath === view.origin.jar);
      assert.ok(binding, 'Class must come from an actual sealed UAA JAR');
      const classBytes = run('unzip', ['-p', join(root, classEvidence, binding.path), view.origin.entry]);
      assert.equal(sha(classBytes), view.origin.sha256);
      writePrivate(join(output, 'javap', `${name}.private.txt`), bytes);
      report.classBindings.push({ name, ...view.origin, disassemblySha256: sha(bytes) });
      views.set(name, view);
    }
    report.classContract = assessNativeSelfClasses(views);
    const nginx = run('docker', ['exec', initial.get('plmweb').Id, 'cat', '/etc/nginx/conf.d/nginx.conf']);
    assert.ok(nginx.includes('location ^~ /api/ibizplm__plmweb/v7/ {')
      && nginx.includes('rewrite ^/api/ibizplm__plmweb/v7/(.*)$ /v7/$1 break;'));
    report.liveNginxSha256 = sha(nginx);
    const credentialsBytes = privateRead(join(root, credentialsPath), root);
    const credentials = JSON.parse(credentialsBytes);
    assert.ok(typeof credentials.username === 'string' && credentials.username
      && typeof credentials.password === 'string' && credentials.password);
    assert.notEqual(credentials.status, 'NOT_CREATED');
    report.credentialInputSha256 = sha(credentialsBytes);
    const nativeOrigin = `http://127.0.0.1:${mappedPort(uaa, 32666)}`;
    report.nativeOrigin = nativeOrigin;
    const parseResponse = async response => {
      const chunks = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader) for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('Native response exceeds the bounded read budget');
        }
        chunks.push(Buffer.from(chunk.value));
      }
      const bytes = Buffer.concat(chunks);
      let data = null;
      try { data = JSON.parse(bytes); } catch {}
      return { status: response.status, data, bytes: bytes.length, sha256: sha(bytes),
        bearerChallengeObserved: /\bBearer\b/i.test(response.headers.get('www-authenticate') ?? '') };
    };
    phase = 'normal-plm-login';
    guard();
    report.normalLoginRequests = 1;
    const login = await parseResponse(await request(
      `http://127.0.0.1:${mappedPort(initial.get('plmweb'), 8080)}/api/ibizplm__plmweb/v7/login`,
      { method: 'POST', redirect: 'error', headers: { accept: 'application/json',
        'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ loginname: credentials.username, password: credentials.password }) }));
    report.login = { status: login.status, bytes: login.bytes, sha256: login.sha256, tokenPersisted: false };
    assert.equal(login.status, 200, 'Normal login did not succeed');
    const token = login.data?.token;
    nativeSelfRequest(token);
    phase = 'exact-native-self-and-owned-read-graph';
    report.result = await readNativeSelfGraph({ expectedUsername: credentials.username,
      async read(path, label) {
        guard();
        const response = await parseResponse(await request(`${nativeOrigin}${path}`, nativeSelfRequest(token)));
        report.nativeRequests.push({ label, method: 'GET', path,
          status: response.status, bytes: response.bytes, sha256: response.sha256,
          bearerChallengeObserved: response.bearerChallengeObserved,
          ...classifyNativeSelfResponse(response.status, response.data) });
        guard();
        return response;
      } });
    guard();
    assert.equal(sha(privateRead(join(root, credentialsPath), root)), sha(credentialsBytes));
    assert.equal(sha(run('docker', ['exec', initial.get('plmweb').Id,
      'cat', '/etc/nginx/conf.d/nginx.conf'])), sha(nginx));
    report.observedRuntimeIdentityStable = true;
    report.status = report.result.status;
  } catch (error) {
    report.status = 'BLOCKED_NATIVE_SELF_PROBE';
    report.failedPhase = phase;
    report.failureType = error.name;
    report.rawErrorWithheld = true;
  }
  report.finishedAt = new Date().toISOString();
  report.remaining = [
    'A successful exact self read proves this observed root route and Bearer interoperability, not complete configuration provenance',
    'Only IDs from current self and its native Person may be read; synthetic authentication memberships do not prove persisted member rows',
    'Role authorities and native flags returned by self do not prove Create/Remove authorization or ordinary-role assignment policy',
    'No account or role creation, configuration mutation, SQL or fallback-prefix probing was performed',
  ];
  writePrivate(join(output, 'report.private.json'), json(report));
  for (const path of [join(output, 'source'), join(output, 'javap'), output]) {
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' } }, strict: true });
  try {
    const report = await probeNativeActorSelf(values);
    console.log(JSON.stringify({ status: report.status, rootRouteProven: report.result?.rootRouteProven ?? false,
      normalBearerAcceptedByStandalone: report.result?.normalBearerAcceptedByStandalone ?? false,
      personReadVerified: report.result?.personReadVerified ?? false,
      nativeReads: report.nativeRequests.length, normalLoginRequests: report.normalLoginRequests,
      usersCreated: 0, rolesChanged: 0, accountCreationAllowed: false }));
    if (!report.result?.personReadVerified) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', type: error.name, rawErrorWithheld: true }));
    process.exitCode = 1;
  }
}
