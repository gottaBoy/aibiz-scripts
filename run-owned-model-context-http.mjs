#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fingerprint, PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import { readNativeFiveDatasetContract } from './native-five-dataset-contract.mjs';
import {
  editorPhysicalInventorySQL, editorPhysicalSnapshotSQL, normalizeEditorPhysicalSnapshot,
  validateEditorPhysicalInventory,
} from './probe-owned-editor-registry-http.mjs';
import { assertA01ReadOnlySQL } from './run-owned-a01-root-http.mjs';
import {
  parseJavaProperties, REDIS_IMAGE_ID, UAA_CONSOLE_LOGGING, UAA_ENTRYPOINT, UAA_JAVA_OPTIONS,
} from './harness-run-owned-uaa-runtime.mjs';
import { parseOwnedNacosContent } from './run-owned-backend-configuration.mjs';
import {
  MODEL_CONTEXT_ACCEPTANCE_SCOPE, MODEL_CONTEXT_SOURCE_PATH, createModelContextPlan,
  modelContextFailureDetails, runOwnedModelContextChecks,
} from './owned-model-context-http.mjs';

const workspaceDefault = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const MODEL_CONTEXT_IMAGE_ARTIFACTS = Object.freeze({
  allinone: Object.freeze({
    jar: '/ibiz-ebsx-allinone-rt.jar',
    archive: 'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar',
    recipe: 'ibiz-ebsx-runtime/src/main/docker/Dockerfile',
  }),
  gateway: Object.freeze({
    jar: '/ibiz-ebsx-gateway.jar',
    archive: 'ibiz-ebsx-gateway/ibiz-ebsx-gateway.jar',
    recipe: 'ibiz-ebsx-gateway/src/main/docker/Dockerfile',
  }),
  provider: Object.freeze({
    jar: '/ibizservicerunner-provider.jar',
    archive: 'ibiz-service-runner/ibizservicerunner-provider.jar',
    recipe: 'modelingservice/Dockerfile',
  }),
});
const providerScripts = Object.freeze({
  '/entrypoint-waitfor.sh': 'modelingservice/docker/entrypoint-waitfor.sh',
  '/wait-for.sh': 'modelingservice/docker/wait-for.sh',
});
export const MODEL_CONTEXT_TOOL_INPUTS = Object.freeze([
  'scripts/owned-model-context-http.mjs', 'scripts/run-owned-model-context-http.mjs',
  'scripts/owned-platform-http.mjs', 'scripts/owned-native-runtime-context.mjs',
  'scripts/owned-a01-root-http.mjs', 'scripts/run-owned-a01-root-http.mjs',
  'scripts/run-owned-native-permission-http.mjs', 'scripts/harness-run-owned-uaa-runtime.mjs',
  'scripts/prepare-run-owned-native-nonadmin-matrix.mjs',
  'scripts/native-five-dataset-contract.mjs', 'scripts/probe-owned-editor-registry-http.mjs',
  'scripts/native-candidate-files.mjs', 'scripts/owned-mysql-volume.mjs',
  'scripts/native-model-design-owned-backend-input.mjs', 'scripts/run-owned-backend-configuration.mjs',
  'scripts/owned-uaa-token-witness.mjs', 'scripts/source-build-identity.mjs',
]);
const inside = (base, path) => {
  const child = relative(resolve(base), resolve(path));
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'),
    'Model context input must stay within the workspace');
};

export function javaMethodBytes(source, signature) {
  assert.equal(typeof source, 'string');
  const start = source.indexOf(signature);
  assert.ok(start >= 0 && source.indexOf(signature, start + signature.length) < 0,
    'Expected one exact native Java method');
  const open = source.indexOf('{', start + signature.length);
  assert.ok(open >= 0);
  let depth = 0;
  let state = 'code';
  for (let index = open; index < source.length; index++) {
    const character = source[index];
    const next = source[index + 1];
    if (state === 'line') { if (character === '\n') state = 'code'; continue; }
    if (state === 'comment') {
      if (character === '*' && next === '/') { state = 'code'; index++; }
      continue;
    }
    if (state === '"' || state === "'") {
      if (character === '\\') index++;
      else if (character === state) state = 'code';
      continue;
    }
    if (character === '/' && next === '/') { state = 'line'; index++; continue; }
    if (character === '/' && next === '*') { state = 'comment'; index++; continue; }
    if (character === '"' || character === "'") { state = character; continue; }
    if (character === '{') depth++;
    if (character === '}' && --depth === 0) return Buffer.from(source.slice(start, index + 1));
  }
  assert.fail('Unterminated Java method cannot be bound');
}

