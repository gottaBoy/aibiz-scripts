import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { ownedFrontendTopologyWitness } from './native-model-design-owned-backend-input.mjs';
import { validateDeployment } from './run-owned-native-permission-http.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Returned inspect/configuration values are owner-private. Public reports must
// use bindings and witnesses, never serialize the context itself.
export function ownedNativeRuntimeContext({
  workspace, runId, deploymentInput, execute = spawnSync,
}) {
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  workspace = resolve(workspace);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const path = resolve(workspace, deploymentInput);
  assert.equal(dirname(dirname(path)), base);
  assert.match(basename(dirname(path)), /^backend-runtime-[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(basename(path), 'deployment-input.private.json');
  const directories = new PinnedDirectories();
  const inputs = [];
  const read = (path, privateInput = false) => {
    const child = relative(workspace, path);
    assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'));
    const file = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
    if (privateInput) {
      assert.equal(file.identity.uid, process.geteuid());
      assert.equal(file.identity.mode & 0o077, 0);
    }
    inputs.push({ path, privateInput, sha256: hash(file.data), bytes: file.data.length });
    return JSON.parse(file.data);
  };
  try {
    const manifest = read(join(base, 'manifest.json'));
    assert.equal(manifest.runId, runId);
    const resources = read(join(base, 'owned-resources.json'), true);
    const deployment = read(path, true);
    const imagePath = resolve(workspace, deployment.imageReceipt.path);
    const images = read(imagePath);
    assert.equal(inputs.at(-1).sha256, deployment.imageReceipt.sha256);
    const credentials = read(join(base, 'credentials.private.json'), true);
    const ids = [resources.mysqlId, ...Object.values(deployment.services).map(x => x.containerId),
      ...deployment.auxiliaryContainers.map(x => x.containerId)];
    assert.ok(ids.every(id => /^[a-f0-9]{64}$/.test(id)));
    assert.match(resources.networkId, /^[a-f0-9]{64}$/);
    const dockerJSON = args => {
      const result = execute('docker', args, {
        encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
      });
      assert.ok(result.status === 0 && !result.error && !result.signal,
        'Owned inspection failed; raw output suppressed');
      return JSON.parse(result.stdout);
    };
    let before;
    const guard = () => {
      for (const input of inputs) {
        const file = readPinnedFile(directories,
          directories.open(dirname(input.path)), basename(input.path));
        assert.equal(hash(file.data), input.sha256, 'Owned runtime input drift');
        if (input.privateInput) {
          assert.equal(file.identity.uid, process.geteuid());
          assert.equal(file.identity.mode & 0o077, 0);
        }
      }
      const containers = dockerJSON(['inspect', ...ids]);
      const network = dockerJSON(['network', 'inspect', resources.networkId])[0];
      const origins = validateDeployment(manifest, resources, deployment, containers, network, images,
        inspectMysqlFixtureVolumes(resources, { execute }));
      const witness = ownedFrontendTopologyWitness({ containers, network, image: { Id: null } });
      if (before) assert.deepEqual(witness, before, 'Owned runtime identity/configuration/lifecycle drift');
      else before = witness;
      return { containers, network, origins };
    };
    guard();
    return {
      base, manifest, resources, deployment, credentials, guard,
      bindings: inputs.map(({ privateInput, ...binding }) => binding),
      witness: before, close: () => directories.close(),
    };
  } catch {
    directories.close();
    throw new Error('Owned runtime context refused; private details suppressed');
  }
}
