import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  REVIEWED_NACOS_CONFIGS, assessNativeActorUserInfo, inspectNativeHttpBootstrap,
  nativeActorHttpPlan, nativeActorHttpRequest, nativeHttpRuntimeComparable, nativeHttpRuntimeIdentity,
  probeExistingNativeActorHttpPreflight, projectNativeConfiguration,
} from '../probe-existing-native-actor-http-preflight.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bootstrap = () => Buffer.from([
  'spring.cloud.nacos.config.namespace=',
  'spring.cloud.nacos.config.file-extension=yaml',
  ...REVIEWED_NACOS_CONFIGS.flatMap((config, index) => [
    `spring.cloud.nacos.config.extension-configs[${index}].data-id=${config.dataId}`,
    `spring.cloud.nacos.config.extension-configs[${index}].group=${config.group}`,
    `spring.cloud.nacos.config.extension-configs[${index}].refresh=true`,
  ]),
].join('\n'));

test('only the three exact actual bootstrap extension IDs and groups are eligible for configuration reads', () => {
  const result = inspectNativeHttpBootstrap(bootstrap());
  assert.deepEqual(result.configs, REVIEWED_NACOS_CONFIGS);
  assert.equal(result.completePropertySourceGraphVerified, false);
  for (const [before, after] of [
    ['common.yaml', 'common'], ['deploysystem-gateway', 'guessed-gateway.yaml'],
    ['ibiz_config_group', 'other-group'], ['refresh=true', 'refresh=false'],
    ['namespace=', 'namespace=other-tenant'],
  ]) assert.throws(() => inspectNativeHttpBootstrap(Buffer.from(bootstrap().toString().replace(before, after))));
  assert.throws(() => inspectNativeHttpBootstrap(Buffer.concat([bootstrap(),
    Buffer.from('\nspring.cloud.nacos.config.extension-configs[0].data-id=common.yaml')])));
});

test('structured YAML projection emits only bounded prefix/password mode candidates and never marks them effective', () => {
  const raw = Buffer.from(`spring:
  datasource:
    password: should-stay-private
ibiz:
  rest:
    basePath:
      api: /native/api/
  auth:
    passwordStorageMode: sm3
account:
  email: private@example.invalid
`);
  const projected = projectNativeConfiguration(raw);
  assert.deepEqual(projected.prefixCandidates, ['/native/api/']);
  assert.deepEqual(projected.passwordModeCandidates, ['sm3']);
  assert.equal(projected.effectiveConfigurationVerified, false);
  assert.equal(projected.completePropertySourceGraphVerified, false);
  assert.equal(projected.rawConfigurationRetained, false);
  assert.ok(!JSON.stringify(projected).includes('should-stay-private'));
  assert.ok(!JSON.stringify(projected).includes('private@example.invalid'));
  const unresolved = projectNativeConfiguration(Buffer.from(
    'ibiz.rest.basePath.api: "${UNRESOLVED_PREFIX}"\nibiz.auth.passwordStorageMode: unreviewed-secret-value\n'));
  assert.equal(unresolved.unresolvedPrefixPresent, true);
  assert.deepEqual(unresolved.passwordModeCandidates, ['unreviewed-mode']);
  assert.ok(!JSON.stringify(unresolved).includes('unreviewed-secret-value'));
  for (const text of [
    'ibiz: {rest: 1}\nibiz: {auth: 2}\n',
    'ibiz: &cycle {rest: *cycle}\n',
    'ibiz: [unclosed\n',
    'ibiz: !!python/object/apply:os.system ["unreviewed"]\n',
  ]) assert.throws(() => projectNativeConfiguration(Buffer.from(text)), /raw configuration withheld/);
});

