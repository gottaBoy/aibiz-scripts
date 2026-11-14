import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';
import { verifyNativeServiceCandidate } from './prepare-native-service-candidate.mjs';

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
const centralRoute = Object.freeze({
  id: 'ibizmodeling__central__psdevsln', uri: 'lb://ibizmodeling-modelapi', order: 100,
  predicates: ['Path=/ibizmodeling__central/psdevslns/**'],
  filters: ['StripPrefix=1', 'PrefixPath=/ibizmodeling/modelapi'],
});
const centralOutputPaths = [
  'PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json',
  'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln.json',
  ...['CurDCAdmin', 'CurDCSLNAdmin', 'CurDCSLNUser'].map(query =>
    `PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln/PSDEDATAQUERIES/${query}/PSDEDQCODES/MYSQL5.json`),
];
const centralSourceRoot =
  'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const stagedCentralBindings = new WeakMap();

export function readCentralMemberModelOverlay({ workspace, receiptPath }) {
  workspace = resolve(workspace);
  receiptPath = resolve(workspace, receiptPath);
  const verified = verifyNativeServiceCandidate({ workspace, receiptPath });
  assert.equal(verified.contract, 'native-central-member-session-binding-candidate',
    'Central routing requires the full member binding, not the view-only candidate');
  assert.equal(verified.status, 'verified-member-binding-candidate-not-accepted');
  assert.deepEqual(verified.outputs.map(row => row.path).sort(), [...centralOutputPaths].sort());
  const directories = new PinnedDirectories();
  const read = path => readPinnedFile(directories,
    directories.open(dirname(path)), basename(path)).data;
  try {
    const contents = verified.outputs.map(row => {
      const data = read(join(dirname(receiptPath), 'model', row.path));
      assert.equal(hash(data), row.sha256);
      return { ...row, data };
    });
    return {
      contents, inputs: verified.inputs,
      receipt: { path: relative(workspace, receiptPath), sha256: hash(read(receiptPath)) },
    };
  } finally { directories.close(); }
}

export function verifyStagedCentralMemberModel({ workspace, receiptPath, modelPath }) {
  workspace = resolve(workspace);
  modelPath = resolve(modelPath);
  assert.ok(modelPath.startsWith(`${join(workspace, '.artifacts')}/`),
    'Central model stage must remain inside this workspace artifact root');
  const overlay = readCentralMemberModelOverlay({ workspace, receiptPath });
  const source = readTree(join(workspace, centralSourceRoot), { jsonOnly: false });
  for (const input of overlay.inputs) {
    assert.equal(source.entries.find(row => row.path === input.path)?.sha256, input.sha256);
  }
  const staged = readTree(modelPath, { jsonOnly: false });
  assert.deepEqual(staged.entries, source.entries.map(file => {
    const replacement = overlay.contents.find(row => row.path === file.path);
    return replacement ? { ...file, bytes: replacement.data.length, sha256: replacement.sha256 } : file;
  }), 'Current Central stage is not the complete verified source plus member overlay');
  const binding = {
    contract: 'staged-native-central-member-binding-v1',
    receipt: overlay.receipt,
    sourceFingerprint: source.fingerprint,
    modelFingerprint: staged.fingerprint,
    outputs: overlay.contents.map(({ path, sha256 }) => ({ path, sha256 })),
    nativeAcceptance: false, permissionAcceptance: false,
  };
  stagedCentralBindings.set(binding, {
    workspace, receiptPath: resolve(workspace, receiptPath), modelPath,
    digest: hash(json(binding)),
  });
  return binding;
}

export function ownedCentralMemberRoute(probe, providerOrigin, binding) {
  verifyOwnedModelingRouteProbe(probe);
  assert.deepEqual(probe.centralCanonicalRoute, centralRoute,
    'Central route must come from the same packaged native gateway generator');
  const proof = binding && stagedCentralBindings.get(binding);
  assert.ok(proof, 'A freshly verified in-process Central stage is required; JSON metadata is not proof');
  assert.equal(hash(json(binding)), proof.digest, 'Central stage binding metadata changed');
  const current = readCentralMemberModelOverlay({
    workspace: proof.workspace, receiptPath: proof.receiptPath,
  });
  assert.deepEqual(current.receipt, binding.receipt);
  assert.equal(readTree(proof.modelPath, { jsonOnly: false }).fingerprint, binding.modelFingerprint,
    'Current Central backend stage changed before route construction');
  assert.equal(binding?.contract, 'staged-native-central-member-binding-v1');
  assert.match(binding.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.match(binding.modelFingerprint, /^[a-f0-9]{64}$/);
  assert.match(binding.receipt?.sha256, /^[a-f0-9]{64}$/);
  assert.match(binding.receipt?.path, /^\.artifacts\/native-service-migration\/[A-Za-z0-9._/-]+\/receipt\.json$/);
  assert.deepEqual(binding.outputs.map(row => row.path).sort(), [...centralOutputPaths].sort());
  for (const row of binding.outputs) assert.match(row.sha256, /^[a-f0-9]{64}$/);
  const route = ownedModelingApplicationRoute(probe, providerOrigin);
  return {
    ...route, id: `${centralRoute.id}__member-read`,
    predicates: [
      { name: 'Path', args: { _genkey_0: '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser' } },
      { name: 'Method', args: { _genkey_0: 'POST' } },
    ],
  };
}

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
