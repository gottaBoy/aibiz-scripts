import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  NATIVE_ACTOR_CLASSES, assessNativeActorClassContract, nativeActorProcessIdentity,
  nativeActorRuntimeIdentity, parseNativeActorJarInventory, parseNativeActorJavap,
  probeExistingNativeActorContract,
} from '../probe-existing-native-actor-contract.mjs';
import { inspectNativeActorSources } from '../prepare-existing-native-actors.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = inspectNativeActorSources();
const fullId = 'a'.repeat(64);
const classpath = '/opt/uaa/third-party/*:/opt/uaa/starters/*:/opt/uaa/packages/*';
const descriptor = 'Lcn/ibizlab/core/ad/domain/SysPerson;';
const personService = 'cn.ibizlab.core.ad.service.impl.SysPersonServiceImpl';
const pre = 'org.springframework.security.access.prepost.PreAuthorize';
const post = 'org.springframework.security.access.prepost.PostAuthorize';
const web = 'org.springframework.web.bind.annotation.';

function runtime() {
  const compose = join(workspace, 'plm/deploy/compose');
  return { Name: '/ibizlab-uaa-api', Id: fullId, Image: `sha256:${'b'.repeat(64)}`,
    State: { Status: 'running', StartedAt: '2026-11-23T00:00:00Z' }, RestartCount: 0,
    Config: { WorkingDir: '/opt/uaa', Env: ['PRIVATE_EXAMPLE=withheld'],
      Labels: { 'com.docker.compose.service': 'ibizlab-uaa-api',
        'com.docker.compose.project.working_dir': compose,
        'com.docker.compose.project.config_files': `${compose}/docker-compose-dev.yml`,
        'com.docker.compose.project': 'compose' } },
    Mounts: [], HostConfig: {} };
}

function inventory(extra = '') {
  const jars = ['/opt/uaa/packages/uaa-api-reconstructed.jar',
    '/opt/uaa/packages/uaa-core-reconstructed.jar', '/opt/uaa/packages/uaa-user-reconstructed.jar'];
  return jars.map(path => `JAR\t${'c'.repeat(64)}  ${path}\n`).join('')
    + NATIVE_ACTOR_CLASSES.map(name =>
      `CLASS\t${jars[0]}\t${name.replaceAll('.', '/')}.class\n`).join('') + extra;
}

function member(name, memberDescriptor, text = '', values = []) {
  return { name, descriptor: memberDescriptor, text, annotations: new Map(values) };
}

