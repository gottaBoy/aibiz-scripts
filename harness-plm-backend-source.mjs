#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPlmIbizDependencyClosure } from './harness-plm-ibiz-dependency-closure.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = 'plm-backend-source-runtime-contract-v1';
const runtimeReportContract = 'plm-backend-configured-runtime-regression-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function childOf(parent, path) {
  const absolute = resolve(parent, path);
  const value = relative(parent, absolute);
  assert.ok(value && value !== '..' && !value.startsWith(`..${sep}`) && !path.startsWith('/'),
    `Unsafe path: ${path}`);
  return absolute;
}

function readText(workspace, path, limit = 64 * 1024 * 1024) {
  const bytes = fs.readFileSync(childOf(workspace, path));
  assert.ok(bytes.length <= limit, `File too large: ${path}`);
  return bytes;
}

function readJson(workspace, path) {
  return JSON.parse(readText(workspace, path));
}

function sha256(workspace, path) {
  return hash(readText(workspace, path, 2 * 1024 ** 3));
}

function pomProperties(pom) {
  const text = pom.toString('utf8');
  const parent = text.match(/<parent>[\s\S]*?<\/parent>/)?.[0] ?? '';
  const property = name => text.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1];
  return {
    springBootVersion: parent.match(/<version>([^<]+)<\/version>/)?.[1] ?? null,
    ibizCloudVersion: property('ibiz.cloud.version'),
    groovyVersion: property('groovy.version'),
  };
}

function groovyJars(path, python) {
  const script = 'import zipfile\n' +
    `with zipfile.ZipFile(${JSON.stringify(path)}) as archive:\n` +
    '    print("\\n".join(name for name in archive.namelist() if name.startswith("BOOT-INF/lib/") and "groovy" in name.lower()))\n';
  const result = spawnSync(python, ['-I', '-c', script], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean);
}

export function verifyPlmBackendSourceRuntimeContract({
  workspace = workspaceDefault,
  sourceRoot = 'plm/backend',
  runtimeReport = '.artifacts/plm-backend-configured-regression-20261007/report.json',
  dependencyTree = '.artifacts/plm-backend-configured-regression-20261007/dependency-tree.txt',
  ibizDependencyTree = '.artifacts/plm-ibiz-groovy-recursive-dependency-tree.txt',
  jar = 'plm/backend/plm-provider.jar',
  python = 'python3',
} = {}) {
  workspace = resolve(workspace);
  const source = join(workspace, sourceRoot);
  const properties = pomProperties(readText(workspace, join(sourceRoot, 'pom.xml')));
  assert.equal(properties.springBootVersion, '2.4.0', 'Unexpected Spring Boot parent');
  assert.equal(properties.ibizCloudVersion, '8.1.0.584.1', 'Unexpected iBiz plugin parent');
  assert.equal(properties.groovyVersion, '3.0.20',
    'Spring Boot 2.4.0 dependency management must not silently select Groovy 2.5.13');

  const tree = readText(workspace, dependencyTree).toString('utf8');
  assert.match(tree, /org\.codefabric\.groovy:groovy:jar:3\.0\.20|org\.codehaus\.groovy:groovy:jar:3\.0\.20/);
  assert.doesNotMatch(tree, /org\.codehaus\.groovy:[^:]+:(?:jar|pom):2\.5\.13/);

  const jarPath = childOf(workspace, jar);
  const jarDigest = sha256(workspace, jar);
  const libraries = groovyJars(jarPath, python);
  const groovyRuntime = libraries.filter(name =>
    /(^|\/)groovy(?:-[a-z0-9.-]+)?-\d+(?:\.\d+)+\.jar$/i.test(name));
  assert.ok(groovyRuntime.length > 0, 'No Groovy runtime libraries in fat JAR');
  for (const name of groovyRuntime) assert.match(name, /-3\.0\.20\.jar$/);
  assert.ok(libraries.every(name => !name.includes('2.5.13')), 'Groovy 2.5.13 found in fat JAR');

  const dockerfile = readText(workspace, join(sourceRoot, 'Dockerfile')).toString('utf8');
  assert.match(dockerfile, /^ARG JRE_IMAGE=eclipse-temurin:11-jre$/m,
    'Default PLM runtime must remain Java 11 until Java 17 acceptance is complete');
  const buildScript = readText(workspace, join(sourceRoot, 'build-local-image.sh')).toString('utf8');
  assert.match(buildScript, /PLM_JRE_IMAGE:-eclipse-temurin:11-jre/);
  assert.match(buildScript, /PLM_MAVEN_IMAGE:-maven:3\.9-eclipse-temurin-11/);

  const report = readJson(workspace, runtimeReport);
  assert.equal(report.contract, runtimeReportContract);
  assert.equal(report.component, 'plm-backend');
  assert.equal(report.status, 'passed-configured-startup-and-api-regression');
  assert.equal(report.source.fatJar.sha256, jarDigest, 'Fat JAR changed after configured regression');
  assert.equal(report.source.dependencyTree.groovy2513Present, false);
  assert.equal(report.source.fatJar.groovy2513Present, false);
  assert.equal(report.runtime.defaultJavaVersion, '11');
  assert.equal(report.runtime.java17DefaultAccepted, false);
  assert.equal(report.runtimeCompatibilityVerified, true);
  assert.equal(report.apiRegressionVerified, true);
  for (const field of ['businessFlowRegressionVerified', 'unitTestsVerified',
    'fullComponentBuildVerified', 'fullSourceClosureVerified', 'nativeAcceptance',
    'acceptedForProduction']) {
    assert.equal(report[field], false, `Runtime evidence cannot promote ${field}`);
  }
  const dependencyClosure = verifyPlmIbizDependencyClosure({
    workspace, dependencyTree: ibizDependencyTree,
  });
  assert.equal(dependencyClosure.status, 'passed', 'PLM iBiz dependency source closure is blocked');

  return {
    contract,
    status: 'passed-partial-source-runtime-contract',
    sourceBuildVerified: true,
    runtimeCompatibilityVerified: true,
    apiRegressionVerified: true,
    unitTestsVerified: false,
    ownDependencySourceClosureVerified: dependencyClosure.ownDependencySourceClosureVerified,
    ibizDependencyClosure: {
      moduleCount: dependencyClosure.moduleCount,
      sourceFileCount: dependencyClosure.sourceFileCount,
      dependencyTree: dependencyClosure.dependencyTree,
    },
    fullComponentBuildVerified: false,
    fullSourceClosureVerified: false,
    nativeAcceptance: false,
    sourceFingerprint: report.source.sourceFingerprint,
    fatJarSha256: jarDigest,
    runtimeReport: relative(workspace, childOf(workspace, runtimeReport)),
    blockers: report.blockers,
  };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('Usage: node harness-plm-backend-source.mjs');
    return 0;
  }
  assert.equal(argv.length, 0, 'This harness takes no arguments');
  try {
    console.log(JSON.stringify(verifyPlmBackendSourceRuntimeContract(), null, 2));
    return 0;
  } catch (cause) {
    console.error(cause instanceof assert.AssertionError ? cause.message : cause.message);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
