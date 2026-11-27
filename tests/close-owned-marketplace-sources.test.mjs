import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bindUnresolvedCatalogSources, closeOwnedMarketplaceSources, inspectMarketplaceSourceDeclarations, parseMarketplaceBlobBatch,
  parseMarketplaceGitTree, rebuildMarketplaceTree,
} from '../close-owned-marketplace-sources.mjs';

const workspace = path.resolve(import.meta.dirname, '../..');
const inventory = JSON.parse(fs.readFileSync(path.join(workspace,
  'scripts/docs/MARKETPLACE-SOURCE-INVENTORY-20261103.json')));
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const sourceId = 'BASE.ibizmodeling.logicdesign.logicdesign';
const catalogRows = value => value.entries.map(row => ({
  pscoreprdfuncid: row.catalogId, httpurltorepo: row.repository, funcstate: row.catalogState,
  path: `/modeling_addons/${row.catalogId.split('.').at(-1)}`,
}));
const observation = value => [{ status: 200, total: 23, items: catalogRows(value) }];
const fixture = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aibiz-k01-source-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};
const runGit = (directory, args) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const result = spawnSync('git', ['-C', directory, ...args], {
    env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('tree parsing keeps exact case-sensitive files and rejects links, traversal, duplicates and budgets', () => {
  const row = relative => `100644 blob ${'a'.repeat(40)} 5\t${relative}\0`;
  assert.deepEqual(parseMarketplaceGitTree(Buffer.from(row('A.json') + row('a.json')))
    .map(item => item.path), ['A.json', 'a.json']);
  for (const relative of ['../outside', '.git/config', 'a\\b', '/absolute', 'a\nb']) {
    assert.throws(() => parseMarketplaceGitTree(Buffer.from(row(relative))), /safe regular/);
  }
  assert.throws(() => parseMarketplaceGitTree(Buffer.from(row('same') + row('same'))), /Duplicate/);
  assert.throws(() => parseMarketplaceGitTree(Buffer.from(row('link').replace('100644', '120000'))),
    /safe regular/);
  assert.throws(() => parseMarketplaceGitTree(Buffer.from(row('large').replace(' 5\t', ' 67108865\t'))));
  assert.throws(() => parseMarketplaceGitTree(Buffer.from(row('a').slice(0, -1))), /NUL/);
});

test('batch parser binds raw binary blobs to exact Git IDs and rejects missing, changed or excess bytes', () => {
  const data = Buffer.from([0, 10, 255, 13, 0]);
  const item = { oid: gitBlob(data), bytes: data.length };
  const batch = Buffer.concat([Buffer.from(`${item.oid} blob ${data.length}\n`), data, Buffer.from('\n')]);
  assert.deepEqual(parseMarketplaceBlobBatch(batch, [item]).get(item.oid), data);
  assert.throws(() => parseMarketplaceBlobBatch(batch.subarray(0, -1), [item]), /Truncated/);
  assert.throws(() => parseMarketplaceBlobBatch(Buffer.concat([batch, Buffer.from('extra')]), [item]),
    /Undeclared/);
  const changed = Buffer.from(batch);
  changed[changed.length - 2] = 1;
  assert.throws(() => parseMarketplaceBlobBatch(changed, [item]), /object ID/);
  assert.throws(() => parseMarketplaceBlobBatch(Buffer.from(`${item.oid} missing\n`), [item]));
});

test('unknown sources bind all successful catalog observations without inventing revision or license', () => {
  const observed = observation(inventory);
  observed.push(structuredClone(observed[0]));
  const bound = bindUnresolvedCatalogSources(inventory, observed);
  assert.equal(bound.length, 2);
  for (const row of bound) {
    assert.equal(row.observationCount, 2);
    assert.equal(row.revision, null);
    assert.equal(row.license, null);
    assert.equal(row.sourceClosure, false);
    assert.equal(row.generatorInputsLocated, false);
  }
  const mismatch = structuredClone(observed);
  mismatch[1].items.find(row => row.pscoreprdfuncid === bound[0].catalogId).httpurltorepo += '/other';
  assert.throws(() => bindUnresolvedCatalogSources(inventory, mismatch));
  const duplicate = structuredClone(observed);
  duplicate[0].items[1] = duplicate[0].items[0];
  assert.throws(() => bindUnresolvedCatalogSources(inventory, duplicate));
  assert.throws(() => bindUnresolvedCatalogSources(inventory,
    [{ ...observed[0], status: 500 }]));
});

test('Git reconstruction reads physical exported files and rejects changed bytes', t => {
  const root = fixture(t), source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'a.json'), 'changed');
  assert.throws(() => rebuildMarketplaceTree({
    source, repository: path.join(root, 'reconstructed.git'),
    entries: [{ path: 'a.json', bytes: 8, oid: gitBlob(Buffer.from('original')), mode: '100644' }],
  }), /Physical export files differ/);
});

