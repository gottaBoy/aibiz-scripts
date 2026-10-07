import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import {
  runAiCodeSourceDepsHarness, verifyAiCodeSourceDepsHarness,
} from '../harness-native-ai-code-source-deps.mjs';
import {
  prepareNativeAiCodeDeployment, verifyNativeAiCodeDeployment,
} from '../prepare-native-ai-code-deployment.mjs';
import {
  prepareAiCodeDockerContext, runAiCodeDockerHarness,
} from '../harness-native-ai-code-docker.mjs';
import { fingerprint, readTree } from '../native-candidate-files.mjs';
import {
  cliSourceFixture, deploymentFixture, fakeBuild, fixtureSnapshot, hash, json,
  setConsumerCliVersion, updateCliBuildReport, write,
} from './helpers/native-ai-code-source-deps-fixture.mjs';

const repo = '@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
const prefixes = ['/plugins/', '/central/plugins/', '/modeldesign/plugins/'];
const tree = root => readTree(root, { jsonOnly: false });

function buildFixture(t, configure = () => {}) {
  const fixture = deploymentFixture(t);
  configure(fixture);
  const build = runAiCodeSourceDepsHarness(fixture);
  assert.equal(build.exitCode, 2, build.report.errors.join('\n'));
  const options = {
    workspace: fixture.workspace, sourceReport: build.reportPath,
    output: join(fixture.workspace, '.artifacts/native-ai-code-deployment/candidate'),
    ...(fixture.cliSourcePins ? { cliSourcePins: fixture.cliSourcePins } : {}),
  };
  return { fixture, build, options };
}

function protectedEvidence({ fixture, build }) {
  return [fixture.hub, fixture.source, fixture.published, build.destination].map(fixtureSnapshot);
}

function preparedFixture(t) {
  const data = buildFixture(t);
  const receipt = prepareNativeAiCodeDeployment(data.options);
  const receiptPath = join(data.options.output, 'receipt.json');
  const deployment = join(data.options.workspace, receipt.deployment.path);
  return { ...data, receipt, receiptPath, deployment };
}

function verify(data, options = {}) {
  return verifyNativeAiCodeDeployment({ ...data.options, receipt: data.receiptPath, ...options });
}

function assertPreflightRejected(data, pattern) {
  const before = fixtureSnapshot(data.fixture.workspace);
  assert.throws(() => prepareNativeAiCodeDeployment(data.options), pattern);
  assert.equal(fs.existsSync(data.options.output), false);
  assert.deepEqual(fixtureSnapshot(data.fixture.workspace), before);
}

function assertReadOnlyRejected(data, options = {}, pattern) {
  const before = fixtureSnapshot(data.fixture.workspace);
  assert.throws(() => verify(data, options), pattern);
  assert.deepEqual(fixtureSnapshot(data.fixture.workspace), before);
}

function assertScopedClaim(receipt) {
  assert.equal(receipt.acceptedForProduction, false);
  assert.equal(receipt.originalRepositoryAuthenticated, false);
  assert.equal(receipt.mapping.compatibility, 'not-verified');
  assert.equal(receipt.dependencies.ibizDependencySourceBuildsVerified, true);
  assert.equal(receipt.dependencies.toolchainSourceBuildsVerified, false);
  assert.equal(receipt.dependencies.declaredRangeCompatibility, 'not-verified');
  assert.ok(receipt.remainingAcceptance.includes('docker-compiler-build-and-toolchain-source-verification'));
}

async function sourceCliDeploymentFixture(t) {
  const fixture = await cliSourceFixture(t, deploymentFixture(t));
  setConsumerCliVersion(fixture, 'vue3-util', '0.3.0');
  setConsumerCliVersion(fixture, 'web-theme', '0.3.23');
  const build = runAiCodeSourceDepsHarness(fixture);
  assert.equal(build.exitCode, 2, build.report.errors.join('\n'));
  const options = {
    workspace: fixture.workspace, sourceReport: build.reportPath, cliSourcePins: fixture.cliSourcePins,
    output: join(fixture.workspace, '.artifacts/native-ai-code-deployment/candidate'),
  };
  return { fixture, build, options };
}

