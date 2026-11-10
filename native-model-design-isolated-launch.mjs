#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WORKSPACE } from './harness-modeling-core-audit.mjs';
import { PinnedDirectories, directoryPath, readPinnedFile } from './native-candidate-files.mjs';
import { modelDesignSelection } from './prepare-native-model-design-candidate.mjs';
import { verifyNativeAiCodeRuntimeAssets } from './prepare-native-ai-code-runtime-assets.mjs';
import { verifyNativeServiceCandidate } from './prepare-native-service-candidate.mjs';
import {
  selectFrontendSourceDist, validateFrontendDistBinding,
} from '../modelingweb/app/scripts/frontend-source-dist.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const label = 'aibiz.native-model-design-isolated';
const artifactRoot = '.artifacts/native-model-design-isolated';
const serviceViewPath = 'PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json';
const shaPattern = /^[a-f0-9]{64}$/;

export function validateNativeCentralServiceBinding(binding, workspace = WORKSPACE) {
  assert.ok(binding && typeof binding === 'object' && !Array.isArray(binding));
  assert.deepEqual(Object.keys(binding).sort(), ['contract', 'file', 'receipt']);
  assert.equal(binding.contract, 'native-central-service-candidate-binding-v1');
  for (const file of [binding.receipt, binding.file]) {
    assert.ok(file && typeof file === 'object' && !Array.isArray(file));
    assert.deepEqual(Object.keys(file).sort(), ['bytes', 'path', 'sha256']);
    assert.match(file.sha256 ?? '', shaPattern);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 64 * 1024 * 1024);
    assert.equal(typeof file.path, 'string');
    assert.equal(file.path, resolve(file.path));
    assert.ok(!/[:,\r\n\0\\]/.test(file.path));
  }
  const root = join(resolve(workspace), '.artifacts/native-service-migration');
  assert.equal(dirname(dirname(binding.receipt.path)), root,
    'Central service receipt must be in a direct candidate directory');
  assert.equal(basename(binding.receipt.path), 'receipt.json');
  assert.match(basename(dirname(binding.receipt.path)), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.equal(binding.file.path, join(dirname(binding.receipt.path), 'model', serviceViewPath));
  assert.ok(!relative(root, binding.file.path).startsWith(`..${sep}`));
}