test('real XML/YAML/JSON parsers preserve dependency and generator declarations without running scripts', t => {
  const source = fixture(t);
  const pom = path.join(source, 'pom.xml');
  fs.writeFileSync(pom, `<project xmlns="http://maven.apache.org/POM/4.0.0">
    <groupId>fixture</groupId><artifactId>source</artifactId><version>1.0</version>
    <parent><groupId>host</groupId><artifactId>parent</artifactId><version>2.0</version></parent>
    <properties><host.version>3.0</host.version></properties><modules><module>core</module></modules>
    <dependencyManagement><dependencies><dependency><groupId>host</groupId><artifactId>managed</artifactId>
      <version>\${host.version}</version></dependency></dependencies></dependencyManagement>
    <dependencies><dependency><groupId>host</groupId><artifactId>runtime</artifactId>
      <version>\${host.version}</version><scope>provided</scope></dependency></dependencies>
    <build><plugins><plugin><groupId>generator</groupId><artifactId>codegen</artifactId>
      <version>4.0</version></plugin></plugins></build>
  </project>`);
  fs.writeFileSync(path.join(source, 'ibizmodel.yaml'), 'modelfolder: model\nversion: 8.1.0\n');
  fs.writeFileSync(path.join(source, '.ibizproject'), 'bound opaque metadata');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name: 'fixture', scripts: { build: 'touch must-not-exist' }, dependencies: { external: '1.2.3' },
  }));
  fs.writeFileSync(path.join(source, 'PSSYSAPP.json'), JSON.stringify({ rtobjectrepo: 'real-plugin@1.2.3' }));
  const result = inspectMarketplaceSourceDeclarations(source);
  assert.equal(result.poms.length, 1);
  assert.equal(result.poms[0].parent[0].artifactId, 'parent');
  assert.equal(result.poms[0].properties['host.version'], '3.0');
  assert.deepEqual(result.poms[0].modules, ['core']);
  assert.equal(result.poms[0].dependencies.length, 2);
  assert.deepEqual(result.poms[0].unresolvedPropertyExpressions, ['${host.version}']);
  assert.equal(result.poms[0].plugins[0].artifactId, 'codegen');
  assert.equal(result.generatorInputs.find(row => row.format === 'yaml').declaration.modelfolder, 'model');
  assert.equal(result.generatorInputs.length, 2);
  assert.deepEqual(result.directPfPackages, ['real-plugin@1.2.3']);
  assert.equal(result.npmDeclarations[0].dependencies.external, '1.2.3');
  assert.equal(result.repositoryScriptsExecuted, false);
  assert.equal(fs.existsSync(path.join(source, 'must-not-exist')), false);
  fs.writeFileSync(pom, '<!DOCTYPE project [<!ENTITY unsafe "value">]><project/>');
  assert.throws(() => inspectMarketplaceSourceDeclarations(source), /without a DOCTYPE/);
});