test('deployment preserves independent same-version source CLI evidence without upgrading fixture acceptance', async t => {
  const data = await sourceCliDeploymentFixture(t);
  const before = protectedEvidence(data);
  const cliBefore = data.fixture.cliBuilds.map(build => fixtureSnapshot(build.destination));
  const mock = t.mock.method(childProcess, 'spawnSync', () => {
    throw new Error('Deployment consumers must never run compilers');
  });
  syncBuiltinESMExports();
  try {
    const receipt = prepareNativeAiCodeDeployment(data.options);
    assertScopedClaim(receipt);
    const evidence = receipt.dependencies.sourceBuildEvidence;
    assert.deepEqual(evidence.cliSourceReports, data.build.report.cliSourceReports);
    assert.deepEqual(evidence.sourceBuiltOwnToolchain, data.build.report.sourceBuiltOwnToolchain);
    assert.deepEqual(evidence.publishedOwnToolchain, []);
    assert.deepEqual(evidence.sourceBuiltOwnToolchain.map(tool => tool.version),
      ['0.3.0', '0.3.23', '0.3.30']);
    for (const report of evidence.cliSourceReports) {
      assert.equal(report.reportSha256, hash(fs.readFileSync(report.reportPath)));
      assert.equal(report.cliSourceBuildVerified, false, 'Fixture pins never authenticate production source');
    }
    const receiptPath = join(data.options.output, 'receipt.json');
    const snapshot = fixtureSnapshot(data.fixture.workspace);
    const verified = verifyNativeAiCodeDeployment({ ...data.options, receipt: receiptPath });
    assertScopedClaim(verified);
    assert.equal(verified.deploymentIntegrityVerified, true);
    assert.deepEqual(fixtureSnapshot(data.fixture.workspace), snapshot);
    assert.deepEqual(protectedEvidence(data), before);
    assert.deepEqual(data.fixture.cliBuilds.map(build => fixtureSnapshot(build.destination)), cliBefore);
    assert.equal(mock.mock.callCount(), 0);
  } finally {
    mock.mock.restore();
    syncBuiltinESMExports();
  }
});

for (const [name, mutate, pattern] of [
  ['source CLI log drift', data => {
    const build = data.fixture.cliBuilds[0];
    fs.appendFileSync(join(build.destination, build.report.commands[0].log), 'retained CLI log drift\n');
  }, /Build log (?:size|hash) drift/],
  ['source core output drift', data =>
    fs.appendFileSync(join(data.fixture.cliBuilds[1].report.stage, 'packages/core/dist/index.js'), '// drift\n'),
    /Build output drift/],
  ['internally valid source report hash replacement', data =>
    updateCliBuildReport(data.fixture.cliBuilds[2], report => { report.trustBoundary += '; drift'; }),
    /CLI source report evidence changed/],
  ['published CLI consumer link', data => {
    const ai = data.build.report.sources.find(item => item.id === 'ai-code');
    const path = join(ai.staged, 'node_modules/@ibiz-template/cli');
    fs.unlinkSync(path);
    fs.symlinkSync(data.fixture.toolDirs['@ibiz-template/cli'], path, 'dir');
  }, /Module mapping changed/],
  ['different-version core link', data => {
    const path = join(data.fixture.cliBuilds[2].report.stage, 'packages/cli/node_modules/@ibiz-template/cli-core');
    fs.unlinkSync(path);
    fs.symlinkSync(join(data.fixture.cliBuilds[0].report.stage, 'packages/core'), path, 'dir');
  }, /fallback\/link drift/i],
  ['forged toolchain source verification', data => {
    const report = JSON.parse(fs.readFileSync(data.build.reportPath));
    report.toolchainSourceVerified = true;
    json(data.build.reportPath, report);
  }, /Toolchain source verification claim changed/],
  ['consumer identity version drift', data =>
    setConsumerCliVersion(data.fixture, 'vue3-util', '0.3.23'), /Dependency evidence changed|mapping changed/],
]) {
  test(`deployment refuses ${name} before publishing any candidate`, async t => {
    const data = await sourceCliDeploymentFixture(t);
    mutate(data);
    assertPreflightRejected(data, pattern);
  });
}

