import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';

export const OWNED_BACKEND_CONFIGURATION_BOUNDARY = Object.freeze({
  contract: 'run-owned-backend-configuration-candidate-v1',
  nativeAcceptance: false,
  permissionAcceptance: false,
  prerequisites: Object.freeze([
    'Launch with exclusive spring.config.location; do not merge classpath application-auto.yml.',
    'Publish and read back owned Nacos inputs before starting the backend services.',
  ]),
  blockers: Object.freeze([
    'The bounded UAA fixture is not proven to contain the complete EBSX application schema.',
    'Gateway UNISTATE requires ZooKeeper; no owned ZooKeeper input or verified disable mechanism is supplied.',
    'RTJWTCloudUAAUtilRuntime still uses lb://uaa-api for user-info; discovery-disabled alias resolution is unverified.',
    'Cloud service OAuth credentials are not provisioned; scoped ordinary users must not substitute for them.',
  ]),
});

const serviceRoles = ['allinone', 'provider', 'gateway', 'nacos', 'redis', 'uaa'];
const driver = 'com.mysql.jdbc.Driver';
const passwordPattern = /^[a-f0-9]{36}$/;
const jwtPattern = /^[a-f0-9]{64}$/;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function requireInput(condition, message) {
  if (!condition) throw new Error(message);
}

function equals(actual, expected, message) {
  requireInput(actual === expected, message);
}

function scalarEquals(actual, expected, message) {
  requireInput(actual === expected || actual === String(expected), message);
}

function validateNames(runId, names) {
  requireInput(plainObject(names), 'Owned service names are required');
  requireInput(Object.keys(names).length === serviceRoles.length,
    'Exactly six owned service names are required');
  for (const role of serviceRoles) {
    requireInput(typeof names[role] === 'string' && /^[a-z0-9-]{1,160}$/.test(names[role]),
      'Invalid owned service name');
  }
  requireInput(new Set(Object.values(names)).size === serviceRoles.length,
    'Owned service names must be distinct');
  const prefix = `nf-${runId}-backend-`;
  const allinone = names.allinone;
  requireInput(allinone.startsWith(prefix) && allinone.endsWith('-allinone'),
    'Backend names must belong to this fixture');
  const label = allinone.slice(prefix.length, -'-allinone'.length);
  requireInput(/^[a-z0-9][a-z0-9-]{0,48}$/.test(label), 'Invalid owned backend label');
  for (const role of ['allinone', 'provider', 'gateway', 'nacos']) {
    equals(names[role], `${prefix}${label}-${role}`, 'Backend service names must share one owned run');
  }
  requireInput(new RegExp(`^nf-${runId}-uaa-[a-z0-9][a-z0-9-]*$`).test(names.uaa),
    'Retained UAA must belong to this fixture');
  equals(names.redis, `${names.uaa}-redis`, 'Redis must be the retained UAA peer');
}

function ownedJdbc(manifest, database) {
  return `jdbc:mysql://${manifest.ownership.mysqlContainer}:3306/${database}?useUnicode=true&characterEncoding=UTF-8&useSSL=false`;
}

function validateAccounts(manifest, accounts, credentials, retained, names) {
  requireInput(plainObject(accounts) && plainObject(accounts.passwords)
    && plainObject(accounts.configuration), 'Private application accounts are required');
  const { uaa, metadata } = accounts.configuration;
  requireInput(plainObject(uaa) && plainObject(metadata), 'Scoped application configuration is required');
  const uaaName = `nf_${manifest.runId}_uaa_app`;
  const metaName = `nf_${manifest.runId}_meta_app`;
  requireInput(Object.keys(accounts.passwords).length === 2
    && [uaaName, metaName].every(key => passwordPattern.test(accounts.passwords[key])),
  'Exactly the scoped application passwords are required');
  equals(uaa['spring.datasource.url'], ownedJdbc(manifest, manifest.schemas.uaa),
    'UAA datasource must select the owned UAA schema');
  equals(uaa['spring.datasource.username'], uaaName, 'UAA must use its scoped application account');
  equals(uaa['spring.datasource.password'], accounts.passwords[uaaName],
    'UAA application password binding differs');
  equals(uaa['spring.datasource.defaultSchema'], manifest.schemas.uaa, 'UAA schema binding differs');
  scalarEquals(uaa['spring.datasource.isSyncDBSchema'], false, 'UAA schema synchronization must be disabled');
  scalarEquals(uaa['spring.liquibase.enabled'], false, 'UAA migration must be disabled');
  equals(metadata.jdbcUrl, ownedJdbc(manifest, manifest.schemas.metadata),
    'Metadata datasource must select the owned metadata schema');
  equals(metadata.username, metaName, 'Metadata must use its scoped application account');
  equals(metadata.password, accounts.passwords[metaName], 'Metadata application password binding differs');
  equals(metadata.readOnly, true, 'Metadata application input must be declared read-only');
  requireInput(plainObject(credentials) && plainObject(credentials.users)
    && plainObject(credentials.databases), 'Private fixture credentials are required');
  requireInput(Object.keys(credentials.users).length === 6
    && manifest.users.every(user => passwordPattern.test(credentials.users[user.loginname])),
  'Six ordinary fixture credential bindings are required');
  requireInput(Object.keys(credentials.databases).length === 2
    && manifest.roots.every(root => passwordPattern.test(credentials.databases[root.jdbcUser])),
  'Two root-selected database credential bindings are required');
  requireInput(plainObject(retained), 'Retained UAA configuration is required');
  for (const key of ['spring.datasource.url', 'spring.datasource.username',
    'spring.datasource.password', 'spring.datasource.defaultSchema']) {
    equals(retained[key], uaa[key], 'Retained UAA datasource binding differs');
  }
  for (const key of ['spring.liquibase.enabled', 'spring.datasource.isSyncDBSchema',
    'spring.datasource.dynamic.datasource.master.isSyncDBSchema',
    'spring.cloud.bootstrap.enabled', 'spring.cloud.nacos.config.enabled',
    'spring.cloud.nacos.discovery.enabled', 'spring.cloud.discovery.enabled',
    'eureka.client.enabled', 'jobs.enabled']) {
    scalarEquals(retained[key], false, 'Retained UAA isolation policy differs');
  }
  for (const [key, expected] of [
    ['server.port', 32666], ['server.uaa.port', 32666],
    ['spring.redis.host', names.redis], ['spring.redis.port', 6379],
    ['spring.redis.database', 0], ['ibiz.cacheLevel', 'L2'],
    ['ibiz.auth.passwordStorageMode', 'sm3'], ['ibiz.auth.passwordEncryptMode', 'none'],
    ['ibiz.auth.imageCaptcha.enable', false], ['ibiz.jwt.signature', 'MAC'],
  ]) scalarEquals(retained[key], expected, 'Retained UAA authentication or cache contract differs');
  requireInput(typeof retained['ibiz.jwt.secret'] === 'string'
    && jwtPattern.test(retained['ibiz.jwt.secret']), 'Retained MAC signing input is invalid');
}