test('full exporter retains ignored/colliding/quoted/binary files and reconstructs and restores the whole tree', async t => {
  const root = fixture(t);
  const repository = path.join(root, 'extensions/upstream/logic-design-standard');
  fs.mkdirSync(repository, { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts/docs'), { recursive: true });
  fs.mkdirSync(path.join(root, '.artifacts'));
  const files = {
    LICENSE: Buffer.from('MIT License\nFixture owner\n'),
    '.gitattributes': Buffer.from('ignored.json export-ignore\n'),
    'ignored.json': Buffer.from('{"retained":true}\n'),
    'A.json': Buffer.from('{"case":"upper"}\n'),
    'a.json': Buffer.from('{"case":"lower"}\n'),
    'quoted"name.txt': Buffer.from('quotes remain exact\n'),
    'binary.dat': Buffer.from([0, 255, 13, 10]),
  };
  for (const [relative, bytes] of Object.entries(files)) fs.writeFileSync(path.join(repository, relative), bytes);
  runGit(repository, ['init']);
  runGit(repository, ['add', '--all']);
  runGit(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--no-gpg-sign', '-m', 'Source fixture']);
  runGit(repository, ['remote', 'add', 'origin', inventory.entries[0].repository]);
  const revision = runGit(repository, ['rev-parse', 'HEAD']);
  const tree = runGit(repository, ['rev-parse', 'HEAD^{tree}']);
  const declared = structuredClone(inventory);
  Object.assign(declared.entries.find(row => row.catalogId === sourceId),
    { gitCommit: revision, treeFiles: Object.keys(files).length });
  declared.catalogEvidence = '.artifacts/catalog.json';
  fs.writeFileSync(path.join(root, 'scripts/docs/MARKETPLACE-SOURCE-INVENTORY-20261103.json'),
    JSON.stringify(declared));
  fs.writeFileSync(path.join(root, declared.catalogEvidence), JSON.stringify(observation(declared)));
  for (const relative of Object.keys(files)) fs.unlinkSync(path.join(repository, relative));
  fs.unlinkSync(path.join(repository, '.git/index'));
  const inherited = Object.fromEntries(['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT']
    .map(key => [key, process.env[key]]));
  let result;
  try {
    process.env.GIT_DIR = path.join(root, 'unrelated-repository');
    process.env.GIT_INDEX_FILE = path.join(root, 'unrelated-index');
    process.env.GIT_CONFIG_COUNT = '1';
    result = await closeOwnedMarketplaceSources({ workspace: root, output: '.artifacts/k01-marketplace-source-test' });
  } finally {
    for (const [key, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(result.source.tree, tree);
  assert.equal(result.source.rebuiltTree, tree);
  assert.equal(result.source.restoredTree, tree);
  assert.equal(result.source.files, Object.keys(files).length);
  assert.deepEqual(result.source.caseCollisionGroups, [['A.json', 'a.json']]);
  assert.equal(result.source.archive.replayBytewise, true);
  assert.equal(result.source.archive.extractionBytewise, true);
  assert.equal(result.source.upstreamAuthenticated, false);
  assert.equal(result.fullK01Acceptance, false);
  assert.deepEqual(result.sourceStateBefore, result.sourceStateAfter);
  assert.equal(result.sourceStateBefore.indexSha256, null);
  assert.equal(fs.existsSync(path.join(repository, '.git/index')), false);
  assert.deepEqual(result.upstreamRefs, []);
  assert.equal(result.executionInputsUnchanged, true);
  assert.equal(fs.existsSync(path.join(root, 'unrelated-index')), false);
  assert.equal(fs.existsSync(path.join(root, 'unrelated-repository')), false);
  for (const [relative, bytes] of Object.entries(files)) {
    assert.deepEqual(fs.readFileSync(path.join(root, '.artifacts/k01-marketplace-source-test/source', relative)), bytes);
  }
  assert.equal(fs.statSync(path.join(root, '.artifacts/k01-marketplace-source-test')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(root, '.artifacts/k01-marketplace-source-test/report.private.json')).mode & 0o777, 0o600);
  await assert.rejects(() => closeOwnedMarketplaceSources({
    workspace: root, output: '.artifacts/k01-marketplace-source-test',
  }), /must not be overwritten/);
  const summary = JSON.parse(fs.readFileSync(path.join(root,
    '.artifacts/k01-marketplace-source-test/summary.json')));
  assert.equal(summary.files, Object.keys(files).length);
  assert.ok(!JSON.stringify(summary).includes('rawOutput'));
});
