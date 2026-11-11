import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { readPinnedFile, readTree } from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';

const helperPath = 'scripts/fixtures/OwnedModelingApplicationRoutesProbe.java';
const toolPath = 'scripts/owned-modeling-application-routes.mjs';
const helperClass = 'OwnedModelingApplicationRoutesProbe';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const canonicalRoute = Object.freeze({
  id: 'ibizmodeling__modeldesign__psdevslnsys',
  uri: 'lb://ibizmodeling-modelapi', order: 100,
  predicates: Object.freeze(['Path=/ibizmodeling__modeldesign/psdevslnsys/**']),
  filters: Object.freeze(['StripPrefix=1', 'PrefixPath=/ibizmodeling/modelapi']),
});
const configurationRoute = Object.freeze({
  id: 'ibizmodeling__modeldesign__config-fetchdefault',
  paths: Object.freeze([
    '/api/ibizmodeling__modeldesign/pspfs/fetchdefault',
    '/api/ibizmodeling__modeldesign/pspfstyles/fetchdefault',
    '/api/ibizmodeling__modeldesign/psapptypes/fetchdefault',
  ]),
});

export function verifyOwnedModelingRouteProbe(probe) {
  assert.equal(probe?.contract, 'owned-modeling-application-route-probe-v1');
  assert.equal(probe.application, 'ModelDesign');
  assert.equal(probe.disabledFactoryReturnedNull, true);
  assert.equal(probe.enabledFactoryClass, 'net.ibizsys.central.app.ApplicationRuntime');
  assert.deepEqual(probe.canonicalRoute, canonicalRoute);
  for (const key of ['generatorOrigin', 'factoryOrigin']) {
    assert.equal(probe[key], 'file:/dependencies/ibiz-cloud-core-8.1.0.584.1.jar');
  }
}

export function ownedModelingApplicationRoute(probe, providerOrigin) {
  verifyOwnedModelingRouteProbe(probe);
  assert.match(providerOrigin, /^http:\/\/nf-[a-f0-9]{12}-backend-[a-z0-9][a-z0-9-]{0,48}-provider:32002$/);
  return {
    id: canonicalRoute.id, uri: providerOrigin, order: canonicalRoute.order,
    predicates: [{ name: 'Path', args: {
      _genkey_0: '/api/ibizmodeling__modeldesign/psdevslnsys/**',
    } }],
    // This harness receives the nginx-facing /api prefix as well as the app prefix.
    filters: [
      { name: 'StripPrefix', args: { parts: '2' } },
      { name: 'PrefixPath', args: { prefix: '/ibizmodeling/modelapi' } },
    ],
  };
}

export function ownedModelingConfigurationRoute(providerOrigin) {
  assert.match(providerOrigin, /^http:\/\/nf-[a-f0-9]{12}-backend-[a-z0-9][a-z0-9-]{0,48}-provider:32002$/);
  return {
    id: configurationRoute.id,
    uri: providerOrigin,
    order: 101,
    predicates: [{ name: 'Path', args: Object.fromEntries(
      configurationRoute.paths.map((path, index) => [`_genkey_${index}`, path]),
    ) }],
    filters: [
      { name: 'StripPrefix', args: { parts: '2' } },
      { name: 'PrefixPath', args: { prefix: '/ibizmodeling/modelapi' } },
    ],
  };
}

