#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const core = 'standalone-uaa/source/uaa-core/src/main/java/cn/ibizlab';
const user = 'standalone-uaa/source/uaa-user/src/main/java/cn/ibizlab';
const api = 'standalone-uaa/source/uaa-api/src/main/java/cn/ibizlab/api/rest';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const statuses = { status: 'NOT_CREATED', runtimeContractVerified: false, authenticationUsable: false };
const actorKinds = ['ordinary', 'readonly', 'nonmember'];
const ref = binding => ({ unresolvedBinding: binding });

export const NATIVE_ACTOR_SOURCE_PATHS = Object.freeze([
  `${api}/SysPersonResource.java`,
  `${api}/SysRoleMemberResource.java`,
  `${api}/SysMemberResource.java`,
  `${user}/api/rest/SysPersonResourceImpl.java`,
  `${user}/api/rest/SysRoleMemberResourceImpl.java`,
  `${user}/api/rest/SysMemberResourceImpl.java`,
  `${core}/api/rest/AbstractSysPersonResource.java`,
  `${core}/api/rest/AbstractSysRoleMemberResource.java`,
  `${core}/api/rest/AbstractSysMemberResource.java`,
  `${core}/api/dto/SysPersonDTO.java`,
  `${core}/api/dto/SysRoleMemberDTO.java`,
  `${core}/api/dto/SysMemberDTO.java`,
  `${core}/core/ad/domain/SysPerson.java`,
  `${user}/core/ad/service/impl/SysPersonServiceImpl.java`,
  `${core}/core/ad/service/impl/AbstractSysPersonService.java`,
  `${core}/core/ad/service/impl/AbstractSysMemberService.java`,
  `${user}/core/authentication/service/impl/AuthUserServiceImpl.java`,
  'plm/model/PSMODULES/Base/PSCODELISTS/product_role_type.json',
  'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/product_member.json',
  'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/product_member/PSDERS/DER1N_PRODUCT_MEMBER_USER_USER_ID.json',
  'plm/model/PSSYSSERVICEAPIS/ServiceAPI.json',
]);

function requireFragments(text, fragments, label) {
  for (const fragment of fragments) assert.ok(text.includes(fragment), `Reviewed ${label} source contract changed`);
}

