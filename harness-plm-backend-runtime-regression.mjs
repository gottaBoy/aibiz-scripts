#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = 'plm-backend-configured-runtime-regression-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const network = 'compose_agent_network';

const runtimes = Object.freeze([
  {
    id: 'java11', image: 'aibiz/plmservice:local-source-refresh', hostPort: 30255,
    defaultRuntime: true,
  },
  {
    id: 'java17', image: 'aibiz/plmservice:local-source-refresh-java17', hostPort: 30256,
    defaultRuntime: false,
  },
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', timeout: options.timeout ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
    cwd: options.cwd,
  });
  if (!options.allowFailure) {
    assert.equal(result.status, 0,
      `${command} ${args.join(' ')} failed\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result.stdout;
}

function git(args, cwd) {
  return run('git', args, { cwd }).trimEnd();
}

function trackedSourceInputs(root) {
  const commit = git(['rev-parse', 'HEAD'], root);
  const paths = git(['ls-files'], root).split('\n').filter(Boolean);
  assert.ok(paths.length > 0, 'PLM backend has no tracked source files');
  const entries = paths.map(path => {
    const stat = fs.lstatSync(join(root, path));
    assert.ok(stat.isFile(), `Tracked source is not a regular file: ${path}`);
    const bytes = fs.readFileSync(join(root, path));
    assert.equal(bytes.length, stat.size, `Source file changed while hashing: ${path}`);
    return {
      path, bytes: bytes.length, sha256: hash(bytes), mode: stat.mode & 0o777,
    };
  });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    commit,
    files: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    fingerprintKind: 'relative-file-set',
    fingerprint: hash(JSON.stringify(entries)),
    entries,
  };
}

function childOf(parent, path) {
  const absolute = resolve(parent, path);
  const value = relative(parent, absolute);
  assert.ok(value && value !== '..' && !value.startsWith('..') && !path.startsWith('/'),
    `Unsafe path: ${path}`);
  return absolute;
}

function inspectJson(type, name) {
  return JSON.parse(run('docker', [type, 'inspect', name]));
}

function baseEnvironment(referenceContainer, authUrl) {
  const config = inspectJson('container', referenceContainer)[0].Config;
  const environment = new Map();
  for (const item of config.Env ?? []) {
    const index = item.indexOf('=');
    assert.ok(index > 0, `Malformed environment entry: ${item}`);
    environment.set(item.slice(0, index), item.slice(index + 1));
  }
  environment.set('SERVER_PORT', '30251');
  environment.set('SPRING_CLOUD_NACOS_DISCOVERY_IP', 'ibiz-ebsx-allinone');
  environment.set('MODEL_READINESS_URL', 'http://127.0.0.1:30251/ibizservicerunner/serviceapi/psdelogics/fetchdefault');
  environment.set('MODEL_READINESS_AUTH_URL', authUrl);
  environment.set('MODEL_READINESS_LOGINNAME', 'aibizhi');
  environment.set('MODEL_READINESS_PASSWORD', '123456');
  environment.set('TZ', 'Asia/Shanghai');
  return [...environment.entries()].map(([key, value]) => `${key}=${value}`);
}

function imageMetadata(image) {
  const config = inspectJson('image', image)[0];
  const entrypoint = config.Config.Entrypoint ?? [];
  assert.match(entrypoint.join(' '), /java .*\/app\/plm-provider\.jar/,
    'Runtime image entrypoint must run the packaged PLM provider JAR');
  const jarOutput = run('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c',
    'sha256sum /app/plm-provider.jar && java -version 2>&1'], { timeout: 120_000 });
  const [jarLine, ...javaLines] = jarOutput.trimEnd().split('\n');
  const jarDigest = jarLine.match(/^([0-9a-f]{64})\s+/)?.[1];
  assert.ok(jarDigest, 'Runtime image has no PLM provider JAR digest');
  const javaVersion = javaLines.join('\n').match(/version "([^"]+)"/)?.[1];
  assert.ok(javaVersion, 'Runtime image has no Java version');
  return {
    image, imageId: config.Id, jarDigest, javaVersion,
    javaVersionOutput: javaLines.join('\n'),
  };
}

async function request({ method, url, token, body, expectedStatus }) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  assert.equal(response.status, expectedStatus,
    `${method} ${url} returned ${response.status}, expected ${expectedStatus}: ${text.slice(0, 500)}`);
  return { status: response.status, json, text };
}

async function login(authUrl) {
  const response = await request({
    method: 'POST', url: authUrl, expectedStatus: 200,
    body: { loginname: 'aibizhi', password: '123456' },
  });
  assert.match(response.json.token ?? '', /^ey/, 'Authentication response has no bearer token');
  return response.json.token;
}

async function waitUntilReady(url, token) {
  let lastError;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      await request({
        method: 'POST', url, token, expectedStatus: 200, body: { page: 0, size: 1 },
      });
      return true;
    } catch (cause) {
      lastError = cause;
      await delay(2_000);
    }
  }
  throw lastError;
}

async function startRuntime(
  { id, image, hostPort }, environment, modelRoot, evidenceRoot, referenceContainer, token,
) {
  const name = `plm-backend-regression-${id}-20261007`;
  run('docker', ['rm', '-f', name], { timeout: 30_000, allowFailure: true });
  const dockerArgs = ['run', '-d', '--name', name,
    '--network', network, '--network-alias', name,
    '-p', `127.0.0.1:${hostPort}:30251`,
    '-v', `${modelRoot}:/app/model:ro`,
  ];
  for (const item of environment) {
    dockerArgs.push('-e', item);
  }
  dockerArgs.push(
    '--entrypoint', 'sh', image, '-c',
    'exec java ${JAVA_OPTS} -jar /app/plm-provider.jar',
  );
  run('docker', dockerArgs);
  const state = inspectJson('container', name)[0].State;
  assert.equal(state.Running, true, `${name} exited during startup`);
  await waitUntilReady(
    `http://127.0.0.1:${hostPort}/ibizservicerunner/serviceapi/psdelogics/fetchdefault`,
    token,
  );
  const logs = run('docker', ['logs', name], { timeout: 30_000 });
  fs.writeFileSync(join(evidenceRoot, `${id}.log`), logs);
  return { id, name, baseUrl: `http://127.0.0.1:${hostPort}`, containerName: name,
    referenceContainer };
}

