import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';

const scriptsRoot = resolve(import.meta.dirname, '..');
const publishScript = resolve(scriptsRoot, 'publish-nacos-config.sh');

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolveListen(server.address().port);
    });
  });
}

function close(server) {
  return new Promise(resolveClose => server.close(() => resolveClose()));
}

function runScript(env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('bash', [publishScript], {
      cwd: scriptsRoot,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status, signal) => resolveRun({ status, signal, stdout, stderr }));
  });
}

test('publishes text config seeds with the extension-free dataId', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aibiz-publish-nacos-'));
  const configDir = join(root, 'plm/deploy/compose/nacos-configs');
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, 'deploysystem-gateway.txt'), 'deploysystemid: gateway\n');
  await writeFile(join(configDir, 'deployapp-demo.json'), '{"routes":[]}\n');
  await writeFile(join(configDir, 'deploysystem-demo.yaml'), 'deploysystemid: demo\n');
  await writeFile(join(configDir, 'manifest.tsv'), 'ignored\n');

  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      if (request.url === '/nacos/v1/auth/login') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ accessToken: 'contract-token' }));
        return;
      }
      if (request.url === '/nacos/v1/cs/configs') {
        const form = new URLSearchParams(body);
        requests.push({
          dataId: form.get('dataId'),
          group: form.get('group'),
          type: form.get('type'),
          content: form.get('content'),
        });
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('true');
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    await rm(root, { recursive: true, force: true });
  });

  const result = await runScript({
    AIBIZ_WORKSPACE_ROOT: root,
    AIBIZ_NACOS_HOST: '127.0.0.1',
    AIBIZ_NACOS_PORT: String(port),
    AIBIZ_NACOS_GROUP: 'contract-group',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(
    requests.map(request => [request.dataId, request.type, request.group]).sort(),
    [
      ['deployapp-demo.json', 'json', 'contract-group'],
      ['deploysystem-demo.yaml', 'yaml', 'contract-group'],
      ['deploysystem-gateway', 'text', 'contract-group'],
    ],
  );
  assert.equal(
    requests.find(request => request.dataId === 'deploysystem-gateway').content,
    'deploysystemid: gateway\n',
  );
  assert.doesNotMatch(result.stdout, /contract-token/);
});