export function isolatedLaunchInput({
  workspace = WORKSPACE, candidate, assets, name,
  centralPort = 32118, modeldesignPort = 32119,
  platformHost = 'ibiz-ebsx-allinone-local',
  network = 'compose_agent_network',
  frontend, serviceCandidate,
} = {}) {
  assert.match(name ?? '', /^[a-z][a-z0-9-]{5,63}$/, 'Explicit unique isolated name required');
  assert.match(platformHost, /^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'Invalid platform service hostname');
  assert.match(network ?? '', /^[A-Za-z][A-Za-z0-9_-]*$/, 'Invalid Docker network name');
  for (const port of [centralPort, modeldesignPort]) {
    assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid isolated port');
    assert.ok(![19323, 32002, 32003, 32006, 32007, 32008, 32009].includes(port),
      'Do not bind a shared service port');
  }
  assert.notEqual(centralPort, modeldesignPort, 'Distinct application ports required');
  if (frontend !== undefined) {
    validateFrontendDistBinding(frontend, {
      workspace, dist: frontend.dist, receipt: frontend.receipt?.path,
      receiptSha256: frontend.receipt?.sha256,
    });
  }
  if (serviceCandidate !== undefined) {
    validateNativeCentralServiceBinding(serviceCandidate, workspace);
  }
  const mounts = [
    [join(assets, 'nginx-native.conf'), '/opt/aibiz/nginx-native.conf'],
    [join(candidate, 'plugins'), '/opt/aibiz/native-candidate-plugins'],
    [assets, '/opt/aibiz/native-ai-code-runtime-assets'],
    [join(workspace, 'modelingweb/start.sh'), '/start.sh'],
    [join(workspace, 'modelingweb/environment.config'), '/environment.config'],
    [frontend?.dist ?? join(workspace, 'modelingweb/app/dist'), '/opt/aibiz/local-dist'],
    [join(workspace, 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling'),
      '/app/model'],
    ...(serviceCandidate ? [[serviceCandidate.file.path, `/app/model/${serviceViewPath}`]] : []),
    ...['Central', 'ModelDesign'].flatMap(app =>
      ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json'].map(file => [
        join(candidate, 'model/PSSYSAPPS', app, file), `/app/model/PSSYSAPPS/${app}/${file}`,
      ])),
  ].map(([source, target]) => {
    assert.ok(source.startsWith(`${resolve(workspace)}/`) && !/[:,\r\n]/.test(source),
      'Mounts must be unambiguous workspace paths');
    return { source, target, readOnly: true };
  });
  const applications = ['Central', 'ModelDesign'].map((application, index) => {
    const code = application.toLowerCase();
    const container = `${name}-${code}`;
    const port = [centralPort, modeldesignPort][index];
    const pluginBaseUrl = `http://127.0.0.1:${port}/${code}/plugins`;
    const environment = {
      TZ: 'Asia/Shanghai', MOCKDCSYSTEMID: 'ibizmodeling', HUB: 'true',
      ISLOCALMODEL: 'true', ISSAASMODE: 'false', ENABLEMQTT: 'false',
      PLUGINBASEURL: pluginBaseUrl, LOCAL_DIST_SOURCE: '/opt/aibiz/local-dist',
      NATIVE_MODEL_APP: application, NATIVEMODELAPP: application,
      APPCODE: code, APICODE: `ibizmodeling__${code}`, BASEURL: `ibizmodeling__${code}`,
      NATIVE_PLATFORM_HOST: platformHost,
    };
    return {
      application, container, entry: `http://127.0.0.1:${port}/${code}/`, environment,
      command: 'docker',
      args: [
        'run', '--detach', '--pull=never', '--name', container,
        '--label', `${label}=${name}`, '--network', network,
        '--publish', `127.0.0.1:${port}:8080`,
        '--health-cmd', `wget -q -O /dev/null --timeout=3 http://127.0.0.1:8080/${code}/`,
        '--health-interval', '10s', '--health-timeout', '5s',
        '--health-start-period', '15s', '--health-retries', '6',
        '--tmpfs', '/dist:uid=101,gid=101,mode=0755',
        ...mounts.flatMap(mount => ['--mount',
          `type=bind,src=${mount.source},dst=${mount.target},readonly`]),
        ...Object.entries(environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
        '--entrypoint', '/bin/sh', 'aibiz/modelingweb:local', '/start.sh',
      ],
    };
  });
  return {
    schemaVersion: 1, contract: 'native-model-design-isolated-launch-input',
    name, candidate, assets, network, mounts, applications,
    cleanup: { command: 'docker', args: ['rm', '--force', ...applications.map(app => app.container)] },
    nativeAccepted: false, acceptedForProduction: false,
    ...(frontend ? { frontend } : {}),
    ...(serviceCandidate ? { serviceCandidate } : {}),
    boundary: 'Only new loopback frontend containers; no shared restart, backend mutation or model save',
  };
}

export function verifyNativeCentralServiceCandidate({
  workspace = WORKSPACE, receiptPath,
} = {}, { verify = verifyNativeServiceCandidate } = {}) {
  workspace = resolve(workspace);
  assert.equal(typeof receiptPath, 'string');
  const absoluteReceipt = resolve(workspace, receiptPath);
  assert.equal(dirname(dirname(absoluteReceipt)), join(workspace, '.artifacts/native-service-migration'));
  assert.equal(basename(absoluteReceipt), 'receipt.json');
  assert.match(basename(dirname(absoluteReceipt)), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  const filePath = join(dirname(absoluteReceipt), 'model', serviceViewPath);
  const directories = new PinnedDirectories();
  const read = path => {
    const file = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
    return { ...file, binding: { path, bytes: file.data.length, sha256: hash(file.data) } };
  };
  try {
    const receipt = read(absoluteReceipt);
    const model = read(filePath);
    const binding = { contract: 'native-central-service-candidate-binding-v1',
      receipt: receipt.binding, file: model.binding };
    validateNativeCentralServiceBinding(binding, workspace);
    const verified = verify({ workspace, receiptPath: absoluteReceipt });
    assert.equal(verified.contract, 'native-central-published-query-candidate');
    assert.equal(verified.permissionAcceptance?.status, 'not-accepted');
    assert.deepEqual(verified.outputs, [{ path: serviceViewPath, sha256: binding.file.sha256 }]);
    for (const [path, before] of [[absoluteReceipt, receipt], [filePath, model]]) {
      const current = read(path);
      assert.deepEqual(current.binding, before.binding, 'Central service candidate changed during verification');
      for (const key of ['dev', 'ino', 'mode']) assert.equal(current.identity[key], before.identity[key]);
    }
    assert.equal(model.identity.mode & 0o004, 0o004,
      'Central service model must be readable by the unprivileged frontend');
    return binding;
  } finally { directories.close(); }
}

async function unusedPort(port) {
  const server = createServer();
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', done);
    });
  } finally {
    if (server.listening) await new Promise(done => server.close(done));
  }
}