test('production deployment verifier rejects fixture source pins unless explicitly injected', async t => {
  const data = await sourceCliDeploymentFixture(t);
  delete data.options.cliSourcePins;
  assertPreflightRejected(data, /Pinned commit mismatch/);
});

test('deployment readback rejects forged source CLI receipt evidence without execution or repair', async t => {
  const data = await sourceCliDeploymentFixture(t);
  const receipt = prepareNativeAiCodeDeployment(data.options);
  const receiptPath = join(data.options.output, 'receipt.json');
  receipt.dependencies.sourceBuildEvidence.cliSourceReports[0].reportSha256 = '0'.repeat(64);
  json(receiptPath, receipt);
  assertReadOnlyRejected({ ...data, receipt, receiptPath }, {}, /current audited build/);
});

test('deployment readback revalidates source CLI logs rather than trusting a prior deployment receipt', async t => {
  const data = await sourceCliDeploymentFixture(t);
  const receipt = prepareNativeAiCodeDeployment(data.options);
  const receiptPath = join(data.options.output, 'receipt.json');
  const build = data.fixture.cliBuilds[2];
  fs.appendFileSync(join(build.destination, build.report.commands[0].log), 'retained CLI log drift\n');
  assertReadOnlyRejected({ ...data, receipt, receiptPath }, {}, /Build log (?:size|hash) drift/);
});

test('source-backed deployment copies only exact fresh outputs plus the byte-identical manifest', t => {
  const data = buildFixture(t);
  const before = protectedEvidence(data);
  const receipt = prepareNativeAiCodeDeployment(data.options);
  const { fixture, build, options } = data;
  const source = build.report.sources.find(pkg => pkg.id === 'ai-code');
  const step = build.report.steps.find(pkg => pkg.id === 'ai-code');
  const manifest = source.entries.find(entry => entry.path === 'package.json');
  const expected = [...step.outputs.entries, manifest].sort((a, b) => a.path.localeCompare(b.path));
  const deployed = join(options.workspace, receipt.deployment.path);
  assert.equal(source.entries.length, 31);
  assert.equal(step.outputs.entries.length, 11);
  assert.equal(receipt.status, 'prepared-not-accepted');
  assertScopedClaim(receipt);
  assert.equal(receipt.source.path, relative(fixture.workspace, fixture.source));
  assert.equal(receipt.source.stagedPath, relative(fixture.workspace, source.staged));
  assert.deepEqual(receipt.source.inputs, source.entries);
  assert.deepEqual(receipt.source.audit, {
    kind: 'source-dependency-report', reportPath: relative(fixture.workspace, build.reportPath),
    reportSha256: hash(fs.readFileSync(build.reportPath)),
  });
  assert.deepEqual(receipt.build.outputs, step.outputs.entries);
  assert.equal(receipt.build.receiptPath, relative(fixture.workspace, build.reportPath));
  assert.equal(receipt.build.receiptSha256, receipt.source.audit.reportSha256);
  assert.equal(receipt.build.package.gitHead, 'a'.repeat(40));
  assert.equal(receipt.build.provenance.status, 'published-snapshot-observed');
  assert.deepEqual(receipt.build.provenance.differences, []);
  assert.deepEqual(tree(deployed).entries, expected);
  assert.deepEqual(receipt.deployment.entries, expected);
  assert.equal(receipt.deployment.files, expected.length);
  assert.equal(receipt.deployment.fingerprint, fingerprint(expected).fingerprint);
  assert.deepEqual(fs.readFileSync(join(deployed, 'package.json')),
    fs.readFileSync(join(fixture.source, 'package.json')));
  for (const entry of expected) {
    assert.deepEqual(fs.readFileSync(join(deployed, entry.path)),
      fs.readFileSync(join(source.staged, entry.path)), entry.path);
  }
  for (const name of ['src', 'public', 'node_modules', '.artifacts', 'pnpm-lock.yaml', 'record-build.mjs']) {
    assert.equal(fs.existsSync(join(deployed, name)), false, name);
  }
  assert.equal(fs.existsSync(join(fixture.source, 'dist')), false);
  assert.deepEqual(fs.readdirSync(options.output).sort(), ['plugins', 'receipt.json']);
  assert.deepEqual(protectedEvidence(data), before);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(options.output, 'receipt.json'))), receipt);
  const bound = receipt.dependencies.sourceBuildEvidence;
  assert.equal(bound.reportPath, receipt.build.receiptPath);
  assert.equal(bound.reportSha256, receipt.build.receiptSha256);
  assert.deepEqual(bound.sources, build.report.sources.filter(pkg => pkg.id !== 'hub-config').map(pkg => ({
    name: pkg.name, version: pkg.version, fingerprint: pkg.fingerprint,
    outputFingerprint: build.report.steps.find(item => item.id === pkg.id)?.outputs.fingerprint ?? null,
  })));
  assert.deepEqual(bound.publishedOwnToolchain, build.report.publishedOwnToolchain);
});