function datasource(url, username, password, database) {
  return {
    url, username, password, 'driver-class-name': driver,
    dbtype: 'MYSQL5', defaultSchema: database, isSyncDBSchema: false,
  };
}

function springDatasource(source, readOnly) {
  return {
    datasource: {
      url: source.url, username: source.username, password: source.password,
      'driver-class-name': driver, defaultSchema: source.defaultSchema,
      isSyncDBSchema: false,
      dynamic: {
        primary: 'master', strict: true,
        datasource: { master: {
          url: source.url, username: source.username, password: source.password,
          'driver-class-name': driver, isSyncDBSchema: false,
          hikari: { 'read-only': readOnly },
        } },
      },
      hikari: { 'read-only': readOnly },
    },
  };
}

function gatewaySystem(redis, secret, defaultDatasource) {
  return {
    deploysystemid: 'gateway', updatedbschema: false, extension: false,
    enablereload: false, installdata: false,
    settings: {
      sysutil: {
        cache: { serviceurl: `${redis}:6379`, servicehost: redis, serviceport: 6379 },
        uaa: { newrtuaa: true, signature: 'MAC', secret },
      },
      sysdbscheme: { default: { datasource: defaultDatasource } },
    },
  };
}

// Numbered dotted keys fit the launcher's scalar .properties serializer.
function flatten(values, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(values)) {
    const property = prefix ? `${prefix}.${key}` : key;
    requireInput(/^[A-Za-z0-9_.-]+$/.test(property), 'Configuration property key is unsafe');
    if (Array.isArray(value) || plainObject(value)) flatten(value, property, result);
    else {
      requireInput(['string', 'boolean', 'number'].includes(typeof value)
        && (typeof value !== 'number' || Number.isFinite(value))
        && !/[\r\n\0]/.test(String(value)), 'Configuration property is not a safe scalar');
      result[property] = value;
    }
  }
  return result;
}

function route(id, uri, paths, order) {
  return {
    id, uri, order,
    predicates: [{ name: 'Path', args: Object.fromEntries(
      paths.map((path, index) => [`_genkey_${index}`, path]),
    ) }],
    filters: [],
  };
}

/**
 * Pure private-input builder. Returned configs contain secrets and must only be
 * persisted privately by the resource owner. This is not a startup receipt.
 */