export function verifyIsolatedContainerState(input, app, inspection) {
  assert.equal(inspection.Config.Labels[label], input.name);
  assert.ok(inspection.Config.Env?.includes(`PLUGINBASEURL=${app.environment.PLUGINBASEURL}`),
    'The running host must use its absolute same-origin plugin base');
  assert.deepEqual(inspection.Config.Healthcheck.Test, [
    'CMD-SHELL', app.args[app.args.indexOf('--health-cmd') + 1],
  ], 'The healthcheck must target this application');
  const mounts = inspection.Mounts.filter(mount => mount.Type === 'bind');
  assert.equal(mounts.length, input.mounts.length, 'Every input mount must be present');
  for (const expected of input.mounts) {
    const mount = mounts.find(item => item.Destination === expected.target);
    assert.ok(mount && mount.Source === expected.source && mount.RW === false,
      `Input mount must remain read-only: ${expected.target}`);
  }
  assert.equal(inspection.State.Running, true, 'Isolated container is not running');
  assert.equal(inspection.State.Health?.Status, 'healthy', 'Isolated container is not healthy');
  return {
    readOnlyMountsVerified: true, healthStatus: inspection.State.Health.Status,
    healthcheck: inspection.Config.Healthcheck.Test,
  };
}

export async function prepareIsolatedModelDesignLaunch({
  workspace = WORKSPACE, assets, output, run = false,
  frontendDist, frontendReceipt, frontendReceiptSha256, serviceCandidateReceipt, ...options
} = {}) {
  workspace = resolve(workspace);
  assert.equal(workspace, WORKSPACE);
  const verified = verifyNativeAiCodeRuntimeAssets({ workspace, assets });
  const frontend = selectFrontendSourceDist({
    workspace, frontendDist, frontendReceipt, frontendReceiptSha256,
  });
  assert.deepEqual(frontend, verified.receipt.frontend,
    'Runtime assets and mounted frontend must bind the same explicit source distribution');
  assert.ok(verified.receipt.modelDesignRuntime, 'A verified source-built model-design integration is required');
  const serviceCandidate = serviceCandidateReceipt
    ? verifyNativeCentralServiceCandidate({ workspace, receiptPath: serviceCandidateReceipt })
    : undefined;
  const candidateReceiptPath = join(verified.candidate, 'receipt.json');
  const candidateReceipt = JSON.parse(fs.readFileSync(candidateReceiptPath));
  assert.ok(candidateReceipt.plugins.some(plugin => plugin.to === modelDesignSelection.to));
  const input = isolatedLaunchInput({
    ...options, workspace, candidate: verified.candidate, assets: verified.directory, frontend,
    serviceCandidate,
  });
  input.evidence = {
    candidateReceiptSha256: hash(fs.readFileSync(candidateReceiptPath)),
    runtimeReceiptSha256: hash(fs.readFileSync(join(verified.directory, 'receipt.json'))),
    sourceBuildReport: verified.receipt.modelDesignRuntime.sourceBuildReport,
    runtime: verified.receipt.modelDesignRuntime.runtime,
  };
  const destination = resolve(workspace, output ?? join(artifactRoot, `launch-${randomUUID()}`));
  assert.equal(dirname(destination), join(workspace, artifactRoot));
  assert.match(relative(dirname(destination), destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.ok(!fs.existsSync(destination), 'Previous launch evidence must not be overwritten');
  for (const mount of input.mounts) {
    const info = fs.lstatSync(mount.source);
    assert.ok(!info.isSymbolicLink() && (info.isFile() || info.isDirectory()), 'Unsafe mount source');
    directoryPath(info.isDirectory() ? mount.source : dirname(mount.source));
  }
  if (serviceCandidate) assert.deepEqual(verifyNativeCentralServiceCandidate({
    workspace, receiptPath: serviceCandidate.receipt.path,
  }), serviceCandidate, 'Central service candidate changed before preparation');
  if (run) {
    execFileSync('docker', ['image', 'inspect', 'aibiz/modelingweb:local'], { stdio: 'ignore' });
    execFileSync('docker', ['network', 'inspect', input.network], { stdio: 'ignore' });
    const names = execFileSync('docker', ['ps', '--all', '--format', '{{.Names}}'], { encoding: 'utf8' })
      .trim().split('\n');
    for (const app of input.applications) {
      assert.ok(!names.includes(app.container), 'Isolated container name already exists');
      await unusedPort(Number(new URL(app.entry).port));
    }
  }
  const directories = new PinnedDirectories();
  try {
    const target = directories.open(destination, { create: true, exclusive: true });
    directories.write(target, 'input.json', JSON.stringify(input, null, 2) + '\n');
    const report = {
      schemaVersion: 1, contract: 'native-model-design-isolated-launch',
      startedAt: new Date().toISOString(), inputSha256: hash(JSON.stringify(input, null, 2) + '\n'),
      run, containers: [], errors: [], nativeAccepted: false, acceptedForProduction: false,
    };
    try {
      if (run) {
        for (const app of input.applications) {
          if (serviceCandidate) assert.deepEqual(verifyNativeCentralServiceCandidate({
            workspace, receiptPath: serviceCandidate.receipt.path,
          }), serviceCandidate, 'Central service candidate changed before launch');
          const id = execFileSync(app.command, app.args, { encoding: 'utf8' }).trim();
          report.containers.push({ application: app.application, name: app.container, id, entry: app.entry });
          const deadline = Date.now() + 60_000;
          let ready = false;
          let inspection;
          while (Date.now() < deadline) {
            try {
              const response = await fetch(app.entry, { signal: AbortSignal.timeout(3000) });
              await response.arrayBuffer();
              if (response.status === 200) {
                inspection = JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8' }))[0];
                if (inspection.State.Running && inspection.State.Health?.Status === 'healthy') {
                  ready = true;
                  break;
                }
              }
            } catch {}
            await new Promise(done => setTimeout(done, 1000));
          }
          assert.ok(ready, `Isolated frontend did not become HTTP-ready and healthy: ${app.container}`);
          Object.assign(report.containers.at(-1), verifyIsolatedContainerState(input, app, inspection));
        }
      }
    } catch (error) {
      report.errors.push(String(error));
    }
    report.finishedAt = new Date().toISOString();
    report.status = report.errors.length ? 'FAIL' : run ? 'RUNNING-ISOLATED-NOT-ACCEPTED' : 'PREPARED-NOT-ACCEPTED';
    directories.write(target, 'report.json', JSON.stringify(report, null, 2) + '\n');
    return { destination, input, report };
  } finally { directories.close(); }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    assets: { type: 'string' }, output: { type: 'string' }, name: { type: 'string' },
    run: { type: 'boolean' }, 'central-port': { type: 'string' },
    'modeldesign-port': { type: 'string' }, 'platform-host': { type: 'string' },
    network: { type: 'string' },
    'frontend-dist': { type: 'string' }, 'frontend-receipt': { type: 'string' },
    'frontend-receipt-sha256': { type: 'string' },
    'service-candidate-receipt': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/native-model-design-isolated-launch.mjs --assets PATH --name UNIQUE [--run] [--output PATH]');
    console.log('Independent source dist requires --frontend-dist PATH --frontend-receipt PATH --frontend-receipt-sha256 SHA.');
    console.log('Optional reviewed Central query candidate: --service-candidate-receipt PATH.');
    return 0;
  }
  const result = await prepareIsolatedModelDesignLaunch({
    assets: values.assets, output: values.output, name: values.name, run: values.run,
    ...(values['central-port'] ? { centralPort: Number(values['central-port']) } : {}),
    ...(values['modeldesign-port'] ? { modeldesignPort: Number(values['modeldesign-port']) } : {}),
    ...(values['platform-host'] ? { platformHost: values['platform-host'] } : {}),
    network: values.network,
    frontendDist: values['frontend-dist'], frontendReceipt: values['frontend-receipt'],
    frontendReceiptSha256: values['frontend-receipt-sha256'],
    serviceCandidateReceipt: values['service-candidate-receipt'],
  });
  console.log(`${result.report.status}: ${result.destination}`);
  for (const app of result.input.applications) console.log(`${app.application}: ${app.entry}`);
  return result.report.errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; })
    .catch(error => { console.error(String(error)); process.exitCode = 1; });
}
