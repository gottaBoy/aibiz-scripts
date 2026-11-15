import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { PinnedDirectories, readPinnedFile, readTree } from '../native-candidate-files.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { MODEL_CONTEXT_SOURCE_PATH } from '../owned-model-context-http.mjs';
import {
  REDIS_IMAGE_ID, UAA_CONSOLE_LOGGING, UAA_ENTRYPOINT, UAA_JAVA_OPTIONS,
} from '../harness-run-owned-uaa-runtime.mjs';
import { backendRunCommand } from '../launch-run-owned-native-backend.mjs';
import { sourceBuildInputs } from '../source-build-identity.mjs';
import {
  bindModelContextMountedInputs, bindModelContextTokenWitness, executeOwnedModelContext,
  guardModelContextBindings, javaMethodBytes, main,
  MODEL_CONTEXT_IMAGE_ARTIFACTS, MODEL_CONTEXT_TOOL_INPUTS, verifyModelContextAutoUpgrade,
  verifyModelContextComponentFiles, verifyModelContextMountLayout, verifyModelContextSourceBinding,
} from '../run-owned-model-context-http.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const source = readFileSync(new URL(`../../ibiz-service-hub/${MODEL_CONTEXT_SOURCE_PATH}`, import.meta.url));
const sourceEntry = { path: MODEL_CONTEXT_SOURCE_PATH, bytes: source.length, sha256: hash(source) };
const roles = ['gateway', 'allinone', 'provider'];
const archives = roles.map((role, index) => ({
  path: MODEL_CONTEXT_IMAGE_ARTIFACTS[role].archive, bytes: index + 10, sha256: `${index + 1}`.repeat(64),
}));
const build = {
  contract: 'isolated-backend-source-package-v1', sourcePackageVerified: true, unitRegression: true,
  status: 'passed-package-and-unit-only',
  sourceInputs: { before: { fingerprint: 'b'.repeat(64) } },
  packages: { archives },
};
const images = {
  contract: 'isolated-backend-source-images-v1',
  status: 'passed-image-artifact-binding-only', imageArtifactBindingVerified: true,
  packageReceipt: { sourceFingerprint: build.sourceInputs.before.fingerprint },
  components: archives.map((archive, index) => {
    const name = roles[index];
    const spec = MODEL_CONTEXT_IMAGE_ARTIFACTS[name];
    const scripts = name === 'provider' ? [
      { path: '/entrypoint-waitfor.sh', bytes: 3409, sha256: 'e'.repeat(64),
        recipePath: 'modelingservice/docker/entrypoint-waitfor.sh' },
      { path: '/wait-for.sh', bytes: 1305, sha256: 'f'.repeat(64),
        recipePath: 'modelingservice/docker/wait-for.sh' },
    ] : [];
    return {
      name,
      imageFiles: [
        { path: spec.jar, bytes: archive.bytes, sha256: archive.sha256 },
        ...scripts.map(({ recipePath, ...file }) => file),
      ].sort((a, b) => a.path.localeCompare(b.path)),
      recipeInputs: [
        { path: spec.recipe, bytes: 500, sha256: 'd'.repeat(64) },
        ...scripts.map(({ recipePath, bytes, sha256 }) => ({ path: recipePath, bytes, sha256 })),
      ].sort((a, b) => a.path.localeCompare(b.path)),
    };
  }),
};

test('native onGetAppData and projection method hashes bind the same current source bytes as packaged JAR receipts', () => {
  const result = verifyModelContextSourceBinding(source, sourceEntry, images, build);
  assert.equal(result.sourceSha256, sourceEntry.sha256);
  assert.equal(result.packageSourceSha256, sourceEntry.sha256);
  for (const method of Object.values(result.methods)) {
    assert.match(method.sha256, /^[a-f0-9]{64}$/);
    assert.ok(method.bytes > 1000);
  }
  for (const change of [
    input => { input.entry.sha256 = 'c'.repeat(64); },
    input => { input.entry.bytes++; },
    input => { input.images.packageReceipt.sourceFingerprint = 'c'.repeat(64); },
    input => { input.images.imageArtifactBindingVerified = false; },
    input => { input.images.components[0].imageFiles[0].sha256 = 'c'.repeat(64); },
    input => { input.build.status = 'failed'; },
    input => { input.build.packages.archives.pop(); },
  ]) {
    const value = structuredClone({ entry: sourceEntry, images, build }); change(value);
    assert.throws(() => verifyModelContextSourceBinding(source, value.entry, value.images, value.build));
  }
  const changed = Buffer.from(source.toString().replace('context.put("pssystemid", user.getPSSystemId())',
    'context.put("pssystemid", "fallback")'));
  assert.throws(() => verifyModelContextSourceBinding(changed,
    { ...sourceEntry, bytes: changed.length, sha256: hash(changed) }, images, build));
});

test('provider roster binds the actual two startup scripts separately from its exact JAR', () => {
  const provider = images.components.find(component => component.name === 'provider');
  assert.equal(provider.imageFiles[0].path, '/entrypoint-waitfor.sh',
    'The real sorted provider roster must not put the JAR first in this fixture');
  assert.equal(verifyModelContextComponentFiles(provider).jar.path, '/ibizservicerunner-provider.jar');
  for (const mutate of [
    component => { component.name = '__proto__'; },
    component => { component.imageFiles.pop(); },
    component => { component.imageFiles.push({ path: '/other.jar', bytes: 1, sha256: 'a'.repeat(64) }); },
    component => { component.imageFiles.find(file => file.path === '/ibizservicerunner-provider.jar').path = '/wrong-provider.jar'; },
    component => { component.imageFiles[0].bytes++; },
    component => { component.imageFiles[0].sha256 = 'a'.repeat(64); },
    component => { component.recipeInputs.find(file => file.path.endsWith('/wait-for.sh')).bytes++; },
    component => { component.recipeInputs.find(file => file.path.endsWith('/entrypoint-waitfor.sh')).sha256 = 'a'.repeat(64); },
    component => { component.recipeInputs[0].path = 'modelingservice/docker/unreviewed.sh'; },
  ]) {
    const changed = structuredClone(provider);
    mutate(changed);
    assert.throws(() => verifyModelContextComponentFiles(changed));
  }
  const changed = structuredClone(build);
  changed.packages.archives.find(archive =>
    archive.path === MODEL_CONTEXT_IMAGE_ARTIFACTS.provider.archive).path = 'unreviewed/ibizservicerunner-provider.jar';
  assert.throws(() => verifyModelContextSourceBinding(source, sourceEntry, images, changed),
    /exact three reviewed backend package archives/);
});