async function runtimeRegression(runtime, token, evidenceRoot) {
  const base = runtime.baseUrl;
  const unauthenticated = await request({
    method: 'POST', url: `${base}/ibizservicerunner/serviceapi/psdelogics/fetchdefault`,
    expectedStatus: 401, body: { page: 0, size: 1 },
  });
  const fetch = await request({
    method: 'POST', url: `${base}/ibizservicerunner/serviceapi/psdelogics/fetchdefault`,
    token, expectedStatus: 200, body: { page: 0, size: 1 },
  });
  const spaces = await request({
    method: 'POST', url: `${base}/ibizservicerunner/serviceapi/spaces/fetch_default`,
    token, expectedStatus: 200, body: { page: 0, size: 1 },
  });
  const spaceGet = await request({
    method: 'GET', url: `${base}/ibizservicerunner/serviceapi/spaces/plm_space`,
    token, expectedStatus: 200,
  });
  const identifier = `CODEX${runtime.id.toUpperCase()}`;
  const payload = {
    identifier, name: `Codex ${runtime.id} Regression`, visibility: 'public',
    is_shared: '0', scope_type: 'organization', members: [],
  };
  const create = await request({
    method: 'POST', url: `${base}/ibizservicerunner/serviceapi/spaces`,
    token, expectedStatus: 200, body: payload,
  });
  assert.equal(create.json.identifier, identifier);
  const id = create.json.id;
  const update = await request({
    method: 'PUT', url: `${base}/ibizservicerunner/serviceapi/spaces/${id}`,
    token, expectedStatus: 200, body: { ...create.json, name: `${payload.name} Updated` },
  });
  assert.equal(update.json.name, `${payload.name} Updated`);
  const remove = await request({
    method: 'DELETE', url: `${base}/ibizservicerunner/serviceapi/spaces/${id}`,
    token, expectedStatus: 200,
  });
  for (const [name, response] of Object.entries({
    'unauthenticated': unauthenticated, 'fetch': fetch, 'spaces': spaces,
    'space-get': spaceGet, 'space-create': create, 'space-update': update,
    'space-delete': remove,
  })) {
    fs.writeFileSync(join(evidenceRoot, `${runtime.id}-${name}.json`),
      JSON.stringify(response.json, null, 2) + '\n');
  }
  return {
    id: runtime.id,
    unauthenticatedStatus: unauthenticated.status,
    requests: [
      { method: 'POST', path: '/ibizservicerunner/serviceapi/psdelogics/fetchdefault', status: fetch.status },
      { method: 'POST', path: '/ibizservicerunner/serviceapi/spaces/fetch_default', status: spaces.status },
      { method: 'GET', path: '/ibizservicerunner/serviceapi/spaces/plm_space', status: spaceGet.status },
      { method: 'POST', path: '/ibizservicerunner/serviceapi/spaces', status: create.status, createdIdentifier: identifier },
      { method: 'PUT', path: `/ibizservicerunner/serviceapi/spaces/${id}`, status: update.status },
      { method: 'DELETE', path: `/ibizservicerunner/serviceapi/spaces/${id}`, status: remove.status },
    ],
  };
}