test('source-backed deployment verification is read-only and never confers native acceptance', t => {
  const data = preparedFixture(t);
  const before = fixtureSnapshot(data.fixture.workspace);
  const verified = verify(data);
  assert.deepEqual(verified, {
    ...data.receipt, status: 'verified-deployment-not-accepted', deploymentIntegrityVerified: true,
  });
  assertScopedClaim(verified);
  assert.deepEqual(fixtureSnapshot(data.fixture.workspace), before);
});

for (const mode of ['modified', 'deleted']) {
  test(`source-backed deployment rejects ${mode} completed framework output before copying`, t => {
    const data = buildFixture(t);
    const model = data.build.report.sources.find(pkg => pkg.id === 'model-core');
    const path = join(model.staged, 'out/index.js');
    if (mode === 'modified') write(path, 'retained modified dependency output\n');
    else fs.unlinkSync(path);
    assertPreflightRejected(data, /Build output drift/);
  });
}

for (const staged of [false, true]) {
  for (const input of ['src/index.ts', 'package.json']) {
    test(`source-backed deployment rejects ${staged ? 'staged' : 'original'} plugin ${input} drift`, t => {
      const data = buildFixture(t);
      const source = data.build.report.sources.find(pkg => pkg.id === 'ai-code');
      const path = join(staged ? source.staged : source.original, input);
      if (input === 'package.json') json(path, { ...JSON.parse(fs.readFileSync(path)), version: 'drift' });
      else fs.appendFileSync(path, '// retained input drift\n');
      assertPreflightRejected(data, /source input drift/i);
    });
  }
}

test('source-backed deployment rejects altered build log bytes before creating any candidate', t => {
  const data = buildFixture(t);
  const command = data.build.report.steps[0].commands[0];
  fs.appendFileSync(join(data.build.destination, command.log), 'retained log drift\n');
  assertPreflightRejected(data, /log (?:length|hash) changed/);
});

test('source-backed deployment rejects a published framework fallback link', t => {
  const data = buildFixture(t);
  const source = data.build.report.sources.find(pkg => pkg.id === 'runtime');
  const link = join(source.staged, 'node_modules/@ibiz-template/core');
  fs.unlinkSync(link);
  fs.symlinkSync(join(data.fixture.source, 'node_modules/@ibiz-template/core'), link, 'dir');
  assertPreflightRejected(data, /Module mapping changed|Published framework fallback/);
});

