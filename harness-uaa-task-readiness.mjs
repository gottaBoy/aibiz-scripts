#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const scriptsRoot = resolve(import.meta.dirname);
const workspaceRoot = resolve(scriptsRoot, '..');
const uaaRoot = join(workspaceRoot, 'vendor-upstream/ibizlab-runtime/ibzuaa');
const taskRoot = join(workspaceRoot, 'task7/SAPAAS');
const reportPath = process.env.UAA_TASK_READINESS_REPORT
  ? resolve(process.env.UAA_TASK_READINESS_REPORT)
  : join(scriptsRoot, '.artifacts/uaa-task-readiness.json');
const runBuild = process.argv.includes('--build');

function check(id, service, ok, reason, evidence = []) {
  return { id, service, status: ok ? 'pass' : 'blocked', reason, evidence };
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function gitValue(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function countFiles(root, suffix) {
  let count = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'target' || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(suffix)) count++;
    }
  };
  visit(root);
  return count;
}

function runSourceBuild() {
  try {
    execFileSync(join(uaaRoot, 'scripts/build-source.sh'), [], {
      cwd: uaaRoot,
      stdio: 'inherit',
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

const checks = [];
const uaaPom = join(uaaRoot, 'pom.xml');
const uaaBuild = join(uaaRoot, 'scripts/build-source.sh');
const uaaDockerfile = join(uaaRoot, 'scripts/Dockerfile.source');
const uaaBuildReport = join(uaaRoot, '.artifacts/source-build/source-build.json');
const expectedUaaArtifact = join(
  uaaRoot,
  '.artifacts/source-build/ibzuaa.jar',
);
const currentUaaCommit = gitValue(uaaRoot, ['rev-parse', 'HEAD']);

checks.push(check(
  'uaa-source-tree',
  'uaa',
  existsSync(uaaPom) && countFiles(uaaRoot, '.java') > 0,
  'Maven root POM and Java source are present',
  [relative(workspaceRoot, uaaPom), `javaFiles=${countFiles(uaaRoot, '.java')}`],
));
checks.push(check(
  'uaa-source-build-entrypoint',
  'uaa',
  existsSync(uaaBuild) && statSync(uaaBuild).mode & 0o111,
  'Dockerized source build entrypoint is executable',
  [relative(workspaceRoot, uaaBuild)],
));
checks.push(check(
  'uaa-source-dockerfile',
  'uaa',
  existsSync(uaaDockerfile) && /EXPOSE 32666/.test(readFileSync(uaaDockerfile, 'utf8')),
  'Source-built image contract exposes UAA port 32666',
  [relative(workspaceRoot, uaaDockerfile)],
));

// A normal audit verifies recorded evidence; --build additionally refreshes it.
const sourceBuildSucceeded = !runBuild || runSourceBuild();
let uaaArtifactReady = false;
let uaaImageReady = false;
if (sourceBuildSucceeded && existsSync(uaaBuildReport)) {
  try {
    const report = JSON.parse(readFileSync(uaaBuildReport, 'utf8'));
    const reportArtifact = typeof report.artifact === 'string'
      ? resolve(report.artifact)
      : '';
    const artifactMatchesCurrentSource = report.commit === currentUaaCommit
      && reportArtifact === expectedUaaArtifact;
    uaaArtifactReady = report.status === 'ready'
      && artifactMatchesCurrentSource
      && existsSync(reportArtifact)
      && fileSha256(reportArtifact) === report.sha256;
    if (uaaArtifactReady && report.imageTag && report.imageId) {
      const imageId = execFileSync('docker', ['image', 'inspect', report.imageTag, '--format', '{{.Id}}'], {
        encoding: 'utf8',
      }).trim();
      const imagePlatform = execFileSync('docker', [
        'image',
        'inspect',
        report.imageTag,
        '--format',
        '{{.Os}}/{{.Architecture}}',
      ], { encoding: 'utf8' }).trim();
      uaaImageReady = imageId === report.imageId
        && imagePlatform === 'linux/arm64';
    }
  } catch {
    uaaArtifactReady = false;
    uaaImageReady = false;
  }
}
checks.push(check(
  'uaa-source-build-evidence',
  'uaa',
  uaaArtifactReady,
  uaaArtifactReady
    ? 'Current UAA source commit produced the expected hash-verified standalone artifact'
    : 'No hash-verified successful source build evidence; prebuilt image is not accepted',
  [
    relative(workspaceRoot, uaaBuildReport),
    `currentCommit=${currentUaaCommit}`,
    `expectedArtifact=${relative(workspaceRoot, expectedUaaArtifact)}`,
  ],
));
checks.push(check(
  'uaa-source-image-evidence',
  'uaa',
  uaaImageReady,
  uaaImageReady
    ? 'Current source Docker image matches the recorded digest and linux/arm64 platform'
    : 'No hash-verified source Docker image evidence; prebuilt image is not accepted',
  [relative(workspaceRoot, uaaBuildReport), 'platform=linux/arm64'],
));

const taskBuild = join(taskRoot, 'resources/classes/build.xml');
const taskSourceCount = countFiles(taskRoot, '.java');
const taskBuildText = existsSync(taskBuild) ? readFileSync(taskBuild, 'utf8') : '';
const hasLocalDependencyClosure = !/I:\/J2EE\/commonlib/.test(taskBuildText)
  && readdirSync(taskRoot, { withFileTypes: true }).some((entry) => entry.name === 'lib');
const hasWarAssembly = /<war\b/.test(taskBuildText)
  && existsSync(join(taskRoot, 'WEB-INF'));
const taskDockerfile = join(workspaceRoot, 'task7/Dockerfile.source');

checks.push(check(
  'task-source-tree',
  'task',
  existsSync(taskBuild) && taskSourceCount > 0,
  'Ant build descriptor and recovered Java source are present',
  [relative(workspaceRoot, taskBuild), `javaFiles=${taskSourceCount}`],
));
checks.push(check(
  'task-local-dependencies',
  'task',
  hasLocalDependencyClosure,
  'Task source build must carry a local dependency closure; I:/J2EE/commonlib is not reproducible',
  ['resources/classes/build.xml'],
));
checks.push(check(
  'task-war-assembly',
  'task',
  hasWarAssembly,
  'Task source must define WAR assembly and include the SAPAAS web application',
  ['resources/classes/build.xml', 'WEB-INF/'],
));
checks.push(check(
  'task-source-dockerfile',
  'task',
  existsSync(taskDockerfile),
  'A source-built Task Dockerfile is required before image claims are allowed',
  [relative(workspaceRoot, taskDockerfile)],
));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runBuild,
  source: {
    uaaCommit: currentUaaCommit,
    taskCommit: gitValue(join(workspaceRoot, 'task7'), ['rev-parse', 'HEAD']),
  },
  services: {
    uaa32666: checks.filter((item) => item.service === 'uaa'),
    task30088: checks.filter((item) => item.service === 'task'),
  },
  checks,
  readiness: {
    uaa32666: checks.filter((item) => item.service === 'uaa').every((item) => item.status === 'pass'),
    task30088: checks.filter((item) => item.service === 'task').every((item) => item.status === 'pass'),
  },
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (!report.readiness.uaa32666 || !report.readiness.task30088) process.exitCode = 1;
