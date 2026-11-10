import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  createApplicationAccounts, createFreshSessionCases, main, validateApplicationGrants,
  validateApplicationTarget, validateFixtureReceipt,
} from '../provision-run-owned-native-application-accounts.mjs';
import { parseArgs as parseLegacyReadHarness } from '../harness-native-model-modules.mjs';
import { mysqlFixtureProfile } from '../mysql-fixture-profiles.mjs';

const runId = 'f01006abcdef';
const fixture = scenario => createFixture({
  runId, scenario, passwordStorageMode: 'sm3', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', secret: () => '1'.repeat(36),
});
const secret = 'f'.repeat(36);

test('application accounts use own exact schemas; UAA CRUD and metadata SELECT only', () => {
  for (const scenario of ['same-center', 'two-center']) {
    const { manifest } = fixture(scenario);
    const candidate = createApplicationAccounts(manifest, () => secret);
    assert.deepEqual(candidate.accounts.map(row => [row.username, row.database, row.privileges]), [
      [`nf_${runId}_uaa_app`, manifest.schemas.uaa, 'SELECT, INSERT, UPDATE, DELETE'],
      [`nf_${runId}_meta_app`, manifest.schemas.metadata, 'SELECT'],
    ]);
    assert.equal(candidate.accounts.length, 2);
    assert.ok(candidate.accounts.every(row => row.username.length <= 32 && row.username !== 'root'));
    for (const row of candidate.accounts) {
      assert.ok(row.jdbcUrl.startsWith(`jdbc:mysql://${manifest.ownership.mysqlContainer}:3306/`));
      assert.ok(candidate.accountSQL.includes(`ON \`${row.database.replaceAll('_', '\\_')}\`.*`));
    }
    assert.doesNotMatch(candidate.accountSQL, /GRANT .* ON \*\.\*|GRANT OPTION|FLUSH|DROP|ALTER|REPLACE|IF NOT EXISTS/);
  }
});

test('passwords remain only in private SQL/configuration, never account descriptors or root requests', () => {
  const candidate = createApplicationAccounts(fixture('two-center').manifest, () => secret);
  assert.ok(candidate.accountSQL.includes(secret));
  assert.ok(JSON.stringify(candidate.configuration).includes(secret));
  assert.ok(!JSON.stringify(candidate.accounts).includes(secret));
  assert.ok(!JSON.stringify(candidate.rootRequests).includes(secret));
  assert.ok(!JSON.stringify(candidate.freshSessionCases).includes(secret));
  assert.equal(Object.keys(candidate.passwords).length, 2);
  for (const value of ["'secret", 'a'.repeat(35), 'a'.repeat(37), 'A'.repeat(36), 'x'.repeat(36)]) {
    assert.throws(() => createApplicationAccounts(fixture('two-center').manifest, () => value));
  }
});

test('private UAA config disables schema sync, Liquibase, and shared discovery, without inventing cache readiness', () => {
  const config = createApplicationAccounts(fixture('two-center').manifest).configuration;
  for (const key of ['spring.datasource.isSyncDBSchema', 'spring.liquibase.enabled',
    'spring.cloud.nacos.config.enabled', 'spring.cloud.nacos.discovery.enabled',
    'spring.cloud.discovery.enabled', 'ibiz.auth.imageCaptcha.enable']) {
    assert.equal(config.uaa[key], false);
  }
  assert.equal(config.uaa['ibiz.auth.passwordStorageMode'], 'sm3');
  assert.equal(config.metadata.readOnly, true);
  assert.ok(config.unresolved.some(row => row.includes('token/cache')));
  assert.ok(config.unresolved.some(row => row.includes('RT2')));
  assert.equal(config.uaa['ibiz.cacheLevel'], undefined);
});