export function verifyModelContextComponentFiles(component) {
  assert.ok(Object.hasOwn(MODEL_CONTEXT_IMAGE_ARTIFACTS, component?.name),
    'Only exact own reviewed backend component names are eligible');
  const spec = MODEL_CONTEXT_IMAGE_ARTIFACTS[component?.name];
  assert.ok(spec, 'Only the exact reviewed backend image components are eligible');
  const scripts = component.name === 'provider' ? Object.keys(providerScripts) : [];
  assert.deepEqual(component.imageFiles?.map(file => file.path).sort(),
    [spec.jar, ...scripts].sort(), 'Image files must retain the exact one-JAR or provider three-file roster');
  assert.deepEqual(component.recipeInputs?.map(input => input.path).sort(),
    [spec.recipe, ...scripts.map(path => providerScripts[path])].sort(),
    'Image recipe input roster must bind its Dockerfile and exact provider startup scripts');
  for (const file of [...component.imageFiles, ...component.recipeInputs]) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
  }
  for (const path of scripts) {
    const file = component.imageFiles.find(file => file.path === path);
    const recipe = component.recipeInputs.find(input => input.path === providerScripts[path]);
    assert.deepEqual([file.sha256, file.bytes], [recipe.sha256, recipe.bytes],
      'The exact provider image startup script must match its recipe input hash and bytes');
  }
  return { spec, jar: component.imageFiles.find(file => file.path === spec.jar) };
}

export function verifyModelContextSourceBinding(sourceBytes, packageEntry, imageReceipt, packageReceipt) {
  assert.equal(packageReceipt.contract, 'isolated-backend-source-package-v1');
  assert.equal(packageReceipt.status, 'passed-package-and-unit-only');
  assert.equal(packageReceipt.sourcePackageVerified, true);
  assert.equal(packageReceipt.unitRegression, true);
  assert.equal(imageReceipt.contract, 'isolated-backend-source-images-v1');
  assert.equal(imageReceipt.status, 'passed-image-artifact-binding-only');
  assert.equal(imageReceipt.imageArtifactBindingVerified, true);
  assert.equal(imageReceipt.packageReceipt.sourceFingerprint, packageReceipt.sourceInputs.before.fingerprint);
  assert.equal(packageEntry?.path, MODEL_CONTEXT_SOURCE_PATH);
  assert.equal(hash(sourceBytes), packageEntry.sha256, 'Current metadata source must match packaged source');
  assert.equal(sourceBytes.length, packageEntry.bytes);
  const source = sourceBytes.toString('utf8');
  const appData = javaMethodBytes(source,
    'protected AppData onGetAppData(String strSystemTag, String strOrgId) throws Throwable');
  const preparation = javaMethodBytes(source,
    'protected void prepareModelContext(AppData appData, IPSDevUser actor, IPSDevSysUser user) throws Exception');
  assert.ok(source.includes('APPDATA_MODEL_CONTEXT = "srfmodelcontext"'));
  assert.ok(appData.toString().includes('this.prepareModelContext(appData, iPSDevUser, iPSDevSysUser)'));
  for (const expression of [
    'appData.reset(APPDATA_MODEL_CONTEXT)', 'ActionSessionManager.getAppContext()',
    'appContext.get("PSDEVSLNSYS")', 'IPSDevUserBase.ACCMODE_READ',
    'actor.getPSDevUserId().equalsIgnoreCase(user.getPSDevUserId())',
    'actor.getPSDevCenterId().equalsIgnoreCase(user.getPSDevCenterId())',
    'context.put("psdevslnsys", (String) root)', 'context.put("pssystemid", user.getPSSystemId())',
    'Collections.unmodifiableMap(context)',
  ]) assert.ok(preparation.toString().includes(expression), 'Missing reviewed native metadata contract');
  assert.equal(imageReceipt.components.length, 3);
  assert.deepEqual(imageReceipt.components.map(component => component.name).sort(),
    ['allinone', 'gateway', 'provider']);
  assert.deepEqual(packageReceipt.packages.archives.map(archive => archive.path).sort(),
    Object.values(MODEL_CONTEXT_IMAGE_ARTIFACTS).map(spec => spec.archive).sort(),
    'Only the exact three reviewed backend package archives are eligible');
  for (const component of imageReceipt.components) {
    const { spec, jar } = verifyModelContextComponentFiles(component);
    const archive = packageReceipt.packages.archives.find(row => row.path === spec.archive);
    assert.ok(archive);
    assert.deepEqual([jar.sha256, jar.bytes],
      [archive.sha256, archive.bytes], 'Image JAR must bind the package archive');
  }
  return {
    sourcePath: MODEL_CONTEXT_SOURCE_PATH, sourceSha256: hash(sourceBytes),
    packageSourceSha256: packageEntry.sha256,
    methods: {
      onGetAppData: { sha256: hash(appData), bytes: appData.length },
      prepareModelContext: { sha256: hash(preparation), bytes: preparation.length },
    },
  };
}

