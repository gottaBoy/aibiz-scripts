import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fingerprintDirectory, loadMigrationContract, WORKSPACE } from '../harness-modeling-core-audit.mjs';
import { prepareNativeModelCandidate, rewritePluginReferences } from '../prepare-native-model-candidate.mjs';
import { collectPluginReferences } from '../harness-plugin-audit.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('candidate rewriting changes only versioned repository fields, preserving every other model field', () => {
  const from = '@ibiz-template-plm/list-tree@0.0.2-dev.145';
  const to = '@ibiz-template-plm/list-tree@0.0.3-alpha.225';
  const original = { note: from, nested: [{ rTObjectRepo: from, label: 'devops' }], cache: {
    child: { RTObjectRepo: from, keep: { note: from } },
  } };
  const result = rewritePluginReferences(original, new Map([[from, to]]));
  assert.deepEqual(result.model, { note: from, nested: [{ rTObjectRepo: to, label: 'devops' }], cache: {
    child: { RTObjectRepo: to, keep: { note: from } },
  } });
  assert.equal(original.nested[0].rTObjectRepo, from);
  assert.deepEqual(result.changes.map(item => item.location), [
    '/nested/0/rTObjectRepo', '/cache/child/RTObjectRepo',
  ]);
});

test('candidate theme rewrites affect only exact root declarations while recursive repository rewrites remain intact', () => {
  const from = '@ibiz-template-theme/studio-theme@0.0.3-alpha.92';
  const to = '@aibiz/studio-theme@0.1.0';
  const declaration = {
    themeTag: 'studio_dark', themeUrl: from,
    themeParams: { 'theme-package-path': from, nested: { themeUrl: from, 'theme-package-path': from } },
  };
  const original = {
    themeUrl: from, 'theme-package-path': from,
    getAllPSAppUIThemes: [structuredClone(declaration)],
    metadata: {
      getAllPSAppUIThemes: [structuredClone(declaration)],
      nested: [{ getAllPSAppUIThemes: [structuredClone(declaration)] }],
      rTObjectRepo: from,
    },
    'metadata/getAllPSAppUIThemes': [structuredClone(declaration)],
    getAllPSAppUIThemesExtra: [structuredClone(declaration)],
  };
  const before = structuredClone(original);
  const result = rewritePluginReferences(original, new Map([[from, to]]));
  const expected = structuredClone(original);
  expected.getAllPSAppUIThemes[0].themeUrl = to;
  expected.getAllPSAppUIThemes[0].themeParams['theme-package-path'] = to;
  expected.metadata.rTObjectRepo = to;
  assert.deepEqual(result.model, expected);
  assert.deepEqual(result.changes, [
    { location: '/getAllPSAppUIThemes/0/themeUrl', from, to },
    { location: '/getAllPSAppUIThemes/0/themeParams/theme-package-path', from, to },
    { location: '/metadata/rTObjectRepo', from, to },
  ]);
  assert.deepEqual(rewritePluginReferences(result.model, new Map([[to, from]])).model, original);
  assert.deepEqual(original, before);
});

test('native candidate binds current source builds, preserves unresolved plugins and leaves originals untouched', () => {
  const candidate = join(WORKSPACE, '.artifacts/native-model-migration', `test-${process.pid}`);
  try {
    const contract = loadMigrationContract();
    const receipt = prepareNativeModelCandidate({ output: candidate });
    assert.equal(receipt.status, 'prepared-not-accepted');
    assert.equal(receipt.acceptedForProduction, false);
    assert.equal(receipt.plugins.length, 5);
    assert.equal(receipt.unresolvedMappings.length, 6);
    for (const application of ['Central', 'ModelDesign']) {
      for (const file of receipt.applications[application].files) {
        const originalBytes = readFileSync(join(WORKSPACE, receipt.sourceModelRoot, file.path));
        assert.equal(hash(originalBytes), file.inputSha256);
        const candidateBytes = readFileSync(join(candidate, 'model', file.path));
        assert.equal(hash(candidateBytes), file.outputSha256);
        const original = JSON.parse(originalBytes);
        const migrated = JSON.parse(candidateBytes);
        const back = rewritePluginReferences(migrated,
          new Map(receipt.plugins.map(plugin => [plugin.to, plugin.from])));
        assert.deepEqual(back.model, original, file.path);
        const repositories = collectPluginReferences(migrated).packages.map(plugin => plugin.repo);
        for (const unresolved of file.unresolved) assert.ok(repositories.includes(unresolved), unresolved);
      }
      const full = receipt.applications[application].files.find(file => file.path.endsWith('/PSSYSAPP.json'));
      assert.equal(full.inputSha256, contract.evidence.applications[application].inputSha256);
    }
    for (const plugin of receipt.plugins) {
      assert.equal(fingerprintDirectory(candidate, `plugins/${plugin.to}`).fingerprint,
        plugin.outputFingerprint);
      assert.equal(plugin.acceptedForProduction, false);
    }
    assert.throws(() => prepareNativeModelCandidate({ output: candidate }), /must not be overwritten/);
    assert.throws(() => prepareNativeModelCandidate({ output: join(WORKSPACE, 'plm/model') }),
      /must be a child/);
  } finally {
    rmSync(candidate, { recursive: true, force: true });
  }
});