test('a failed source build retains its real log/output/report and cannot produce a deployment', t => {
  const fixture = deploymentFixture(t);
  write(join(fixture.toolDirs.typescript, 'tsc.cjs'), `${fakeBuild}\nprocess.exit(17);\n`);
  const build = runAiCodeSourceDepsHarness(fixture);
  assert.equal(build.exitCode, 1);
  assert.equal(build.report.steps[0].commands[0].exitCode, 17);
  const options = {
    workspace: fixture.workspace, sourceReport: build.reportPath,
    output: join(fixture.workspace, '.artifacts/native-ai-code-deployment/candidate'),
  };
  assertPreflightRejected({ fixture, build, options }, /did not complete/);
  assert.ok(fs.existsSync(join(build.destination, build.report.steps[0].commands[0].log)));
  assert.ok(fs.existsSync(join(build.report.sources.find(pkg => pkg.id === 'model-core').staged,
    'out/index.js')));
});

for (const [name, configure, pattern] of [
  ['unrecorded root input', fixture => write(join(fixture.source, 'unexpected-input.txt'), 'extra\n'),
    /Staged plugin inputs differ/],
  ['missing fixed input', fixture => fs.unlinkSync(join(fixture.source, 'record-build.mjs')),
    /ENOENT/],
  ['changed entry metadata', fixture => {
    const path = join(fixture.source, 'package.json');
    json(path, { ...JSON.parse(fs.readFileSync(path)), main: 'lib/wrong.cjs' });
  }, /Unexpected plugin entry points/],
  ['missing CSS output', fixture => {
    const path = join(fixture.toolDirs['@ibiz-template/cli'], 'cli.cjs');
    write(path, `${fs.readFileSync(path, 'utf8')}
if (value.name === '@ibiz-template-plugin/ai-code') fs.unlinkSync('dist/index.min.css');
`);
  }, /Missing plugin entry point/],
  ['non-System bundle', fixture => {
    const path = join(fixture.toolDirs['@ibiz-template/cli'], 'cli.cjs');
    write(path, `${fs.readFileSync(path, 'utf8')}
if (value.name === '@ibiz-template-plugin/ai-code') emit('dist/index.system.min.js', 'not a system bundle');
`);
  }, /not a System.register bundle/],
  ['mismatched built asset', fixture => {
    const path = join(fixture.toolDirs['@ibiz-template/cli'], 'cli.cjs');
    write(path, `${fs.readFileSync(path, 'utf8')}
if (value.name === '@ibiz-template-plugin/ai-code') emit('es/assets/type/types.txt', 'wrong asset');
`);
  }, /Built asset differs from source/],
]) {
  test(`source-backed deployment rejects ${name} despite a successful dependency build`, t => {
    const data = buildFixture(t, configure);
    assert.equal(verifyAiCodeSourceDepsHarness(data.options).dependencySourceBuildsVerified, true);
    assertPreflightRejected(data, pattern);
  });
}

for (const [name, mutate, pattern] of [
  ['gitHead', fixture => {
    const path = join(fixture.published, 'package.json');
    json(path, { ...JSON.parse(fs.readFileSync(path)), gitHead: 'b'.repeat(40) });
  }, /Published gitHead changed/],
  ['source bytes', fixture => fs.appendFileSync(join(fixture.published, 'src/index.ts'), '// upstream drift\n'),
    /Source differs unexpectedly/],
  ['source file set', fixture => write(join(fixture.published, 'src/extra.ts'), 'export {};\n'),
    /Published source file set differs/],
  ['asset bytes', fixture => write(join(fixture.published, 'dist/assets/type/types.txt'), 'upstream drift\n'),
    /Published assets differ/],
]) {
  test(`source-backed deployment still binds published ${name}`, t => {
    const data = buildFixture(t);
    mutate(data.fixture);
    assertPreflightRejected(data, pattern);
  });
}

