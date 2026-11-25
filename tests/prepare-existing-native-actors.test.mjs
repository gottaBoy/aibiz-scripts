import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  NATIVE_ACTOR_SOURCE_PATHS, assertNotCreatedCredentialBundle, buildNativeActorCandidate,
  inspectNativeActorSources, prepareExistingNativeActors, validateNativeActorBindingHints,
} from '../prepare-existing-native-actors.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const original = new Map(NATIVE_ACTOR_SOURCE_PATHS.map(path => [path, fs.readFileSync(join(workspace, path))]));
const source = inspectNativeActorSources(path => original.get(path));
const runId = 'a1b2c3d4e5f6';
const hash = value => createHash('sha256').update(value).digest('hex');

test('maintained source binds native controller guards, DTO fields and automatic role/member cleanup without runtime claims', () => {
  assert.equal(source.files.length, 21);
  assert.equal(source.facts.runtimeContractVerified, false);
  assert.match(source.facts.sourceProvenance, /not-proven-original-running-image-source/);
  for (const contract of source.facts.uaaCollections) {
    assert.match(contract.create.guard, /ROLE_SUPERADMIN/);
    assert.match(contract.create.guard, /hasPermission/);
    assert.match(contract.remove.guard, /Remove/);
    assert.equal(contract.actualControllerPrefixVerified, false);
    assert.equal(contract.get.runtimeAuthorizationVerified, false);
  }
  assert.equal(source.facts.automaticBaseRole.authority, 'ROLE_USERS');
  assert.equal(source.facts.automaticBaseRole.manualDuplicateAssignmentPlanned, false);
  assert.equal(source.facts.organizationMembership.separateBlindMemberCreatePlanned, false);
  assert.equal(source.facts.deletion.person, 'native-logical-ENABLED-0');
  assert.equal(source.facts.deletion.repeatedUidCreateCanDeleteOldDisabledRow, true);
  assert.equal(source.facts.objectRoles.uaaPersonIdEqualsPlmUserIdAssumed, false);
});

test('changed runtime-relevant source mappings, guards and DTO fields require a new contract review', () => {
  for (const [suffix, before, after] of [
    ['AbstractSysPersonResource.java', "'uaa-SysPerson-Create-all'", "'weakened-permission'"],
    ['SysPersonDTO.java', '@JsonProperty("user_password")', '@JsonProperty("other_password")'],
    ['SysPersonResourceImpl.java', 'extends AbstractSysPersonResource {',
      'extends AbstractSysPersonResource { public ResponseEntity<SysPersonDTO> create('],
    ['SysPersonServiceImpl.java', 'this.init(et);', ''],
    ['SysPersonServiceImpl.java', 'password.length() != 64', 'password.length() != 48'],
    ['product_role_type.json', '"value" : "reader"', '"value" : "guessed-viewer"'],
  ]) {
    let changed = false;
    assert.throws(() => inspectNativeActorSources(path => {
      const bytes = original.get(path);
      if (!path.endsWith(`/${suffix}`)) return bytes;
      const text = bytes.toString();
      assert.ok(text.includes(before));
      changed = true;
      return Buffer.from(text.replace(before, after));
    }));
    assert.equal(changed, true);
  }
});

test('three generated actors remain uncreated and every request stays typed and unresolved', () => {
  const candidate = buildNativeActorCandidate({ runId, source: source.facts });
  assert.equal(candidate.status, 'NOT_CREATED');
  assert.equal(candidate.runtimeContractVerified, false);
  assert.equal(candidate.authenticationUsable, false);
  assert.equal(candidate.allRequestsExecutable, false);
  assert.deepEqual(candidate.actors.map(actor => actor.actorKey), ['ordinary', 'readonly', 'nonmember']);
  assert.equal(new Set(candidate.actors.map(actor => actor.plannedUid)).size, 3);
  for (const actor of candidate.actors) {
    assert.match(actor.plannedUid, new RegExp(`^nat_${runId}_[a-z]+$`));
    assert.equal(actor.issuedPersonId, null);
    assert.equal(actor.issuedPlmUserId, null);
  }
  for (const request of candidate.requestTemplates) {
    assert.equal(request.status, 'NOT_CREATED');
    assert.equal(request.executable, false);
    assert.equal(request.personCreate.body.dc.unresolvedBinding, 'verifiedRealmId');
    assert.ok(request.personCreate.body.user_password.plannedSecretReference);
    assert.equal(request.baseRole.createRequest, null);
    assert.equal(request.organizationMember.createRequest, null);
  }
  const readonly = candidate.requestTemplates.find(actor => actor.actorKey === 'readonly');
  assert.equal(readonly.objectMember.body.role_id, 'reader');
  assert.match(readonly.objectMember.body.user_id.unresolvedBinding, /verifiedPlmUserId/);
  assert.equal(candidate.requestTemplates.find(actor => actor.actorKey === 'nonmember')
    .objectMember.expectedOwnedProductMemberCount, 0);
  assert.equal(candidate.crossOrganization.accountPrepared, false);
  assert.equal(candidate.effectsExecuted.usersCreated, 0);
});