test('current owner-private package and image receipts satisfy the real one/one/three artifact contract', t => {
  const packagePath = new URL('../../.artifacts/model-context-source-package-20261115-r1/report.json', import.meta.url);
  const imagePath = new URL('../../.artifacts/model-context-source-images-20261115-r1/report.json', import.meta.url);
  if (!existsSync(packagePath) || !existsSync(imagePath)) {
    t.skip('Owner-private current packaging receipts are unavailable; synthetic roster tests remain separate');
    return;
  }
  const packageBytes = readFileSync(packagePath);
  const imageBytes = readFileSync(imagePath);
  const actualPackage = JSON.parse(packageBytes);
  const actualImages = JSON.parse(imageBytes);
  assert.equal(actualImages.packageReceipt.sha256, hash(packageBytes));
  const actualSource = readFileSync(join(actualPackage.worktree, MODEL_CONTEXT_SOURCE_PATH));
  const entry = actualPackage.sourceInputs.before.entries.find(value => value.path === MODEL_CONTEXT_SOURCE_PATH);
  const result = verifyModelContextSourceBinding(actualSource, entry, actualImages, actualPackage);
  assert.equal(result.sourceSha256, hash(actualSource));
  assert.deepEqual(actualImages.components.map(component => [component.name, component.imageFiles.length]),
    [['allinone', 1], ['gateway', 1], ['provider', 3]]);
  const provider = actualImages.components.find(component => component.name === 'provider');
  assert.equal(verifyModelContextComponentFiles(provider).jar.path, '/ibizservicerunner-provider.jar');
  assert.equal(hash(readFileSync(packagePath)), hash(packageBytes));
  assert.equal(hash(readFileSync(imagePath)), hash(imageBytes));
});

test('current retained startup and UAA receipts bind the maintained two-mount launch and complete witness offline', t => {
  const workspace = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures/b5dc5669e6d1');
  const runtime = join(base, 'backend-runtime-context-backend-r2');
  const startupPath = join(runtime, 'report.json');
  const deploymentInput = join(runtime, 'deployment-input.private.json');
  const imagePath = join(workspace, '.artifacts/model-context-source-images-20261115-r1/report.json');
  if (![startupPath, deploymentInput, imagePath].every(existsSync)) {
    t.skip('Owner-private current retained runtime receipts are unavailable; no historical fallback');
    return;
  }
  const directories = new PinnedDirectories();
  t.after(() => directories.close());
  const inputs = [];
  const read = path => {
    const parent = directories.open(dirname(path));
    const file = readPinnedFile(directories, parent, path.split('/').at(-1));
    inputs.push({ path, sha256: hash(file.data) });
    return file.data;
  };
  const startupBytes = read(startupPath);
  assert.equal(read(join(runtime, 'report.sha256')).toString().trim(), hash(startupBytes));
  const startup = JSON.parse(startupBytes);
  const deploymentBytes = read(deploymentInput);
  assert.equal(hash(deploymentBytes), startup.deploymentInput.sha256);
  const deployment = JSON.parse(deploymentBytes);
  const actualImagesBytes = read(imagePath);
  assert.equal(hash(actualImagesBytes), deployment.imageReceipt.sha256);
  const actualImages = JSON.parse(actualImagesBytes);
  const manifest = JSON.parse(read(join(base, 'manifest.json')));
  const retainedPath = startup.inputs.filter(row => /\/uaa-runtime-[^/]+\/report\.json$/.test(row.path));
  assert.equal(retainedPath.length, 1);
  const retainedDirectory = dirname(join(workspace, retainedPath[0].path));
  const containers = ['allinone', 'gateway', 'provider'].map(role => {
    const service = deployment.services[role];
    const command = backendRunCommand({
      role, runId: manifest.runId, label: startup.label,
      name: `nf-${manifest.runId}-backend-${startup.label}-${role}`,
      networkName: manifest.ownership.network, imageId: service.imageId,
      configPath: join(runtime, `${role}-config/application.properties`),
      loggingPath: join(runtime, `${role}-config/logback.xml`),
      modelPath: join(runtime, 'model-input'), mysqlName: manifest.ownership.mysqlContainer,
      nacosName: `nf-${manifest.runId}-backend-${startup.label}-nacos`,
    });
    const values = flag => command.flatMap((value, index) => value === flag ? [command[index + 1]] : []);
    const entrypoint = values('--entrypoint');
    return {
      Id: service.containerId, Image: service.imageId,
      Config: {
        Env: values('--env'), User: values('--user')[0],
        Entrypoint: entrypoint.length ? entrypoint : ['/entrypoint-waitfor.sh'],
        Cmd: command.slice(command.indexOf(service.imageId) + 1),
      },
      Mounts: values('--mount').map(value => {
        const fields = Object.fromEntries(value.split(',').map(field => field.split('=')));
        return { Type: fields.type, RW: !Object.hasOwn(fields, 'readonly'),
          Source: fields.src, Destination: fields.dst };
      }),
    };
  });
  const uaa = deployment.services.uaa;
  containers.push({
    Id: uaa.containerId, Image: uaa.imageId,
    Config: {
      User: '65532:65532', Entrypoint: [...UAA_ENTRYPOINT],
      Cmd: ['--spring.config.location=classpath:/,file:/opt/uaa/config/application.properties'],
      Env: [
        'SPRING_CLOUD_BOOTSTRAP_ENABLED=false', 'SPRING_CLOUD_NACOS_CONFIG_ENABLED=false',
        'SPRING_CLOUD_NACOS_DISCOVERY_ENABLED=false', `JAVA_TOOL_OPTIONS=${UAA_JAVA_OPTIONS}`,
      ],
    },
    Mounts: [
      { Type: 'bind', RW: false, Source: join(retainedDirectory, 'config'), Destination: '/opt/uaa/config' },
      { Type: 'bind', RW: false, Source: join(retainedDirectory, 'token-witness-classes'), Destination: '/opt/uaa/witness' },
    ],
  });
  const redis = deployment.auxiliaryContainers.find(row => row.role === 'redis');
  containers.push({ Id: redis.containerId, Image: redis.imageId });
  const context = { base, manifest, deployment };
  const live = { containers };
  const layout = verifyModelContextMountLayout({
    workspace, deploymentInput, context, startup, live, images: actualImages,
  });
  const witness = bindModelContextTokenWitness({
    workspace, context, startup, live, layout, directories, read,
  });
  witness.verify();
  assert.equal(witness.evidence.files, 2);
  assert.equal(witness.evidence.bytes, 6002);
  assert.equal(witness.evidence.fingerprint, 'a4b5ccd3f723912fa58f6852791c05879eb041e3e3c1f7fe5dec712eb6288012');
  assert.equal(witness.evidence.applicationClasspathExcludesWitness, true);
  for (const input of inputs) assert.equal(hash(readFileSync(input.path)), input.sha256);
});