for (const level of ['output', 'migration-root', 'artifacts-root', 'workspace', 'dangling-output']) {
  test(`candidate rejects ${level} symlinks before writing any external file`, t => {
    const root = mkdtempSync(join(tmpdir(), 'native-candidate-symlink-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'unchanged');
    const workspace = join(root, 'workspace');
    const migration = join(workspace, '.artifacts/native-model-migration');
    const output = join(migration, 'candidate');
    const link = level === 'workspace' ? workspace :
      level === 'artifacts-root' ? join(workspace, '.artifacts') :
      level === 'migration-root' ? migration : output;
    mkdirSync(join(link, '..'), { recursive: true });
    symlinkSync(level === 'dangling-output' ? join(root, 'missing') : outside, link, 'dir');
    assert.throws(() => prepareNativeModelCandidate({ workspace, output }), /Symlink directory rejected/);
    assert.deepEqual(readdirSync(outside), ['keep.txt']);
    assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'unchanged');
    assert.equal(existsSync(join(root, 'missing')), false);
  });
}

test('candidate delivery is nginx-readable with a restrictive umask and preserves ancestor modes', t => {
  const parent = mkdtempSync(join(WORKSPACE, '.artifacts/native-model-migration/test-private-'));
  const candidate = join(parent, 'candidate');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const originalMode = statSync(parent).mode & 0o777;
  const mask = process.umask(0o077);
  try {
    prepareNativeModelCandidate({ output: candidate });
    function inspect(path) {
      const info = statSync(path);
      assert.equal(info.mode & 0o777, info.isDirectory() ? 0o755 : 0o644, path);
      if (info.isDirectory()) for (const name of readdirSync(path)) inspect(join(path, name));
    }
    inspect(candidate);
    assert.equal(statSync(parent).mode & 0o777, originalMode);
  } finally {
    process.umask(mask);
  }
});

test('candidate compose keeps native entries separate and overlays individual models read-only', () => {
  const compose = join(WORKSPACE, 'plm/deploy/compose');
  const bytes = execFileSync('docker', [
    'compose', '--env-file', '.dev', '-f', 'docker-compose-dev.yml',
    '-f', 'docker-compose-modeling-native.yml', '-f', 'docker-compose-modeling-native-candidate.yml',
    '--profile', 'modeling', '--profile', 'modeling-native', '--profile', 'modeling-native-candidate',
    'config', '--format', 'json',
  ], { cwd: compose, encoding: 'utf8', timeout: 30_000 });
  const config = JSON.parse(bytes);
  for (const [name, port] of [
    ['modelingweb-native-central', 32006], ['modelingweb-native-modeldesign', 32007],
    ['modelingweb-candidate-central', 32008], ['modelingweb-candidate-modeldesign', 32009],
  ]) {
    assert.equal(config.services[name].ports[0].published, String(port));
    assert.equal(config.services[name].ports[0].host_ip, '127.0.0.1');
  }
  for (const name of ['modelingweb-candidate-central', 'modelingweb-candidate-modeldesign']) {
    const service = config.services[name];
    assert.deepEqual(service.entrypoint, ['/bin/sh', '/start.sh']);
    const files = service.volumes.filter(volume => volume.target.endsWith('.json'));
    assert.equal(files.length, 6);
    assert.ok(files.every(volume => volume.read_only));
    assert.ok(service.volumes.some(volume =>
      volume.target === '/opt/aibiz/native-candidate-plugins' && volume.read_only));
  }
});
