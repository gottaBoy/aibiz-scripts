import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  DEFAULT_NATIVE_AI_CODE_RUNTIME_ROOT,
  DEFAULT_NATIVE_CANDIDATE_ROOT,
  DEFAULT_NATIVE_SERVICE_CANDIDATE_ROOT,
  NATIVE_CANDIDATE_COMPOSE_FILES,
  WORKSPACE_ROOT,
  nativeCandidateComposeInvocation,
  resolveNativeModelingConfig,
} from '../native-modeling-config.mjs';
import {
  resolveNativeModelDesignTarget,
} from '../../modelingweb/app/tests/modeldesign-target.mjs';

const wrapper = join(WORKSPACE_ROOT, 'scripts/native-candidate-compose.mjs');
const workspace = '/tmp/native modeling workspace';
const composeDirectory = join(workspace, 'plm/deploy/compose');

test('browser and Compose share the same candidate resolver and default roots', () => {
  assert.equal(resolveNativeModelDesignTarget, resolveNativeModelingConfig);
  const config = resolveNativeModelingConfig({}, workspace);
  assert.equal(config.nativeCandidateRoot, join(workspace, DEFAULT_NATIVE_CANDIDATE_ROOT));
  assert.equal(config.modelRoot, join(config.nativeCandidateRoot, 'model'));
  assert.equal(config.nativeServiceCandidateRoot,
    join(workspace, DEFAULT_NATIVE_SERVICE_CANDIDATE_ROOT));
  assert.equal(config.nativeAiCodeRuntimeRoot,
    join(workspace, DEFAULT_NATIVE_AI_CODE_RUNTIME_ROOT));
  assert.deepEqual(config.entries, [
    ['Central', 'http://127.0.0.1:32008/central/'],
    ['ModelDesign', 'http://127.0.0.1:32009/modeldesign/'],
  ]);
});

test('all candidate roots use Compose-relative or absolute overrides', () => {
  const config = resolveNativeModelingConfig({
    NATIVE_CANDIDATE_ROOT: '../../../.artifacts/custom candidate',
    NATIVE_SERVICE_CANDIDATE_ROOT: '/tmp/service candidate',
    NATIVE_AI_CODE_RUNTIME_ROOT: '../runtime candidate',
  }, workspace);
  assert.equal(config.nativeCandidateRoot, join(workspace, '.artifacts/custom candidate'));
  assert.equal(config.modelRoot, join(config.nativeCandidateRoot, 'model'));
  assert.equal(config.nativeServiceCandidateRoot, '/tmp/service candidate');
  assert.equal(config.nativeAiCodeRuntimeRoot,
    resolve(composeDirectory, '../runtime candidate'));
});

test('legacy model root can confirm the selected candidate but cannot choose another one', () => {
  const env = { NATIVE_CANDIDATE_ROOT: '/tmp/native candidate' };
  for (const root of ['/tmp/native candidate', '/tmp/native candidate/model']) {
    assert.equal(resolveNativeModelingConfig({
      ...env, MODEL_DESIGN_MODEL_ROOT: root,
    }, workspace).modelRoot, '/tmp/native candidate/model');
  }
  assert.equal(resolveNativeModelingConfig({
    MODEL_DESIGN_MODEL_ROOT: `${DEFAULT_NATIVE_CANDIDATE_ROOT}/model`,
  }, workspace).modelRoot, join(workspace, DEFAULT_NATIVE_CANDIDATE_ROOT, 'model'));
  assert.throws(() => resolveNativeModelingConfig({
    ...env, MODEL_DESIGN_MODEL_ROOT: '/tmp/other candidate/model',
  }, workspace), /MODEL_DESIGN_MODEL_ROOT must match NATIVE_CANDIDATE_ROOT/);
  assert.throws(() => nativeCandidateComposeInvocation(['config'], {
    ...env, MODEL_DESIGN_MODEL_ROOT: '/tmp/other candidate',
  }, workspace), /MODEL_DESIGN_MODEL_ROOT must match/);
});

