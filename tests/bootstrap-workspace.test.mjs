import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const script = await readFile(new URL('../bootstrap-workspace.sh', import.meta.url), 'utf8');

test('bootstrap maps all repositories to their required local directory names', () => {
  const expected = [
    ['plm', 'plm'],
    ['plm-web', 'plm-web'],
    ['plm-e2e', 'plm-e2e'],
    ['aibiz-scripts', 'scripts'],
    ['ibiz-app-hub', 'ibiz-app-hub'],
    ['ibiz-service-hub', 'ibiz-service-hub'],
    ['modeling-web', 'modelingweb'],
    ['modeling-service', 'modelingservice'],
    ['task-service', 'task7'],
  ];

  for (const [repository, directory] of expected) {
    assert.match(script, new RegExp(`clone_or_update ${repository} ${directory}`));
  }
});

test('bootstrap uses the active PLM branch and configurable workspace root', () => {
  assert.match(script, /AIBIZ_PLM_BRANCH:-mydev/);
  assert.match(script, /AIBIZ_WORKSPACE_ROOT/);
});

test('bootstrap overrides project npm registry configuration', () => {
  assert.match(script, /AIBIZ_NPM_REGISTRY:-https:\/\/registry\.npmmirror\.com/);
  assert.match(script, /pnpm install --registry="\$NPM_REGISTRY"/);
  assert.match(script, /npm install --registry="\$NPM_REGISTRY"/);
});

test('bootstrap starts the modeling profile and runs idempotent verification', () => {
  assert.match(script, /--profile modeling up -d/);
  assert.match(script, /\.\/migrate\.sh/);
  assert.match(script, /harness-baseline\.sh/);
});

test('bootstrap registers amd64 emulation and builds the PLM service from source', () => {
  assert.match(script, /tonistiigi\/binfmt:latest/);
  assert.match(script, /--install amd64/);
  assert.match(script, /build-local-image\.sh/);
  assert.match(script, /docker-compose-plm-local\.yml/);
});

test('bootstrap supports safe partial runs', () => {
  assert.match(script, /--clone-only/);
  assert.match(script, /--no-dependencies/);
  assert.match(script, /--no-start/);
  assert.match(script, /--no-migration/);
  assert.match(script, /--no-baseline/);
});