function views() {
  const result = new Map(NATIVE_ACTOR_CLASSES.map(name => [name,
    { name, superclass: 'java.lang.Object', members: [], annotations: new Map(), bootstrapMethods: new Map() }]));
  const get = name => result.get(name);
  for (const contract of source.facts.uaaCollections) {
    const { entity } = contract;
    const controller = get(`cn.ibizlab.api.rest.${entity}Resource`);
    const implementation = get(`cn.ibizlab.api.rest.${entity}ResourceImpl`);
    const base = get(`cn.ibizlab.api.rest.Abstract${entity}Resource`);
    controller.superclass = implementation.name;
    implementation.superclass = base.name;
    controller.annotations.set(`${web}RequestMapping`, { value: ['${ibiz.rest.basePath.api:/}'] });
    controller.annotations.set(`${web}RestController`, { value: `api-${entity.toLowerCase()}` });
    const response = 'Lorg/springframework/http/ResponseEntity;';
    const path = contract.collection.slice(1);
    base.members.push(member('create', `(Lcn/ibizlab/api/dto/${entity}DTO;)${response}`, '', [
      [`${web}PostMapping`, { value: [path, path] }], [pre, { value: contract.create.guard }],
    ]), member('removeById', `(Ljava/lang/String;)${response}`, '', [
      [`${web}DeleteMapping`, { value: [`${path}/{id}`] }], [pre, { value: contract.remove.guard }],
    ]));
    const read = member('getById', `(Ljava/lang/String;)${response}`, '',
      [[`${web}GetMapping`, { value: [`${path}/{id}`] }]]);
    if (entity !== 'SysRoleMember') read.annotations.set(post, {
      value: `hasAnyAuthority('ROLE_SUPERADMIN','uaa-${entity}-Get-all') or `
        + `hasPermission(this.${entity[0].toLowerCase()}${entity.slice(1)}DtoMapping.toDomain(returnObject.body),'uaa-${entity}-Get')`,
    });
    base.members.push(read);
    get(`cn.ibizlab.api.dto.${entity}DTO`).members = contract.dtoFields.map(field =>
      member(field, 'Ljava/lang/String;', '', [['com.fasterxml.jackson.annotation.JsonProperty', { value: field }]]));
  }
  const service = get(personService);
  service.superclass = 'cn.ibizlab.core.ad.service.impl.AbstractSysPersonService';
  service.members.push(member('create', `(${descriptor})Z`, [
    'SysPerson.getUserPassword:', 'SysPerson.getUid:', 'SysPerson.getDc:', 'SysPerson.getDefaultKey:',
    'Field defaultPassword:', 'Field passwordStorageMode:', 'String sm3', 'java/lang/String.equals:',
    'java/lang/String.length:', 'bipush        64', 'if_icmpeq',
    'cn/ibizlab/util/web/Sm3Util.encrypt:', 'SysPerson.setUserPassword:',
    "String delete from sys_person where enabled=0 and id = '",
    'SysPerson.getOrganizationalRoleId:', 'SysPerson.setMemberOf:',
    'java/util/Collections.singletonList:', 'Method execute:',
    'AbstractSysPersonService.create:', 'Method init:',
  ].join('\n')));
  service.members.push(member('init', `(${descriptor})${descriptor}`, [
    'SysRoleService.all:', 'java/util/stream/Stream.filter:', 'SysRoleMemberService.count:',
    'String inetOrgPerson', 'SysRoleMember.setMemberUid:', 'SysPerson.getId:', 'SysRoleMemberService.create:',
    '// InvokeDynamic #0:test',
  ].join('\n')));
  service.members.push(member('lambda$init$0', '(Lcn/ibizlab/core/authorization/domain/SysRole;)Z',
    'String ROLE_USERS\nSysRole.getAuthority:\njava/lang/String.equalsIgnoreCase:'));
  service.members.push(member('remove', `(${descriptor})Z`,
    'SysPerson.getId:\nString inetOrgPerson\nSysRoleMemberService.remove:\nAbstractSysPersonService.remove:'));
  service.members.push(member('passwordStorageMode', 'Ljava/lang/String;', '',
    [['org.springframework.beans.factory.annotation.Value', { value: '${ibiz.auth.passwordStorageMode:none}' }]]));
  service.bootstrapMethods.set(0, 'REF_invokeStatic cn/ibizlab/core/ad/service/impl/SysPersonServiceImpl.lambda$init$0:');
  const base = get('cn.ibizlab.core.ad.service.impl.AbstractSysPersonService');
  base.members.push(member('create', `(${descriptor})Z`, 'SysMemberService.saveByPerson:'));
  base.members.push(member('remove', `(${descriptor})Z`, 'SysMemberService.removeByPersonId:\nMethod remove:'));
  get('cn.ibizlab.core.ad.domain.SysPerson').members.push(member('enabled', 'Ljava/lang/Integer;', '',
    [['com.baomidou.mybatisplus.annotation.TableLogic', { value: '1', delval: '0' }]]));
  get('cn.ibizlab.core.ad.service.impl.AbstractSysMemberService').members.push(
    member('removeByPersonId', '(Ljava/lang/String;)Z'),
    member('saveByPerson', `(${descriptor}Ljava/util/List;)Z`));
  const loader = get('cn.ibizlab.core.authentication.service.impl.AuthUserServiceImpl');
  loader.members.push(member('loadUserByUsername',
    '(Ljava/lang/String;)Lcn/ibizlab/core/authentication/domain/AuthUserImpl;',
    '// InvokeDynamic #0:test\n// InvokeDynamic #1:test'));
  loader.bootstrapMethods.set(0, 'REF_invokeVirtual cn/ibizlab/core/ad/domain/SysPerson.getUid:');
  loader.bootstrapMethods.set(1, 'REF_invokeVirtual cn/ibizlab/core/ad/domain/SysPerson.getDc:');
  get('cn.ibizlab.core.ad.filter.SysPersonSearchContext').members.push(...['n_uid_eq', 'n_dc_eq']
    .map(property => member(property, 'Ljava/lang/String;', '',
      [['com.fasterxml.jackson.annotation.JsonProperty', { value: property }]])));
  get('cn.ibizlab.config.BootSecurityConfig').annotations.set(
    'org.springframework.security.config.annotation.method.configuration.EnableGlobalMethodSecurity',
    { prePostEnabled: true });
  return result;
}