test('candidate ports and browser URL overrides remain configurable', () => {
  assert.deepEqual(resolveNativeModelingConfig({
    MODELING_CANDIDATE_CENTRAL_PORT: '32108',
    MODELING_CANDIDATE_MODELDESIGN_PORT: '32109',
  }, workspace).entries, [
    ['Central', 'http://127.0.0.1:32108/central/'],
    ['ModelDesign', 'http://127.0.0.1:32109/modeldesign/'],
  ]);
  assert.deepEqual(resolveNativeModelingConfig({
    NATIVE_CENTRAL_URL: 'http://localhost:32118/central/',
    MODEL_DESIGN_URL: 'http://localhost:32119/modeldesign/',
  }, workspace).entries, [
    ['Central', 'http://localhost:32118/central/'],
    ['ModelDesign', 'http://localhost:32119/modeldesign/'],
  ]);
});

test('the complete five-file candidate stack and both env files exist', async () => {
  assert.deepEqual(NATIVE_CANDIDATE_COMPOSE_FILES, [
    'docker-compose-dev.yml',
    'docker-compose-modeling-native-candidate.yml',
    'docker-compose-modeling-native-service-candidate.yml',
    'docker-compose-modeling-native-ai-code-runtime.yml',
    'docker-compose-modeling-native-platform-local.yml',
  ]);
  const config = resolveNativeModelingConfig({});
  await Promise.all([...config.composeFiles, ...config.composeEnvFiles].map(file => access(file)));
});

test('Compose invocation pins profiles, files, roots and argv without mutating the caller', () => {
  const env = {
    NATIVE_CANDIDATE_ROOT: '../../../.artifacts/custom candidate',
    NATIVE_SERVICE_CANDIDATE_ROOT: '/tmp/service candidate',
    NATIVE_AI_CODE_RUNTIME_ROOT: '/tmp/runtime candidate',
    FIXTURE_ENV: 'preserved',
  };
  const before = { ...env };
  const argv = ['config', '--format', 'json'];
  const config = resolveNativeModelingConfig(env, workspace);
  const invocation = nativeCandidateComposeInvocation(argv, env, workspace);
  assert.equal(invocation.command, 'docker');
  assert.equal(invocation.cwd, composeDirectory);
  assert.deepEqual(invocation.args, [
    'compose',
    '--env-file', join(composeDirectory, '.dev'),
    '--env-file', join(composeDirectory, 'source-built-local.env'),
    '--profile', 'modeling', '--profile', 'modeling-native-candidate',
    ...config.composeFiles.flatMap(file => ['-f', file]),
    ...argv,
  ]);
  assert.equal(invocation.env.NATIVE_CANDIDATE_ROOT, config.nativeCandidateRoot);
  assert.equal(invocation.env.NATIVE_SERVICE_CANDIDATE_ROOT, config.nativeServiceCandidateRoot);
  assert.equal(invocation.env.NATIVE_AI_CODE_RUNTIME_ROOT, config.nativeAiCodeRuntimeRoot);
  assert.equal(invocation.env.FIXTURE_ENV, 'preserved');
  assert.deepEqual(env, before);
  assert.deepEqual(argv, ['config', '--format', 'json']);
  for (const invalid of [undefined, [], 'config']) {
    assert.throws(() => nativeCandidateComposeInvocation(invalid, {}, workspace),
      /subcommand is required/);
  }
});