export function probeOwnedModelingApplicationRoutes({
  workspace, runId, label, imageId, dependencies, modelPath, outputPath, directories, docker,
}) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  workspace = resolve(workspace);
  for (const path of [dependencies, modelPath, outputPath]) {
    assert.equal(path, resolve(path));
    assert.ok(!/[,\r\n\0]/.test(path));
    assert.ok(path.startsWith(`${join(workspace, '.artifacts')}/`));
  }
  const read = path => readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  const target = directories.open(outputPath, { create: true, exclusive: true });
  const source = directories.open(join(outputPath, 'source'), { create: true, exclusive: true });
  const classes = directories.open(join(outputPath, 'classes'), { create: true, exclusive: true });
  const helper = read(join(workspace, helperPath));
  directories.write(source, `${helperClass}.java`, helper);
  const dependencyInventory = sourceBuildInputs(dependencies);
  const model = readTree(modelPath, { jsonOnly: false });
  const report = {
    helperSource: { path: helperPath, sha256: hash(helper) },
    generator: { path: toolPath, sha256: hash(read(join(workspace, toolPath))) },
    dependencies: { path: relative(workspace, dependencies), ...dependencyInventory },
    modelFingerprint: model.fingerprint, commands: [],
    nativeAcceptance: false, permissionAcceptance: false,
  };
  const names = ['compile', 'probe'].map(mode => `nf-${runId}-model-route-${label}-${mode}`);
  const attempted = [];
  try {
    for (const name of names) {
      const current = docker(['container', 'inspect', name], true);
      assert.equal(current.status, 1);
      assert.equal(current.stderr.trim(), `Error response from daemon: No such container: ${name}`);
    }
    const common = name => ['run', '--rm', '--pull=never', '--name', name, '--network=none',
      '--label', `aibiz.native-fixture.run=${runId}`, '--label', `aibiz.model-route.probe=${label}`,
      '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=536870912',
      '--mount', `type=bind,src=${dependencies},dst=/dependencies,readonly`];
    const commands = [
      [...common(names[0]), '--user', `${process.geteuid()}:${process.getegid()}`,
        '--mount', `type=bind,src=${source.path},dst=/source,readonly`,
        '--mount', `type=bind,src=${classes.path},dst=/classes`,
        '--entrypoint', 'javac', imageId, '--release', '8', '-proc:none', '-implicit:none',
        '-sourcepath', '', '-cp', '/dependencies/*', '-d', '/classes', `/source/${helperClass}.java`],
      [...common(names[1]), '--user', '65532:65532',
        '--mount', `type=bind,src=${classes.path},dst=/classes,readonly`,
        '--mount', `type=bind,src=${modelPath},dst=/model,readonly`,
        '--entrypoint', 'java', imageId, '-Xmx1024m', '-cp', '/classes:/dependencies/*', helperClass],
    ];
    for (const [index, command] of commands.entries()) {
      attempted.push(names[index]);
      const result = docker(command, true);
      directories.write(target, `${index}.private.log`, `${result.stderr ?? ''}\n${result.stdout ?? ''}`);
      report.commands.push({ args: command, exitCode: result.status });
      assert.ok(result.status === 0 && !result.error && !result.signal, 'Application route probe failed; see private log');
      if (index === 0) {
        fs.chmodSync(classes.path, 0o755);
        for (const name of fs.readdirSync(classes.path)) fs.chmodSync(join(classes.path, name), 0o644);
      } else {
        report.probe = JSON.parse(result.stdout);
        verifyOwnedModelingRouteProbe(report.probe);
      }
    }
    assert.deepEqual(sourceBuildInputs(dependencies), dependencyInventory);
    assert.equal(readTree(modelPath, { jsonOnly: false }).fingerprint, model.fingerprint);
    assert.equal(hash(read(join(workspace, helperPath))), report.helperSource.sha256);
    assert.equal(hash(read(join(workspace, toolPath))), report.generator.sha256);
    report.helperClasses = sourceBuildInputs(classes.path);
    directories.write(target, 'report.json', json(report));
    return report;
  } finally {
    for (const name of attempted) {
      const result = docker(['container', 'inspect', name], true);
      if (result.status === 0) {
        const container = JSON.parse(result.stdout)[0];
        assert.equal(container.Name, `/${name}`);
        assert.equal(container.Image, imageId);
        assert.equal(container.Config.Labels?.['aibiz.native-fixture.run'], runId);
        assert.equal(container.Config.Labels?.['aibiz.model-route.probe'], label);
        docker(['rm', '--force', container.Id]);
      } else {
        assert.equal(result.status, 1);
        assert.equal(result.stderr.trim(), `Error response from daemon: No such container: ${name}`);
      }
    }
  }
}