export function guardModelContextBindings(context, directories, bindings) {
  const live = context.guard();
  for (const binding of bindings) {
    const input = readPinnedFile(directories, binding.parent, binding.name);
    assert.equal(hash(input.data), binding.sha256, 'Model context source/package/tool input drift');
  }
  return live;
}

export function verifyModelContextMountLayout({ workspace, deploymentInput, context, startup, live, images }) {
  const directory = dirname(resolve(workspace, deploymentInput));
  assert.equal(dirname(directory), context.base);
  const label = basename(directory).replace(/^backend-runtime-/, '');
  assert.equal(basename(directory), `backend-runtime-${label}`);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(startup.contract, 'run-owned-native-backend-startup-v1');
  assert.equal(startup.runId, context.manifest.runId);
  assert.equal(startup.label, label);
  assert.equal(startup.status, 'passed-owned-backend-http-transport-only');
  assert.equal(startup.actualBackendStarted, true);
  assert.equal(startup.retainedOwned, true);
  assert.deepEqual(startup.services, context.deployment.services);
  assert.equal(resolve(workspace, startup.deploymentInput.path), resolve(workspace, deploymentInput));
  const modelPath = join(directory, 'model-input');
  assert.equal(resolve(workspace, startup.modelInput.stagedPath), modelPath);
  assert.match(startup.modelInput.fingerprint, /^[a-f0-9]{64}$/);
  const configs = [];
  for (const role of ['allinone', 'gateway', 'provider']) {
    const matches = live.containers.filter(row => row.Id === context.deployment.services[role].containerId);
    assert.equal(matches.length, 1);
    const container = matches[0];
    const image = images.components.find(component => component.name === role);
    const artifact = verifyModelContextComponentFiles(image);
    assert.equal(container.Image, context.deployment.services[role].imageId);
    const expected = [
      [join(directory, `${role}-config/application.properties`), '/app/config/application.properties'],
      [join(directory, `${role}-config/logback.xml`), '/app/config/logback.xml'],
      ...(role === 'provider' ? [[modelPath, '/app/model']] : []),
    ];
    const mounts = container.Mounts.filter(mount => mount.Type !== 'tmpfs');
    assert.deepEqual(mounts.map(mount => [mount.Source, mount.Destination]).sort(),
      expected.sort(), 'Only exact current startup inputs may be mounted; JAR/entrypoint shadows are forbidden');
    assert.ok(mounts.every(mount => mount.Type === 'bind' && mount.RW === false));
    for (const mount of mounts) {
      const jar = artifact.jar.path;
      assert.ok(!(jar === mount.Destination || jar.startsWith(`${mount.Destination}/`)),
        'A mount cannot shadow the immutable image JAR');
    }
    if (role === 'provider') {
      assert.deepEqual(container.Config.Entrypoint, ['/entrypoint-waitfor.sh']);
      assert.deepEqual(container.Config.Cmd, [
        `${context.manifest.ownership.mysqlContainer}:3306`,
        `nf-${context.manifest.runId}-backend-${label}-nacos:8848`,
        '--', '--spring.config.location=file:/app/config/application.properties',
      ]);
    } else {
      assert.deepEqual(container.Config.Entrypoint, ['java']);
      assert.deepEqual(container.Config.Cmd, [
        '--add-opens=java.base/java.lang=ALL-UNNAMED',
        '--add-opens=java.base/java.lang.reflect=ALL-UNNAMED',
        '-Duser.timezone=Asia/Shanghai', '-jar', artifact.jar.path,
        '--spring.config.location=file:/app/config/application.properties',
      ]);
    }
    configs.push({ role, properties: join(directory, `${role}-config/application.properties`),
      logging: join(directory, `${role}-config/logback.xml`), environment: container.Config.Env ?? [],
      command: [...(container.Config.Entrypoint ?? []), ...(container.Config.Cmd ?? [])] });
  }
  const uaa = live.containers.filter(row => row.Id === context.deployment.services.uaa.containerId);
  assert.equal(uaa.length, 1);
  assert.equal(uaa[0].Image, context.deployment.services.uaa.imageId);
  const uaaMounts = uaa[0].Mounts.filter(mount => mount.Type !== 'tmpfs');
  const uaaConfigMount = uaaMounts.filter(mount => mount.Destination === '/opt/uaa/config');
  assert.equal(uaaConfigMount.length, 1);
  const uaaDirectory = dirname(uaaConfigMount[0].Source);
  assert.equal(dirname(uaaDirectory), context.base);
  assert.match(basename(uaaDirectory), /^uaa-runtime-[a-z0-9][a-z0-9-]{0,48}$/);
  const uaaConfigPath = join(uaaDirectory, 'config');
  const witnessPath = join(uaaDirectory, 'token-witness-classes');
  assert.deepEqual(uaaMounts.map(mount => [mount.Source, mount.Destination]).sort(), [
    [uaaConfigPath, '/opt/uaa/config'], [witnessPath, '/opt/uaa/witness'],
  ].sort(), 'Retained UAA permits only its exact configuration and receipt-bound TokenStore witness mounts');
  assert.ok(uaaMounts.every(mount => mount.Type === 'bind' && mount.RW === false));
  assert.deepEqual(uaa[0].Config.Entrypoint, UAA_ENTRYPOINT,
    'The fixture witness cannot enter the UAA application classpath');
  assert.deepEqual(uaa[0].Config.Cmd, [
    '--spring.config.location=classpath:/,file:/opt/uaa/config/application.properties',
  ]);
  assert.equal(uaa[0].Config.User, '65532:65532');
  const uaaEnvironment = uaa[0].Config.Env ?? [];
  for (const expected of [
    'SPRING_CLOUD_BOOTSTRAP_ENABLED=false', 'SPRING_CLOUD_NACOS_CONFIG_ENABLED=false',
    'SPRING_CLOUD_NACOS_DISCOVERY_ENABLED=false', `JAVA_TOOL_OPTIONS=${UAA_JAVA_OPTIONS}`,
  ]) {
    const key = expected.slice(0, expected.indexOf('='));
    assert.deepEqual(uaaEnvironment.filter(entry => entry.startsWith(`${key}=`)), [expected]);
  }
  assert.ok(!uaaEnvironment.some(entry => /^(?:_JAVA_OPTIONS|JDK_JAVA_OPTIONS|CLASSPATH)=/.test(entry)),
    'Unexpected JVM/classpath environment overrides are forbidden');
  configs.push({ role: 'uaa', properties: join(uaaConfigPath, 'application.properties'),
    logging: join(uaaConfigPath, 'logback.xml'), directory: uaaConfigPath,
    environment: uaa[0].Config.Env ?? [],
    command: [...(uaa[0].Config.Entrypoint ?? []), ...(uaa[0].Config.Cmd ?? [])] });
  return { modelPath, configs, nacosPath: join(directory, 'nacos-configs.private.json'),
    retainedUaa: { directory: uaaDirectory, reportPath: join(uaaDirectory, 'report.json'), witnessPath } };
}