for (const mode of ['modified', 'deleted', 'added', 'symlink']) {
  test(`source-backed deployment verification rejects ${mode} delivery output without repair`, t => {
    const data = preparedFixture(t);
    const path = join(data.deployment, 'es/index.mjs');
    if (mode === 'modified') write(path, 'retained modified delivery\n');
    else if (mode === 'deleted') fs.unlinkSync(path);
    else if (mode === 'added') write(join(data.deployment, 'dist/unrecorded.js'), 'retained extra delivery\n');
    else {
      fs.unlinkSync(path);
      fs.symlinkSync(join(data.build.report.sources.find(pkg => pkg.id === 'ai-code').staged,
        'es/index.mjs'), path);
    }
    assertReadOnlyRejected(data);
  });
}

test('deployment verification binds source report bytes, even a semantically unchanged report', t => {
  const data = preparedFixture(t);
  fs.appendFileSync(data.build.reportPath, ' \n');
  assert.equal(verifyAiCodeSourceDepsHarness(data.options).dependencySourceBuildsVerified, true);
  assertReadOnlyRejected(data, {}, /Deployment receipt differs/);
});

test('deployment verification rejects source evidence hash substitution in its own receipt', t => {
  const data = preparedFixture(t);
  const receipt = JSON.parse(fs.readFileSync(data.receiptPath));
  receipt.dependencies.sourceBuildEvidence.reportSha256 = '0'.repeat(64);
  json(data.receiptPath, receipt);
  assertReadOnlyRejected(data, {}, /Deployment receipt differs/);
});

test('deployment verification rechecks dependency output and log drift after preparation', t => {
  const data = preparedFixture(t);
  const command = data.build.report.steps[0].commands[0];
  const log = join(data.build.destination, command.log);
  const bytes = fs.readFileSync(log);
  fs.appendFileSync(log, 'retained late log drift\n');
  assertReadOnlyRejected(data, {}, /log (?:length|hash) changed/);
  write(log, bytes);
  const model = data.build.report.sources.find(pkg => pkg.id === 'model-core');
  write(join(model.staged, 'out/index.js'), 'retained late dependency drift\n');
  assertReadOnlyRejected(data, {}, /Build output drift/);
});

test('a source-backed receipt cannot be consumed without its report or with a different valid build', t => {
  const data = preparedFixture(t);
  assertReadOnlyRejected(data, { sourceReport: undefined });
  const another = runAiCodeSourceDepsHarness({
    ...data.fixture, output: join(dirname(data.build.destination), 'another-valid-build'),
  });
  assert.equal(another.exitCode, 2, another.report.errors.join('\n'));
  assert.equal(verifyAiCodeSourceDepsHarness({
    workspace: data.fixture.workspace, sourceReport: another.reportPath,
  }).dependencySourceBuildsVerified, true);
  assertReadOnlyRejected(data, { sourceReport: another.reportPath }, /Deployment receipt differs/);
});

test('source-backed preparation refuses overwriting an existing deployment', t => {
  const data = preparedFixture(t);
  assertPreflightRejected({ ...data, options: { ...data.options,
    output: join(dirname(data.options.output), 'nested/candidate') } }, /direct child/);
  const before = fixtureSnapshot(data.fixture.workspace);
  assert.throws(() => prepareNativeAiCodeDeployment(data.options), /must not be overwritten/);
  assert.deepEqual(fixtureSnapshot(data.fixture.workspace), before);
});

function dockerOptions(data) {
  return {
    workspace: data.fixture.workspace, sourceReport: data.build.reportPath, receipt: data.receiptPath,
    output: join(data.fixture.workspace, '.artifacts/native-ai-code-docker/delivery'),
  };
}

