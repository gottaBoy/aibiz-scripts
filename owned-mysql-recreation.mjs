import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { mysqlSmokeRunArgs } from './tests/run-owned-native-nonadmin-fixture.sql.mjs';
import { mysqlFixtureProfile, verifySelectedMysqlStorage } from './mysql-fixture-profiles.mjs';
import { OWNED_VOLUME_PROFILE, inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';

const toolPath = 'scripts/owned-mysql-recreation.mjs';
const ownerKey = 'aibiz.native-fixture.run';
const idPattern = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const generator = () => ({ path: toolPath, sha256: hash(readFileSync(fileURLToPath(import.meta.url))) });

function docker(args, execute, allowFailure = false) {
  const result = execute('docker', args, {
    encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.ok(!result.error && !result.signal, 'Owned MySQL recreation command did not complete');
  if (!allowFailure) assert.equal(result.status, 0, 'Owned MySQL recreation failed; private output suppressed');
  return result;
}

export function mysqlRecreationWitness(container) {
  return {
    id: container.Id, image: container.Image, name: container.Name,
    configSha256: hash(json(canonical(container.Config))), hostConfigSha256: hash(json(canonical(container.HostConfig))),
    mountsSha256: hash(json(canonical([...container.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination))))),
  };
}

export function mysqlRecreationCreatedWitness(before, id) {
  const created = structuredClone(before);
  created.Id = id;
  // The reviewed local Engine normalizes null to false at create, then restores null at start.
  if (created.HostConfig.OomKillDisable === null) created.HostConfig.OomKillDisable = false;
  return mysqlRecreationWitness(created);
}

export function mysqlRecreationCreateArgs(manifest, resources, before) {
  assert.equal(resources.runId, manifest.runId);
  assert.equal(resources.databaseProfile?.name, OWNED_VOLUME_PROFILE, 'Recreation cannot use a tmpfs profile');
  const profile = mysqlFixtureProfile(resources.databaseProfile.name);
  assert.equal(resources.mysqlImage, profile.imageId);
  assert.equal(before.Id, resources.mysqlId);
  assert.equal(before.Name, `/${manifest.ownership.mysqlContainer}`);
  assert.equal(before.Config.Labels?.[ownerKey], manifest.runId);
  assert.equal(before.Image, profile.imageId);
  assert.match(before.Config.Hostname, /^[a-z0-9][a-z0-9-]{0,62}$/);
  assert.deepEqual(Object.keys(before.NetworkSettings.Networks), [resources.networkName]);
  const attachment = before.NetworkSettings.Networks[resources.networkName];
  assert.equal(attachment.NetworkID, resources.networkId);
  assert.match(attachment.IPAddress, /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/);
  const secrets = before.Config.Env.filter(row => row.startsWith('MYSQL_ROOT_PASSWORD='));
  assert.equal(secrets.length, 1, 'Original private runtime must contain exactly one root secret');
  const password = secrets[0].slice('MYSQL_ROOT_PASSWORD='.length);
  const args = mysqlSmokeRunArgs(manifest, {
    mysqlImage: profile.imageId, databaseProfile: resources.databaseProfile.name,
    databaseStorage: resources.databaseStorage, password,
  });
  assert.deepEqual(args.slice(0, 2), ['run', '-d']);
  const imageIndex = args.indexOf(profile.imageId);
  return ['create', ...args.slice(2, imageIndex), '--hostname', before.Config.Hostname,
    '--ip', attachment.IPAddress, ...args.slice(imageIndex)];
}

export function mysqlRecreationCreateRequest(manifest, resources, before) {
  mysqlRecreationCreateArgs(manifest, resources, before);
  const network = before.NetworkSettings.Networks[resources.networkName];
  return {
    name: resources.mysqlName,
    body: { ...structuredClone(before.Config), HostConfig: structuredClone(before.HostConfig),
      NetworkingConfig: { EndpointsConfig: { [resources.networkName]: {
        IPAMConfig: { IPv4Address: network.IPAddress },
      } } } },
  };
}

export function recreationTransport(execute) {
  const endpoint = JSON.parse(docker(['context', 'inspect', '--format', '{{json .Endpoints.docker}}'], execute).stdout);
  assert.match(endpoint.Host, /^unix:\/\//, 'Exact recreation requires the selected local Docker Unix socket');
  assert.ok(!process.env.DOCKER_HOST || process.env.DOCKER_HOST === endpoint.Host);
  const socket = endpoint.Host.slice('unix://'.length);
  assert.match(socket, /^\/[a-zA-Z0-9_./-]+$/);
  const version = docker(['version', '--format', '{{.Server.APIVersion}}'], execute).stdout.trim();
  assert.match(version, /^1\.[0-9]+$/);
  return { socket, version };
}

export function createExactContainer(request, transport, execute) {
  assert.deepEqual(recreationTransport(execute), transport, 'Docker transport changed during recreation');
  const { socket, version } = transport;
  const result = execute('curl', ['--silent', '--show-error', '--fail', '--noproxy', '*',
    '--unix-socket', socket, '--max-time', '90', '--request', 'POST',
    '--header', 'Content-Type: application/json', '--data-binary', '@-',
    `http://localhost/v${version}/containers/create?name=${encodeURIComponent(request.name)}`], {
    input: json(request.body), encoding: 'utf8', timeout: 95_000, maxBuffer: 1024 * 1024,
  });
  assert.ok(!result.error && !result.signal && result.status === 0, 'Exact owned container creation failed; private output suppressed');
  const response = JSON.parse(result.stdout);
  assert.match(response.Id, idPattern);
  return response;
}

export function verifyMysqlRecreationContainer(before, after, resources) {
  assert.match(after.Id, idPattern);
  assert.notEqual(after.Id, before.Id, 'Recreation requires a genuinely new container ID');
  assert.equal(after.Image, before.Image);
  assert.equal(after.Name, before.Name);
  assert.deepEqual(after.Config, before.Config, 'Replacement must preserve every private runtime setting');
  assert.deepEqual(after.HostConfig, before.HostConfig, 'Replacement must preserve every host restriction');
  const oldWitness = mysqlRecreationWitness(before);
  const newWitness = mysqlRecreationWitness(after);
  assert.equal(newWitness.mountsSha256, oldWitness.mountsSha256);
  assert.notEqual(after.Created, before.Created);
  assert.deepEqual(Object.keys(after.NetworkSettings.Networks), [resources.networkName]);
  const previous = before.NetworkSettings.Networks[resources.networkName];
  const current = after.NetworkSettings.Networks[resources.networkName];
  assert.equal(current.NetworkID, resources.networkId);
  assert.equal(current.IPAddress, previous.IPAddress, 'Preserve the owned private address for existing JDBC pools');
  assert.notEqual(current.EndpointID, previous.EndpointID, 'A new Docker network endpoint is required');
}

export function recreateOwnedMysql({
  manifest, resources, context, sequence, previous = null, guard, write, onCurrent, execute = spawnSync,
}) {
  assert.ok(Number.isInteger(sequence) && sequence >= 1 && sequence <= 2);
  assert.equal(typeof guard, 'function');
  assert.equal(typeof write, 'function');
  assert.equal(typeof onCurrent, 'function');
  guard();
  const inspect = id => JSON.parse(docker(['inspect', id], execute).stdout)[0];
  const before = inspect(resources.mysqlId);
  assert.equal(before.State.Running, true);
  const volumes = inspectMysqlFixtureVolumes(resources, { execute });
  verifySelectedMysqlStorage(resources.databaseProfile, before, { storage: resources.databaseStorage, volumes });
  const network = JSON.parse(docker(['network', 'inspect', resources.networkId], execute).stdout)[0];
  const otherPeers = Object.keys(network.Containers).filter(id => id !== before.Id).sort();
  const createRequest = mysqlRecreationCreateRequest(manifest, resources, before);
  const transport = recreationTransport(execute);
  // Private recovery plan is written before stopping or deleting anything.
  const intent = {
    contract: 'owned-mysql-recreation-intent-v1', runId: manifest.runId, sequence,
    generator: generator(), context, previous, resourcesBefore: structuredClone(resources),
    before, createRequest, transport, createdAt: new Date().toISOString(),
  };
  const intentBinding = write('intent.private.json', intent);
  guard();
  docker(['stop', '--time', '60', before.Id], execute);
  const stopped = inspect(before.Id);
  assert.equal(stopped.State.Running, false);
  assert.equal(stopped.State.ExitCode, 0, 'Orderly recreation requires successful MySQL shutdown, not forced kill');
  assert.equal(stopped.State.OOMKilled, false);
  assert.deepEqual(mysqlRecreationWitness(stopped), mysqlRecreationWitness(before));
  inspectMysqlFixtureVolumes(resources, { execute });
  write('stopped.json', { contract: 'owned-mysql-recreation-stopped-v1', intent: intentBinding,
    mysqlId: before.Id, exitCode: 0 });
  docker(['rm', before.Id], execute);
  const absent = docker(['container', 'inspect', before.Id], execute, true);
  assert.equal(absent.status, 1);
  assert.equal(absent.stderr.trim(), `Error response from daemon: No such container: ${before.Id}`);
  inspectMysqlFixtureVolumes(resources, { execute, expectedRefs: [] });
  const remaining = JSON.parse(docker(['network', 'inspect', resources.networkId], execute).stdout)[0];
  assert.equal(remaining.Id, network.Id);
  assert.equal(remaining.Name, network.Name);
  assert.deepEqual(Object.keys(remaining.Containers).sort(), otherPeers);
  const removed = write('removed.json', { contract: 'owned-mysql-recreation-removed-v1',
    intent: intentBinding, mysqlId: before.Id, absent: true });
  onCurrent({ ...resources, mysqlId: null });
  const response = createExactContainer(createRequest, transport, execute);
  const id = response.Id;
  assert.match(id, idPattern);
  const next = { ...resources, mysqlId: id };
  // A created replacement is journaled even if its later readiness check fails.
  const created = inspect(id);
  const createdBinding = write('created.json', {
    contract: 'owned-mysql-recreation-created-v1', intent: intentBinding, removed,
    resourcesAfter: next, witness: mysqlRecreationWitness(created), warnings: response.Warnings ?? [],
  });
  onCurrent(next);
  assert.deepEqual(response.Warnings ?? [], [], 'Replacement creation warnings require review');
  assert.deepEqual(mysqlRecreationWitness(created), mysqlRecreationCreatedWitness(before, id),
    'Created-state configuration must match the exact reviewed Engine normalization');
  assert.equal(created.Image, before.Image);
  assert.equal(created.Name, before.Name);
  assert.equal(created.Config.Labels?.[ownerKey], manifest.runId);
  inspectMysqlFixtureVolumes(next, { execute });
  docker(['start', id], execute);
  const after = inspect(id);
  verifyMysqlRecreationContainer(before, after, next);
  verifySelectedMysqlStorage(next.databaseProfile, after, {
    storage: next.databaseStorage, volumes: inspectMysqlFixtureVolumes(next, { execute }),
  });
  guard();
  return { before, after, intent: intentBinding, created: createdBinding, resources: next };
}

export function verifyMysqlRecreationRecords(resources, records, context) {
  let current = structuredClone(resources);
  let previous = null;
  let witness;
  let createdWitness;
  const removedIds = [];
  for (const [index, record] of records.entries()) {
    const { intent, stopped, removed, created, verified, bindings } = record;
    assert.equal(intent.contract, 'owned-mysql-recreation-intent-v1');
    assert.equal(intent.runId, resources.runId);
    assert.equal(intent.sequence, index + 1);
    assert.deepEqual(intent.generator, generator());
    assert.match(intent.transport?.socket, /^\/[a-zA-Z0-9_./-]+$/);
    assert.match(intent.transport.version, /^1\.[0-9]+$/);
    assert.deepEqual(intent.context, context, 'Recreation must bind the original immutable inputs');
    assert.deepEqual(intent.resourcesBefore, current);
    witness = mysqlRecreationWitness(intent.before);
    createdWitness = witness;
    assert.deepEqual(intent.previous, previous);
    assert.deepEqual(intent.createRequest, mysqlRecreationCreateRequest({
      runId: resources.runId, ownership: { mysqlContainer: resources.mysqlName, network: resources.networkName },
    }, current, intent.before));
    if (index) assert.ok(records[index - 1].verified, 'A new recreation requires the previous verified transition');
    const stage = (value, name) => {
      assert.equal(value.contract, `owned-mysql-recreation-${name}-v1`);
      assert.deepEqual(value.intent, bindings.intent);
      assert.equal(value.mysqlId, current.mysqlId);
    };
    if (stopped) {
      stage(stopped, 'stopped');
      assert.equal(stopped.exitCode, 0);
    }
    if (removed) {
      assert.ok(stopped, 'A removed container must have its successful shutdown receipt');
      stage(removed, 'removed');
      assert.equal(removed.absent, true);
      removedIds.push(current.mysqlId);
    }
    if (created) {
      assert.ok(removed, 'Replacement cannot bypass removal and absence proof');
      assert.equal(created.contract, 'owned-mysql-recreation-created-v1');
      assert.deepEqual(created.intent, bindings.intent);
      assert.deepEqual(created.removed, bindings.removed);
      const next = created.resourcesAfter;
      assert.match(next.mysqlId, idPattern);
      assert.notEqual(next.mysqlId, current.mysqlId);
      assert.ok(!removedIds.includes(next.mysqlId), 'A retired container ID cannot be resurrected');
      assert.deepEqual({ ...next, mysqlId: current.mysqlId }, current, 'Only the MySQL container ID may change');
      const beforeWitness = mysqlRecreationWitness(intent.before);
      assert.equal(created.witness.id, next.mysqlId);
      assert.deepEqual(created.witness, mysqlRecreationCreatedWitness(intent.before, next.mysqlId));
      current = next;
      createdWitness = created.witness;
      witness = { ...beforeWitness, id: next.mysqlId };
      if (verified) {
        assert.deepEqual(created.warnings, []);
        assert.equal(verified.contract, 'owned-mysql-recreation-verified-v1');
        assert.deepEqual(verified.created, bindings.created);
        assert.equal(verified.mysqlId, current.mysqlId);
        assert.equal(verified.completePhysicalRowsUnchanged, true);
        assert.deepEqual(verified.witness, witness);
      }
    } else {
      assert.equal(verified, undefined);
      if (removed) current = { ...current, mysqlId: null };
    }
    if (index < records.length - 1) assert.ok(verified, 'Incomplete transition must be the last journal entry');
    previous = bindings.created ?? bindings.intent;
  }
  assert.ok(records.length >= 1 && records.length <= 2);
  return { resources: current, removedIds, witness, createdWitness };
}

export function loadMysqlRecreationJournal({ workspace, base, journalPath, resources, context }) {
  const path = resolve(workspace, journalPath);
  assert.equal(dirname(dirname(path)), base);
  assert.match(basename(dirname(path)), /^native-http-[a-z0-9][a-z0-9-]{0,63}$/);
  assert.equal(basename(path), 'mysql-recreations');
  const directories = new PinnedDirectories();
  try {
    const root = directories.open(path);
    assert.equal(root.identity.mode & 0o077, 0, 'Recreation journal directory must be private');
    const entries = readdirSync(root.access).sort();
    assert.ok(entries.length >= 1 && entries.length <= 2);
    assert.deepEqual(entries, entries.map((value, index) => `step-${String(index + 1).padStart(4, '0')}`));
    const records = entries.map(entry => {
      const directory = directories.open(join(path, entry));
      assert.equal(directory.identity.mode & 0o077, 0, 'Recreation step directory must be private');
      const names = readdirSync(directory.access);
      assert.ok(names.includes('intent.private.json'));
      assert.ok(names.every(name => ['intent.private.json', 'stopped.json', 'removed.json', 'created.json',
        'verified.json', 'readback.private.json'].includes(name)));
      const value = { bindings: {} };
      for (const name of names) {
        const file = readPinnedFile(directories, directory, name);
        assert.equal(file.identity.uid, process.geteuid(), 'Recreation records must be owned by the current user');
        assert.equal(file.identity.mode & 0o077, 0, 'Recreation records must remain private');
        const key = name === 'intent.private.json' ? 'intent' : name.slice(0, -5);
        value[key] = JSON.parse(file.data);
        value.bindings[key] = { path: relative(workspace, join(path, entry, name)),
          bytes: file.data.length, sha256: hash(file.data) };
      }
      if (value.verified) {
        assert.ok(value['readback.private']);
        assert.deepEqual(value.verified.evidence, value.bindings['readback.private']);
        const evidence = value['readback.private'];
        assert.deepEqual(evidence.before, evidence.after);
        assert.deepEqual(evidence.stateBefore, evidence.stateAfter);
        assert.deepEqual(evidence.diskBefore, evidence.diskAfter);
      }
      return value;
    });
    return { ...verifyMysqlRecreationRecords(resources, records, context),
      records: records.map(row => row.bindings) };
  } finally { directories.close(); }
}