export function inspectNativeActorSources(read = path => fs.readFileSync(join(workspace, path))) {
  const files = NATIVE_ACTOR_SOURCE_PATHS.map(path => ({ path, bytes: Buffer.from(read(path)) }));
  const text = suffix => {
    const matches = files.filter(file => file.path.endsWith(suffix));
    assert.equal(matches.length, 1, 'Source suffix must identify exactly one reviewed file');
    return matches[0].bytes.toString();
  };
  const contracts = [];
  for (const [name, collection] of [
    ['SysPerson', 'sys_people'], ['SysRoleMember', 'sys_role_members'], ['SysMember', 'sys_members'],
  ]) {
    const resource = text(`/Abstract${name}Resource.java`);
    const declaration = text(`/uaa-api/src/main/java/cn/ibizlab/api/rest/${name}Resource.java`);
    const implementation = text(`/uaa-user/src/main/java/cn/ibizlab/api/rest/${name}ResourceImpl.java`);
    requireFragments(declaration, ['@RestController(', '@RequestMapping({"${ibiz.rest.basePath.api:/}"})'],
      `${name} controller`);
    assert.doesNotMatch(implementation, /ResponseEntity<[^>]+>\s+(?:create|removeById|getById)\s*\(/,
      'A CRUD override requires a new native authorization review');
    const guard = operation => {
      const expression = `hasAnyAuthority('ROLE_SUPERADMIN','uaa-${name}-${operation}-all')`
        + ` or hasPermission(${operation === 'Create'
          ? `this.${name[0].toLowerCase()}${name.slice(1)}DtoMapping.toDomain(#dto)`
          : `this.${name[0].toLowerCase()}${name.slice(1)}Service.get(#id)`},'uaa-${name}-${operation}')`;
      requireFragments(resource, [`@PreAuthorize("${expression}")`], `${name} ${operation} guard`);
      return expression;
    };
    requireFragments(resource, [`@PostMapping({"${collection}", "${collection}"})`,
      `@GetMapping({"${collection}/{id}"})`, `@DeleteMapping({"${collection}/{id}"})`],
    `${name} native CRUD mapping`);
    const fields = [...text(`/api/dto/${name}DTO.java`).matchAll(/@JsonProperty\("([a-z0-9_]+)"\)/g)]
      .map(match => match[1]);
    for (const field of name === 'SysPerson'
      ? ['uid', 'display_name', 'user_password', 'dc', 'organization_id', 'organizational_role_id', 'status']
      : name === 'SysRoleMember' ? ['role_id', 'member_type', 'member_uid']
        : ['person_id', 'organizational_role_id', 'organization_id']) {
      assert.ok(fields.includes(field), 'A planned body field is absent from the maintained native DTO');
    }
    contracts.push({ entity: name, collection: `/${collection}`,
      controllerBasePath: '${ibiz.rest.basePath.api:/}', actualControllerPrefixVerified: false,
      create: { method: 'POST', guard: guard('Create') },
      get: { method: 'GET', path: `/${collection}/{issuedId}`, runtimeAuthorizationVerified: false },
      remove: { method: 'DELETE', guard: guard('Remove') }, dtoFields: [...new Set(fields)] });
  }
  const person = text('/core/ad/service/impl/SysPersonServiceImpl.java');
  requireFragments(person, [
    '@Value("${ibiz.auth.passwordStorageMode:none}")',
    '"sm3".equals(this.passwordStorageMode) && password.length() != 64',
    'et.setUserPassword(Sm3Util.encrypt(password));',
    'this.execute("delete from sys_person where enabled=0 and id = \'" + et.getId() + "\'", null);',
    'this.init(et);', '"ROLE_USERS".equalsIgnoreCase(item.getAuthority())',
    '.setMemberType("inetOrgPerson").setMemberUid(person.getId())',
    'et.getOrganizationalRoleId()', 'et.setMemberOf(Collections.singletonList(member));',
    'getMemberUid, et.getId()', 'getMemberType, "inetOrgPerson"',
  ], 'person password/default role/removal');
  const basePerson = text('/core/ad/service/impl/AbstractSysPersonService.java');
  requireFragments(basePerson, ['this.sysMemberService.saveByPerson(et, et.getMemberOf());',
    'this.sysMemberService.removeByPersonId(key);',
    'return this.remove(Wrappers.<SysPerson>lambdaQuery().eq(SysPerson::getId, et.getId()));'],
  'person organization member cleanup');
  const domain = text('/core/ad/domain/SysPerson.java');
  assert.match(domain, /@TableLogic\(\s*value = "1",\s*delval = "0"\s*\)/);
  requireFragments(text('/core/ad/service/impl/AbstractSysMemberService.java'),
    ['public boolean removeByPersonId(String personId)', 'public boolean saveByPerson(SysPerson sysPerson, List<SysMember> list)'],
    'member relation lifecycle');
  requireFragments(text('/core/authentication/service/impl/AuthUserServiceImpl.java'),
    ['conditions.eq(SysPerson::getUid, loginname);', 'conditions.eq(SysPerson::getDc, domains);'],
    'native login identity and realm lookup');
  const roleModel = JSON.parse(text('/PSCODELISTS/product_role_type.json'));
  assert.ok(roleModel.getPSCodeItems.some(item => item.value === 'user'));
  assert.ok(roleModel.getPSCodeItems.some(item => item.value === 'reader'));
  const memberModel = JSON.parse(text('/PSDATAENTITIES/product_member.json'));
  assert.equal(memberModel.tableName, 'PRODUCT_MEMBER');
  const relation = JSON.parse(text('/PSDERS/DER1N_PRODUCT_MEMBER_USER_USER_ID.json'));
  assert.equal(relation.getMajorPSDataEntity.path, 'PSMODULES/Base/PSDATAENTITIES/user.json');
  const service = JSON.parse(text('/PSSYSSERVICEAPIS/ServiceAPI.json'))
    .getPSDEServiceAPIs.filter(item => item.getPSDataEntity?.path === 'PSMODULES/ProdMgmt/PSDATAENTITIES/product_member.json');
  assert.equal(service.length, 1);
  assert.equal(service[0].codeName2, 'product_members');
  for (const [name, method, access] of [['Create', 'POST', 'CREATE'], ['Remove', 'DELETE', 'DELETE']]) {
    const native = service[0].getPSDEServiceAPIMethods.find(item => item.name === name);
    assert.equal(native.requestMethod, method);
    assert.equal(native.dataAccessAction, access);
  }
  return {
    facts: {
      contract: 'native-actor-maintained-source-contract-v1',
      sourceProvenance: 'maintained-or-reconstructed-UAA-source-not-proven-original-running-image-source',
      runtimeContractVerified: false, uaaCollections: contracts,
      password: { configurationKey: 'ibiz.auth.passwordStorageMode',
        sourceDefault: 'none', supportedObservedBranch: 'sm3', nativeHashesNon64CharacterInputInSm3Mode: true,
        currentRuntimeModeVerified: false, generatorAlwaysSuppliesStrongRandomPassword: true },
      automaticBaseRole: { authority: 'ROLE_USERS', assignedByPersonCreate: true,
        manualDuplicateAssignmentPlanned: false, actualRuntimeAssignmentVerified: false },
      organizationMembership: { automaticWhenOrganizationalRoleProvided: true,
        separateBlindMemberCreatePlanned: false, currentOrganizationOrRoleVerified: false },
      deletion: { person: 'native-logical-ENABLED-0',
        directRoleRelations: 'native-remove-inetOrgPerson-memberships-before-person-remove',
        organizationMemberRelations: 'native-removeByPersonId-before-person-remove',
        repeatedUidCreateCanDeleteOldDisabledRow: true, physicalErasureClaimed: false },
      objectRoles: { ordinary: 'user', readonly: 'reader', nonmember: null,
        collection: '/product_members', userForeignKeyEntity: relation.getMajorPSDataEntity.path,
        uaaPersonIdEqualsPlmUserIdAssumed: false, runtimeMembershipAuthorizationVerified: false },
    },
    bindings: files.map(({ path, bytes }) => ({ path, bytes: bytes.length, sha256: sha(bytes) })),
    files,
  };
}

export function validateNativeActorBindingHints(input = {}) {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input));
  const allowed = ['realmId', 'organizationId', 'organizationRoleId', 'ownedProductId'];
  assert.ok(Object.keys(input).every(key => allowed.includes(key)),
    'Only unresolved realm/organization/product hints are accepted');
  const result = Object.fromEntries(allowed.map(key => [key, null]));
  for (const [key, value] of Object.entries(input)) {
    assert.ok(typeof value === 'string' && value.length > 0 && value.length <= 100
      && !/[\u0000-\u001f\u007f]/.test(value), 'A binding hint must be a bounded nonblank native identifier');
    assert.ok(!['ROLE_APIUSERS', 'ROLE_SUPERADMIN'].includes(value),
      'Privileged role values are not actor binding hints');
    result[key] = value;
  }
  return { hints: result, hintsAreAuthorization: false, verified: false };
}

export function buildNativeActorCandidate({ runId, source, hints = {} }) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.equal(source.runtimeContractVerified, false);
  const bindingHints = validateNativeActorBindingHints(hints);
  const actors = actorKinds.map(kind => ({
    actorKey: kind, ...statuses, plannedUid: `nat_${runId}_${kind}`,
    plannedDisplayName: `Native acceptance ${runId} ${kind}`,
    issuedPersonId: null, issuedPlmUserId: null,
    intendedRole: kind === 'readonly' ? 'read-only-member-of-owned-product'
      : kind === 'nonmember' ? 'organization-user-without-owned-product-membership'
        : 'ordinary-member-of-owned-product',
  }));
  const requests = actors.map(actor => ({
    actorKey: actor.actorKey, ...statuses, executable: false,
    personCreate: { method: 'POST', collection: '/sys_people',
      authorityBaseUrl: ref('currentUaaAuthorityVerifiedByRuntimeContract'),
      body: { uid: actor.plannedUid, display_name: actor.plannedDisplayName,
        user_password: { plannedSecretReference: `entries.${actor.actorKey}.candidatePassword` },
        dc: ref('verifiedRealmId'), organization_id: ref('verifiedOrganizationId'),
        organizational_role_id: ref('verifiedOrdinaryOrganizationRoleId'), status: '1' } },
    baseRole: { createRequest: null, expectedNativeCreateAuthority: 'ROLE_USERS',
      mustReadBackEveryEffectiveAuthority: true, rejectAuthorities: ['ROLE_SUPERADMIN', 'ROLE_APIUSERS'] },
    organizationMember: { createRequest: null, sourceAutomaticallyDerivesItFromOrganizationalRole: true,
      readBackIssuedMemberIds: true },
    objectMember: actor.actorKey === 'nonmember' ? {
      createRequest: null, expectedOwnedProductMemberCount: 0,
    } : {
      runtimeAuthorizationVerified: false, executable: false, method: 'POST', collection: '/product_members',
      applicationApiBasePath: ref('currentVerifiedPlmUserApiBasePath'),
      body: { product_id: ref('verifiedProductCreatedAndOwnedByThisRun'),
        user_id: ref(`actor.${actor.actorKey}.verifiedPlmUserIdFromNormalAppdataAndNativeUserLookup`),
        role_id: actor.actorKey === 'readonly' ? 'reader' : 'user' },
    },
  }));
  return {
    contract: 'existing-native-actors-prepare-only-v1', ...statuses, runId,
    operationMode: 'PREPARE_ONLY', allRequestsExecutable: false,
    administratorActor: { credentialCopied: false, identity: null, roleAssertionsAreAuthorization: false,
      currentNativeCreateAndDeleteGuardsMustBeProven: true },
    sourceContract: source, bindingHints, actors, requestTemplates: requests,
    crossOrganization: { status: 'BLOCKED-NO-VERIFIED-OWN-ORGANIZATION-CONTRACT',
      organizationIdGuessed: false, accountPrepared: false,
      requirement: 'Review actual runtime organization Create/Get/Remove and owned realm before preparing a fourth identity' },
    preflight: [
      'Verify current UAA container/image/mount/datasource/realm identity and retain an immutable runtime witness',
      'Prove current Swagger or served class annotations/DTO fields match this maintained-source contract; source hashes alone are insufficient',
      'Normally authenticate the authorized administrator and prove exact native GET and create/delete method authorization without forging identity headers',
      'Resolve actual controller base path and same authentication authority; do not infer the configured native prefix from source defaults',
      'Read back the real organization, ordinary organizational role, realm and unprivileged effective role set; hints are never grants',
      'Verify generated UIDs do not exist across any realm, including disabled/tombstoned persons, before native Create can delete an old disabled ID',
      'Verify password storage mode and transport policy from current runtime without printing or exporting credentials',
      'Bind an existing run-owned product created by this acceptance run; resolve every PLM user foreign key from normal login/appdata plus native user lookup',
    ],
    applyProtocol: [
      'Use a new exclusive private evidence directory; bind the reviewed candidate/source/runtime hashes and fsync an intent before each native write',
      'Resolve all typed bindings and secret references only after runtime and authorization preflight passes; never pass unresolved template objects to HTTP',
      'POST one person through the actual native admin endpoint, save the complete response and exact issued ID privately, then independently GET and compare UID/realm/org',
      'On HTTP failure, timeout or response loss, read back the exact generated UID and issued identity before deciding that no write occurred',
      'Read back automatic ROLE_USERS and organization memberships; do not duplicate them or grant ROLE_APIUSERS/ROLE_SUPERADMIN',
      'Normally log in each newly created person, compare server-issued user/realm/org/system, then record a separate created-and-authenticated receipt',
      'Only then export a separate CREATED credential format for an existing browser helper; this NOT_CREATED bundle must remain unusable for login',
      'Create only the ordinary/reader memberships on the run-owned product through its legitimate native API, and read back membership plus nonmember absence',
    ],
    recoveryProtocol: [
      'Journal every issued person, role-member, org-member and object-member ID with full native snapshots and the exact generated UID',
      'Before cleanup prove the issued row still matches this run and has not been changed or adopted by another actor',
      'Remove only run-owned object memberships and dependent acceptance data through their native APIs, then verify absence',
      'Read back native role/org dependencies; remove only proven run-owned associations if needed, and let normal Person.Remove handle its documented dependencies',
      'DELETE the exact issued person through the authorized native endpoint; do not use SQL deletes or automatically recreate a tombstone',
      'Independently verify active-person absence, effective role/org/object dependency absence, rejected new login, and retained ENABLED=0 tombstone as appropriate',
      'Report incomplete cleanup or unknown persistence; never erase newer shared data or claim physical deletion from a logical-delete response',
    ],
    effectsExecuted: { httpRequests: 0, usersCreated: 0, rolesGranted: 0,
      organizationMembersCreated: 0, productMembersCreated: 0, sharedClientsChanged: 0 },
  };
}

export function assertNotCreatedCredentialBundle(value) {
  assert.equal(value.contract, 'native-actors-planned-secrets-v1');
  assert.equal(value.status, 'NOT_CREATED');
  assert.equal(value.authenticationUsable, false);
  assert.equal(value.runtimeContractVerified, false);
  assert.deepEqual(Object.keys(value.entries).sort(), [...actorKinds].sort());
  assert.ok(!Object.hasOwn(value, 'username') && !Object.hasOwn(value, 'password')
    && !Object.hasOwn(value, 'users'), 'Planned secrets must not resemble an existing login-helper input');
  for (const [kind, entry] of Object.entries(value.entries)) {
    assert.equal(entry.actorKey, kind);
    assert.equal(entry.status, 'NOT_CREATED');
    assert.equal(entry.issuedPersonId, null);
    assert.ok(typeof entry.candidatePassword === 'string' && entry.candidatePassword.length === 36
      && entry.candidatePassword.length !== 64);
  }
  return true;
}

export function prepareExistingNativeActors(options = {}) {
  assert.ok(Object.keys(options).every(key => ['root', 'output', 'runId', 'bindingHints'].includes(key)),
    'This generator has no apply, request adapter, runtime verification, role or existing-user override');
  const root = resolve(options.root ?? workspace);
  const runId = options.runId ?? randomBytes(6).toString('hex');
  assert.match(runId, /^[a-f0-9]{12}$/);
  const artifactRoot = join(root, '.artifacts');
  assert.equal(fs.realpathSync(artifactRoot), artifactRoot, 'The artifact root must not be a symbolic link');
  const output = resolve(options.output ?? join(artifactRoot, `native-actors-prepare-${runId}`));
  assert.equal(dirname(output), artifactRoot);
  assert.match(relative(artifactRoot, output), /^native-actors-prepare-[a-z0-9][a-z0-9-]{0,70}$/);
  try { fs.lstatSync(output); assert.fail('An existing output cannot be adopted'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = inspectNativeActorSources(path => fs.readFileSync(join(root, path)));
  const implementation = ['scripts/prepare-existing-native-actors.mjs',
    'scripts/tests/prepare-existing-native-actors.test.mjs']
    .map(path => ({ path, bytes: fs.readFileSync(join(root, path)) }));
  const candidate = buildNativeActorCandidate({ runId, source: source.facts, hints: options.bindingHints });
  const secrets = { contract: 'native-actors-planned-secrets-v1', ...statuses, runId,
    entries: Object.fromEntries(candidate.actors.map(actor => [actor.actorKey, {
      actorKey: actor.actorKey, status: 'NOT_CREATED', plannedUid: actor.plannedUid,
      candidatePassword: `A!${randomBytes(24).toString('base64url')}z9`, issuedPersonId: null,
    }])) };
  assertNotCreatedCredentialBundle(secrets);
  fs.mkdirSync(output, { mode: 0o700 });
  const sync = directory => {
    const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  };
  const write = (path, bytes) => {
    const target = join(output, path);
    fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const descriptor = fs.openSync(target,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    sync(dirname(target));
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  };
  sync(artifactRoot);
  const snapshots = [...source.files, ...implementation].map(file => write(`source/${file.path}`, file.bytes));
  const bindings = [
    write('candidate.private.json', Buffer.from(json(candidate))),
    write('credentials.planned.private.json', Buffer.from(json(secrets))),
    write('source-manifest.private.json', Buffer.from(json({
      contract: 'native-actor-maintained-source-snapshot-v1', runtimeContractVerified: false,
      files: snapshots,
    }))),
  ];
  const receipt = { contract: 'native-actor-prepare-receipt-v1', ...statuses, runId,
    preparedAt: new Date().toISOString(), sourceProvenance: source.facts.sourceProvenance,
    candidateActors: candidate.actors.length, bindings, sourceBindings: source.bindings,
    implementationBindings: implementation.map(file =>
      ({ path: file.path, bytes: file.bytes.length, sha256: sha(file.bytes) })),
    remainingBlockers: ['current-runtime-contract-and-admin-authorization',
      'real-realm-org-and-ordinary-organizational-role',
      'uid-collision-and-tombstone-preflight', 'native-create-login-and-membership-readback'],
    effectsExecuted: candidate.effectsExecuted };
  write('report.private.json', Buffer.from(json(receipt)));
  sync(output);
  sync(artifactRoot);
  return { output, receipt, candidate };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' }, 'run-id': { type: 'string' } } });
  const result = prepareExistingNativeActors({
    ...(values.output ? { output: values.output } : {}), ...(values['run-id'] ? { runId: values['run-id'] } : {}),
  });
  console.log(JSON.stringify({ output: result.output, status: result.receipt.status,
    runtimeContractVerified: false, authenticationUsable: false,
    candidateActors: result.receipt.candidateActors, httpRequests: 0, usersCreated: 0 }, null, 2));
}