test('Docker context consumes the bound source report but copies no build inputs or dependencies', t => {
  const data = preparedFixture(t);
  const before = protectedEvidence(data);
  const deploymentBefore = fixtureSnapshot(data.options.output);
  const options = dockerOptions(data);
  const prepared = prepareAiCodeDockerContext(options);
  assertScopedClaim(prepared.verified);
  assert.equal(prepared.verified.deploymentIntegrityVerified, true);
  const expected = data.receipt.deployment.entries.map(entry => ({
    ...entry, path: `plugins/${repo}/${entry.path}`,
  }));
  const entries = tree(prepared.contextPath).entries;
  assert.deepEqual(entries.filter(entry => entry.path.startsWith('plugins/')), expected);
  assert.deepEqual(entries.filter(entry => !entry.path.startsWith('plugins/')).map(entry => entry.path),
    ['Dockerfile', 'nginx.conf']);
  assert.deepEqual(prepared.context.entries, entries);
  assert.equal(prepared.context.files, data.receipt.deployment.files + 2);
  assert.equal(prepared.deploymentReceipt.sha256, hash(fs.readFileSync(data.receiptPath)));
  assert.deepEqual(protectedEvidence(data), before);
  assert.deepEqual(fixtureSnapshot(data.options.output), deploymentBefore);
});

test('Docker context rejects missing or stale source evidence before creating a context', t => {
  const data = preparedFixture(t);
  const options = dockerOptions(data);
  let before = fixtureSnapshot(data.fixture.workspace);
  assert.throws(() => prepareAiCodeDockerContext({ ...options, sourceReport: undefined }));
  assert.equal(fs.existsSync(options.output), false);
  assert.deepEqual(fixtureSnapshot(data.fixture.workspace), before);
  const source = data.build.report.sources.find(pkg => pkg.id === 'ai-code');
  write(join(source.staged, 'es/index.mjs'), 'retained plugin output drift\n');
  before = fixtureSnapshot(data.fixture.workspace);
  assert.throws(() => prepareAiCodeDockerContext(options), /Build output drift/);
  assert.equal(fs.existsSync(options.output), false);
  assert.deepEqual(fixtureSnapshot(data.fixture.workspace), before);
});

async function httpFixture(t, deployment) {
  const files = tree(deployment).contents;
  const routes = new Map(prefixes.flatMap(prefix => files.map(file =>
    [`${prefix}${repo}/${file.path}`, file.data])));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const body = request.url === '/health' ? Buffer.from('ok\n') : routes.get(request.url);
    response.writeHead(body ? 200 : 404);
    response.end(body ?? 'not found\n');
  });
  t.after(async () => {
    await new Promise((done, reject) => {
      server.close(error => error ? reject(error) : done());
      server.closeAllConnections();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: String(server.address().port), requests };
}

function mockDocker(t, port) {
  const calls = [];
  const id = 'c'.repeat(64);
  const baseId = `sha256:${'a'.repeat(64)}`;
  const imageId = `sha256:${'b'.repeat(64)}`;
  const baseLayer = `sha256:${'d'.repeat(64)}`;
  let imageTag, name, label, removed = false;
  const mock = t.mock.method(childProcess, 'spawnSync', (command, args) => {
    assert.equal(command, 'docker', 'Only fake Docker commands are expected here');
    calls.push(args);
    let stdout = '', stderr = '', status = 0;
    const emit = value => { stdout = `${JSON.stringify(value)}\n`; };
    if (args[0] === 'image' && args[1] === 'inspect') {
      assert.ok(args[2] === 'fixture/nginx:local' || args[2] === imageTag);
      const base = args[2] === 'fixture/nginx:local';
      emit([{
        Id: base ? baseId : imageId, Architecture: 'amd64',
        RootFS: { Layers: base ? [baseLayer] : [baseLayer, `sha256:${'e'.repeat(64)}`] },
        Config: { User: '101:101', Volumes: null },
      }]);
    } else if (args[0] === 'build') {
      imageTag = args[args.indexOf('--tag') + 1];
      stdout = 'fixture static Docker copy, no compiler\n';
    } else if (args[0] === 'create') {
      name = args[args.indexOf('--name') + 1];
      label = args[args.indexOf('--label') + 1].split('=').slice(1).join('=');
      stdout = `${id}\n`;
    } else if (args[0] === 'start' || args[0] === 'logs') {
      assert.equal(args[1], id);
      stdout = 'fixture container\n';
    } else if (args[0] === 'inspect') {
      assert.ok(args[1] === id || args[1] === name);
      if (removed) {
        status = 1;
        stderr = `No such container: ${name}\n`;
      } else emit([{
        Id: id, Name: `/${name}`, Image: imageId,
        Config: { User: '101:101', Volumes: null, Labels: { 'io.aibiz.native-ai-code.run': label } },
        HostConfig: {
          ReadonlyRootfs: true, Tmpfs: { '/tmp': 'uid=101,gid=101,mode=0700' },
          CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'],
        },
        Mounts: [], NetworkSettings: { Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: port }] } },
      }]);
    } else if (args[0] === 'rm') {
      assert.deepEqual(args, ['rm', '--force', '--volumes', id]);
      removed = true;
      stdout = `${id}\n`;
    } else assert.fail(`Unexpected fake Docker command: ${JSON.stringify(args)}`);
    return { status, signal: null, error: undefined, stdout, stderr };
  });
  syncBuiltinESMExports();
  return { calls, restore: () => { mock.mock.restore(); syncBuiltinESMExports(); } };
}