export function bindModelContextTokenWitness({ workspace, context, startup, live, layout, directories, read }) {
  const retained = layout.retainedUaa;
  const reportBytes = read(retained.reportPath);
  const startupBinding = startup.inputs.filter(input =>
    resolve(workspace, input.path) === retained.reportPath);
  assert.equal(startupBinding.length, 1, 'Retained UAA witness needs its exact backend startup receipt binding');
  assert.deepEqual([hash(reportBytes), reportBytes.length],
    [startupBinding[0].sha256, startupBinding[0].bytes]);
  const reportHashPath = join(retained.directory, 'report.sha256');
  const reportHashBytes = read(reportHashPath);
  assert.equal(reportHashBytes.toString().trim(), hash(reportBytes));
  const receipt = JSON.parse(reportBytes);
  assert.equal(receipt.contract, 'run-owned-source-uaa-native-http-probe-v1');
  assert.equal(receipt.runId, context.manifest.runId);
  assert.equal(receipt.status, 'passed-scoped-native-uaa-http-only');
  for (const key of [
    'actualBootApplicationStarted', 'actualHttpLoginVerified', 'actualTokenSecurityVerified', 'retainedOwned',
  ]) assert.equal(receipt[key], true);
  assert.equal(receipt.tokenExpirationMilliseconds, 20000);
  assert.deepEqual(receipt.checks.map(({ id, status }) => ({ id, status })), [
    'anonymous-user-info-self-denied',
    ...context.manifest.users.flatMap(user => [
      `${user.loginname}-wrong-password-denied`, `${user.loginname}-login-and-self`,
    ]),
    'signed-security-positive-control', 'tampered-signature-token-denied', 'expired-signed-token-denied',
  ].map(id => ({ id, status: 'pass' })));
  assert.deepEqual(Object.keys(receipt.services).sort(), ['redis', 'uaa']);
  assert.deepEqual(receipt.services.uaa, context.deployment.services.uaa);
  const redis = context.deployment.auxiliaryContainers.filter(row => row.role === 'redis');
  assert.equal(redis.length, 1);
  assert.deepEqual(receipt.services.redis, {
    containerId: redis[0].containerId, imageId: REDIS_IMAGE_ID,
  });
  assert.equal(redis[0].imageId, REDIS_IMAGE_ID);
  const currentRedis = live.containers.filter(row => row.Id === redis[0].containerId);
  assert.equal(currentRedis.length, 1);
  assert.equal(currentRedis[0].Image, REDIS_IMAGE_ID);
  const witness = receipt.tokenStoreWitness;
  assert.equal(witness.fixtureOnly, true);
  const sourcePath = join(workspace, 'standalone-uaa/tools/RedisTokenStoreWitness.java');
  assert.equal(witness.sourcePath, sourcePath);
  assert.equal(witness.compilerImageId, receipt.services.uaa.imageId);
  const sourceDirectory = join(retained.directory, 'token-witness-source');
  const stagedSourcePath = join(sourceDirectory, 'RedisTokenStoreWitness.java');
  const compileLogPath = join(retained.directory, 'token-witness-compile.log');
  assert.deepEqual(witness.command, [
    'run', '--rm', '--pull=never', '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', `${process.geteuid()}:${process.getegid()}`,
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
    '--mount', `type=bind,src=${sourceDirectory},dst=/helper,readonly`,
    '--mount', `type=bind,src=${retained.witnessPath},dst=/output`,
    '--entrypoint', 'javac', receipt.services.uaa.imageId, '--release', '8', '-proc:none', '-implicit:none',
    '-sourcepath', '', '-cp', UAA_ENTRYPOINT[3], '-d', '/output', '/helper/RedisTokenStoreWitness.java',
  ], 'Witness compile provenance must retain the exact maintained offline command and image');
  const files = [
    { path: retained.reportPath, bytes: reportBytes },
    { path: reportHashPath, bytes: reportHashBytes },
    ...[sourcePath, stagedSourcePath, compileLogPath].map(path => ({ path, bytes: read(path) })),
  ].map(({ path, bytes }) => ({
    path, parent: directories.open(dirname(path)), name: basename(path), sha256: hash(bytes),
  }));
  assert.match(witness.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(files.find(row => row.path === sourcePath).sha256, witness.sourceSha256);
  assert.equal(files.find(row => row.path === stagedSourcePath).sha256, witness.sourceSha256);
  assert.equal(files.find(row => row.path === compileLogPath).sha256, witness.compileLogSha256);
  const pinnedSource = directories.open(sourceDirectory);
  const pinnedClasses = directories.open(retained.witnessPath);
  const classNames = ['RedisTokenStoreWitness.class', 'RedisTokenStoreWitness$1.class'];
  const flatFiles = (directory, expected) => {
    directories.verify(directory);
    const entries = fs.readdirSync(directory.access, { withFileTypes: true });
    assert.deepEqual(entries.map(entry => entry.name).sort(), [...expected].sort(),
      'Witness directories permit only the complete receipt-bound flat file set');
    assert.ok(entries.every(entry => entry.isFile()), 'Witness tree directories and symlinks are forbidden');
    directories.verify(directory);
  };
  const classInventory = () => {
    flatFiles(pinnedClasses, classNames);
    const entries = classNames.map(path => {
      const file = readPinnedFile(directories, pinnedClasses, path);
      assert.equal(file.identity.mode & 0o777, 0o644);
      return { path, bytes: file.data.length, sha256: hash(file.data), mode: file.identity.mode & 0o777 };
    }).sort((a, b) => a.path.localeCompare(b.path));
    return { ...fingerprint(entries), entries };
  };
  const verify = () => {
    flatFiles(pinnedSource, ['RedisTokenStoreWitness.java']);
    for (const file of files) {
      assert.equal(hash(readPinnedFile(directories, file.parent, file.name).data), file.sha256,
        'Retained UAA witness source/compile/receipt drift before or after HTTP');
    }
    assert.deepEqual(classInventory(), witness.classes,
      'Retained UAA witness classes, modes and fingerprint must match their exact receipt');
  };
  verify();
  return { verify, evidence: {
    receipt: { path: retained.reportPath, sha256: hash(reportBytes) },
    path: retained.witnessPath, sourcePath, sourceSha256: witness.sourceSha256,
    stagedSourcePath, compilerImageId: witness.compilerImageId,
    compileCommandSha256: hash(json(witness.command)), compileLogSha256: witness.compileLogSha256,
    files: witness.classes.files, bytes: witness.classes.bytes, fingerprint: witness.classes.fingerprint,
    fixtureOnly: true, applicationClasspathExcludesWitness: true,
  } };
}

export function verifyModelContextAutoUpgrade({ source, properties, nacos, containers }) {
  assert.ok(source.includes('.getParam("modelautoupgrate", false)'),
    'The packaged/current source must prove the absent-setting false default');
  const explicitFalse = [];
  const flag = key => /modelauto(?:upgrate|upgrade)/i.test(key.replace(/[^a-z0-9]/gi, ''));
  const visit = (value, path) => {
    if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, `${path}.${index}`)); return; }
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) visit(entry, `${path}.${key}`);
      return;
    }
    if (!flag(path)) return;
    assert.ok(value === false || value === 'false', 'Auto-upgrade must be explicitly false, never an unknown boolean');
    explicitFalse.push(path);
  };
  for (const config of properties) visit(config.values, config.role);
  for (const row of nacos) visit(parseOwnedNacosContent(row.content), `nacos.${row.dataId}`);
  for (const container of containers) {
    for (const entry of [...container.environment, ...container.command]) {
      if (!flag(entry)) continue;
      assert.match(entry, /(?:^|[\s=])(?:--|-D)?[A-Za-z0-9_.-]*modelauto(?:upgrate|upgrade)=false(?:$|\s)/i,
        'Unknown environment/command auto-upgrade override');
      assert.ok(!/modelauto(?:upgrate|upgrade)=(?!false(?:$|\s))/i.test(entry),
        'Conflicting auto-upgrade override');
      explicitFalse.push(`${container.role}:environment-or-command`);
    }
  }
  return { sourceDefault: false, explicitFalse, unknownOverridesRejected: true };
}

