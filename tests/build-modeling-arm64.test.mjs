import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../build-modeling-arm64.sh', import.meta.url));
const source = await readFile(
  new URL('../build-modeling-arm64.sh', import.meta.url),
  'utf8',
);
const sourceBuild = await readFile(
  new URL('../../modelingservice/build-source.sh', import.meta.url),
  'utf8',
);
const dockerfile = await readFile(
  new URL('../../modelingservice/Dockerfile', import.meta.url),
  'utf8',
);
const entrypoint = await readFile(
  new URL('../../modelingservice/docker/entrypoint-waitfor.sh', import.meta.url),
  'utf8',
);

test('Modeling arm64 build is source-built and verifies architecture', () => {
  assert.match(source, /AIBIZ_MODELING_IMAGE:-aibiz\/modelingservice-arm64:source-built/);
  assert.match(source, /AIBIZ_MODELING_RUNTIME_IMAGE:-eclipse-temurin:17-jdk/);
  assert.match(source, /AIBIZ_MODELING_PROVIDER_JAR:-/);
  assert.match(source, /"\$MODELINGSERVICE_DIR\/build-source\.sh"/);
  assert.match(source, /--force\) FORCE=true/);
  assert.doesNotMatch(source, /SOURCE_IMAGE/);
  assert.doesNotMatch(source, /BASE_IMAGE/);
  assert.doesNotMatch(source, /docker pull/);
  assert.match(source, /if \[ "\$FORCE" != true \] && docker image inspect/);
  assert.match(source, /docker image inspect "\$RUNTIME_IMAGE"/);
  assert.match(source, /runtime_architecture=.*docker image inspect/);
  assert.match(source, /--build-arg "RUNTIME_IMAGE=\$RUNTIME_IMAGE"/);
  assert.match(source, /--pull=false/);
  assert.match(source, /docker build \\/);
  assert.match(source, /verify_arm64_image "\$MODELING_IMAGE"/);
  assert.match(source, /"\$architecture" != "arm64 linux"/);
  assert.match(dockerfile, /ARG RUNTIME_IMAGE=eclipse-temurin:17-jdk/);
  assert.match(dockerfile, /COPY ibizservicerunner-provider\.jar \/ibizservicerunner-provider\.jar/);
  assert.match(dockerfile, /COPY docker\/entrypoint-waitfor\.sh \/entrypoint-waitfor\.sh/);
  assert.match(dockerfile, /ENTRYPOINT \["\/entrypoint-waitfor\.sh"\]/);
  assert.match(entrypoint, /\/wait-for\.sh -t/);
  assert.match(entrypoint, /-jar \/ibizservicerunner-provider\.jar/);
});

test('an existing target image must still have the arm64 architecture', t => {
  const root = mkdtempSync(join(tmpdir(), 'modeling-arm64-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const docker = join(bin, 'docker');
  writeFileSync(docker, `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === 'image' && args[1] === 'inspect') {
  if (args.includes('--format')) console.log('amd64 linux');
  process.exit(0);
}
process.exit(99);
`);
  chmodSync(docker, 0o755);

  const result = spawnSync('bash', [scriptPath], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AIBIZ_MODELING_IMAGE: 'fixture:wrong-architecture',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Unexpected image architecture: amd64 linux/);
});

test('Modeling source build supports a local Docker JDK17 fallback and publishes the stable JAR', () => {
  assert.match(sourceBuild, /BUILD_IMAGE=\$\{AIBIZ_MODELING_BUILD_IMAGE:-maven:3\.9-eclipse-temurin-17\}/);
  assert.match(sourceBuild, /docker image inspect "\$BUILD_IMAGE"/);
  assert.match(sourceBuild, /--pull=never/);
  assert.match(sourceBuild, /-v "\$ROOT_DIR:\/workspace"/);
  assert.match(sourceBuild, /ibiz-service-runner\/ibizservicerunner-provider\.jar/);
  assert.match(sourceBuild, /\[ -s "\$PROVIDER_JAR" \]/);
  assert.match(sourceBuild, /Main-Class: org\.springframework\.boot\.loader\.JarLauncher/);
  assert.doesNotMatch(sourceBuild, /cp "\$provider_jar" "\$PROVIDER_JAR"/);
});