test('Docker report forwards verified dependency evidence while remaining static-only and not accepted', async t => {
  const data = preparedFixture(t);
  const before = protectedEvidence(data);
  const deploymentBefore = fixtureSnapshot(data.options.output);
  const http = await httpFixture(t, data.deployment);
  const docker = mockDocker(t, http.port);
  let report;
  try {
    report = await runAiCodeDockerHarness({ ...dockerOptions(data), baseImage: 'fixture/nginx:local' });
  } finally { docker.restore(); }
  assert.equal(report.status, 'docker-delivery-passed-native-not-accepted', report.errors.join('\n'));
  assert.equal(report.deliveryStatus, 'passed');
  assert.equal(report.cleanup.status, 'passed');
  assert.equal(report.ibizDependencySourceBuildsVerified, true);
  assert.equal(report.compilerBuildInDockerVerified, false);
  assert.equal(report.acceptedForProduction, false);
  assert.equal(report.nativeRuntimeAccepted, false);
  assert.deepEqual(report.sourceBuildEvidence, data.receipt.dependencies.sourceBuildEvidence);
  assert.deepEqual(report.deployment, data.receipt.deployment);
  const expected = prefixes.flatMap(prefix => [
    ...data.receipt.deployment.entries.map(entry => ({
      path: `${prefix}${repo}/${entry.path}`, status: 200, bytes: entry.bytes, sha256: entry.sha256,
    })),
    { path: `${prefix}@ibiz-template-plugin/ai-code@0.0.3-alpha.92/package.json`, status: 404 },
    { path: `${prefix}${repo}/missing.js`, status: 404 },
  ]);
  assert.deepEqual(report.checks, expected);
  assert.deepEqual(http.requests, ['/health', ...expected.map(check => check.path)]);
  assert.ok(docker.calls.some(args => args[0] === 'build' && args.includes('--network=none')));
  assert.ok(docker.calls.some(args => args[0] === 'rm' && args.includes('--volumes')));
  const { reportPath, ...persisted } = report;
  assert.deepEqual(JSON.parse(fs.readFileSync(join(data.fixture.workspace, reportPath))), persisted);
  assert.deepEqual(protectedEvidence(data), before);
  assert.deepEqual(fixtureSnapshot(data.options.output), deploymentBefore);
});