test('only the complete current workspace-owned UAA identity and actual process shape are accepted', () => {
  const snapshot = runtime();
  const identity = nativeActorRuntimeIdentity(snapshot);
  assert.equal(identity.containerId, fullId);
  assert.ok(!JSON.stringify(identity).includes('PRIVATE_EXAMPLE'));
  for (const mutate of [
    row => { row.Id = row.Id.slice(0, 12); },
    row => { row.State.Status = 'stopped'; },
    row => { row.Config.Labels['com.docker.compose.service'] = 'other-service'; },
    row => { row.Config.Labels['com.docker.compose.project.working_dir'] = '/tmp/other'; },
    row => { row.Mounts = [{ Destination: '/opt/uaa' }]; },
  ]) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.throws(() => nativeActorRuntimeIdentity(changed));
  }
  const command = ['java', '-Dcom.sun.xml.bind.v2.bytecode.ClassTailor.noOptimize=true',
    '-cp', classpath, 'cn.ibizlab.BootApplication'].join('\0') + '\0';
  assert.equal(nativeActorProcessIdentity(Buffer.from(command)).templateCommandUsedAsRuntimeEvidence, false);
  assert.throws(() => nativeActorProcessIdentity(Buffer.from('java\0-jar\0/uaa-api.jar\0')));
  const changed = structuredClone(snapshot);
  changed.RestartCount += 1;
  assert.notDeepEqual(nativeActorRuntimeIdentity(changed), identity);
});

test('every reviewed class has one exact origin across the actual classpath and duplicate classes fail closed', () => {
  const value = parseNativeActorJarInventory(inventory());
  assert.equal(value.classes.length, NATIVE_ACTOR_CLASSES.length);
  assert.equal(value.jars.length, 3);
  assert.throws(() => parseNativeActorJarInventory(inventory().replace(
    `CLASS\t/opt/uaa/packages/uaa-api-reconstructed.jar\t${value.classes[0].entry}\n`, '')), /Missing or ambiguous/);
  assert.throws(() => parseNativeActorJarInventory(inventory(
    `CLASS\t/opt/uaa/packages/uaa-core-reconstructed.jar\t${value.classes[0].entry}\n`)), /Missing or ambiguous/);
  assert.throws(() => parseNativeActorJarInventory(inventory().replace('/opt/uaa/packages/', '/tmp/other/')));
});

test('javap parsing binds exact origin, descriptors and annotations to their member rather than the constant pool', () => {
  const name = 'cn.ibizlab.api.rest.TestResource';
  const text = `Classfile jar:file:///opt/uaa/packages/test.jar!/cn/ibizlab/api/rest/TestResource.class
  SHA-256 checksum ${'d'.repeat(64)}
public class ${name} extends java.lang.Object
Constant pool:
  #1 = Utf8 annotation-that-must-not-be-accepted
{
  public java.lang.String create(java.lang.String);
    descriptor: (Ljava/lang/String;)Ljava/lang/String;
    flags: (0x0001) ACC_PUBLIC
    RuntimeVisibleAnnotations:
      0: #1(#2=s#3)
        ${pre}(
          value="reviewed-\\'create\\'"
        )

  public java.lang.String getById(java.lang.String);
    descriptor: (Ljava/lang/String;)Ljava/lang/String;
    flags: (0x0001) ACC_PUBLIC
}
SourceFile: "TestResource.java"
RuntimeVisibleAnnotations:
  0: #1(#2=Z#3)
    test.Configuration(
      enabled=true
    )
`;
  const view = parseNativeActorJavap(text, name);
  assert.equal(view.origin.sha256, 'd'.repeat(64));
  assert.equal(view.members.length, 2);
  assert.equal(view.members[0].annotations.get(pre).value, "reviewed-'create'");
  assert.equal(view.members[1].annotations.has(pre), false);
  assert.equal(view.annotations.get('test.Configuration').enabled, true);
  assert.equal(parseNativeActorJavap(text.replace(' extends java.lang.Object', ''), name).superclass,
    'java.lang.Object');
  assert.throws(() => parseNativeActorJavap(text.replace(`public class ${name}`, 'public class other.Name'), name));
  assert.throws(() => parseNativeActorJavap(text.replace('SHA-256 checksum', 'unbound-checksum'), name));
  assert.throws(() => parseNativeActorJavap(text.slice(0, text.indexOf('\n}')), name));
});