test('the finite HTTP plan contains one normal login POST and four fixed GETs without native route guessing', () => {
  const plan = nativeActorHttpPlan(30250, 8848, inspectNativeHttpBootstrap(bootstrap()));
  assert.equal(plan.length, 5);
  assert.equal(plan.filter(entry => entry.method === 'POST').length, 1);
  assert.equal(plan.find(entry => entry.method === 'POST').label, 'normal-login');
  assert.equal(plan.filter(entry => entry.method === 'GET').length, 4);
  assert.ok(plan.every(entry => entry.nativeBusinessOperation === false));
  assert.equal(plan[1].url, 'http://127.0.0.1:8848/nacos/v1/cs/configs?dataId=deploysystem-gateway&group=ibiz_config_group');
  assert.ok(!plan.some(entry => /sys_people|sys_organizations|sys_organizational_roles/.test(entry.url)));
  assert.throws(() => nativeActorHttpPlan(30250, 8848, { configs: [{ dataId: 'guessed' }] }));
  assert.throws(() => nativeActorHttpPlan(0, 8848, inspectNativeHttpBootstrap(bootstrap())));
});

test('normal credential authentication and Bearer userinfo never add actor, organization, tenant or token query overrides', () => {
  const plan = nativeActorHttpPlan(30250, 8848, inspectNativeHttpBootstrap(bootstrap()));
  const login = nativeActorHttpRequest(plan[3], { username: 'configured-existing-user', password: 'private' });
  assert.deepEqual(JSON.parse(login.body), { loginname: 'configured-existing-user', password: 'private' });
  assert.deepEqual(login.headers, { accept: 'application/json', 'content-type': 'application/json' });
  assert.equal(login.redirect, 'error');
  const userinfo = nativeActorHttpRequest(plan[4], null, 'normal-returned-token');
  assert.deepEqual(userinfo.headers, { accept: 'application/json', authorization: 'Bearer normal-returned-token' });
  assert.equal(userinfo.body, undefined);
  assert.deepEqual(nativeActorHttpRequest(plan[0]).headers, { accept: 'application/json' });
  for (const token of ['', 'space token', 'token\nheader']) {
    assert.throws(() => nativeActorHttpRequest(plan[4], null, token));
  }
  assert.throws(() => nativeActorHttpRequest(plan[3],
    { status: 'NOT_CREATED', username: 'planned', password: 'private' }));
  assert.throws(() => nativeActorHttpRequest({ label: 'create-person', method: 'POST' }));
});

test('OIDC subject matching never promotes role declarations to native administrator or organization authority', () => {
  const result = assessNativeActorUserInfo({ sub: 'configured-existing-user',
    email: 'private@example.invalid', authorities: ['ROLE_SUPERADMIN'],
    organization_id: 'unverified', roles: [{ authority: 'ROLE_SUPERADMIN' }],
    member_of: [{ organizational_role_id: 'unverified' }] }, 'configured-existing-user');
  assert.equal(result.normalLoginSubjectMatched, true);
  for (const field of ['administratorAuthorityVerified', 'realmVerified', 'organizationVerified',
    'ordinaryOrganizationRoleVerified', 'nativePersonIdVerified',
    'userinfoRoleDeclarationsTreatedAsEffectiveAuthorities']) assert.equal(result[field], false);
  assert.ok(!JSON.stringify(result).includes('private@example.invalid'));
  assert.ok(!JSON.stringify(result).includes('ROLE_SUPERADMIN'));
  assert.throws(() => assessNativeActorUserInfo({ sub: 'other-user' }, 'configured-existing-user'));
});