test('Java method extraction respects quoted/comment braces and refuses missing, duplicate or unterminated methods', () => {
  const signature = 'protected void sample()';
  const method = `${signature} { String v = "}"; char c = '{'; /* } */\n // }\n if(true) { v = "\\\\}"; } }`;
  assert.equal(javaMethodBytes(`class A { ${method} void later() {} }`, signature).toString(), method);
  for (const text of ['class A {}', `${method}\n${method}`, `${signature} { if(true) {}`]) {
    assert.throws(() => javaMethodBytes(text, signature));
  }
});

test('pinned source guard refuses byte drift and symlinks before another owned operation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'model-context-binding-'));
  const pinned = new PinnedDirectories();
  try {
    const parent = pinned.open(directory);
    pinned.write(parent, 'source.java', source);
    const bindings = [{ parent, name: 'source.java', sha256: hash(source) }];
    const live = { origins: { backend: 'http://10.42.215.9:30086' } };
    assert.equal(guardModelContextBindings({ guard: () => live }, pinned, bindings), live);
    writeFileSync(join(directory, 'source.java'), 'changed');
    assert.throws(() => guardModelContextBindings({ guard: () => live }, pinned, bindings));
    rmSync(join(directory, 'source.java'));
    writeFileSync(join(directory, 'replacement.java'), source);
    symlinkSync(join(directory, 'replacement.java'), join(directory, 'source.java'));
    assert.throws(() => guardModelContextBindings({ guard: () => live }, pinned, bindings));
  } finally { pinned.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('CLI requires explicit owned execution and refuses shared URLs, lifecycle flags and duplicate inputs', async () => {
  let opened = 0;
  const contextFactory = () => { opened++; assert.fail('No implicit owned target'); };
  for (const options of [
    {}, { executeOwned: true }, { executeOwned: true, runId: 'shared' },
    { executeOwned: true, runId: 'abcdef012345', label: '../shared', deploymentInput: 'x' },
    { executeOwned: true, runId: 'abcdef012345', label: 'unit' },
  ]) await assert.rejects(executeOwnedModelContext({ ...options, contextFactory }));
  assert.equal(opened, 0);
  for (const args of [[], ['--url=http://127.0.0.1:30250'], ['--restart-owned-provider'],
    ['--execute-owned', '--execute-owned'], ['--label=a', '--label=b'],
    ['--run-id=abcdef012345', '--run-id=abcdef012345']]) await assert.rejects(main(args));
});

test('historical/retired owned receipts cannot authorize SQL or HTTP and context closes after refusal', async () => {
  let commands = 0;
  let closed = false;
  const result = await executeOwnedModelContext({
    workspace: '/unavailable', runId: 'abcdef012345', label: 'unit', executeOwned: true,
    deploymentInput: 'historical.private.json',
    execute: () => { commands++; assert.fail('No command after a failed fresh guard'); },
    contextFactory: () => ({
      guard: () => { throw new Error('retired'); }, close: () => { closed = true; },
    }),
  });
  assert.equal(result.report.status, 'failed-owned-model-context-http');
  assert.equal(result.report.stage, 'fresh-owned-runtime-inspection');
  assert.equal(result.reportPath, null);
  assert.equal(result.report.routingMetadataResponseAcceptance, false);
  assert.equal(result.report.nativeAcceptance, false);
  assert.equal(result.report.fullAcceptance, false);
  assert.equal(commands, 0);
  assert.equal(closed, true);
});

test('a controlled wrapper failure keeps a private exclusive output and cannot overwrite a previous campaign', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'model-context-wrapper-'));
  let closed = 0;
  const options = {
    workspace, runId: 'abcdef012345', label: 'unit', executeOwned: true, deploymentInput: 'controlled.private.json',
    execute: () => assert.fail('Source gate must fail before SQL'),
    contextFactory: () => ({ base: workspace, guard: () => ({}), close: () => { closed++; } }),
  };
  try {
    const result = await executeOwnedModelContext(options);
    assert.equal(result.report.status, 'failed-owned-model-context-http');
    assert.equal(result.report.stage, 'source-package-image-binding');
    assert.equal(statSync(result.reportPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(workspace, 'model-context-http-unit')).mode & 0o777, 0o700);
    assert.deepEqual(JSON.parse(readFileSync(result.reportPath)), result.report);
    const bytes = readFileSync(result.reportPath);
    const second = await executeOwnedModelContext(options);
    assert.equal(second.report.stage, 'fresh-owned-runtime-inspection');
    assert.equal(second.reportPath, null);
    assert.deepEqual(readFileSync(result.reportPath), bytes);
    assert.equal(closed, 2);
  } finally {
    chmodSync(workspace, 0o700);
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('wrapper source contract requires both complete physical schemas and binds every HTTP to snapshots', () => {
  const text = readFileSync(new URL('../run-owned-model-context-http.mjs', import.meta.url), 'utf8');
  assert.match(text, /assert\.equal\(targets\.length, 848/);
  assert.match(text, /assert\.equal\(inventory\.length, 30660/);
  assert.match(text, /everyDispatchedHTTPBeforeAndAfter: false/);
  assert.match(text, /assertA01ReadOnlySQL\(statement\)/);
  assert.match(text, /sourceAppData = verifyModelContextSourceBinding/);
  assert.match(text, /hash\(packaged\), hash\(source\)/);
  assert.match(text, /fs\.fsyncSync\(output\.descriptor\)/);
});

function wrapperFixture(t, { sourceDrift = false } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'model-context-complete-wrapper-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const { manifest, credentials } = createFixture({
    runId: 'abcdef012345', scenario: 'two-center', modelVersion: 816,
    uaaSchemaMode: 'legacy-views', passwordStorageMode: 'sm3', secret: () => 'a'.repeat(36),
  });
  const write = (path, value) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, value, { mode: 0o600 });
  };
  for (const path of MODEL_CONTEXT_TOOL_INPUTS) {
    write(join(workspace, path), readFileSync(new URL(`../../${path}`, import.meta.url)));
  }
  const worktree = join(workspace, '.artifacts/package/worktree');
  const sourcePath = join(workspace, 'ibiz-service-hub', MODEL_CONTEXT_SOURCE_PATH);
  write(sourcePath, source);
  write(join(worktree, MODEL_CONTEXT_SOURCE_PATH), source);
  const packagePath = join(workspace, '.artifacts/package/report.json');
  const packageBytes = Buffer.from(JSON.stringify({
    ...build, worktree,
    sourceInputs: { before: { ...build.sourceInputs.before, entries: [sourceEntry] } },
  }));
  write(packagePath, packageBytes);
  const imagePath = join(workspace, '.artifacts/images/report.json');
  const imageBytes = Buffer.from(JSON.stringify({
    ...images, packageReceipt: { ...images.packageReceipt, path: packagePath, sha256: hash(packageBytes) },
  }));
  write(imagePath, imageBytes);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', manifest.runId);
  const runtimeDirectory = join(base, 'backend-runtime-startup-r2');
  const deploymentInput = join(runtimeDirectory, 'deployment-input.private.json');
  const deployment = {
    imageReceipt: { path: imagePath, sha256: hash(imageBytes) },
    services: Object.fromEntries(['allinone', 'gateway', 'provider', 'uaa'].map((role, index) =>
      [role, { containerId: String(index + 1).repeat(64), imageId: `sha256:${String(index + 1).repeat(64)}` }])),
    auxiliaryContainers: [{ containerId: '5'.repeat(64), imageId: REDIS_IMAGE_ID, role: 'redis' }],
  };
  write(deploymentInput, JSON.stringify(deployment));
  const modelPath = join(runtimeDirectory, 'model-input');
  write(join(modelPath, 'PSSYSSERVICEAPIS/ModelAPI.json'), '{"controlled":true}\n');
  const tree = readTree(modelPath, { jsonOnly: false });
  const containers = ['allinone', 'gateway', 'provider'].map(role => {
    const configPath = join(runtimeDirectory, `${role}-config/application.properties`);
    const loggingPath = join(runtimeDirectory, `${role}-config/logback.xml`);
    write(configPath, `server.port=30000\nibiz.deploysystems.ibizmodeling.settings.modelautoupgrate=false\n`);
    write(loggingPath, '<configuration/>\n');
    return {
      Id: deployment.services[role].containerId, Image: deployment.services[role].imageId,
      Config: {
        Env: [],
        Entrypoint: role === 'provider' ? ['/entrypoint-waitfor.sh'] : ['java'],
        Cmd: role === 'provider' ? [
          `${manifest.ownership.mysqlContainer}:3306`, `nf-${manifest.runId}-backend-startup-r2-nacos:8848`,
          '--', '--spring.config.location=file:/app/config/application.properties',
        ] : [
          '--add-opens=java.base/java.lang=ALL-UNNAMED',
          '--add-opens=java.base/java.lang.reflect=ALL-UNNAMED',
          '-Duser.timezone=Asia/Shanghai', '-jar',
          MODEL_CONTEXT_IMAGE_ARTIFACTS[role].jar,
          '--spring.config.location=file:/app/config/application.properties',
        ],
      },
      Mounts: [
        { Type: 'bind', RW: false, Source: configPath, Destination: '/app/config/application.properties' },
        { Type: 'bind', RW: false, Source: loggingPath, Destination: '/app/config/logback.xml' },
        ...(role === 'provider' ? [{
          Type: 'bind', RW: false, Source: modelPath, Destination: '/app/model',
        }] : []),
      ],
    };
  });
  const nacos = ['appgateway-default', 'cloud-auth', 'cloud-auth-agent-rt'].map(dataId => ({
    dataId, group: `nf_${manifest.runId}`, content: '---\n{}\n',
  }));
  const uaaDirectory = join(base, 'uaa-runtime-retained-r1');
  const uaaConfig = join(uaaDirectory, 'config');
  const uaaProperties = 'server.port=32666\n';
  write(join(uaaConfig, 'application.properties'), uaaProperties);
  write(join(uaaConfig, 'logback.xml'), UAA_CONSOLE_LOGGING);
  const witnessSource = readFileSync(new URL('../../standalone-uaa/tools/RedisTokenStoreWitness.java', import.meta.url));
  const witnessSourcePath = join(workspace, 'standalone-uaa/tools/RedisTokenStoreWitness.java');
  const witnessStagedSource = join(uaaDirectory, 'token-witness-source/RedisTokenStoreWitness.java');
  const witnessClasses = join(uaaDirectory, 'token-witness-classes');
  const witnessCompileLog = join(uaaDirectory, 'token-witness-compile.log');
  write(witnessSourcePath, witnessSource);
  write(witnessStagedSource, witnessSource);
  write(witnessCompileLog, '');
  for (const name of ['RedisTokenStoreWitness.class', 'RedisTokenStoreWitness$1.class']) {
    write(join(witnessClasses, name), `controlled-${name}`);
    chmodSync(join(witnessClasses, name), 0o644);
  }
  const retainedUaa = {
    contract: 'run-owned-source-uaa-native-http-probe-v1', runId: manifest.runId,
    status: 'passed-scoped-native-uaa-http-only', actualBootApplicationStarted: true,
    actualHttpLoginVerified: true, actualTokenSecurityVerified: true,
    retainedOwned: true, tokenExpirationMilliseconds: 20000,
    services: { uaa: deployment.services.uaa,
      redis: { containerId: deployment.auxiliaryContainers[0].containerId, imageId: REDIS_IMAGE_ID } },
    checks: [
      'anonymous-user-info-self-denied',
      ...manifest.users.flatMap(user => [
        `${user.loginname}-wrong-password-denied`, `${user.loginname}-login-and-self`,
      ]),
      'signed-security-positive-control', 'tampered-signature-token-denied', 'expired-signed-token-denied',
    ].map(id => ({ id, status: 'pass' })),
    tokenStoreWitness: {
      sourcePath: witnessSourcePath, sourceSha256: hash(witnessSource),
      compilerImageId: deployment.services.uaa.imageId,
      command: [
        'run', '--rm', '--pull=never', '--network=none', '--read-only',
        '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', `${process.geteuid()}:${process.getegid()}`,
        '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
        '--mount', `type=bind,src=${dirname(witnessStagedSource)},dst=/helper,readonly`,
        '--mount', `type=bind,src=${witnessClasses},dst=/output`,
        '--entrypoint', 'javac', deployment.services.uaa.imageId, '--release', '8',
        '-proc:none', '-implicit:none', '-sourcepath', '', '-cp', UAA_ENTRYPOINT[3],
        '-d', '/output', '/helper/RedisTokenStoreWitness.java',
      ],
      classes: sourceBuildInputs(witnessClasses), compileLogSha256: hash(''), fixtureOnly: true,
    },
  };
  const retainedUaaPath = join(uaaDirectory, 'report.json');
  const retainedUaaBytes = JSON.stringify(retainedUaa);
  write(retainedUaaPath, retainedUaaBytes);
  write(join(uaaDirectory, 'report.sha256'), `${hash(retainedUaaBytes)}\n`);
  containers.push({
    Id: deployment.services.uaa.containerId, Image: deployment.services.uaa.imageId,
    Config: {
      Env: [
        'SPRING_CLOUD_BOOTSTRAP_ENABLED=false', 'SPRING_CLOUD_NACOS_CONFIG_ENABLED=false',
        'SPRING_CLOUD_NACOS_DISCOVERY_ENABLED=false', `JAVA_TOOL_OPTIONS=${UAA_JAVA_OPTIONS}`,
      ],
      Cmd: ['--spring.config.location=classpath:/,file:/opt/uaa/config/application.properties'],
      Entrypoint: [...UAA_ENTRYPOINT], User: '65532:65532',
    },
    Mounts: [
      { Type: 'bind', RW: false, Source: uaaConfig, Destination: '/opt/uaa/config' },
      { Type: 'bind', RW: false, Source: witnessClasses, Destination: '/opt/uaa/witness' },
    ],
  });
  containers.push({ Id: retainedUaa.services.redis.containerId, Image: REDIS_IMAGE_ID });
  write(join(runtimeDirectory, 'nacos-configs.private.json'), JSON.stringify(nacos));
  const startup = {
    contract: 'run-owned-native-backend-startup-v1', runId: manifest.runId, label: 'startup-r2',
    status: 'passed-owned-backend-http-transport-only', actualBackendStarted: true, retainedOwned: true,
    services: deployment.services,
    inputs: [
      { path: join(uaaConfig, 'application.properties'), sha256: hash(uaaProperties), bytes: Buffer.byteLength(uaaProperties) },
      { path: retainedUaaPath, sha256: hash(retainedUaaBytes), bytes: Buffer.byteLength(retainedUaaBytes) },
    ],
    deploymentInput: { path: deploymentInput, sha256: hash(JSON.stringify(deployment)) },
    modelInput: { stagedPath: modelPath, files: tree.files, bytes: tree.bytes, fingerprint: tree.fingerprint },
    nacosConfigurationBindings: nacos.map(row => ({
      dataId: row.dataId, group: row.group, bytes: Buffer.byteLength(row.content),
      sha256: hash(row.content), readbackAttempts: 1,
    })),
  };
  const startupBytes = JSON.stringify(startup);
  write(join(runtimeDirectory, 'report.json'), startupBytes);
  write(join(runtimeDirectory, 'report.sha256'), `${hash(startupBytes)}\n`);
  const entities = [
    ['PSSysDBScheme', 'pssysdbscheme', 'pssysdbschemes'],
    ['PSSysApp', 'pssysapp', 'pssysapps'],
    ['PSSysSFPub', 'pssyssfpub', 'pssyssfpubs'],
    ['PSSysServiceAPI', 'pssysserviceapi', 'pssysserviceapis'],
    ['PSSubSysServiceAPI', 'pssubsysserviceapi', 'pssubsysserviceapis'],
  ];
  const datasets = entities.map(([entity, table, collection], index) => {
    const query = index === 2 ? 'CurSys2' : 'CurSys';
    const collectionPath = `/api/ibizmodeling__modeldesign/psdevslnsys/$ROOT_ID/${collection}`;
    const keyField = `${table}id`;
    const nameField = `${table}name`;
    const columns = [keyField, nameField, 'pssystemid', 'usertag'];
    return {
      entity, table: `t_srf${table}`, keyField, nameField, query, collectionPath,
      fetchPath: `${collectionPath}/fetch${query.toLowerCase()}`,
      methods: { [`Fetch${query}`]: { method: 'POST', permission: 'READ' } },
      fetchBody: { pssystemid: '$ACTUAL_ROOT_LOGICAL_SYSTEM_ID', page: 0, size: 1000 },
      returnProjection: columns.map(field => ({ field, expression: field })),
      sourceSchema: { columns }, joins: [], predicate: '',
    };
  });
  const schema = { contract: 'native-five-dataset-readonly-sentinel-contract-v1',
    datasets, schemaTables: { mergedPhysicalTables: 424 }, inputs: [] };
  const inventory = manifest.roots.flatMap(root =>
    Array.from({ length: 424 }, (_, index) => {
      const dataset = datasets[index];
      const table = dataset?.table ?? `t_srfcontrolled_${String(index).padStart(3, '0')}`;
      const required = dataset?.sourceSchema.columns ?? ['controlledid'];
      const columns = Array.from({ length: index < 66 ? 37 : 36 },
        (_, column) => required[column] ?? `controlled_${column}`);
      return columns.map((column, ordinal) => ({
        database: root.database, table, column, type: 'varchar', columnType: 'varchar(200)',
        ordinal: ordinal + 1, key: ordinal === 0 ? 'PRI' : '', nullable: 'YES',
        default: null, extra: '', charset: 'utf8mb4', collation: 'utf8mb4_general_ci',
      }));
    }).flat());
  assert.equal(inventory.length, 30660);
  let commands = 0;
  let checks = 0;
  let closed = false;
  let guarded = 0;
  return {
    workspace, runId: manifest.runId, deploymentInput,
    label: 'complete', executeOwned: true, readSchema: () => schema,
    contextFactory: () => ({
      base, manifest, credentials, bindings: [], resources: { mysqlId: 'a'.repeat(64) },
      deployment,
      guard: () => { guarded++; return { containers }; }, close: () => { closed = true; },
    }),
    execute(command, arguments_, options) {
      commands++;
      assert.equal(command, 'docker');
      assert.deepEqual(arguments_.slice(0, 4), ['exec', '-i', 'a'.repeat(64), 'sh']);
      assert.ok(options.input.startsWith('SELECT JSON_OBJECT('));
      assert.ok(!/\b(?:UPDATE|DELETE|ALTER|CREATE|INSERT)\b/.test(options.input));
      return { status: 0, signal: null, stdout: options.input.includes('INFORMATION_SCHEMA.COLUMNS')
        ? inventory.map(row => JSON.stringify(row)).join('\n') : '', stderr: '' };
    },
    async runChecks({ context, snapshot, record }) {
      checks++;
      context.guard();
      const before = await snapshot();
      const after = await snapshot();
      assert.equal(before.tables.length, 848);
      assert.equal(before.inventory.length, 30660);
      assert.deepEqual(after, before);
      await record('controlled-only.private.json', { controlledFixtureOnly: true, nativeAcceptance: false });
      if (sourceDrift) writeFileSync(sourcePath, 'Controlled source drift');
      return { status: 'controlled-wrapper-only', routingMetadataResponseAcceptance: true,
        nativeAcceptance: false, fullAcceptance: false, permissionAcceptance: false, unresolved: [] };
    },
    observation: () => ({ commands, checks, closed, guarded }),
    mountedFixture: { containers, startup, deployment, modelPath, runtimeDirectory, uaaConfig,
      uaaDirectory, retainedUaa, retainedUaaPath, witnessSourcePath, witnessStagedSource,
      witnessClasses, witnessCompileLog },
  };
}