export function createOwnedBackendConfiguration(input) {
  requireInput(plainObject(input), 'Owned backend configuration inputs are required');
  const { manifest, accounts, credentials, retainedUaaConfiguration: retained, names } = input;
  try { validateMatrixFixture(manifest); }
  catch { throw new Error('Invalid run-owned fixture manifest; supplied values suppressed'); }
  equals(manifest.passwordStorageMode, 'sm3', 'This configuration requires the declared SM3 fixture');
  validateNames(manifest.runId, names);
  validateAccounts(manifest, accounts, credentials, retained, names);

  const group = `nf_${manifest.runId}`;
  const meta = accounts.configuration.metadata;
  const uaa = accounts.configuration.uaa;
  const metadataSource = datasource(meta.jdbcUrl, meta.username, meta.password, manifest.schemas.metadata);
  const uaaSource = datasource(uaa['spring.datasource.url'], uaa['spring.datasource.username'],
    uaa['spring.datasource.password'], manifest.schemas.uaa);
  const uaaOrigin = `http://${names.uaa}:32666`;
  const allinoneOrigin = `http://${names.allinone}:30000`;
  const nacosAddress = `${names.nacos}:8848`;
  const common = role => ({
    server: { port: { allinone: 30000, provider: 32002, gateway: 30086 }[role] },
    spring: {
      application: { name: names[role] },
      profiles: { active: 'isolated-native', include: 'sys' },
      cloud: {
        bootstrap: { enabled: false }, discovery: { enabled: false },
        nacos: {
          config: { enabled: true, 'server-addr': nacosAddress, group, 'file-extension': 'yaml' },
          discovery: { enabled: false, 'register-enabled': false, 'server-addr': nacosAddress, group },
        },
      },
      redis: { host: names.redis, port: 6379, database: 0 },
      liquibase: { enabled: false }, flyway: { enabled: false },
      jpa: { 'generate-ddl': false, hibernate: { 'ddl-auto': 'none' } },
      sql: { init: { mode: 'never' } },
      main: { 'allow-bean-definition-overriding': true, 'allow-circular-references': true },
    },
    eureka: { client: { enabled: false } },
    jobs: { enabled: false },
    springfox: { documentation: { enabled: false } },
    ibiz: {
      tenant: true, cacheLevel: 'L2',
      auth: { passwordStorageMode: 'sm3', passwordEncryptMode: 'none', imageCaptcha: { enable: false } },
      jwt: { signature: 'MAC', secret: retained['ibiz.jwt.secret'] },
      ref: { service: { rt: { version: 'ISOLATED_NATIVE_NO_SYNC' } } },
    },
  });
  const servicehub = (role, systems, sources) => ({
    id: names[role], initmode: 'auto', localmode: true,
    'register-naming-service': false, 'publish-config': false,
    tempfolder: `/tmp/${role}/tempfile`, filefolder: `/tmp/${role}/datafile`,
    deploysystems: systems, datasources: sources,
    systemsettings: { cloudclientutil: {
      serviceurl: allinoneOrigin, accesstokenurl: `${allinoneOrigin}/v7/login`,
      clientid: '', clientsecret: '',
    } },
  });

  const allinone = common('allinone');
  Object.assign(allinone.spring, springDatasource(uaaSource, false));
  // Seed appgateway-default in Nacos first: the EBSX loader ignores publish-config.
  allinone.ibiz['appgateway-default'] = { deployapps: '' };
  allinone.ibiz.deploysystems = {
    gateway: gatewaySystem(names.redis, retained['ibiz.jwt.secret'], 'owneduaa'),
    ebsx: {
      deploysystemid: 'ebsx',
      runtimeclassname: 'net.ibizsys.central.cloud.saas.ebsx.EBSXSystemRuntime',
      updatedbschema: false, extension: false, enablereload: false, installdata: false,
      settings: { sysdbscheme: { default: { datasource: 'owneduaa' } } },
    },
  };
  allinone.ibiz.servicehub = servicehub('allinone', ['gateway', 'ebsx'], { owneduaa: uaaSource });

  const provider = common('provider');
  Object.assign(provider.spring, springDatasource(metadataSource, true));
  provider.ibiz.deploysystems = {
    gateway: gatewaySystem(names.redis, retained['ibiz.jwt.secret'], 'DEFAULT'),
    ibizmodeling: {
      deploysystemid: 'ibizmodeling', modelpath: '/app/model',
      updatedbschema: false, extension: false, enablereload: false, installdata: false,
      settings: { sysdbscheme: { default: { datasource: 'DEFAULT' } } },
    },
  };
  provider.ibiz.servicehub = servicehub('provider', ['gateway', 'ibizmodeling'],
    { DEFAULT: metadataSource });

  const gateway = common('gateway');
  gateway.ibiz.appgateway = {
    id: 'default', tempfolder: '/tmp/gateway/tempfile', filefolder: '/tmp/gateway/datafile',
  };
  const routing = {
    deployapps: [], tempfolder: '/tmp/gateway/tempfile', filefolder: '/tmp/gateway/datafile',
    routes: [
      route('owned-modeling-api', `http://${names.provider}:32002`, ['/api/**'], 0),
      route('owned-backend-auth', allinoneOrigin, ['/v7/login', '/uaa/**', '/appdata/**'], 1),
      route('owned-retained-uaa', uaaOrigin, ['/auths/**', '/oauth/**'], 2),
    ],
  };
  return {
    services: { allinone: flatten(allinone), provider: flatten(provider), gateway: flatten(gateway) },
    nacosConfigs: [
      { dataId: 'appgateway-default', group, content: JSON.stringify(routing) },
      { dataId: 'cloud-auth', group, content: JSON.stringify({ agents: ['RT'] }) },
      { dataId: 'cloud-auth-agent-rt', group,
        content: JSON.stringify({ serviceurl: uaaOrigin, accesstokenurl: '/auths/login' }) },
    ],
  };
}