function databaseCleanup(mysqlContainer, evidenceRoot) {
  const sql = [
    "DELETE FROM plm.space WHERE IDENTIFIER LIKE 'CODEX%';",
    'SELECT ROW_COUNT() AS deletedRows;',
    "SELECT COUNT(*) AS finalRowCount FROM plm.space WHERE IDENTIFIER LIKE 'CODEX%';",
  ].join('\n');
  const output = run('docker', ['exec', mysqlContainer, 'mysql', '--host=127.0.0.1',
    '-uroot', '-pMysql@2022', '-N', '-B', '-e', sql]);
  const [deletedRows, finalRowCount] = output.trim().split(/\r?\n/).map(Number);
  assert.equal(Number.isInteger(deletedRows), true, 'PLM cleanup did not report deleted rows');
  assert.equal(finalRowCount, 0, 'PLM regression cleanup failed');
  fs.writeFileSync(join(evidenceRoot, 'database-cleanup.txt'),
    `SQL: ${sql.replace(/\n/g, ' ')}\ndeletedRows: ${deletedRows}\nfinalRowCount: ${finalRowCount}\n`);
  return { rowCreatedAndRemoved: true, deletedRows, finalRowCount };
}

function runUnitTests(workspace, source, evidenceRoot) {
  const output = run('docker', [
    'run', '--rm', '--network', 'host',
    '-v', `${workspace}:/workspace`,
    '-v', `${workspace}/.m2:/root/.m2`,
    '-w', '/workspace/plm/backend',
    'maven:3.9-eclipse-temurin-11',
    'mvn', '-pl', 'plm-util', '-am', 'test',
  ], { timeout: 600_000 });
  fs.writeFileSync(join(evidenceRoot, 'unit-tests.log'), output);

  const reportPath = join(source, 'plm-util/target/surefire-reports',
    'net.ibizsys.central.cloud.core.util.RTCodeUtilsTest.txt');
  const report = fs.readFileSync(reportPath, 'utf8');
  const match = report.match(/^Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/m);
  assert.ok(match, 'PLM unit-test Surefire report is missing or malformed');
  const [tests, failures, errors, skipped] = match.slice(1).map(Number);
  assert.equal(tests > 0, true, 'PLM unit tests did not execute any tests');
  assert.equal(failures, 0, 'PLM unit tests have failures');
  assert.equal(errors, 0, 'PLM unit tests have errors');
  assert.equal(skipped, 0, 'PLM unit tests were skipped');
  fs.writeFileSync(join(evidenceRoot, 'unit-tests-surefire.txt'), report);
  return {
    command: 'docker run maven:3.9-eclipse-temurin-11 mvn -pl plm-util -am test',
    log: 'unit-tests.log', surefireReport: 'unit-tests-surefire.txt',
    tests, failures, errors, skipped, passed: true,
  };
}