test('controlled wrapper binds source/package/images and all 848 tables/30660 columns without invoking Docker', async t => {
  const state = wrapperFixture(t);
  const result = await executeOwnedModelContext(state);
  assert.equal(result.report.status, 'controlled-wrapper-only');
  assert.equal(result.report.stage, 'complete');
  assert.equal(result.report.nativeAcceptance, false);
  assert.equal(result.report.fullAcceptance, false);
  assert.deepEqual(result.report.snapshotCoverage, {
    tables: 848, columns: 30660, schemas: result.report.snapshotCoverage.schemas,
    everyDispatchedHTTPBeforeAndAfter: false,
    excludedStores: ['uaa', 'metadata', 'cache'],
  });
  assert.equal(result.report.sourceAppData.sourceSha256, sourceEntry.sha256);
  assert.ok(result.report.inputs.length > 10);
  assert.equal(state.observation().commands, 5, 'Only the controlled executor observes SQL commands');
  assert.equal(state.observation().checks, 1);
  assert.equal(state.observation().closed, true);
  assert.ok(state.observation().guarded > 10);
});

test('controlled final-source drift invalidates the result while retaining source bindings and private failure stage', async t => {
  const state = wrapperFixture(t, { sourceDrift: true });
  const result = await executeOwnedModelContext(state);
  assert.equal(result.report.status, 'failed-owned-model-context-http');
  assert.equal(result.report.routingMetadataResponseAcceptance, false);
  assert.equal(result.report.stage, 'final-source-and-runtime-integrity');
  assert.equal(result.report.sourceAppData.sourceSha256, sourceEntry.sha256);
  assert.equal(result.report.wrapperFailedStage.errorKind, 'assertion-failed');
  assert.ok(result.report.inputs.length > 10);
  assert.equal(state.observation().closed, true);
});