test('scoped fetchcursys binds developer-system root, not the common logical system ID', () => {
  const { manifest } = fixture('two-center');
  const candidate = createApplicationAccounts(manifest);
  for (const [index, request] of candidate.rootRequests.entries()) {
    const root = manifest.roots[index];
    assert.equal(request.path,
      `/api/ibizmodeling__modeldesign/psdevslnsys/${root.rootId}/psmodules/fetchcursys`);
    assert.equal(request.appContext.PSDEVSLNSYS, root.rootId);
    assert.equal(request.body.pssystemid, root.logicalSystemId);
    assert.notEqual(request.appContext.PSDEVSLNSYS, request.body.pssystemid);
    assert.equal(request.nativeHTTPVerified, false);
  }
});

test('fresh-session acceptance inputs require persisted readbacks, all six roles, two DB projections and case-only delete', () => {
  for (const scenario of ['same-center', 'two-center']) {
    const { manifest } = fixture(scenario);
    const cases = createFreshSessionCases(manifest);
    assert.equal(cases.length, 2);
    for (const [index, row] of cases.entries()) {
      const root = manifest.roots[index];
      assert.equal(row.rootId, root.rootId);
      assert.notEqual(row.probeId, row.baselineSentinelId);
      assert.equal(row.mutationContract.removeId, row.probeId);
      assert.equal(row.mutationContract.create.pssystemid, root.logicalSystemId);
      assert.equal(row.freshSessionReadbacks.length, 6);
      assert.equal(row.freshSessionReadbacks.filter(item => item.expectedAuthorization === 'allow').length, 2);
      for (const item of row.freshSessionReadbacks) {
        const user = manifest.users.find(user => user.loginname === item.loginname);
        assert.equal(item.expectedAuthorization, user.rootId === root.rootId && user.role !== 'no-access' ? 'allow' : 'deny');
        assert.equal(item.requireNewBackendLoginRequest, true);
        assert.equal(item.reusePriorAuthorizationHeader, false);
        assert.equal(item.requireDifferentTokenBytes, false);
        assert.equal(item.administrator, false);
      }
      assert.equal(row.acceptance.bothDatabaseProjectionsRequiredAtEveryStep, true);
      assert.equal(row.acceptance.http404500OrNetworkFailureIsNotAuthorizationProof, true);
      assert.equal(row.acceptance.durableRestartAcceptance, false);
      assert.equal(row.executionStatus, 'not-run');
      assert.equal(row.apiActionMappingVerified, false);
      assert.equal(row.nativeAcceptance, false);
    }
  }
});

test('legacy read harness UUID-only validator cannot consume this fixture and must not default to shared admin', () => {
  const { manifest } = fixture('two-center');
  assert.throws(() => parseLegacyReadHarness([
    '--psdevslnsys', manifest.roots[0].rootId, '--pssystemid', manifest.roots[0].logicalSystemId,
  ], {
    AIBIZ_LOGINNAME: manifest.users[0].loginname, AIBIZ_PASSWORD: secret,
    AIBIZ_MYSQL_CONTAINER: manifest.ownership.mysqlContainer,
    AIBIZ_MYSQL_MODEL_DATABASE: manifest.schemas.modelA,
    AIBIZ_MYSQL_ROOT_USER: manifest.roots[0].jdbcUser, AIBIZ_MYSQL_ROOT_PASSWORD: secret,
  }), /Invalid model system identifier/);
});

test('foreign schema, elevated identity or promoted manifest cannot become application SQL', () => {
  for (const mutate of [
    m => { m.schemas.uaa = 'shared'; },
    m => { m.users[0].administrator = true; },
    m => { m.ownership.mysqlContainer = 'mysql'; },
    m => { m.roots[0].rootId = "x';DROP USER"; },
    m => { m.nativeAcceptance = true; },
  ]) {
    const { manifest } = fixture('two-center');
    mutate(manifest);
    assert.throws(() => createApplicationAccounts(manifest));
  }
});

const grantsFor = account => [
  `GRANT USAGE ON *.* TO '${account.username}'@'%'`,
  `GRANT ${account.privileges} ON \`${account.database.replaceAll('_', '\\_')}\`.* TO '${account.username}'@'%'`,
].join('\n');