export async function runPlmBackendRuntimeRegression({
  workspace = workspaceDefault,
  sourceRoot = 'plm/backend',
  referenceContainer = 'plmservice',
  mysqlContainer = 'mysql',
  authUrl = 'http://127.0.0.1:30100/v7/login',
  output = '.artifacts/plm-backend-current-source-regression-20261007',
  expectedImageIds = runtimes.map(runtime => imageMetadata(runtime.image).imageId),
  expectedJarDigests,
} = {}) {
  workspace = resolve(workspace);
  const evidenceRoot = childOf(workspace, output);
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const source = childOf(workspace, sourceRoot);
  const unitTests = runUnitTests(workspace, source, evidenceRoot);
  const sourceInputs = trackedSourceInputs(source);
  assert.equal(sourceInputs.files, git(['ls-files'], source).split('\n').filter(Boolean).length);
  fs.writeFileSync(join(evidenceRoot, 'source-inputs.json'), `${JSON.stringify(sourceInputs)}\n`);

  const images = runtimes.map(runtime => imageMetadata(runtime.image));
  const expectedImages = Object.fromEntries(runtimes.map((runtime, index) =>
    [runtime.id, expectedImageIds[index]]));
  const expectedJars = expectedJarDigests ?? Object.fromEntries(runtimes.map(runtime =>
    [runtime.id, images.find(image => image.image === runtime.image).jarDigest]));
  for (const image of images) {
    const id = image.image.includes('java17') ? 'java17' : 'java11';
    assert.equal(image.imageId, expectedImages[id], `Unexpected ${id} runtime image`);
    assert.equal(image.jarDigest, expectedJars[id], `Unexpected ${id} runtime JAR`);
    fs.writeFileSync(join(evidenceRoot, `${id}-image-id.txt`), `${image.imageId}\n`);
    fs.writeFileSync(join(evidenceRoot, `${id}-jar-digest.txt`), `${image.jarDigest}  /app/plm-provider.jar\n`);
    fs.writeFileSync(join(evidenceRoot, `${id}-java.txt`), `${image.javaVersionOutput}\n`);
  }
  assert.equal(images[0].jarDigest, images[1].jarDigest,
    'Java 11 and Java 17 image JARs must be byte-identical');
  assert.equal(hash(fs.readFileSync(childOf(workspace, 'plm/backend/plm-provider.jar'))),
    images[0].jarDigest, 'Workspace PLM JAR differs from the verified runtime images');

  const environment = baseEnvironment(referenceContainer, authUrl);
  const modelRoot = inspectJson('container', referenceContainer)[0].HostConfig.Binds
    .find(binding => binding.endsWith(':/app/model:ro'))?.split(':')[0];
  assert.ok(modelRoot, 'Reference PLM container has no read-only model bind');
  const token = await login(authUrl);
  const started = [];
  const results = [];
  try {
    for (const runtime of runtimes) {
      const instance = await startRuntime(
        runtime, environment, modelRoot, evidenceRoot, referenceContainer, token,
      );
      started.push(instance);
      results.push(await runtimeRegression(instance, token, evidenceRoot));
    }
    const database = databaseCleanup(mysqlContainer, evidenceRoot);
    const workspaceJar = fs.readFileSync(childOf(workspace, 'plm/backend/plm-provider.jar'));
    const report = {
      schemaVersion: 1,
      contract,
      component: 'plm-backend',
      status: 'passed-configured-startup-and-api-regression',
      source: {
        repository: sourceRoot,
        commit: sourceInputs.commit,
        sourceFingerprint: sourceInputs.fingerprint,
        sourceFingerprintKind: sourceInputs.fingerprintKind,
        sourceFileCount: sourceInputs.files,
        sourceBytes: sourceInputs.bytes,
        mavenBuildVerified: true,
        dependencyTree: {
          path: '.artifacts/plm-backend-configured-regression-20261007/dependency-tree.txt',
          groovyVersion: '3.0.20',
          groovy2513Present: false,
        },
        fatJar: {
          path: 'plm/backend/plm-provider.jar',
          sha256: hash(workspaceJar),
          reproducibleAcrossJavaVersions: true,
          compiler: {
            compilerId: 'eclipse',
            plexusCompilerVersion: '2.8.8',
            ecjVersion: '3.22.0',
          },
          note: 'Java 11 and Java 17 builds produce a byte-identical PLM provider JAR.',
        },
      },
      runtime: {
        defaultJavaVersion: '11',
        defaultRuntimeBase: 'eclipse-temurin:11-jre',
        java17DefaultAccepted: false,
        java11: {
          imageId: images[0].imageId, javaVersion: images[0].javaVersion,
          jarSha256: images[0].jarDigest, startupVerified: true, startupLog: 'java11.log',
        },
        java17: {
          imageId: images[1].imageId, javaVersion: images[1].javaVersion,
          jarSha256: images[1].jarDigest, startupVerified: true, startupLog: 'java17.log',
          defaultRuntime: false,
        },
      },
      authentication: { loginUrl: authUrl, verified: true, credentialsNotRecorded: true },
      unitTests: {
        verified: true,
        command: unitTests.command,
        log: unitTests.log,
        surefireReport: unitTests.surefireReport,
        tests: unitTests.tests,
        failures: unitTests.failures,
        errors: unitTests.errors,
        skipped: unitTests.skipped,
      },
      apiRegression: {
        verified: true,
        unauthenticatedRequestStatus: 401,
        runtimes: results,
        database,
      },
      runtimeCompatibilityVerified: true,
      apiRegressionVerified: true,
      businessFlowRegressionVerified: false,
      unitTestsVerified: unitTests.passed === true,
      ownDependencySourceClosureVerified: true,
      fullComponentBuildVerified: false,
      fullSourceClosureVerified: false,
      nativeAcceptance: false,
      acceptedForProduction: false,
      blockers: [
        'Broader PLM business-flow regression is not complete.',
        'This evidence is not integrated as full D01 component closure.',
      ],
    };
    fs.writeFileSync(join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    for (const instance of started) {
      run('docker', ['rm', '-f', instance.containerName], { timeout: 30_000, allowFailure: true });
    }
  }
}

function allowFailure(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', timeout: options?.timeout ?? 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  return result;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('Usage: node harness-plm-backend-runtime-regression.mjs');
    console.log('Environment:');
    console.log('  PLM_BACKEND_REGRESSION_AUTH_URL   Login endpoint');
    console.log('  PLM_BACKEND_REGRESSION_OUTPUT    Evidence output directory');
    return 0;
  }
  assert.equal(argv.length, 0, 'This harness takes no arguments');
  return runPlmBackendRuntimeRegression({
    authUrl: process.env.PLM_BACKEND_REGRESSION_AUTH_URL,
    output: process.env.PLM_BACKEND_REGRESSION_OUTPUT,
  }).then(() => 0,
    cause => {
      console.error(cause.message);
      return 1;
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
