import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { createApplicationAccounts } from '../provision-run-owned-native-application-accounts.mjs';
import { javaProperties, parseJavaProperties, runtimeConfiguration } from '../harness-run-owned-uaa-runtime.mjs';
import {
  createOwnedBackendConfiguration, OWNED_BACKEND_CONFIGURATION_BOUNDARY,
  ownedNacosContent, parseOwnedNacosContent,
} from '../run-owned-backend-configuration.mjs';

function inputs(scenario = 'two-center') {
  let sequence = 1;
  const secret = () => (sequence++).toString(16).padStart(36, '0');
  const { manifest, credentials } = createFixture({
    runId: 'f01006abcdef', scenario, passwordStorageMode: 'sm3', modelVersion: 816,
    uaaSchemaMode: 'legacy-views', secret,
  });
  const accounts = createApplicationAccounts(manifest, secret);
  const names = Object.fromEntries(['allinone', 'provider', 'gateway', 'nacos', 'zookeeper']
    .map(role => [role, `nf-${manifest.runId}-backend-config-r1-${role}`]));
  names.uaa = `nf-${manifest.runId}-uaa-maintained-r7`;
  names.redis = `${names.uaa}-redis`;
  const retainedUaaConfiguration = runtimeConfiguration(
    manifest, accounts.configuration, names.redis, 'a'.repeat(64),
  );
  // Match accounts.private.json, not the public candidate's account/SQL extras.
  return {
    manifest, credentials, names, retainedUaaConfiguration,
    accounts: { passwords: accounts.passwords, configuration: accounts.configuration,
      roleCredentialsPath: '../credentials.private.json' },
    modelingRouteProbe: {
      contract: 'owned-modeling-application-route-probe-v1', application: 'ModelDesign',
      disabledFactoryReturnedNull: true, enabledFactoryClass: 'net.ibizsys.central.app.ApplicationRuntime',
      canonicalRoute: {
        id: 'ibizmodeling__modeldesign__psdevslnsys', uri: 'lb://ibizmodeling-modelapi', order: 100,
        predicates: ['Path=/ibizmodeling__modeldesign/psdevslnsys/**'],
        filters: ['StripPrefix=1', 'PrefixPath=/ibizmodeling/modelapi'],
      },
      generatorOrigin: 'file:/dependencies/ibiz-cloud-core-8.1.0.584.1.jar',
      factoryOrigin: 'file:/dependencies/ibiz-cloud-core-8.1.0.584.1.jar',
    },
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test('exact launcher interface produces three flat scalar maps and explicit YAML Nacos rows', () => {
  const source = inputs();
  const configuration = createOwnedBackendConfiguration(source);
  assert.deepEqual(Object.keys(configuration).sort(), ['nacosConfigs', 'services']);
  assert.deepEqual(Object.keys(configuration.services).sort(), ['allinone', 'gateway', 'provider']);
  for (const [role, port] of [['allinone', 30000], ['provider', 32002], ['gateway', 30086]]) {
    const properties = configuration.services[role];
    assert.equal(properties['server.port'], port);
    for (const [key, value] of Object.entries(properties)) {
      assert.match(key, /^[A-Za-z0-9_.-]+$/);
      assert.ok(['string', 'boolean', 'number'].includes(typeof value));
    }
    const serialized = javaProperties(properties);
    const parsed = parseJavaProperties(serialized);
    assert.equal(Object.keys(parsed).length, Object.keys(properties).length);
    assert.ok(Object.entries(properties).every(([key, value]) => parsed[key] === String(value)));
  }
  assert.equal(configuration.nacosConfigs.length, 3);
  for (const row of configuration.nacosConfigs) {
    assert.deepEqual(Object.keys(row).sort(), ['content', 'dataId', 'group']);
    assert.equal(row.group, `nf_${source.manifest.runId}`);
    assert.equal(typeof row.content, 'string');
    assert.ok(row.content.startsWith('---\n'));
    const value = parseOwnedNacosContent(row.content);
    assert.equal(typeof value, 'object');
    assert.ok(value && !Array.isArray(value));
  }
});

test('Nacos encoding selects ConfigEntity YAML parsing and preserves nested scalar values', () => {
  const value = { agents: ['RT'], nested: { value: 'a&b=x\n#still data', enabled: false }, empty: [] };
  const content = ownedNacosContent(value);
  assert.notEqual(content.indexOf('{'), 0);
  assert.deepEqual(parseOwnedNacosContent(content), value);
  for (const invalid of ['{"agents":["RT"]}', '---\nhello', '---\n[]', '---\nnull', '\n---\n{}']) {
    assert.throws(() => parseOwnedNacosContent(invalid));
  }
  for (const invalid of [null, [], 'hello']) assert.throws(() => ownedNacosContent(invalid));
});

test('auto/local ServiceHub explicitly deploys only needed locally defined systems', () => {
  const { services } = createOwnedBackendConfiguration(inputs());
  for (const [role, systems] of [
    ['allinone', ['gateway', 'ebsx']], ['provider', ['gateway', 'ibizmodeling']],
  ]) {
    const config = services[role];
    assert.equal(config['ibiz.servicehub.initmode'], 'auto');
    assert.equal(config['ibiz.servicehub.localmode'], true);
    assert.equal(config['ibiz.servicehub.register-naming-service'], false);
    assert.equal(config['ibiz.servicehub.publish-config'], false);
    assert.equal(config['ibiz.servicehub.enableappgateway'], role === 'provider');
    const listKeys = Object.keys(config).filter(key => key.startsWith('ibiz.servicehub.deploysystems.'));
    assert.equal(listKeys.length, systems.length);
    for (const [index, system] of systems.entries()) {
      assert.equal(config[`ibiz.servicehub.deploysystems.${index}`], system);
      assert.equal(config[`ibiz.deploysystems.${system}.deploysystemid`], system);
      for (const flag of ['updatedbschema', 'extension', 'enablereload', 'installdata']) {
        assert.equal(config[`ibiz.deploysystems.${system}.${flag}`], false);
      }
    }
  }
  assert.equal(services.allinone['ibiz.appgateway-default.deployapps'], '');
  assert.ok(!Object.keys(services.gateway).some(key => key.startsWith('ibiz.deploysystems.')));
});

test('provider DEFAULT selects read-only owned metadata and leaves DB2 root-selected', () => {
  const source = inputs();
  const { services } = createOwnedBackendConfiguration(source);
  const config = services.provider;
  const metadata = source.accounts.configuration.metadata;
  assert.equal(config['spring.datasource.url'], metadata.jdbcUrl);
  assert.equal(config['spring.datasource.username'], metadata.username);
  assert.ok(config['spring.datasource.password'] === metadata.password);
  assert.equal(config['spring.datasource.hikari.read-only'], true);
  assert.equal(config['spring.datasource.dynamic.datasource.master.hikari.read-only'], true);
  assert.equal(config['ibiz.servicehub.datasources.DEFAULT.url'], metadata.jdbcUrl);
  assert.equal(config['ibiz.servicehub.datasources.DEFAULT.username'], metadata.username);
  assert.ok(config['ibiz.servicehub.datasources.DEFAULT.password'] === metadata.password);
  assert.equal(config['ibiz.deploysystems.ibizmodeling.settings.sysdbscheme.default.datasource'], 'DEFAULT');
  assert.equal(config['ibiz.deploysystems.ibizmodeling.modelpath'], '/app/model');
  const keys = Object.keys(config);
  assert.ok(!keys.some(key => /(?:^|\.)(?:db2|model_a|model_b)(?:\.|$)/i.test(key)));
  for (const root of source.manifest.roots) {
    assert.ok(!Object.values(config).includes(root.jdbcUrl));
    assert.ok(!Object.values(config).includes(source.credentials.databases[root.jdbcUser]));
  }
});

test('allinone selects scoped UAA and makes no claim of full EBSX schema readiness', () => {
  const source = inputs();
  const { services } = createOwnedBackendConfiguration(source);
  const uaa = source.accounts.configuration.uaa;
  assert.equal(services.allinone['spring.datasource.url'], uaa['spring.datasource.url']);
  assert.equal(services.allinone['spring.datasource.username'], uaa['spring.datasource.username']);
  assert.ok(services.allinone['spring.datasource.password'] === uaa['spring.datasource.password']);
  assert.equal(services.allinone['ibiz.deploysystems.ebsx.settings.sysdbscheme.default.datasource'], 'owneduaa');
  assert.equal(services.allinone['ibiz.servicehub.datasources.owneduaa.url'], uaa['spring.datasource.url']);
  assert.equal(OWNED_BACKEND_CONFIGURATION_BOUNDARY.nativeAcceptance, false);
  assert.equal(OWNED_BACKEND_CONFIGURATION_BOUNDARY.permissionAcceptance, false);
  assert.ok(OWNED_BACKEND_CONFIGURATION_BOUNDARY.blockers.some(row => /complete EBSX/.test(row)));
});

test('Flowable schema updates are explicitly disabled without skipping the workflow engine', () => {
  const { services } = createOwnedBackendConfiguration(inputs());
  for (const config of [services.allinone, services.provider]) {
    assert.equal(config['ibiz.servicehub.systemsettings.cloudwfutil.schemaupdate'], false);
    assert.equal(config['ibiz.servicehub.systemsettings.cloudwfutil.ayncexecutoractivate'], false);
    assert.ok(!Object.keys(config).some(key => /cloudwfutil.*(?:skip|disabled|exclude)/.test(key)));
  }
});

test('verified workflow configuration binds only allinone to its separate CRUD-only database', () => {
  const source = inputs();
  const run = source.manifest.runId;
  source.workflow = {
    schema: `nf_${run}_workflow`, username: `nf_${run}_wf_app`, password: 'c'.repeat(36),
    url: `jdbc:mysql://nf-${run}-mysql:3306/nf_${run}_workflow?useUnicode=true&characterEncoding=UTF-8&useSSL=false`,
    schemaUpdate: false,
  };
  const { services } = createOwnedBackendConfiguration(source);
  assert.equal(services.allinone['ibiz.servicehub.systemsettings.cloudwfutil.datasource'], 'ownedworkflow');
  assert.equal(services.allinone['ibiz.servicehub.datasources.ownedworkflow.url'], source.workflow.url);
  assert.equal(services.allinone['ibiz.servicehub.datasources.ownedworkflow.username'], source.workflow.username);
  assert.equal(services.allinone['spring.datasource.url'], source.accounts.configuration.uaa['spring.datasource.url']);
  for (const role of ['provider', 'gateway']) {
    assert.ok(!Object.values(services[role]).includes(source.workflow.password));
  }
  for (const change of [
    w => { w.username = `nf_${run}_wf_ddl`; }, w => { w.url = 'jdbc:mysql://mysql/shared'; },
    w => { w.schema = source.manifest.schemas.uaa; }, w => { w.schemaUpdate = true; },
    w => { w.password = 'invalid'; },
  ]) {
    const bad = structuredClone(source);
    change(bad.workflow);
    assert.throws(() => createOwnedBackendConfiguration(bad));
  }
});

test('verified EBSX moves allinone and all three logical schemas off the standalone UAA database', () => {
  const source = inputs();
  const run = source.manifest.runId;
  source.ebsx = {
    schema: `nf_${run}_ebsx`, username: `nf_${run}_ebsx_app`, password: 'd'.repeat(36),
    url: `jdbc:mysql://nf-${run}-mysql:3306/nf_${run}_ebsx?useUnicode=true&characterEncoding=UTF-8&useSSL=false`,
    schemaUpdate: false, logicalDatasources: ['DEFAULT', 'DB2', 'DB3'],
  };
  const { services } = createOwnedBackendConfiguration(source);
  const runtimeUrl = `${source.ebsx.url}&allowMultiQueries=true`;
  for (const key of ['spring.datasource.url', 'spring.datasource.dynamic.datasource.master.url',
    'ibiz.servicehub.datasources.ownedebsx.url']) {
    assert.equal(services.allinone[key], runtimeUrl);
  }
  assert.ok(!Object.values(services.provider).includes(runtimeUrl));
  assert.ok(!Object.values(services.gateway).includes(runtimeUrl));
  assert.equal(services.allinone['ibiz.servicehub.datasources.ownedebsx.username'], source.ebsx.username);
  assert.equal(services.allinone['ibiz.servicehub.datasources.owneduaa.url'], undefined);
  for (const link of ['default', 'db2', 'db3']) {
    assert.equal(services.allinone[`ibiz.deploysystems.ebsx.settings.sysdbscheme.${link}.datasource`], 'ownedebsx');
  }
  assert.ok(!Object.values(services.allinone).includes(source.accounts.configuration.uaa['spring.datasource.password']));
  assert.ok(!Object.values(services.provider).includes(source.ebsx.password));
  assert.ok(!Object.values(services.gateway).includes(source.ebsx.password));
  for (const mutate of [
    e => { e.username = `nf_${run}_ebsx_ddl`; }, e => { e.url = 'jdbc:mysql://mysql/shared'; },
    e => { e.schemaUpdate = true; }, e => { e.logicalDatasources = ['DEFAULT']; },
  ]) {
    const bad = structuredClone(source);
    mutate(bad.ebsx);
    assert.throws(() => createOwnedBackendConfiguration(bad));
  }
});

test('MAC verification and Redis bind to retained UAA without copying unrelated secrets', () => {
  const source = inputs();
  const ignoredSecret = 'unrelated-sensitive-input-do-not-copy';
  source.retainedUaaConfiguration['unrelated.private.token'] = ignoredSecret;
  source.accounts.configuration.uaa['unrelated.external.url'] = 'https://outside.invalid';
  const { services, nacosConfigs } = createOwnedBackendConfiguration(source);
  for (const [role, config] of Object.entries(services)) {
    assert.equal(config['spring.redis.host'], source.names.redis);
    assert.equal(config['spring.redis.port'], 6379);
    assert.equal(config['spring.redis.database'], 0);
    assert.equal(config['ibiz.jwt.signature'], 'MAC');
    assert.ok(config['ibiz.jwt.secret'] === source.retainedUaaConfiguration['ibiz.jwt.secret']);
    assert.equal(config['ibiz.auth.passwordStorageMode'], 'sm3');
    assert.equal(config['ibiz.auth.passwordEncryptMode'], 'none');
    if (role !== 'gateway') {
      assert.equal(config['ibiz.deploysystems.gateway.settings.sysutil.uaa.newrtuaa'], true);
      assert.equal(config['ibiz.deploysystems.gateway.settings.sysutil.uaa.signature'], 'MAC');
      assert.ok(config['ibiz.deploysystems.gateway.settings.sysutil.uaa.secret']
        === source.retainedUaaConfiguration['ibiz.jwt.secret']);
    }
  }
  const output = JSON.stringify({ services, nacosConfigs });
  assert.ok(!output.includes(ignoredSecret));
  assert.ok(!output.includes('outside.invalid'));
  for (const password of Object.values(source.credentials.users)) assert.ok(!output.includes(password));
  for (const row of nacosConfigs) {
    assert.ok(!row.content.includes(source.retainedUaaConfiguration['ibiz.jwt.secret']));
    for (const password of Object.values(source.accounts.passwords)) assert.ok(!row.content.includes(password));
  }
});

test('verified platform deploys the real extension without changing the EBSX or provider datasource', () => {
  const source = inputs();
  const run = source.manifest.runId;
  const url = schema => `jdbc:mysql://nf-${run}-mysql:3306/${schema}?useUnicode=true&characterEncoding=UTF-8&useSSL=false`;
  source.ebsx = {
    schema: `nf_${run}_ebsx`, username: `nf_${run}_ebsx_app`, password: 'd'.repeat(36),
    url: url(`nf_${run}_ebsx`), schemaUpdate: false, logicalDatasources: ['DEFAULT', 'DB2', 'DB3'],
  };
  source.platform = {
    schema: `nf_${run}_platform`, username: `nf_${run}_plat_app`, password: 'e'.repeat(36),
    url: url(`nf_${run}_platform`), schemaUpdate: false, logicalDatasources: ['DEFAULT'],
    deploySystemId: 'extension', runtimeClassName: 'net.ibizsys.central.cloud.saas.extension.runtime.SystemRuntime',
    operatorValuesReady: false,
  };
  const { services, nacosConfigs } = createOwnedBackendConfiguration(source);
  const config = services.allinone;
  assert.equal(config['ibiz.servicehub.deploysystems.2'], 'extension');
  assert.equal(config['ibiz.deploysystems.extension.runtimeclassname'], source.platform.runtimeClassName);
  for (const flag of ['updatedbschema', 'extension', 'enablereload', 'installdata']) {
    assert.equal(config[`ibiz.deploysystems.extension.${flag}`], false);
  }
  assert.equal(config['ibiz.deploysystems.extension.settings.sysdbscheme.default.datasource'], 'ownedplatform');
  assert.equal(config['ibiz.servicehub.datasources.ownedplatform.url'], source.platform.url);
  assert.equal(config['ibiz.servicehub.datasources.ownedplatform.username'], source.platform.username);
  assert.equal(config['ibiz.servicehub.datasources.ownedplatform.password'], source.platform.password);
  assert.equal(config['spring.datasource.url'], `${source.ebsx.url}&allowMultiQueries=true`);
  assert.equal(config['ibiz.deploysystems.ebsx.settings.sysdbscheme.default.datasource'], 'ownedebsx');
  assert.ok(!Object.values(services.provider).includes(source.platform.password));
  assert.ok(!Object.values(services.gateway).includes(source.platform.password));
  const route = parseOwnedNacosContent(nacosConfigs[0].content).routes.at(-1);
  assert.equal(route.id, 'owned-platform-extension');
  assert.equal(route.uri, `http://${source.names.allinone}:30000`);
  assert.deepEqual(route.predicates[0].args, { _genkey_0: '/extension/**' });
  assert.deepEqual(route.filters, ['StripPrefix=1', 'PrefixPath=/extension/api']);
  for (const mutate of [
    candidate => { delete candidate.ebsx; },
    candidate => { candidate.platform.username = `nf_${run}_plat_ddl`; },
    candidate => { candidate.platform.url = source.ebsx.url; },
    candidate => { candidate.platform.schemaUpdate = true; },
    candidate => { candidate.platform.schema = source.manifest.schemas.uaa; },
    candidate => { candidate.platform.logicalDatasources = ['DEFAULT', 'DB2']; },
    candidate => { candidate.platform.runtimeClassName = 'fake.Runtime'; },
    candidate => { candidate.platform.deploySystemId = 'gateway'; },
    candidate => { candidate.platform.password = 'unsafe'; },
  ]) {
    const bad = structuredClone(source);
    mutate(bad);
    assert.throws(() => createOwnedBackendConfiguration(bad));
  }
});

test('required Nacos client uses the owned registry without self-registration, schema sync or jobs', () => {
  const source = inputs();
  for (const config of Object.values(createOwnedBackendConfiguration(source).services)) {
    assert.equal(config['spring.cloud.nacos.config.enabled'], true);
    assert.equal(config['spring.cloud.nacos.config.server-addr'], `${source.names.nacos}:8848`);
    assert.equal(config['spring.cloud.nacos.config.group'], `nf_${source.manifest.runId}`);
    assert.equal(config['spring.cloud.nacos.discovery.server-addr'], `${source.names.nacos}:8848`);
    assert.equal(config['spring.cloud.nacos.discovery.group'], `nf_${source.manifest.runId}`);
    assert.equal(config['spring.cloud.nacos.discovery.enabled'], true);
    assert.equal(config['spring.cloud.discovery.enabled'], true);
    for (const key of ['spring.cloud.bootstrap.enabled',
      'spring.cloud.nacos.discovery.register-enabled',
      'eureka.client.enabled', 'spring.liquibase.enabled', 'spring.flyway.enabled',
      'spring.jpa.generate-ddl', 'jobs.enabled']) assert.equal(config[key], false);
    assert.equal(config['spring.jpa.hibernate.ddl-auto'], 'none');
    assert.equal(config['spring.sql.init.mode'], 'never');
    assert.equal(config['spring.profiles.include'], 'sys');
    assert.equal(config['spring.profiles.active'], 'isolated-native');
    assert.ok(!Object.values(config).some(value => typeof value === 'string'
      && (value.includes('${') || value.startsWith('lb://') || value.startsWith('https://'))));
  }
});

test('Nacos application routes compose canonical model mapping with the exact owned peer', () => {
  const source = inputs();
  const { nacosConfigs } = createOwnedBackendConfiguration(source);
  assert.equal(new Set(nacosConfigs.map(row => `${row.group}/${row.dataId}`)).size, nacosConfigs.length);
  const routing = parseOwnedNacosContent(nacosConfigs.find(row => row.dataId === 'appgateway-default').content);
  assert.deepEqual(routing.deployapps, []);
  assert.equal(routing.routes.length, 4);
  assert.deepEqual(routing.routes.map(row => row.uri), [
    `http://${source.names.provider}:32002`,
    `http://${source.names.allinone}:30000`,
    `http://${source.names.uaa}:32666`,
    `http://${source.names.allinone}:30000`,
  ]);
  assert.deepEqual(routing.routes[0].predicates, [{ name: 'Path', args: {
    _genkey_0: '/api/ibizmodeling__modeldesign/psdevslnsys/**',
  } }]);
  assert.deepEqual(routing.routes[0].filters, [
    { name: 'StripPrefix', args: { parts: '2' } },
    { name: 'PrefixPath', args: { prefix: '/ibizmodeling/modelapi' } },
  ]);
  assert.ok(routing.routes.slice(1).every(row => row.filters.length === 0));
  assert.deepEqual(routing.routes[3].predicates, [{ name: 'Path', args: {
    _genkey_0: '/configs/**', _genkey_1: '/dictionaries/**',
  } }]);
  assert.ok(!routing.routes.some(row => Object.values(row.predicates[0].args).includes('/api/**')));
  assert.ok(!routing.routes.some(row => Object.values(row.predicates[0].args).includes('/**')));
  const agent = parseOwnedNacosContent(nacosConfigs.find(row => row.dataId === 'cloud-auth-agent-rt').content);
  assert.deepEqual(agent, { serviceurl: `http://${source.names.uaa}:32666`, accesstokenurl: '/auths/login' });
  assert.deepEqual(parseOwnedNacosContent(nacosConfigs.find(row => row.dataId === 'cloud-auth').content), { agents: ['RT'] });
});

test('configuration rejects missing or changed route proof without disclosing supplied values', () => {
  for (const mutate of [
    s => { delete s.modelingRouteProbe; },
    s => { s.modelingRouteProbe.canonicalRoute.predicates = ['Path=/**']; },
    s => { s.modelingRouteProbe.factoryOrigin = 'private-supplied-value'; },
  ]) {
    const source = inputs();
    mutate(source);
    assert.throws(() => createOwnedBackendConfiguration(source), error => {
      assert.equal(error.constructor, Error);
      assert.equal(error.message, 'Invalid packaged application-route probe; supplied values suppressed');
      return true;
    });
  }
});

test('UNISTATE uses only the owned ZooKeeper address without disable flags or ordinary-user service credentials', () => {
  const source = inputs();
  const { services } = createOwnedBackendConfiguration(source);
  for (const config of [services.allinone, services.provider]) {
    assert.equal(config['ibiz.deploysystems.gateway.settings.sysutil.unistate.serviceurl'],
      `${source.names.zookeeper}:2181`);
    assert.equal(config['ibiz.deploysystems.gateway.settings.sysutil.unistate.servicehost'],
      source.names.zookeeper);
    assert.equal(config['ibiz.deploysystems.gateway.settings.sysutil.unistate.serviceport'], 2181);
    assert.ok(!Object.keys(config).some(key => /(?:unistate|zookeeper).*(?:enable|disable)/i.test(key)));
    assert.equal(config['ibiz.servicehub.systemsettings.cloudclientutil.clientid'], '');
    assert.equal(config['ibiz.servicehub.systemsettings.cloudclientutil.clientsecret'], '');
    for (const user of source.manifest.users) assert.ok(!Object.values(config).includes(user.loginname));
  }
  const blockers = OWNED_BACKEND_CONFIGURATION_BOUNDARY.blockers.join('\n');
  assert.match(blockers, /ZooKeeper/);
  assert.match(blockers, /lb:\/\/uaa-api/);
  assert.match(blockers, /OAuth/);
  assert.ok(Object.isFrozen(OWNED_BACKEND_CONFIGURATION_BOUNDARY.blockers));
  assert.ok(OWNED_BACKEND_CONFIGURATION_BOUNDARY.prerequisites.some(row => /exclusive/.test(row)));
});

test('pure builder is deterministic, handles parsed properties, and never mutates frozen inputs', () => {
  const source = inputs();
  const snapshot = structuredClone(source);
  deepFreeze(source);
  const first = createOwnedBackendConfiguration(source);
  const second = createOwnedBackendConfiguration(source);
  assert.deepEqual(first, second);
  assert.deepEqual(source, snapshot);
  const parsedSource = structuredClone(snapshot);
  parsedSource.retainedUaaConfiguration = parseJavaProperties(javaProperties(snapshot.retainedUaaConfiguration));
  assert.deepEqual(createOwnedBackendConfiguration(parsedSource), first);
  first.services.provider['server.port'] = 1;
  assert.equal(second.services.provider['server.port'], 32002);
});

test('both same-center and two-center inputs retain identical root-selected routing policy', () => {
  const same = createOwnedBackendConfiguration(inputs('same-center'));
  const separate = createOwnedBackendConfiguration(inputs('two-center'));
  assert.deepEqual(same, separate);
});

const invalidCases = [
  ['foreign manifest run', source => { source.manifest.runId = '000000000000'; }],
  ['accepted fixture promotion', source => { source.manifest.nativeAcceptance = true; }],
  ['administrator fixture', source => { source.manifest.users[0].administrator = true; }],
  ['foreign center', source => { source.manifest.users[0].centerId = 'other_center'; }],
  ['non-SM3 fixture', source => { source.manifest.passwordStorageMode = 'none'; }],
  ['shared backend name', source => { source.names.provider = 'shared-modeling'; }],
  ['foreign backend run', source => { source.names.gateway = source.names.gateway.replace('f01006abcdef', '000000000000'); }],
  ['different backend label', source => { source.names.nacos = source.names.nacos.replace('config-r1', 'other'); }],
  ['missing ZooKeeper', source => { delete source.names.zookeeper; }],
  ['shared ZooKeeper', source => { source.names.zookeeper = 'zoo1'; }],
  ['foreign ZooKeeper', source => { source.names.zookeeper = source.names.zookeeper.replace('config-r1', 'other'); }],
  ['shared UAA name', source => { source.names.uaa = 'uaa'; }],
  ['shared Redis name', source => { source.names.redis = 'redis'; }],
  ['other owned Redis peer', source => { source.names.redis = source.names.redis.replace('maintained-r7', 'other'); }],
  ['origin injection', source => { source.names.nacos += ':8848/'; }],
  ['extra service name', source => { source.names.untrusted = 'external'; }],
  ['root UAA account', source => { source.accounts.configuration.uaa['spring.datasource.username'] = 'root'; }],
  ['foreign UAA JDBC', source => { source.accounts.configuration.uaa['spring.datasource.url'] = 'jdbc:mysql://shared/uaa'; }],
  ['foreign metadata JDBC', source => { source.accounts.configuration.metadata.jdbcUrl = 'jdbc:mysql://shared/meta'; }],
  ['root metadata account', source => { source.accounts.configuration.metadata.username = 'root'; }],
  ['metadata not read-only', source => { source.accounts.configuration.metadata.readOnly = false; }],
  ['metadata password mismatch', source => { source.accounts.configuration.metadata.password = 'b'.repeat(36); }],
  ['application password injection', source => { source.accounts.passwords[`nf_${source.manifest.runId}_uaa_app`] += '\nkey=value'; }],
  ['extra application account', source => { source.accounts.passwords.admin = 'b'.repeat(36); }],
  ['missing role credential', source => { delete source.credentials.users[source.manifest.users[0].loginname]; }],
  ['extra role credential', source => { source.credentials.users.admin = 'b'.repeat(36); }],
  ['missing model DB credential', source => { delete source.credentials.databases[source.manifest.roots[0].jdbcUser]; }],
  ['foreign retained JDBC', source => { source.retainedUaaConfiguration['spring.datasource.url'] = 'jdbc:mysql://shared/uaa'; }],
  ['retained password mismatch', source => { source.retainedUaaConfiguration['spring.datasource.password'] = 'b'.repeat(36); }],
  ['retained different Redis', source => { source.retainedUaaConfiguration['spring.redis.host'] = 'shared-redis'; }],
  ['retained different Redis DB', source => { source.retainedUaaConfiguration['spring.redis.database'] = 1; }],
  ['retained L1 cache', source => { source.retainedUaaConfiguration['ibiz.cacheLevel'] = 'L1'; }],
  ['retained RSA signature', source => { source.retainedUaaConfiguration['ibiz.jwt.signature'] = 'RSA'; }],
  ['retained password transport', source => { source.retainedUaaConfiguration['ibiz.auth.passwordEncryptMode'] = 'rsa'; }],
  ['retained migration enabled', source => { source.retainedUaaConfiguration['spring.liquibase.enabled'] = true; }],
  ['retained schema sync enabled', source => { source.retainedUaaConfiguration['spring.datasource.isSyncDBSchema'] = 'true'; }],
  ['retained discovery enabled', source => { source.retainedUaaConfiguration['spring.cloud.discovery.enabled'] = true; }],
  ['retained jobs enabled', source => { source.retainedUaaConfiguration['jobs.enabled'] = true; }],
  ['retained wrong port', source => { source.retainedUaaConfiguration['server.port'] = 8080; }],
  ['invalid MAC secret', source => { source.retainedUaaConfiguration['ibiz.jwt.secret'] = 'sensitive-invalid-secret'; }],
];
for (const [name, mutate] of invalidCases) {
  test(`rejects ${name} without disclosing supplied values`, () => {
    const source = inputs();
    mutate(source);
    assert.throws(() => createOwnedBackendConfiguration(source), error => {
      assert.equal(error.constructor, Error);
      const privateValues = [
        ...Object.values(source.accounts.passwords), ...Object.values(source.credentials.users),
        ...Object.values(source.credentials.databases), source.accounts.configuration.metadata.password,
        source.retainedUaaConfiguration['ibiz.jwt.secret'],
      ];
      assert.ok(privateValues.every(value => !error.message.includes(value)));
      assert.ok(!error.message.includes('jdbc:mysql://shared'));
      return true;
    });
  });
}

test('missing or malformed top-level inputs yield sanitized bounded errors', () => {
  for (const value of [undefined, null, [], {}, { manifest: null }]) {
    assert.throws(() => createOwnedBackendConfiguration(value), error => error.constructor === Error);
  }
});