test('current workspace ownership and complete identity are required for every already reviewed service', () => {
  const row = { Name: '/nacos', Id: 'a'.repeat(64), Image: `sha256:${'b'.repeat(64)}`,
    State: { Status: 'running', StartedAt: '2026-11-23T00:00:00Z' }, RestartCount: 0,
    Config: { Labels: { 'com.docker.compose.service': 'nacos',
      'com.docker.compose.project.working_dir': join(workspace, 'plm/deploy/compose'),
      'com.docker.compose.project.config_files': join(workspace, 'plm/deploy/compose/docker-compose-dev.yml') } },
    Mounts: [
      { Source: '/owned/a', Destination: '/a', RW: false, Type: 'bind' },
      { Source: '/owned/b', Destination: '/b', RW: true, Type: 'bind' },
    ],
    NetworkSettings: { Ports: { '8848/tcp': [
      { HostIp: '0.0.0.0', HostPort: '8848' }, { HostIp: '::', HostPort: '8848' },
    ] } } };
  const identity = nativeHttpRuntimeIdentity(row);
  const reordered = structuredClone(row);
  reordered.Mounts.reverse();
  reordered.NetworkSettings.Ports['8848/tcp'].reverse();
  const reorderedIdentity = nativeHttpRuntimeIdentity(reordered);
  assert.deepEqual(nativeHttpRuntimeComparable(reorderedIdentity), nativeHttpRuntimeComparable(identity));
  assert.notDeepEqual(reorderedIdentity.rawArrayHashes, identity.rawArrayHashes);
  for (const mutate of [
    value => { value.Mounts[0].Source = '/other/source'; },
    value => { value.Mounts[0].RW = true; },
    value => { value.Mounts.push({ ...value.Mounts[0] }); },
    value => { value.NetworkSettings.Ports['8848/tcp'][0].HostPort = '9999'; },
    value => { value.NetworkSettings.Ports['8848/tcp'][0].HostIp = '127.0.0.1'; },
    value => { value.NetworkSettings.Ports['8848/tcp'].push({ ...value.NetworkSettings.Ports['8848/tcp'][0] }); },
    value => { value.Config.Env = ['ORDER=first', 'ORDER=last']; },
  ]) {
    const altered = structuredClone(row);
    mutate(altered);
    assert.notDeepEqual(nativeHttpRuntimeComparable(nativeHttpRuntimeIdentity(altered)),
      nativeHttpRuntimeComparable(identity));
  }
  const withEnvironment = structuredClone(row);
  withEnvironment.Config.Env = ['ORDER=first', 'ORDER=last'];
  const reversedEnvironment = structuredClone(withEnvironment);
  reversedEnvironment.Config.Env.reverse();
  assert.notEqual(nativeHttpRuntimeIdentity(withEnvironment).configurationSha256,
    nativeHttpRuntimeIdentity(reversedEnvironment).configurationSha256);
  const changed = structuredClone(row);
  changed.RestartCount += 1;
  assert.notDeepEqual(nativeHttpRuntimeIdentity(changed), identity);
  changed.Config.Labels['com.docker.compose.project.working_dir'] = '/tmp/other-project';
  assert.throws(() => nativeHttpRuntimeIdentity(changed));
  assert.throws(() => nativeHttpRuntimeIdentity({ ...row, Id: row.Id.slice(0, 12) }));
  assert.throws(() => nativeHttpRuntimeIdentity({ ...row, Name: '/other-service' }));
});

test('route, credential, header and apply overrides and unsafe output are rejected before reading private credentials or HTTP', async () => {
  let commands = 0;
  let requests = 0;
  const execute = () => { commands += 1; throw Error('must not run'); };
  const request = () => { requests += 1; throw Error('must not run'); };
  for (const options of [
    { apply: true }, { headers: { srforgid: 'unverified' } }, { prefix: '/' },
    { credentialsPath: '/tmp/other-credentials' }, { username: 'other-user' },
    { output: '/tmp/native-actor-http-preflight-unowned' },
    { output: join(workspace, '.artifacts', 'unreviewed-output') },
  ]) await assert.rejects(probeExistingNativeActorHttpPreflight({ ...options, execute, request }));
  const output = join(workspace, '.artifacts', `native-actor-http-preflight-test-${randomBytes(8).toString('hex')}`);
  fs.symlinkSync('/tmp', output);
  try { await assert.rejects(probeExistingNativeActorHttpPreflight({ output, execute, request })); }
  finally { fs.unlinkSync(output); }
  assert.equal(commands, 0);
  assert.equal(requests, 0);
});
