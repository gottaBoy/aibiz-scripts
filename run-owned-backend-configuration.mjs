import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { workflowIdentity } from './bootstrap-owned-workflow-schema.mjs';
import { ebsxIdentity } from './bootstrap-owned-ebsx-schema.mjs';
import { platformIdentity } from './bootstrap-owned-platform-schema.mjs';
import {
  ownedModelingApplicationRoute, ownedModelingConfigurationRoute, ownedCentralMemberRoute,
} from './owned-modeling-application-routes.mjs';

export const OWNED_BACKEND_CONFIGURATION_BOUNDARY = Object.freeze({
  contract: 'run-owned-backend-configuration-candidate-v1',
  nativeAcceptance: false,
  permissionAcceptance: false,
  prerequisites: Object.freeze([
    'Launch with exclusive spring.config.location; do not merge classpath application-auto.yml.',
    'Publish and read back owned Nacos inputs before starting the backend services.',
  ]),
  blockers: Object.freeze([
    'The complete EBSX application schema requires separate model-derived verification; scoped schema readiness is not seed or application acceptance.',
    'Gateway UNISTATE must use the explicitly owned ZooKeeper peer; service startup and permissions require actual verification.',
    'RTJWTCloudUAAUtilRuntime requires an exact owned lb://uaa-api Nacos alias; registration/readback alone is not user-info or refresh acceptance.',
    'Cloud service OAuth credentials are not provisioned; scoped ordinary users must not substitute for them.',
  ]),
});

