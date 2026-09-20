import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('restart script selects the actual Compose projects and never recreates plmservice', async t => {
  const script = new URL('../restart-modeling-stack.sh', import.meta.url).pathname;
  const root = (process.env.AIBIZ_WORKSPACE_ROOT || new URL('../../', import.meta.url).pathname).replace(/\/$/, '');
  const workspaceRoot = root;
  const directory = await mkdtemp(join(tmpdir(), 'aibiz-restart-harness-'));
  const bin = join(directory, 'bin');
  const log = join(directory, 'commands.log');
  const debugLog = join(directory, 'debug.log');
  await mkdir(bin);
  await writeFile(debugLog, '');
  await writeFile(join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const log = process.env.MOCK_LOG;
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (args[0] === 'info') process.exit(0);
if (args[0] === 'inspect') {
  const name = args.at(-1);
  const format = args[args.indexOf('--format') + 1] || '';
  fs.appendFileSync(process.env.MOCK_DEBUG, JSON.stringify({ name, format, root }) + '\\n');
  if (name === 'ibiz-ebsx-allinone') {
    if (format.includes('com.docker.compose.project.config_files')) {
      console.log(join(workspaceRoot, 'docker-compose-platform.yml'));
    } else if (format.includes('com.docker.compose.service')) {
      console.log('ibiz-ebsx-allinone');
    } else if (format.includes('com.docker.compose.project')) {
      console.log('aibiz');
    }
  } else if (name === 'modelingweb' || name === 'modeling-plugins') {
    console.log('compose');
  } else {
    process.exit(1);
  }
  process.exit(0);
}
if (args[0] === 'compose') process.exit(0);
if (args[0] === 'cp') process.exit(0);
process.exit(1);
`);
  await writeFile(join(bin, 'bash'), `#!${process.execPath}
const fs = require('node:fs');
const log = process.env.MOCK_LOG;
fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv.at(-1).endsWith('harness-baseline.sh')) {
  fs.writeFileSync(process.env.BASELINE_MARKER, 'ran');
  process.exit(0);
}
process.exit(1);
`);
for (const name of ['docker', 'bash']) await chmod(join(bin, name), 0o755);
t.after(() => rm(directory, { recursive: true, force: true }));

  const result = await new Promise(resolve => {
    const child = spawn('/bin/bash', [script], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        MOCK_LOG: log,
        MOCK_DEBUG: debugLog,
        BASELINE_MARKER: join(directory, 'baseline-ran'),
        AIBIZ_USE_LOCAL_WEB_DIST: 'true',
      },
    stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', value => { output += value; });
    child.stderr.on('data', value => { output += value; });
    child.once('close', (code, signal) => resolve({ code, signal, output }));
  });

  assert.equal(result.code, 0, result.output);
  const debug = (await readFile(debugLog, 'utf8')).trim().split('\n');
  assert.ok(debug.length > 0, result.output);
  const commands = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  const composeCommands = commands.filter(args => args[0] === 'compose');
  assert.equal(composeCommands.length, 5);
  assert.ok(composeCommands[0].includes('emqx'));
  assert.equal(composeCommands[1].length, 11);
  assert.ok(composeCommands[2].includes(join(root, 'plm/deploy/compose/docker-compose-dev.yml')));
  assert.ok(composeCommands[2].includes(join(root, 'plm/deploy/compose/docker-compose-modeling-local.yml')));
  assert.ok(composeCommands[4].includes('task'));
  assert.equal(composeCommands[4][composeCommands[4].indexOf('--wait-timeout') + 1], '480');
  assert.ok(composeCommands.every(args => !args.includes('plmservice')));
  assert.equal(await readFile(join(directory, 'baseline-ran'), 'utf8'), 'ran');
});