function mountedFixture(t) {
  const state = wrapperFixture(t);
  const directories = new PinnedDirectories();
  t.after(() => directories.close());
  const context = state.contextFactory();
  const bindings = [];
  const read = path => {
    const parent = directories.open(dirname(path));
    const name = path.split('/').at(-1);
    const file = readPinnedFile(directories, parent, name);
    bindings.push({ parent, name, sha256: hash(file.data) });
    return file.data;
  };
  const mounted = bindModelContextMountedInputs({
    workspace: state.workspace, deploymentInput: state.deploymentInput, context,
    startup: state.mountedFixture.startup, images, live: context.guard(),
    source: source.toString(), directories, read,
  });
  return { ...state, context, directories, bindings, mounted };
}

test('current mounted model/config inputs are pinned and match the exact startup fingerprint', t => {
  const state = mountedFixture(t);
  state.mounted.verify(state.context.guard());
  guardModelContextBindings(state.context, state.directories, state.bindings);
  assert.equal(state.mounted.evidence.modelInput.fingerprint, state.mountedFixture.startup.modelInput.fingerprint);
  assert.equal(state.mounted.evidence.configFiles.length, 8);
  assert.equal(state.mounted.evidence.autoUpgrade.sourceDefault, false);
  assert.equal(state.mounted.evidence.jarShadowMountsRejected, true);
  assert.equal(state.mounted.evidence.liveNacosStateRevalidated, false);
  assert.equal(state.mounted.evidence.retainedUaaTokenStoreWitness.files, 2);
  assert.equal(state.mounted.evidence.retainedUaaTokenStoreWitness.fixtureOnly, true);
  assert.equal(state.mounted.evidence.retainedUaaTokenStoreWitness.applicationClasspathExcludesWitness, true);
});

