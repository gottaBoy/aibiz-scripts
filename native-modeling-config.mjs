import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_NATIVE_CANDIDATE_ROOT =
  '.artifacts/native-model-migration/s07-model-design-v11-console-layout-20261006';
export const DEFAULT_NATIVE_SERVICE_CANDIDATE_ROOT =
  '.artifacts/native-service-migration/central-query-consistent-refs';
export const DEFAULT_NATIVE_AI_CODE_RUNTIME_ROOT =
  '.artifacts/native-ai-code-runtime-assets/s07-model-design-v11-console-layout-20261006';
export const NATIVE_CANDIDATE_COMPOSE_FILES = Object.freeze([
  'docker-compose-dev.yml',
  'docker-compose-modeling-native-candidate.yml',
  'docker-compose-modeling-native-service-candidate.yml',
  'docker-compose-modeling-native-ai-code-runtime.yml',
  'docker-compose-modeling-native-platform-local.yml',
]);

export function resolveNativeModelingConfig(env = process.env, workspace = WORKSPACE_ROOT) {
  const composeDirectory = resolve(workspace, 'plm/deploy/compose');
  // Compose bind sources are relative to its project directory, not the caller's cwd.
  const candidateRoot = (value, fallback) => value
    ? resolve(composeDirectory, value)
    : resolve(workspace, fallback);
  const nativeCandidateRoot = candidateRoot(
    env.NATIVE_CANDIDATE_ROOT, DEFAULT_NATIVE_CANDIDATE_ROOT);
  const nativeServiceCandidateRoot = candidateRoot(
    env.NATIVE_SERVICE_CANDIDATE_ROOT, DEFAULT_NATIVE_SERVICE_CANDIDATE_ROOT);
  const nativeAiCodeRuntimeRoot = candidateRoot(
    env.NATIVE_AI_CODE_RUNTIME_ROOT, DEFAULT_NATIVE_AI_CODE_RUNTIME_ROOT);
  const modelRoot = join(nativeCandidateRoot, 'model');
  if (env.MODEL_DESIGN_MODEL_ROOT) {
    const legacyRoot = resolve(workspace, env.MODEL_DESIGN_MODEL_ROOT);
    assert.ok(legacyRoot === modelRoot || legacyRoot === nativeCandidateRoot,
      'MODEL_DESIGN_MODEL_ROOT must match NATIVE_CANDIDATE_ROOT or its model directory; ' +
      'select the candidate with NATIVE_CANDIDATE_ROOT');
  }
  return {
    nativeCandidateRoot,
    nativeServiceCandidateRoot,
    nativeAiCodeRuntimeRoot,
    modelRoot,
    composeDirectory,
    composeFiles: NATIVE_CANDIDATE_COMPOSE_FILES.map(file => join(composeDirectory, file)),
    composeEnvFiles: ['.dev', 'source-built-local.env'].map(file => join(composeDirectory, file)),
    entries: [
      ['Central', env.NATIVE_CENTRAL_URL ||
        `http://127.0.0.1:${env.MODELING_CANDIDATE_CENTRAL_PORT || 32008}/central/`],
      ['ModelDesign', env.MODEL_DESIGN_URL ||
        `http://127.0.0.1:${env.MODELING_CANDIDATE_MODELDESIGN_PORT || 32009}/modeldesign/`],
    ],
  };
}

export function nativeCandidateComposeInvocation(argv, env = process.env, workspace = WORKSPACE_ROOT) {
  const config = resolveNativeModelingConfig(env, workspace);
  assert.ok(Array.isArray(argv) && argv.length, 'A Docker Compose subcommand is required');
  return {
    command: 'docker',
    args: [
      'compose',
      ...config.composeEnvFiles.flatMap(file => ['--env-file', file]),
      '--profile', 'modeling', '--profile', 'modeling-native-candidate',
      ...config.composeFiles.flatMap(file => ['-f', file]),
      ...argv,
    ],
    cwd: config.composeDirectory,
    env: {
      ...env,
      NATIVE_CANDIDATE_ROOT: config.nativeCandidateRoot,
      NATIVE_SERVICE_CANDIDATE_ROOT: config.nativeServiceCandidateRoot,
      NATIVE_AI_CODE_RUNTIME_ROOT: config.nativeAiCodeRuntimeRoot,
    },
  };
}