test('binding hints cannot silently become verified grants or privileged roles', () => {
  const hints = { realmId: 'actual-native-realm', organizationId: 'Chinese-组织',
    organizationRoleId: 'actual-group', ownedProductId: 'run-owned-product' };
  const before = structuredClone(hints);
  const verified = validateNativeActorBindingHints(hints);
  assert.equal(verified.verified, false);
  assert.equal(verified.hintsAreAuthorization, false);
  assert.deepEqual(hints, before);
  for (const input of [
    { role: 'admin' }, { realmId: '' }, { realmId: 'a\nb' }, { realmId: 'x'.repeat(101) },
    { organizationRoleId: 'ROLE_SUPERADMIN' }, { organizationRoleId: 'ROLE_APIUSERS' },
    { runtimeContractVerified: true }, { adminUsername: 'shared-client' }, [],
  ]) assert.throws(() => validateNativeActorBindingHints(input));
  assert.throws(() => buildNativeActorCandidate({ runId: '../foreign', source: source.facts }));
  assert.throws(() => buildNativeActorCandidate({ runId, source: { ...source.facts, runtimeContractVerified: true } }));
});

test('planned secrets cannot be mistaken for created browser credentials', () => {
  const bundle = { contract: 'native-actors-planned-secrets-v1', status: 'NOT_CREATED',
    runtimeContractVerified: false, authenticationUsable: false,
    entries: Object.fromEntries(['ordinary', 'readonly', 'nonmember'].map(actorKey => [actorKey, {
      actorKey, status: 'NOT_CREATED', issuedPersonId: null, candidatePassword: 'A!'.padEnd(34, 'z') + 'z9',
    }])) };
  assert.equal(assertNotCreatedCredentialBundle(bundle), true);
  for (const mutate of [
    value => { value.status = 'CREATED'; },
    value => { value.authenticationUsable = true; },
    value => { value.runtimeContractVerified = true; },
    value => { value.username = 'existing-helper-input'; value.password = 'private'; },
    value => { value.users = {}; },
    value => { value.entries.ordinary.issuedPersonId = 'claimed-created-id'; },
    value => { value.entries.ordinary.candidatePassword = 'a'.repeat(64); },
  ]) {
    const altered = structuredClone(bundle);
    mutate(altered);
    assert.throws(() => assertNotCreatedCredentialBundle(altered));
  }
});

test('prepare writes exclusive durable private candidates, independent random secrets and exact source snapshots', () => {
  const output = join(workspace, '.artifacts', `native-actors-prepare-test-${randomBytes(8).toString('hex')}`);
  try {
    const result = prepareExistingNativeActors({ output, runId });
    assert.equal(result.receipt.status, 'NOT_CREATED');
    assert.equal(result.receipt.effectsExecuted.httpRequests, 0);
    assert.equal(fs.statSync(output).mode & 0o777, 0o700);
    const candidateBytes = fs.readFileSync(join(output, 'candidate.private.json'));
    const credentialBytes = fs.readFileSync(join(output, 'credentials.planned.private.json'));
    const credentials = JSON.parse(credentialBytes);
    assertNotCreatedCredentialBundle(credentials);
    const passwords = Object.values(credentials.entries).map(entry => entry.candidatePassword);
    assert.equal(new Set(passwords).size, 3);
    for (const password of passwords) {
      assert.match(password, /^A![A-Za-z0-9_-]{32}z9$/);
      assert.ok(!candidateBytes.includes(password));
      assert.ok(!fs.readFileSync(join(output, 'report.private.json')).includes(password));
    }
    for (const binding of result.receipt.bindings) {
      const bytes = fs.readFileSync(join(output, binding.path));
      assert.equal(hash(bytes), binding.sha256);
      assert.equal(fs.statSync(join(output, binding.path)).mode & 0o777, 0o600);
    }
    for (const file of source.files) {
      const snapshot = fs.readFileSync(join(output, 'source', file.path));
      assert.deepEqual(snapshot, file.bytes);
    }
    assert.equal(result.receipt.implementationBindings.length, 2);
    for (const binding of result.receipt.implementationBindings) {
      const snapshot = fs.readFileSync(join(output, 'source', binding.path));
      assert.equal(hash(snapshot), binding.sha256);
    }
    assert.throws(() => prepareExistingNativeActors({ output, runId }), /existing output/);
    assert.deepEqual(fs.readFileSync(join(output, 'credentials.planned.private.json')), credentialBytes);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('generator refuses apply adapters, shared identities and path/symlink escapes before creating output', () => {
  for (const input of [
    { apply: true }, { request() {} }, { runtimeContractVerified: true },
    { existingUsername: 'shared-client' }, { role: 'ROLE_APIUSERS' },
    { output: '/tmp/unowned-native-actors' },
    { output: join(workspace, '.artifacts', 'not-the-reviewed-prefix') },
  ]) assert.throws(() => prepareExistingNativeActors(input));
  const output = join(workspace, '.artifacts', `native-actors-prepare-test-${randomBytes(8).toString('hex')}`);
  fs.symlinkSync('/tmp', output);
  try {
    assert.throws(() => prepareExistingNativeActors({ output }));
    assert.equal(fs.readlinkSync(output), '/tmp');
  } finally { fs.unlinkSync(output); }
});