for (const [name, mutate] of [
  ['changed model content', state => writeFileSync(join(state.mountedFixture.modelPath,
    'PSSYSSERVICEAPIS/ModelAPI.json'), '{"controlled":"changed"}')],
  ['an added model file', state => writeFileSync(join(state.mountedFixture.modelPath, 'new.json'), '{}')],
  ['model symlink', state => symlinkSync(join(state.mountedFixture.modelPath,
    'PSSYSSERVICEAPIS/ModelAPI.json'), join(state.mountedFixture.modelPath, 'linked.json'))],
  ['foreign deployment model', state => {
    state.mountedFixture.containers.find(row => row.Id === state.mountedFixture.deployment.services.provider.containerId)
      .Mounts.find(row => row.Destination === '/app/model').Source += '-old';
  }],
  ['JAR shadow mount', state => {
    state.mountedFixture.containers[0].Mounts.push({
      Type: 'bind', RW: false, Source: join(state.mountedFixture.runtimeDirectory, 'allinone-config/application.properties'),
      Destination: '/ibiz-allinone-rt.jar',
    });
  }],
  ['parent-directory shadow mount', state => {
    state.mountedFixture.containers[0].Mounts.push({
      Type: 'bind', RW: false, Source: state.mountedFixture.runtimeDirectory, Destination: '/',
    });
  }],
  ['entrypoint replacement', state => {
    state.mountedFixture.containers[0].Config.Entrypoint = ['/bin/sh'];
  }],
  ['alternate image JAR command', state => {
    const container = state.mountedFixture.containers.find(row =>
      row.Id === state.mountedFixture.deployment.services.gateway.containerId);
    container.Config.Cmd[4] = '/other.jar';
  }],
  ['retained UAA extra configuration', state => {
    writeFileSync(join(state.mountedFixture.uaaConfig, 'extra.properties'), 'new=unreviewed\n');
  }],
  ['witness class mutation', state => {
    writeFileSync(join(state.mountedFixture.witnessClasses, 'RedisTokenStoreWitness.class'), 'drift');
  }],
  ['witness class permission mutation', state => {
    chmodSync(join(state.mountedFixture.witnessClasses, 'RedisTokenStoreWitness.class'), 0o600);
  }],
  ['additional witness class', state => {
    writeFileSync(join(state.mountedFixture.witnessClasses, 'Unexpected.class'), 'extra');
  }],
  ['ignored hidden witness subtree', state => {
    const directory = join(state.mountedFixture.witnessClasses, '.git');
    mkdirSync(directory);
    writeFileSync(join(directory, 'shadow.class'), 'extra');
  }],
  ['empty hidden witness directory', state => {
    mkdirSync(join(state.mountedFixture.witnessClasses, '.artifacts'));
  }],
  ['witness class symlink', state => {
    const path = join(state.mountedFixture.witnessClasses, 'RedisTokenStoreWitness.class');
    rmSync(path);
    symlinkSync(state.mountedFixture.witnessSourcePath, path);
  }],
  ['current witness source drift', state => {
    writeFileSync(state.mountedFixture.witnessSourcePath, 'changed source');
  }],
  ['staged witness source drift', state => {
    writeFileSync(state.mountedFixture.witnessStagedSource, 'changed staged source');
  }],
  ['extra staged witness source subtree', state => {
    mkdirSync(join(dirname(state.mountedFixture.witnessStagedSource), 'target'));
  }],
  ['witness compile log drift', state => {
    writeFileSync(state.mountedFixture.witnessCompileLog, 'changed compiler output');
  }],
  ['retained witness receipt drift', state => {
    writeFileSync(state.mountedFixture.retainedUaaPath, '{}');
  }],
  ['retained witness receipt hash drift', state => {
    writeFileSync(join(state.mountedFixture.uaaDirectory, 'report.sha256'), `${'f'.repeat(64)}\n`);
  }],
  ['foreign witness mount', state => {
    const uaa = state.mountedFixture.containers.find(row =>
      row.Id === state.mountedFixture.deployment.services.uaa.containerId);
    uaa.Mounts.find(row => row.Destination === '/opt/uaa/witness').Source += '-old';
  }],
  ['writable witness mount', state => {
    const uaa = state.mountedFixture.containers.find(row =>
      row.Id === state.mountedFixture.deployment.services.uaa.containerId);
    uaa.Mounts.find(row => row.Destination === '/opt/uaa/witness').RW = true;
  }],
  ['additional UAA parent shadow mount', state => {
    const uaa = state.mountedFixture.containers.find(row =>
      row.Id === state.mountedFixture.deployment.services.uaa.containerId);
    uaa.Mounts.push({ Type: 'bind', RW: false, Source: state.mountedFixture.uaaDirectory, Destination: '/opt/uaa' });
  }],
  ['witness in the UAA application classpath', state => {
    const uaa = state.mountedFixture.containers.find(row =>
      row.Id === state.mountedFixture.deployment.services.uaa.containerId);
    uaa.Config.Entrypoint[3] = `/opt/uaa/witness:${UAA_ENTRYPOINT[3]}`;
  }],
  ['duplicate UAA JVM options', state => {
    const uaa = state.mountedFixture.containers.find(row =>
      row.Id === state.mountedFixture.deployment.services.uaa.containerId);
    uaa.Config.Env.push('JAVA_TOOL_OPTIONS=-javaagent:/opt/uaa/witness/Unexpected.class');
  }],
  ['UAA alternate JVM override', state => {
    const uaa = state.mountedFixture.containers.find(row =>
      row.Id === state.mountedFixture.deployment.services.uaa.containerId);
    uaa.Config.Env.push('JDK_JAVA_OPTIONS=-cp /opt/uaa/witness');
  }],
]) {
  test(`mounted HTTP guard rejects ${name} without a live operation`, t => {
    const state = mountedFixture(t);
    mutate(state);
    assert.throws(() => state.mounted.verify(state.context.guard()));
    assert.equal(state.observation().commands, 0);
  });
}