const serviceRoles = ['allinone', 'provider', 'gateway', 'nacos', 'zookeeper', 'redis', 'uaa'];
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
    'Exactly seven owned service names are required');
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
  for (const role of ['allinone', 'provider', 'gateway', 'nacos', 'zookeeper']) {
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

function gatewaySystem(redis, secret, defaultDatasource, zookeeper) {
  return {
    deploysystemid: 'gateway', updatedbschema: false, extension: false,
    enablereload: false, installdata: false,
    settings: {
      sysutil: {
        cache: { serviceurl: `${redis}:6379`, servicehost: redis, serviceport: 6379 },
        unistate: { serviceurl: `${zookeeper}:2181`, servicehost: zookeeper, serviceport: 2181 },
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

export function ownedExtensionRoute(runId, allinoneName) {
  requireInput(/^[a-f0-9]{12}$/.test(runId), 'Invalid owned run');
  requireInput(new RegExp(`^nf-${runId}-backend-[a-z0-9][a-z0-9-]{0,48}-allinone$`).test(allinoneName),
    'Extension route must select the exact owned allinone');
  return {
    ...route('owned-platform-extension', `http://${allinoneName}:30000`, ['/extension/**'], 4),
    // The owned nginx has already removed the app prefix used by GatewayUtils.
    filters: ['StripPrefix=1', 'PrefixPath=/extension/api'],
  };
}

export function ownedNacosContent(value) {
  requireInput(plainObject(value), 'Owned Nacos payload must be a structured object');
  // ConfigEntity's JSON branch converts a String instead of parsing it.
  // JSON inside an explicit YAML document uses its working SnakeYAML branch.
  return `---\n${JSON.stringify(value)}\n`;
}

export function parseOwnedNacosContent(content) {
  requireInput(typeof content === 'string' && content.startsWith('---\n'),
    'Owned Nacos payload requires an explicit YAML document');
  const value = JSON.parse(content.slice(4));
  requireInput(plainObject(value), 'Owned Nacos payload must be a structured object');
  return value;
}

/**
 * Pure private-input builder. Returned configs contain secrets and must only be
 * persisted privately by the resource owner. This is not a startup receipt.
 */
export function createOwnedBackendConfiguration(input) {
  requireInput(plainObject(input), 'Owned backend configuration inputs are required');
  const { manifest, accounts, credentials, retainedUaaConfiguration: retained, names, workflow, ebsx, platform,
    modelingRouteProbe, centralMemberBinding } = input;
  try { validateMatrixFixture(manifest); }
  catch { throw new Error('Invalid run-owned fixture manifest; supplied values suppressed'); }
  equals(manifest.passwordStorageMode, 'sm3', 'This configuration requires the declared SM3 fixture');
  validateNames(manifest.runId, names);
  validateAccounts(manifest, accounts, credentials, retained, names);
  let modelingRoute;
  try {
    modelingRoute = ownedModelingApplicationRoute(modelingRouteProbe, `http://${names.provider}:32002`);
  } catch { throw new Error('Invalid packaged application-route probe; supplied values suppressed'); }
  let centralReadRoute;
  if (centralMemberBinding !== undefined) {
    try {
      centralReadRoute = ownedCentralMemberRoute(
        modelingRouteProbe, `http://${names.provider}:32002`, centralMemberBinding,
      );
    } catch { throw new Error('Invalid staged Central member route input; supplied values suppressed'); }
  }

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
        bootstrap: { enabled: false }, discovery: { enabled: true },
        nacos: {
          config: { enabled: true, 'server-addr': nacosAddress, group, 'file-extension': 'yaml' },
          discovery: { enabled: true, 'register-enabled': false, 'server-addr': nacosAddress, group },
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
    enableappgateway: role === 'provider',
    tempfolder: `/tmp/${role}/tempfile`, filefolder: `/tmp/${role}/datafile`,
    deploysystems: systems, datasources: sources,
    systemsettings: {
      cloudclientutil: {
        serviceurl: allinoneOrigin, accesstokenurl: `${allinoneOrigin}/v7/login`,
        clientid: '', clientsecret: '',
      },
      cloudwfutil: { schemaupdate: false, ayncexecutoractivate: false },
    },
  });

  const allinone = common('allinone');
  Object.assign(allinone.spring, springDatasource(uaaSource, false));
  // Seed appgateway-default in Nacos first: the EBSX loader ignores publish-config.
  allinone.ibiz['appgateway-default'] = { deployapps: '' };
  allinone.ibiz.deploysystems = {
    gateway: gatewaySystem(names.redis, retained['ibiz.jwt.secret'], 'owneduaa', names.zookeeper),
    ebsx: {
      deploysystemid: 'ebsx',
      runtimeclassname: 'net.ibizsys.central.cloud.saas.ebsx.EBSXSystemRuntime',
      updatedbschema: false, extension: false, enablereload: false, installdata: false,
      settings: { sysdbscheme: { default: { datasource: 'owneduaa' } } },
    },
  };
  allinone.ibiz.servicehub = servicehub('allinone', ['gateway', 'ebsx'], { owneduaa: uaaSource });
  if (workflow !== undefined) {
    const identity = workflowIdentity(manifest.runId);
    requireInput(plainObject(workflow), 'Explicit owned workflow configuration required');
    equals(workflow.url, identity.url, 'Workflow must use the separate owned schema');
    equals(workflow.username, identity.runtimeUser, 'Workflow must use its scoped runtime principal');
    equals(workflow.schema, identity.schema, 'Workflow schema binding differs');
    equals(workflow.schemaUpdate, false, 'Runtime workflow schema updates must stay disabled');
    requireInput(passwordPattern.test(workflow.password ?? ''), 'Invalid private workflow password');
    allinone.ibiz.servicehub.datasources.ownedworkflow = datasource(
      workflow.url, workflow.username, workflow.password, workflow.schema);
    allinone.ibiz.servicehub.systemsettings.cloudwfutil.datasource = 'ownedworkflow';
  }
  if (ebsx !== undefined) {
    const identity = ebsxIdentity(manifest.runId);
    requireInput(plainObject(ebsx), 'Explicit owned EBSX configuration required');
    equals(ebsx.url, identity.url, 'EBSX must use its separate owned schema');
    equals(ebsx.username, identity.runtimeUser, 'EBSX must use its scoped runtime principal');
    equals(ebsx.schema, identity.schema, 'EBSX schema binding differs');
    equals(ebsx.schemaUpdate, false, 'Runtime EBSX schema updates must stay disabled');
    requireInput(Array.isArray(ebsx.logicalDatasources)
      && JSON.stringify(ebsx.logicalDatasources) === JSON.stringify(['DEFAULT', 'DB2', 'DB3']),
    'EBSX logical datasource mapping differs');
    requireInput(passwordPattern.test(ebsx.password ?? ''), 'Invalid private EBSX password');
    // The packaged MyBatis adapter joins batch statements with semicolons.
    const source = datasource(`${ebsx.url}&allowMultiQueries=true`, ebsx.username, ebsx.password, ebsx.schema);
    Object.assign(allinone.spring, springDatasource(source, false));
    delete allinone.ibiz.servicehub.datasources.owneduaa;
    allinone.ibiz.servicehub.datasources.ownedebsx = source;
    allinone.ibiz.deploysystems.gateway.settings.sysdbscheme.default.datasource = 'ownedebsx';
    allinone.ibiz.deploysystems.ebsx.settings.sysdbscheme = Object.fromEntries(
      ['default', 'db2', 'db3'].map(link => [link, { datasource: 'ownedebsx' }]));
  }
  if (platform !== undefined) {
    requireInput(ebsx !== undefined, 'Platform projection requires the verified separate EBSX schema');
    const identity = platformIdentity(manifest.runId);
    requireInput(plainObject(platform), 'Explicit owned platform configuration required');
    equals(platform.url, identity.url, 'Platform must use its separate owned schema');
    equals(platform.username, identity.runtimeUser, 'Platform must use its scoped runtime principal');
    equals(platform.schema, identity.schema, 'Platform schema binding differs');
    equals(platform.schemaUpdate, false, 'Runtime platform schema updates must stay disabled');
    equals(platform.deploySystemId, 'extension', 'Platform runtime must deploy the real extension system');
    equals(platform.runtimeClassName, 'net.ibizsys.central.cloud.saas.extension.runtime.SystemRuntime',
      'Platform runtime class binding differs');
    requireInput(Array.isArray(platform.logicalDatasources)
      && JSON.stringify(platform.logicalDatasources) === JSON.stringify(['DEFAULT']),
    'Platform logical datasource mapping differs');
    requireInput(passwordPattern.test(platform.password ?? ''), 'Invalid private platform password');
    allinone.ibiz.servicehub.datasources.ownedplatform = datasource(
      platform.url, platform.username, platform.password, platform.schema);
    allinone.ibiz.servicehub.deploysystems.push('extension');
    allinone.ibiz.deploysystems.extension = {
      deploysystemid: 'extension', runtimeclassname: platform.runtimeClassName,
      updatedbschema: false, extension: false, enablereload: false, installdata: false,
      settings: { sysdbscheme: { default: { datasource: 'ownedplatform' } } },
    };
  }

  const provider = common('provider');
  Object.assign(provider.spring, springDatasource(metadataSource, true));
  provider.ibiz.deploysystems = {
    gateway: gatewaySystem(names.redis, retained['ibiz.jwt.secret'], 'DEFAULT', names.zookeeper),
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
      modelingRoute,
      ownedModelingConfigurationRoute(`http://${names.provider}:32002`),
      ...(centralReadRoute ? [centralReadRoute] : []),
      route('owned-backend-auth', allinoneOrigin, ['/v7/login', '/uaa/**', '/appdata/**'], 1),
      route('owned-retained-uaa', uaaOrigin, ['/auths/**', '/oauth/**'], 2),
      route('owned-platform-config', allinoneOrigin, ['/configs/**', '/dictionaries/**'], 3),
      ...(platform === undefined ? [] : [
        ownedExtensionRoute(manifest.runId, names.allinone),
      ]),
    ],
  };
  return {
    services: { allinone: flatten(allinone), provider: flatten(provider), gateway: flatten(gateway) },
    nacosConfigs: [
      { dataId: 'appgateway-default', group, content: ownedNacosContent(routing) },
      { dataId: 'cloud-auth', group, content: ownedNacosContent({ agents: ['RT'] }) },
      { dataId: 'cloud-auth-agent-rt', group,
        content: ownedNacosContent({ serviceurl: uaaOrigin, accesstokenurl: '/auths/login' }) },
    ],
  };
}