test('matching reviewed class subset never promotes original-source provenance, authorization or prepared actors', () => {
  const result = assessNativeActorClassContract(views(), source.facts);
  assert.equal(result.runtimeClassContractVerified, true);
  assert.equal(result.runtimeContractVerified, false);
  assert.equal(result.actualAuthorizationTested, false);
  assert.equal(result.sourceAuthenticityOrFullEquivalenceProven, false);
  assert.equal(result.basePathEffectiveValueVerified, false);
  assert.equal(result.passwordModeEffectiveValueVerified, false);
  assert.equal(result.entities.find(entity => entity.entity === 'SysRoleMember').localGetGuard,
    'no-local-method-guard-observed');
});

test('missing guards, DTO properties, CRUD overrides, password branches and cleanup dependencies fail closed', () => {
  for (const mutate of [
    value => { value.get('cn.ibizlab.api.rest.AbstractSysPersonResource').members[0].annotations.delete(pre); },
    value => { value.get('cn.ibizlab.api.rest.AbstractSysPersonResource').members[2].annotations.delete(post); },
    value => { value.get('cn.ibizlab.api.dto.SysPersonDTO').members.pop(); },
    value => { value.get('cn.ibizlab.api.rest.SysPersonResourceImpl').members.push(member('create', '()V')); },
    value => { value.get(personService).members[0].text = value.get(personService).members[0].text.replace('bipush        64', 'bipush        32'); },
    value => { value.get(personService).members[0].text = value.get(personService).members[0].text.replace('Method init:', 'Method unrelated:'); },
    value => { value.get(personService).members[2].text = value.get(personService).members[2].text.replace('ROLE_USERS', 'ROLE_SUPERADMIN'); },
    value => { value.get(personService).bootstrapMethods.clear(); },
    value => { value.get('cn.ibizlab.core.authentication.service.impl.AuthUserServiceImpl').bootstrapMethods.delete(1); },
    value => { value.get('cn.ibizlab.core.ad.service.impl.AbstractSysPersonService').members[1].text = 'Method remove:\nSysMemberService.removeByPersonId:'; },
    value => { value.get('cn.ibizlab.core.ad.domain.SysPerson').members[0].annotations.get('com.baomidou.mybatisplus.annotation.TableLogic').delval = '1'; },
    value => { value.get('cn.ibizlab.config.BootSecurityConfig').annotations.clear(); },
  ]) {
    const altered = views();
    mutate(altered);
    assert.throws(() => assessNativeActorClassContract(altered, source.facts));
  }
});

test('apply, HTTP, credential and unsafe output options are refused before any command or output', () => {
  let calls = 0;
  const execute = () => { calls += 1; throw Error('must not run'); };
  for (const options of [
    { apply: true }, { request() {} }, { username: 'shared-client' }, { role: 'ROLE_SUPERADMIN' },
    { output: '/tmp/native-actor-contract-unowned' },
    { output: join(workspace, '.artifacts', 'unreviewed-prefix') },
  ]) assert.throws(() => probeExistingNativeActorContract({ ...options, execute }));
  assert.equal(calls, 0);
  const output = join(workspace, '.artifacts', `native-actor-contract-test-${randomBytes(8).toString('hex')}`);
  fs.symlinkSync('/tmp', output);
  try { assert.throws(() => probeExistingNativeActorContract({ output, execute })); }
  finally { fs.unlinkSync(output); }
  assert.equal(calls, 0);
});

test('ownership failure stops before class execution, account activity or candidate writes', () => {
  const output = join(workspace, '.artifacts', `native-actor-contract-test-${randomBytes(8).toString('hex')}`);
  const row = runtime();
  row.Config.Labels['com.docker.compose.project.working_dir'] = '/tmp/other-project';
  const commands = [];
  assert.throws(() => probeExistingNativeActorContract({ output, execute(program, args) {
    commands.push({ program, args });
    return { status: 0, stdout: Buffer.from(JSON.stringify([row])) };
  } }));
  assert.deepEqual(commands, [{ program: 'docker', args: ['inspect', 'ibizlab-uaa-api'] }]);
  assert.equal(fs.existsSync(output), false);
});