for (const [name, mutate] of [
  ['missing security check', receipt => { receipt.checks.pop(); }],
  ['failed security check', receipt => { receipt.checks[15].status = 'fail'; }],
  ['foreign security actor', receipt => { receipt.checks[1].id = 'foreign-login'; }],
  ['different token lifetime', receipt => { receipt.tokenExpirationMilliseconds = 60000; }],
  ['different compiler image', receipt => { receipt.tokenStoreWitness.compilerImageId = `sha256:${'f'.repeat(64)}`; }],
  ['networked compilation', receipt => { receipt.tokenStoreWitness.command[3] = '--network=host'; }],
  ['different compiler user', receipt => { receipt.tokenStoreWitness.command[8] = '0:0'; }],
  ['different compiler classpath', receipt => {
    const command = receipt.tokenStoreWitness.command;
    command[command.indexOf('-cp') + 1] += ':/unreviewed';
  }],
  ['different source provenance', receipt => { receipt.tokenStoreWitness.sourceSha256 = 'e'.repeat(64); }],
  ['different class fingerprint', receipt => { receipt.tokenStoreWitness.classes.fingerprint = 'e'.repeat(64); }],
  ['different class entry', receipt => { receipt.tokenStoreWitness.classes.entries[0].bytes++; }],
  ['different compile log provenance', receipt => { receipt.tokenStoreWitness.compileLogSha256 = 'e'.repeat(64); }],
  ['application witness claim', receipt => { receipt.tokenStoreWitness.fixtureOnly = false; }],
  ['foreign retained UAA', receipt => { receipt.services.uaa.containerId = 'f'.repeat(64); }],
  ['foreign retained Redis', receipt => { receipt.services.redis.containerId = 'f'.repeat(64); }],
]) {
  test(`a newly bound but invalid retained receipt rejects ${name} before SQL or HTTP`, async t => {
    const state = wrapperFixture(t);
    const fixture = state.mountedFixture;
    mutate(fixture.retainedUaa);
    const receiptBytes = JSON.stringify(fixture.retainedUaa);
    writeFileSync(fixture.retainedUaaPath, receiptBytes);
    writeFileSync(join(fixture.uaaDirectory, 'report.sha256'), `${hash(receiptBytes)}\n`);
    const binding = fixture.startup.inputs.find(row => row.path === fixture.retainedUaaPath);
    binding.sha256 = hash(receiptBytes);
    binding.bytes = Buffer.byteLength(receiptBytes);
    const startupBytes = JSON.stringify(fixture.startup);
    writeFileSync(join(fixture.runtimeDirectory, 'report.json'), startupBytes);
    writeFileSync(join(fixture.runtimeDirectory, 'report.sha256'), `${hash(startupBytes)}\n`);
    const result = await executeOwnedModelContext(state);
    assert.equal(result.report.routingMetadataResponseAcceptance, false);
    assert.equal(result.report.stage, 'current-mounted-startup-input-binding');
    assert.equal(state.observation().commands, 0);
    assert.equal(state.observation().checks, 0);
  });
}