export function bindModelContextMountedInputs({
  workspace, deploymentInput, context, startup, images, live, source, directories, read,
}) {
  const layout = verifyModelContextMountLayout({ workspace, deploymentInput, context, startup, live, images });
  const pinnedModel = directories.open(layout.modelPath);
  const first = readTree(layout.modelPath, { jsonOnly: false });
  assert.deepEqual([first.fingerprint, first.files, first.bytes],
    [startup.modelInput.fingerprint, startup.modelInput.files, startup.modelInput.bytes],
    'The complete mounted model tree must equal this startup modelInput fingerprint');
  const properties = layout.configs.map(config => {
    const data = read(config.properties);
    if (config.role === 'uaa') {
      const startupInput = startup.inputs.filter(input =>
        resolve(workspace, input.path) === config.properties);
      assert.equal(startupInput.length, 1, 'Retained UAA configuration needs its startup input binding');
      assert.equal(hash(data), startupInput[0].sha256);
    }
    return { role: config.role, values: parseJavaProperties(data) };
  });
  for (const config of layout.configs) {
    const logging = read(config.logging);
    if (config.role === 'uaa') assert.equal(hash(logging), hash(UAA_CONSOLE_LOGGING));
  }
  const uaaConfig = layout.configs.find(config => config.role === 'uaa');
  const pinnedUaa = directories.open(uaaConfig.directory);
  const uaaTree = readTree(uaaConfig.directory, { jsonOnly: false });
  assert.deepEqual(uaaTree.entries.map(row => row.path), ['application.properties', 'logback.xml']);
  const witness = bindModelContextTokenWitness({ workspace, context, startup, live, layout, directories, read });
  const nacos = JSON.parse(read(layout.nacosPath));
  assert.ok(Array.isArray(nacos));
  assert.deepEqual(nacos.map(row => ({ dataId: row.dataId, group: row.group, bytes: Buffer.byteLength(row.content),
    sha256: hash(row.content) })).sort((a, b) => a.dataId.localeCompare(b.dataId)),
  startup.nacosConfigurationBindings.map(({ readbackAttempts, ...binding }) => binding)
    .sort((a, b) => a.dataId.localeCompare(b.dataId)),
  'Current Nacos publication input must match the startup readback bindings');
  const autoUpgrade = verifyModelContextAutoUpgrade({ source, properties, nacos, containers: layout.configs });
  const verify = current => {
    verifyModelContextMountLayout({ workspace, deploymentInput, context, startup, live: current, images });
    directories.verify(pinnedModel);
    const value = readTree(layout.modelPath, { jsonOnly: false });
    assert.deepEqual(value.entries, first.entries, 'Mounted model content/file-set drift before or after HTTP');
    assert.equal(value.fingerprint, startup.modelInput.fingerprint);
    directories.verify(pinnedModel);
    directories.verify(pinnedUaa);
    assert.deepEqual(readTree(uaaConfig.directory, { jsonOnly: false }).entries, uaaTree.entries,
      'Retained UAA configuration tree drift before or after HTTP');
    directories.verify(pinnedUaa);
    witness.verify();
  };
  return {
    verify,
    evidence: { modelInput: { path: layout.modelPath, files: first.files, bytes: first.bytes,
      fingerprint: first.fingerprint }, configFiles: layout.configs.flatMap(config => [config.properties, config.logging]),
    retainedUaaConfig: { path: uaaConfig.directory, files: uaaTree.files, fingerprint: uaaTree.fingerprint },
    retainedUaaTokenStoreWitness: witness.evidence,
    nacosInput: layout.nacosPath, autoUpgrade, jarShadowMountsRejected: true,
    liveNacosStateRevalidated: false },
  };
}

