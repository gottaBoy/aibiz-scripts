import assert from 'node:assert/strict';
import test from 'node:test';
import { permissionMavenCommand } from '../harness-modeling-permission-regression.mjs';
import { backendPackageCommand } from '../harness-backend-source-package.mjs';
import {
  backendRunCommand, nacosRunCommand, zookeeperRunCommand, NACOS_IMAGE_ID, ZOOKEEPER_IMAGE_ID,
} from '../launch-run-owned-native-backend.mjs';
import { mysqlSmokeRunArgs } from './run-owned-native-nonadmin-fixture.sql.mjs';
import { mysqlFixtureProfile } from '../mysql-fixture-profiles.mjs';
import { UAA_JAVA_OPTIONS } from '../harness-run-owned-uaa-runtime.mjs';

const runId = '123456789abc', label = 'budget';
const paths = {
  worktree: '/workspace/.artifacts/worktree', snapshot: '/workspace/.artifacts/snapshot',
  repository: '/workspace/.artifacts/repository', uid: 1000, gid: 1000,
};
const requireBudget = (args, memory, cpus = 2, pids = 512) => {
  assert.ok(args.includes(`--memory=${memory}`));
  assert.ok(args.includes(`--cpus=${cpus}`));
  assert.ok(args.includes(`--pids-limit=${pids}`));
  assert.ok(args.includes('--pull=never'));
};

test('both permission stages and backend packaging have bounded CPU, memory, processes and JVM heap', () => {
  for (const stage of ['focused', 'full']) {
    const command = permissionMavenCommand({
      ...paths, stage, containerName: 'modeling-permission-11111111-1111-1111-1111-111111111111',
    });
    requireBudget(command.args, '3g');
    assert.ok(command.args.includes('MAVEN_OPTS=-Xmx1536m -XX:ActiveProcessorCount=2'));
    assert.ok(command.args.includes('aibiz.validation.role=compiler'));
  }
  const command = backendPackageCommand({
    ...paths, containerName: 'backend-package-11111111-1111-1111-1111-111111111111',
  });
  requireBudget(command.args, '4g');
  assert.ok(command.args.includes('MAVEN_OPTS=-Xmx2048m -XX:ActiveProcessorCount=2'));
  assert.ok(command.args.includes('--network=none'));
});

test('owned backend roles use bounded distinct limits and matching heaps', () => {
  const root = `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/backend-runtime-${label}`;
  for (const [role, memory, heap] of [
    ['allinone', '3g', '1536m'], ['provider', '3g', '1536m'], ['gateway', '1g', '512m'],
  ]) {
    const args = backendRunCommand({
      runId, label, role, networkName: `nf-${runId}-private`,
      name: `nf-${runId}-backend-${label}-${role}`, imageId: `sha256:${'a'.repeat(64)}`,
      configPath: `${root}/config.properties`, loggingPath: `${root}/logback.xml`, modelPath: `${root}/model`,
      mysqlName: `nf-${runId}-mysql`, nacosName: `nf-${runId}-backend-${label}-nacos`,
    });
    requireBudget(args, memory);
    assert.ok(args.some(value => value.startsWith('JAVA_TOOL_OPTIONS=') && value.includes(`-Xmx${heap}`)));
  }
});

test('Nacos and ZooKeeper have bounded memory without inherited volume storage', () => {
  const options = { runId, label, networkName: `nf-${runId}-private` };
  const nacos = nacosRunCommand({
    ...options, name: `nf-${runId}-backend-${label}-nacos`, imageId: NACOS_IMAGE_ID,
  });
  requireBudget(nacos, '1g');
  assert.ok(nacos.some(value => value.startsWith('JAVA_OPT_EXT=') && value.includes('-Xmx512m')));
  requireBudget(zookeeperRunCommand({
    ...options, name: `nf-${runId}-backend-${label}-zookeeper`, imageId: ZOOKEEPER_IMAGE_ID,
  }), '384m');
});

test('fresh tmpfs MySQL has a hard limit and UAA heap is bounded', () => {
  const profile = mysqlFixtureProfile('mysql57-bitnami-arm64');
  const args = mysqlSmokeRunArgs({
    runId, ownership: { mysqlContainer: `nf-${runId}-mysql`, network: `nf-${runId}-private` },
  }, { databaseProfile: 'mysql57-bitnami-arm64', mysqlImage: profile.imageId, password: 'b'.repeat(32) });
  requireBudget(args, '2g', 1, 256);
  assert.ok(args.includes('--read-only'));
  assert.ok(UAA_JAVA_OPTIONS.includes('-Xmx1024m'));
  assert.ok(UAA_JAVA_OPTIONS.includes('-XX:ActiveProcessorCount=2'));
});