test('pinned config bytes cannot drift while the container inspect mount remains identical', t => {
  const state = mountedFixture(t);
  const path = join(state.mountedFixture.runtimeDirectory, 'provider-config/application.properties');
  writeFileSync(path, 'server.port=32002\nmodelautoupgrate=true\n');
  assert.throws(() => guardModelContextBindings(state.context, state.directories, state.bindings));
  assert.equal(state.observation().commands, 0);
});

test('a staged model inconsistent with the startup fingerprint fails before the first SQL command', async t => {
  const state = wrapperFixture(t);
  writeFileSync(join(state.mountedFixture.modelPath, 'PSSYSSERVICEAPIS/ModelAPI.json'), '{"changed":true}');
  const result = await executeOwnedModelContext(state);
  assert.equal(result.report.routingMetadataResponseAcceptance, false);
  assert.equal(result.report.stage, 'current-mounted-startup-input-binding');
  assert.equal(state.observation().commands, 0);
});

test('model input guards cannot interpret unknown or enabled auto-upgrade flags as a false default', () => {
  const base = {
    source: source.toString(),
    properties: [], nacos: [], containers: [],
  };
  assert.equal(verifyModelContextAutoUpgrade(base).sourceDefault, false);
  for (const value of [true, 'true', '0', 'off', 'FALSE', null]) {
    assert.throws(() => verifyModelContextAutoUpgrade({
      ...base, properties: [{ role: 'provider', values: { modelautoupgrate: value } }],
    }));
    assert.throws(() => verifyModelContextAutoUpgrade({
      ...base, nacos: [{ dataId: 'config', content: `---\n${JSON.stringify({ settings: { modelautoupgrate: value } })}` }],
    }));
  }
  assert.throws(() => verifyModelContextAutoUpgrade({ ...base, source: 'unknown default' }));
  assert.throws(() => verifyModelContextAutoUpgrade({ ...base,
    containers: [{ role: 'provider', environment: ['JAVA_OPTS=-Dmodelautoupgrate=true'], command: [] }] }));
  assert.equal(verifyModelContextAutoUpgrade({ ...base,
    properties: [{ role: 'provider', values: { modelautoupgrate: 'false' } }],
    containers: [{ role: 'provider', environment: ['JAVA_OPTS=-Dmodelautoupgrate=false'], command: [] }],
  }).explicitFalse.length, 2);
});

test('a failed wrapper cannot publish the retired readonlyMetadataAcceptance green field', async t => {
  const state = wrapperFixture(t, { sourceDrift: true });
  const result = await executeOwnedModelContext(state);
  assert.equal(Object.hasOwn(result.report, 'readonlyMetadataAcceptance'), false);
  assert.equal(result.report.routingMetadataResponseAcceptance, false);
  assert.deepEqual(result.report.snapshotCoverage.excludedStores, ['uaa', 'metadata', 'cache']);
  for (const key of ['uaaSideEffectsUnverified', 'metadataSideEffectsUnverified', 'cacheSideEffectsUnverified']) {
    assert.equal(result.report.acceptanceScope[key], true);
  }
});

test('failures retain raw diagnostics only in an owner-private file and only a hash/path in the report and CLI', async t => {
  const state = wrapperFixture(t);
  const secret = 'CONTROLLED-PRIVATE-CREDENTIAL-MARKER';
  state.readSchema = () => { throw new Error(`Private schema diagnostic ${secret}`); };
  const result = await executeOwnedModelContext(state);
  assert.equal(result.report.routingMetadataResponseAcceptance, false);
  assert.deepEqual(Object.keys(result.report.failureEvidence).sort(), ['path', 'sha256']);
  assert.ok(result.report.failureEvidence.path.endsWith('/failure.private.json'));
  const failureBytes = readFileSync(result.report.failureEvidence.path);
  assert.equal(statSync(result.report.failureEvidence.path).mode & 0o777, 0o600);
  assert.equal(result.report.failureEvidence.sha256, hash(failureBytes));
  const failure = JSON.parse(failureBytes);
  assert.equal(failure.name, 'Error');
  assert.match(failure.message, new RegExp(secret));
  assert.match(failure.stack, new RegExp(secret));
  assert.equal(failure.stage.stage, 'current-mounted-startup-input-binding');
  assert.equal(JSON.stringify(result.report).includes(secret), false);
  assert.equal(readFileSync(result.reportPath, 'utf8').includes(secret), false);
  const output = [];
  const previousExitCode = process.exitCode;
  try {
    await main(['--execute-owned', '--run-id=abcdef012345', '--label=controlled',
      '--deployment-input=controlled.private.json'], {
      executeContext: async () => result, print: text => output.push(text),
    });
    assert.equal(process.exitCode, 1);
    assert.equal(output.length, 1);
    assert.equal(output[0].includes(secret), false);
    assert.equal(output[0].includes('failureEvidence'), false);
    assert.equal(JSON.parse(output[0]).routingMetadataResponseAcceptance, false);
  } finally { process.exitCode = previousExitCode; }
});

test('a wrapper failure preserves an earlier private HTTP diagnostic without overwriting its bytes', async t => {
  const state = wrapperFixture(t);
  const firstSecret = 'FIRST-PRIVATE-FAILURE';
  state.runChecks = async ({ recordFailure }) => {
    const failureEvidence = recordFailure({ name: 'Error', message: firstSecret, stack: firstSecret });
    writeFileSync(join(state.workspace, 'ibiz-service-hub', MODEL_CONTEXT_SOURCE_PATH), 'controlled source drift');
    return {
      status: 'failed-controlled-http', routingMetadataResponseAcceptance: false,
      nativeAcceptance: false, fullAcceptance: false, permissionAcceptance: false, unresolved: [],
      failureEvidence,
    };
  };
  const result = await executeOwnedModelContext(state);
  assert.ok(result.report.previousFailureEvidence.path.endsWith('/failure.private.json'));
  assert.ok(result.report.failureEvidence.path.endsWith('/failure-2.private.json'));
  assert.equal(JSON.parse(readFileSync(result.report.previousFailureEvidence.path)).message, firstSecret);
  assert.equal(result.report.previousFailureEvidence.sha256, hash(readFileSync(result.report.previousFailureEvidence.path)));
  assert.equal(statSync(result.report.failureEvidence.path).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(result.report).includes(firstSecret), false);
});