test('browser reports the selected roots and rejects a served model from another candidate', async () => {
  const source = await readFile(
    new URL('../../modelingweb/app/tests/native-modeldesign.browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /resolveNativeModelDesignTarget\(process\.env, workspace\)/);
  assert.match(source, /nativeServiceCandidateRoot: target\.nativeServiceCandidateRoot/);
  assert.match(source, /nativeAiCodeRuntimeRoot: target\.nativeAiCodeRuntimeRoot/);
  assert.match(source, /Served model must match the selected NATIVE_CANDIDATE_ROOT model/);
});

function renderConfig(env) {
  const result = spawnSync(process.execPath, [wrapper, 'config', '--format', 'json'], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      NATIVE_CANDIDATE_ROOT: '',
      NATIVE_SERVICE_CANDIDATE_ROOT: '',
      NATIVE_AI_CODE_RUNTIME_ROOT: '',
      MODEL_DESIGN_MODEL_ROOT: '',
      MODELING_CANDIDATE_CENTRAL_PORT: '',
      MODELING_CANDIDATE_MODELDESIGN_PORT: '',
      ...env,
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertCandidateMounts(config, roots) {
  for (const name of ['modelingweb-candidate-central', 'modelingweb-candidate-modeldesign']) {
    const service = config.services[name];
    const mount = target => {
      const matches = service.volumes.filter(volume => volume.target === target);
      assert.equal(matches.length, 1, `${name}: ${target}`);
      assert.equal(matches[0].read_only, true, `${name}: ${target}`);
      return matches[0];
    };
    assert.equal(mount('/opt/aibiz/native-candidate-plugins').source,
      join(roots.nativeCandidateRoot, 'plugins'));
    assert.equal(mount('/opt/aibiz/nginx-native.conf').source,
      join(roots.nativeAiCodeRuntimeRoot, 'nginx-native.conf'));
    assert.equal(mount('/opt/aibiz/native-ai-code-runtime-assets').source,
      roots.nativeAiCodeRuntimeRoot);
    for (const app of ['Central', 'ModelDesign']) {
      for (const file of ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json']) {
        const target = `PSSYSAPPS/${app}/${file}`;
        assert.equal(mount(`/app/model/${target}`).source,
          join(roots.modelRoot, target));
      }
    }
    assert.equal(service.environment.NATIVE_PLATFORM_HOST, 'ibiz-ebsx-allinone-local');
  }
  const target = '/app/model/PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json';
  const central = config.services['modelingweb-candidate-central'];
  const grid = central.volumes.filter(volume => volume.target === target);
  assert.equal(grid.length, 1);
  assert.equal(grid[0].source, join(roots.nativeServiceCandidateRoot,
    'model/PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json'));
  assert.equal(grid[0].read_only, true);
  assert.ok(!config.services['modelingweb-candidate-modeldesign'].volumes
    .some(volume => volume.target === target));
}

test('wrapper renders the default complete candidate stack from an unrelated cwd', () => {
  const config = renderConfig({});
  assertCandidateMounts(config, resolveNativeModelingConfig({}));
  for (const [name, port] of [
    ['modelingweb-candidate-central', '32008'],
    ['modelingweb-candidate-modeldesign', '32009'],
  ]) {
    assert.equal(config.services[name].ports[0].published, port);
    assert.equal(config.services[name].ports[0].host_ip, '127.0.0.1');
  }
});

test('wrapper and browser select the same overridden roots after actual Compose rendering', () => {
  const env = {
    NATIVE_CANDIDATE_ROOT: '../../../.artifacts/explicit candidate',
    NATIVE_SERVICE_CANDIDATE_ROOT: '/tmp/explicit service',
    NATIVE_AI_CODE_RUNTIME_ROOT: '../explicit runtime',
  };
  assertCandidateMounts(renderConfig(env), resolveNativeModelDesignTarget(env));
});

test('Compose wrapper fails closed on missing subcommand and conflicting legacy root', () => {
  for (const [argv, env, message] of [
    [[], {}, /subcommand is required/],
    [['config'], { MODEL_DESIGN_MODEL_ROOT: '/tmp/wrong model' },
      /MODEL_DESIGN_MODEL_ROOT must match/],
  ]) {
    const result = spawnSync(process.execPath, [wrapper, ...argv], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 5000,
      env: { ...process.env, NATIVE_CANDIDATE_ROOT: '', MODEL_DESIGN_MODEL_ROOT: '', ...env },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  }
});

test('Compose wrapper preserves the Docker exit code without deploying any service', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'native-compose-wrapper-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const docker = join(directory, 'docker');
  await writeFile(docker, `#!${process.execPath}
process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(),
  root: process.env.NATIVE_CANDIDATE_ROOT }));
process.exit(7);
`);
  await chmod(docker, 0o755);
  const result = spawnSync(process.execPath, [wrapper, 'config'], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 5000,
    env: {
      ...process.env, PATH: directory,
      NATIVE_CANDIDATE_ROOT: '/tmp/explicit candidate', MODEL_DESIGN_MODEL_ROOT: '',
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 7, result.stderr);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.args.at(-1), 'config');
  assert.equal(evidence.cwd, join(WORKSPACE_ROOT, 'plm/deploy/compose'));
  assert.equal(evidence.root, '/tmp/explicit candidate');
});
