#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadMigrationContract } from './harness-modeling-core-audit.mjs';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { resolveNativeModelingConfig, WORKSPACE_ROOT } from './native-modeling-config.mjs';
import { readDesignIndexReplacement } from './prepare-native-design-index-replacement.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gridPath = 'PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json';
const indexRepo = '@aibiz/design-index@0.1.0';
const inspectContainer = name => JSON.parse(execFileSync('docker', [
  'inspect', '--type', 'container', name,
], { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }))[0];
const readIndex = workspace => readDesignIndexReplacement({
  workspace, contract: loadMigrationContract(workspace),
});

export function expectedNativeMounts(config, application, workspace = WORKSPACE_ROOT) {
  return [
    [join(config.nativeAiCodeRuntimeRoot, 'nginx-native.conf'), '/opt/aibiz/nginx-native.conf'],
    [config.nativeAiCodeRuntimeRoot, '/opt/aibiz/native-ai-code-runtime-assets'],
    [join(config.nativeCandidateRoot, 'plugins'), '/opt/aibiz/native-candidate-plugins'],
    [join(workspace, 'modelingweb/app/dist'), '/opt/aibiz/local-dist'],
    ...['Central', 'ModelDesign'].flatMap(app =>
      ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json'].map(file => [
        join(config.modelRoot, 'PSSYSAPPS', app, file), `/app/model/PSSYSAPPS/${app}/${file}`,
      ])),
    ...(application === 'Central'
      ? [[join(config.nativeServiceCandidateRoot, 'model', gridPath), `/app/model/${gridPath}`]]
      : []),
  ].map(([source, target]) => ({ source, target }));
}

export function inspectNativeDeployment(config, application, inspection, workspace = WORKSPACE_ROOT) {
  const failures = [];
  if (inspection?.State?.Running !== true || inspection.State.Health?.Status !== 'healthy') {
    failures.push('container is not running and healthy');
  }
  for (const expected of expectedNativeMounts(config, application, workspace)) {
    const matches = inspection?.Mounts?.filter(mount => mount.Destination === expected.target) ?? [];
    if (matches.length !== 1 || matches[0].Type !== 'bind' ||
        matches[0].Source !== expected.source || matches[0].RW !== false) {
      failures.push(`read-only mount mismatch: ${expected.target}; expected ${expected.source}`);
    }
  }
  for (const [key, value] of Object.entries({
    NATIVE_MODEL_APP: application, NATIVE_PLATFORM_HOST: config.platformHost,
  })) {
    const actual = inspection?.Config?.Env?.filter(entry => entry.startsWith(`${key}=`)) ?? [];
    if (actual.length !== 1 || actual[0] !== `${key}=${value}`) {
      failures.push(`environment mismatch: ${key}; expected ${value}`);
    }
  }
  return failures;
}

export async function inspectNativeAsset(url, expected, request = fetch) {
  const expectedSha256 = hash(expected);
  const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const actual = Buffer.from(await response.arrayBuffer());
  const actualSha256 = hash(actual);
  return {
    url, httpStatus: response.status, expectedSha256, actualSha256,
    status: response.status === 200 && actualSha256 === expectedSha256 ? 'pass' : 'fail',
  };
}

export async function auditNativeDeployment({
  workspace = WORKSPACE_ROOT, env = process.env,
  inspect = inspectContainer, request = fetch, indexSource = readIndex,
} = {}) {
  const config = resolveNativeModelingConfig(env, workspace);
  const directories = new PinnedDirectories();
  const checks = [];
  const check = async (id, action) => {
    try {
      const evidence = await action();
      checks.push({ id, status: 'pass', ...evidence });
    } catch (error) {
      checks.push({ id, status: 'fail', error: error.message });
    }
  };
  const read = path => readPinnedFile(directories, directories.open(dirname(path)),
    path.split('/').at(-1)).data;
  try {
    for (const [application, entry] of config.entries) {
      const container = env[application === 'Central' ? 'NATIVE_CENTRAL_CONTAINER'
        : 'NATIVE_MODELDESIGN_CONTAINER'] || `compose-modelingweb-candidate-${application.toLowerCase()}-1`;
      await check(`${application}:container`, () => {
        const inspection = inspect(container);
        const failures = inspectNativeDeployment(config, application, inspection, workspace);
        return { container, containerId: inspection.Id, status: failures.length ? 'fail' : 'pass', failures };
      });
      if (application === 'Central') {
        await check('Central:query-model', async () => {
          const expected = read(join(config.nativeServiceCandidateRoot, 'model', gridPath));
          return inspectNativeAsset(new URL(`/api/ibizmodeling__central/remotemodel/${gridPath}`,
            entry).href, expected, request);
        });
      }
    }
    await check('ModelDesign:index-current-source', async () => {
      const source = indexSource(workspace);
      assert.ok(source.files.contents.length > 0, 'Design-index source delivery is empty');
      const entry = config.entries.find(([application]) => application === 'ModelDesign')[1];
      const files = [];
      for (const file of source.files.contents) {
        const candidate = read(join(config.nativeCandidateRoot, 'plugins', indexRepo, file.path));
        const served = await inspectNativeAsset(new URL(`plugins/${indexRepo}/${file.path}`, entry).href,
          file.data, request);
        const candidateSha256 = hash(candidate);
        files.push({ path: file.path, candidateSha256, ...served,
          status: candidateSha256 === served.expectedSha256 ? served.status : 'fail' });
      }
      return {
        sourceFingerprint: source.plugin.sourceFingerprint,
        status: files.every(file => file.status === 'pass') ? 'pass' : 'fail', files,
      };
    });
  } finally { directories.close(); }
  return {
    schemaVersion: 1, contract: 'native-deployment-current-inputs',
    generatedAt: new Date().toISOString(),
    evidenceOrigin: inspect === inspectContainer && request === fetch && indexSource === readIndex
      ? 'local-read-only-deployment-audit' : 'controlled-test-runner',
    status: checks.every(check => check.status === 'pass') ? 'pass' : 'fail',
    nativeAcceptance: false, sourceClosure: false, checks,
    boundary: 'Selected frontend mounts, Central query bytes and current design-index delivery only; no restart, model save, permission or complete source acceptance.',
  };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    'report-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/harness-native-deployment.mjs [--report-dir NEW_DIRECTORY]');
    console.log('Read-only native frontend mount/model/plugin checks using native-modeling-config.mjs.');
    return 0;
  }
  const directories = new PinnedDirectories();
  try {
    const destination = resolve(values['report-dir'] || join(WORKSPACE_ROOT,
      '.artifacts/native-deployment', `audit-${randomUUID()}`));
    const target = directories.open(destination, { create: true, exclusive: true });
    const report = await auditNativeDeployment();
    directories.write(target, 'report.json', `${JSON.stringify(report, null, 2)}\n`);
    for (const check of report.checks) console.log(`${check.status.toUpperCase()} ${check.id}`);
    console.log(`Report: ${join(destination, 'report.json')}`);
    return report.status === 'pass' ? 0 : 1;
  } finally { directories.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