test('grant validation rejects underscore wildcards, global access, writable metadata and grant option', () => {
  const [uaa, metadata] = createApplicationAccounts(fixture('two-center').manifest).accounts;
  for (const account of [uaa, metadata]) {
    const grants = grantsFor(account);
    assert.equal(validateApplicationGrants(account, grants), true);
    assert.equal(validateApplicationGrants(account, grants.split('\n').reverse().join('\n')), true);
    for (const invalid of [
      grants.replaceAll('\\_', '_'), grants.replace(/ON `[^`]+`\.\*/, 'ON *.*'),
      `${grants} WITH GRANT OPTION`, `${grants}\nGRANT SELECT ON shared.* TO '${account.username}'@'%'`,
      grants.replace('SELECT', 'ALL PRIVILEGES'),
    ]) assert.throws(() => validateApplicationGrants(account, invalid));
  }
  assert.throws(() => validateApplicationGrants(metadata, grantsFor(metadata).replace('GRANT SELECT ON', 'GRANT SELECT, UPDATE ON')));
});

function sqlReceipt(manifest) {
  return {
    contract: 'run-owned-native-nonadmin-isolated-sql-smoke-v1', runId, scenario: manifest.scenario,
    status: 'passed-isolated-sql-fixture-only', retainOwned: true,
    nativeAcceptance: false, permissionAcceptance: false, sourceNativeAcceptance: false,
    actualUAALoginVerified: false, actualBackendHTTPVerified: false,
    outputs: { 'manifest.json': { sha256: 'a'.repeat(64) } },
    checks: Array.from({ length: 54 }, () => ({ status: 'passed' })),
    cleanup: { mysqlRemoved: false, networkRemoved: false },
  };
}

test('preflight requires SHA-bound retained SQL receipt without promoting any native gate', () => {
  const { manifest } = fixture('two-center');
  assert.equal(validateFixtureReceipt(manifest, sqlReceipt(manifest), 'a'.repeat(64)), true);
  for (const mutate of [
    r => { r.retainOwned = false; },
    r => { r.runId = 'abcdef000000'; },
    r => { r.nativeAcceptance = true; },
    r => { r.actualUAALoginVerified = true; },
    r => { r.cleanup.mysqlRemoved = true; },
    r => { r.checks.pop(); },
    r => { r.checks[0].status = 'failed'; },
    r => { r.outputs['manifest.json'].sha256 = 'b'.repeat(64); },
  ]) {
    const receipt = sqlReceipt(manifest);
    mutate(receipt);
    assert.throws(() => validateFixtureReceipt(manifest, receipt, 'a'.repeat(64)));
  }
});

function ownedTarget(manifest) {
  const mysqlId = 'a'.repeat(64);
  const networkId = 'b'.repeat(64);
  const resources = {
    contract: 'run-owned-native-fixture-resources-v1', runId, mysqlId, networkId,
    mysqlName: manifest.ownership.mysqlContainer, networkName: manifest.ownership.network,
    schemas: manifest.schemas,
  };
  const container = {
    Id: mysqlId, Name: `/${resources.mysqlName}`,
    Image: 'sha256:a086c6276f57c2b8067d0fda21893b7e3e542513cb5997b224cd0538d4970ece',
    Config: { Labels: { 'aibiz.native-fixture.run': runId } },
    State: { Running: true },
    HostConfig: {
      Privileged: false, PortBindings: {}, Binds: [], VolumesFrom: [],
      Tmpfs: { '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824' },
    },
    NetworkSettings: { Ports: {}, Networks: { [resources.networkName]: { NetworkID: networkId } } },
    Mounts: [{ Type: 'tmpfs', Destination: '/var/lib/mysql' }],
  };
  const network = {
    Id: networkId, Name: resources.networkName, Internal: true, Driver: 'bridge',
    Labels: { 'aibiz.native-fixture.run': runId }, Containers: { [mysqlId]: {} },
  };
  return { resources, container, network };
}

test('live guard verifies immutable exclusive container/network with tmpfs and no shared peers', () => {
  const { manifest } = fixture('two-center');
  const { resources, container, network } = ownedTarget(manifest);
  const live = validateApplicationTarget(manifest, resources, container, network);
  assert.equal(live.mysqlId, resources.mysqlId);
  assert.equal(live.networkId, resources.networkId);
  assert.equal(live.publishedMysqlPorts, false);
  assert.equal(live.privateInternalNetwork, true);
});

test('application account guard accepts only the explicitly reviewed ARM64 temporary database', () => {
  const { manifest } = fixture('two-center');
  const profile = mysqlFixtureProfile('mysql57-bitnami-arm64');
  const target = () => {
    const t = ownedTarget(manifest);
    t.resources.databaseProfile = { name: 'mysql57-bitnami-arm64', imageId: profile.imageId };
    t.container.Image = profile.imageId;
    t.container.Config.User = profile.user;
    t.container.HostConfig.ReadonlyRootfs = true;
    t.container.HostConfig.Tmpfs = Object.fromEntries(profile.tmpfs.map(value => {
      const i = value.indexOf(':');
      return [value.slice(0, i), value.slice(i + 1)];
    }));
    t.container.Mounts = Object.keys(t.container.HostConfig.Tmpfs)
      .map(Destination => ({ Type: 'tmpfs', Destination }));
    return t;
  };
  const t = target();
  assert.doesNotThrow(() => validateApplicationTarget(manifest, t.resources, t.container, t.network));
  for (const mutate of [
    t => { delete t.resources.databaseProfile; },
    t => { t.resources.databaseProfile.imageId = 'sha256:' + 'f'.repeat(64); },
    t => { t.container.Config.User = 'root'; },
    t => { t.container.HostConfig.ReadonlyRootfs = false; },
    t => { t.container.HostConfig.Tmpfs['/docker-entrypoint-initdb.d'] = 'rw'; },
    t => { t.container.Mounts.push({ Type: 'bind', Source: '/shared', Destination: '/shared' }); },
  ]) {
    const t = target();
    mutate(t);
    assert.throws(() => validateApplicationTarget(manifest, t.resources, t.container, t.network));
  }
});

test('live guard refuses reused IDs, shared mysql, foreign peers, exposure, mounts, and writable host storage', () => {
  const { manifest } = fixture('two-center');
  for (const mutate of [
    t => { t.container.Id = 'c'.repeat(64); },
    t => { t.network.Id = 'c'.repeat(64); },
    t => { t.container.Name = '/mysql'; },
    t => { t.container.Config.Labels['aibiz.native-fixture.run'] = 'other'; },
    t => { t.network.Containers['c'.repeat(64)] = {}; },
    t => { t.network.Internal = false; },
    t => { t.container.NetworkSettings.Networks.shared = {}; },
    t => { t.container.HostConfig.PortBindings['3306/tcp'] = [{ HostPort: '3306' }]; },
    t => { t.container.HostConfig.Binds = ['/shared:/var/lib/mysql']; },
    t => { t.container.Image = 'sha256:' + 'e'.repeat(64); },
    t => { t.container.HostConfig.Tmpfs = {}; },
  ]) {
    const target = ownedTarget(manifest);
    mutate(target);
    assert.throws(() => validateApplicationTarget(manifest, target.resources, target.container, target.network));
  }
});

test('CLI refuses implicit SQL action, unknown flags, duplicates and foreign run/label before Docker', () => {
  for (const args of [
    [], ['--run-id=' + runId], ['--provision-owned-application-accounts', '--cleanup-owned-application-accounts'],
    ['--anything'], ['--run-id=' + runId, '--run-id=' + runId],
    ['--provision-owned-application-accounts', '--run-id=shared'],
    ['--provision-owned-application-accounts', '--run-id=' + runId, '--label=../shared'],
  ]) assert.throws(() => main(args));
});