export async function executeOwnedModelContext({
  workspace = workspaceDefault, runId, deploymentInput, label, executeOwned = false,
  contextFactory = ownedNativeRuntimeContext, execute = spawnSync, runChecks = runOwnedModelContextChecks,
  readSchema = readNativeFiveDatasetContract,
} = {}) {
  assert.equal(executeOwned, true, 'Explicit owned model-context execution is required');
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(typeof deploymentInput, 'string');
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  const bindings = [];
  let context;
  let output;
  let report;
  let sourceAppData;
  let snapshotCoverage;
  let mounted;
  let stage = 'fresh-owned-runtime-inspection';
  let serial = 0;
  let failureSerial = 0;
  const read = path => {
    path = resolve(workspace, path);
    inside(workspace, path);
    const parent = directories.open(dirname(path));
    const name = basename(path);
    const file = readPinnedFile(directories, parent, name);
    bindings.push({ path, parent, name, sha256: hash(file.data), bytes: file.data.length });
    return file.data;
  };
  const guard = () => guardModelContextBindings(context, directories, bindings);
  const write = (name, value) => {
    const bytes = json(value);
    const identity = directories.write(output, name, bytes);
    const fd = fs.openSync(directories.entry(output, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      assert.equal(fs.fstatSync(fd).ino, identity.ino);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.fsyncSync(output.descriptor);
    return { path: join(output.path, name), sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
  };
  const writeFailure = details => {
    assert.ok(output, 'No verified owner-private diagnostic directory is available');
    const name = ++failureSerial === 1 ? 'failure.private.json' : `failure-${failureSerial}.private.json`;
    const evidence = write(name, details);
    return { path: evidence.path, sha256: evidence.sha256 };
  };
  const sql = statement => {
    assertA01ReadOnlySQL(statement);
    guard();
    const result = execute('docker', ['exec', '-i', context.resources.mysqlId, 'sh', '-c',
      'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
    { input: statement, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    write(`sql-${String(++serial).padStart(4, '0')}.private.json`, {
      statementSha256: hash(statement), exitCode: result.status, signal: result.signal,
      stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? ''),
    });
    assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned complete physical snapshot failed');
    guard();
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    assert.ok(lines.length <= 100_000);
    return lines.map(line => JSON.parse(line));
  };
  try {
    context = contextFactory({ workspace, runId, deploymentInput, execute });
    context.guard();
    output = directories.open(join(context.base, `model-context-http-${label}`),
      { create: true, exclusive: true });
    stage = 'source-package-image-binding';
    for (const path of MODEL_CONTEXT_TOOL_INPUTS) read(path);
    const images = JSON.parse(read(context.deployment.imageReceipt.path));
    assert.equal(bindings.at(-1).sha256, context.deployment.imageReceipt.sha256);
    const build = JSON.parse(read(images.packageReceipt.path));
    assert.equal(bindings.at(-1).sha256, images.packageReceipt.sha256);
    const packaged = read(join(build.worktree, MODEL_CONTEXT_SOURCE_PATH));
    const source = read(join(workspace, 'ibiz-service-hub', MODEL_CONTEXT_SOURCE_PATH));
    assert.equal(hash(packaged), hash(source), 'Packaged and current appdata source differ');
    sourceAppData = verifyModelContextSourceBinding(source,
      build.sourceInputs.before.entries.find(row => row.path === MODEL_CONTEXT_SOURCE_PATH), images, build);
    stage = 'current-mounted-startup-input-binding';
    const startupPath = join(dirname(resolve(workspace, deploymentInput)), 'report.json');
    const startupBytes = read(startupPath);
    assert.equal(read(join(dirname(startupPath), 'report.sha256')).toString().trim(), hash(startupBytes));
    const startup = JSON.parse(startupBytes);
    assert.equal(hash(read(resolve(workspace, deploymentInput))), startup.deploymentInput.sha256);
    mounted = bindModelContextMountedInputs({
      workspace, deploymentInput, context, startup, images, live: guard(),
      source: source.toString('utf8'), directories, read,
    });
    write('source-binding.private.json', { sourceAppData,
      imageReceipt: context.deployment.imageReceipt, packageReceipt: images.packageReceipt,
      mountedInputs: mounted.evidence });
    const schema = readSchema({ workspace });
    const schemaSha256 = hash(json(schema));
    for (const input of schema.inputs.filter(input => input.bytes <= 64 * 1024 * 1024)) {
      assert.equal(hash(read(input.path)), input.sha256);
    }
    write('plan.json', createModelContextPlan(context.manifest));
    stage = 'complete-physical-model-snapshot';
    const inventorySQL = editorPhysicalInventorySQL(context.manifest);
    const inventory = sql(inventorySQL);
    const targets = validateEditorPhysicalInventory(context.manifest, schema, inventory);
    assert.equal(targets.length, 848, 'This gate requires both complete 424-table physical model schemas');
    assert.equal(inventory.length, 30660, 'This gate requires all current physical model columns');
    snapshotCoverage = { tables: targets.length, columns: inventory.length,
      schemas: context.manifest.roots.map(root => root.database), everyDispatchedHTTPBeforeAndAfter: false,
      excludedStores: ['uaa', 'metadata', 'cache'] };
    const snapshotSQL = editorPhysicalSnapshotSQL(targets);
    const snapshot = () => {
      assert.deepEqual(sql(inventorySQL), inventory, 'Model context physical schema drift');
      return normalizeEditorPhysicalSnapshot(inventory, targets, sql(snapshotSQL));
    };
    stage = 'ordinary-auth-readonly-model-context-http';
    report = await runChecks({ context: { ...context, guard,
      guardForHTTP: () => { const live = guard(); mounted.verify(live); return live; },
      verifyMountedInputs: live => mounted.verify(live) },
    snapshot, record: async (name, value) => write(name, value), recordFailure: writeFailure });
    assert.equal(Object.hasOwn(report, 'readonlyMetadataAcceptance'), false, 'A retired acceptance flag is not current evidence');
    stage = 'final-source-and-runtime-integrity';
    guard();
    mounted.verify(context.guard());
    assert.equal(hash(json(readSchema({ workspace }))), schemaSha256, 'Source schema drift');
    report.liveResourcesInspected = true;
    report.stage = 'complete';
  } catch (error) {
    report ??= { contract: 'owned-model-context-readonly-http-v1', runId,
      authentication: [], queries: [], anonymous: [], snapshotSequence: [], unresolved: [],
      nativeAcceptance: false, fullAcceptance: false, permissionAcceptance: false };
    report.status = 'failed-owned-model-context-http';
    report.routingMetadataResponseAcceptance = false;
    report.stage = stage;
    report.wrapperFailedStage = { stage, errorKind: error?.code === 'ERR_ASSERTION'
      ? 'assertion-failed' : 'operation-failed' };
    report.unresolved.push('Fresh owned peer/source/package/image or complete snapshot gate failed; no shared fallback.');
    try {
      if (report.failureEvidence) report.previousFailureEvidence = report.failureEvidence;
      report.failureEvidence = writeFailure(modelContextFailureDetails(error, { stage }));
    } catch {
      report.privateDiagnosticUnavailable = true;
    }
  } finally {
    try {
      if (output) {
        report.inputs = [...(context.bindings ?? []),
          ...bindings.map(({ parent, name, ...binding }) => binding)];
        if (sourceAppData) report.sourceAppData = sourceAppData;
        if (mounted) report.mountedInputs = mounted.evidence;
        report.acceptanceScope = MODEL_CONTEXT_ACCEPTANCE_SCOPE;
        delete report.readonlyMetadataAcceptance;
        const dispatched = [...(report.authentication ?? []), ...(report.queries ?? []),
          ...(report.anonymous ?? [])].filter(row => row.dispatched === true);
        if (snapshotCoverage) report.snapshotCoverage = {
          ...snapshotCoverage,
          everyDispatchedHTTPBeforeAndAfter: dispatched.length > 0 && dispatched
            .every(row => row.snapshotBoundary?.before && row.snapshotBoundary?.after),
        };
        report.completedAt = new Date().toISOString();
        write('report.json', report);
      }
    } finally { directories.close(); context?.close(); }
  }
  return { report, reportPath: output ? join(output.path, 'report.json') : null };
}

export async function main(argv = process.argv.slice(2), {
  executeContext = executeOwnedModelContext, print = value => console.log(value),
} = {}) {
  const options = {};
  for (const argument of argv) {
    if (argument === '--execute-owned') {
      assert.ok(!options.executeOwned, 'Duplicate execution option');
      options.executeOwned = true;
      continue;
    }
    const match = /^--(run-id|deployment-input|label)=(.+)$/.exec(argument);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Only explicit owned model-context options are allowed');
    options[match[1]] = match[2];
  }
  const result = await executeContext({
    runId: options['run-id'], deploymentInput: options['deployment-input'], label: options.label,
    executeOwned: options.executeOwned ?? false,
  });
  print(json({ reportPath: result.reportPath, status: result.report.status,
    routingMetadataResponseAcceptance: result.report.routingMetadataResponseAcceptance,
    nativeAcceptance: false, fullAcceptance: false }));
  if (!result.report.routingMetadataResponseAcceptance) process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('Owned model-context execution refused; private details suppressed.'); process.exitCode = 1; });
}
