#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { collectPluginReferences } from './harness-plugin-audit.mjs';
import { verifyOfflineMarketplaceBundle } from './owned-marketplace-offline.mjs';
import { planOwnedMarketplaceOffline } from './prepare-owned-marketplace-offline.mjs';

const workspaceDefault = resolve(import.meta.dirname, '..');
const indexPath = 'scripts/docs/MARKETPLACE-SOURCE-INVENTORY-20261103.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const safe = path => typeof path === 'string' && /^[A-Za-z0-9_.][A-Za-z0-9._/-]*$/.test(path)
  && path.split('/').every(part => part && part !== '.' && part !== '..');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const relativeTo = (root, path) => {
  const child = relative(root, resolve(root, path));
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'));
  return child;
};

function sourceIdentity(workspace, catalogId, directories) {
  const indexBytes = read(directories, join(workspace, indexPath));
  const index = JSON.parse(indexBytes);
  const entry = index.entries.find(row => row.catalogId === catalogId);
  assert.ok(entry?.localPath && entry.repository, 'An observed official source checkout is required');
  const catalogBytes = read(directories, join(workspace, relativeTo(workspace, index.catalogEvidence)));
  const items = JSON.parse(catalogBytes).flatMap(page => page.items ?? [])
    .filter(item => item.pscoreprdfuncid === catalogId);
  assert.ok(items.length && items.every(item => item.httpurltorepo === entry.repository));
  assert.equal(new Set(items.map(item => item.avatarurl)).size, 1);
  const item = items[0];
  const icon = new URL(item.avatarurl);
  assert.equal(icon.protocol, 'https:');
  assert.equal(icon.hostname, 'code.ibizlab.cn');
  assert.ok(!icon.username && !icon.password && !icon.port && !icon.search && !icon.hash);
  assert.ok(decodeURIComponent(icon.pathname).startsWith('/plm_addons/public/-/raw/master/exchange/'));
  assert.ok(decodeURIComponent(icon.pathname).endsWith('.png'));
  const root = join(workspace, relativeTo(workspace, entry.localPath));
  directories.open(root);
  const git = args => execFileSync('git', ['-C', root, ...args],
    { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
  assert.equal(resolve(git(['rev-parse', '--show-toplevel']).toString().trim()), root);
  return { entry, item, root, git, catalogBinding: { path: index.catalogEvidence,
    sha256: hash(catalogBytes), indexSha256: hash(indexBytes) } };
}

function read(directories, path) {
  return readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
}

function outputDirectory(directories, workspace, path) {
  const child = relativeTo(workspace, path);
  assert.ok(/^\.artifacts\/owned-marketplace-packages\/[a-f0-9]{12}\/[a-z0-9][a-z0-9-]{0,48}$/.test(child),
    'Output must be a new run-owned marketplace package directory');
  return directories.open(join(workspace, child), { create: true, exclusive: true });
}

function put(directories, root, path, bytes) {
  assert.ok(safe(path));
  const parent = directories.open(join(root.path, dirname(path)), { create: true });
  directories.write(parent, basename(path), bytes);
}

function png(bytes) {
  assert.ok(bytes.length >= 24 && bytes.length <= 4 * 1024 * 1024);
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(bytes.subarray(12, 16).toString(), 'IHDR');
  assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 8192);
  assert.ok(bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 8192);
}

export async function fetchOfficialMarketplaceIcon({
  workspace = workspaceDefault, catalogId, outputPath,
} = {}) {
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  try {
    const identity = sourceIdentity(workspace, catalogId, directories);
    const response = await fetch(identity.item.avatarurl,
      { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, 'Exact official icon did not return 200; no redirect or fallback is adopted');
    assert.match(response.headers.get('content-type') ?? '', /^image\/png(?:;|$)/i);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        await response.body.cancel().catch(() => {});
        throw new Error('Official icon exceeds its bounded byte budget');
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    png(bytes);
    const output = outputDirectory(directories, workspace, outputPath);
    put(directories, output, 'icon.png', bytes);
    const receipt = { contract: 'official-marketplace-icon-observation-v1', catalogId,
      observedAt: new Date().toISOString(), url: identity.item.avatarurl,
      sourceRefImmutable: false, sourceRefMeaning: 'Official catalog master URL observed at this timestamp',
      contentType: response.headers.get('content-type'), bytes: bytes.length, sha256: hash(bytes),
      catalogBinding: identity.catalogBinding, imagePath: relative(workspace, join(output.path, 'icon.png')) };
    const receiptBytes = json(receipt);
    put(directories, output, 'icon-receipt.private.json', receiptBytes);
    return { receipt, receiptPath: join(output.path, 'icon-receipt.private.json'),
      receiptSha256: hash(receiptBytes) };
  } finally { directories.close(); }
}

export function renderLocalDeliveryChangelog({ catalogId, revision, tree, committedAt, subject, version }) {
  return Buffer.from(`# Local Delivery Record / \u672c\u5730\u4ea4\u4ed8\u8bb0\u5f55\n\n`
    + `This generated file is not an upstream CHANGELOG or a claim of an upstream release.\n`
    + `No upstream source content is changed by this local delivery label.\n\n`
    + `Catalog: ${catalogId}\nLocal delivery: ${version}\nSource revision: ${revision}\n`
    + `Source tree: ${tree}\nCommit time: ${committedAt}\nCommit subject: ${subject}\n`
    + `\nGenerator: scripts/package-owned-marketplace-offline.mjs / local-delivery-record-v1\n`);
}

export function packageOwnedMarketplaceOffline({
  workspace = workspaceDefault, catalogId, revision, version, iconReceiptPath, iconReceiptSha256,
  outputPath, dependencyPath = '.artifacts/native-nonadmin-fixtures/6189aef47735/workflow-schema-converge-wf-20261122-r1/dependencies',
  jdkPath = '.artifacts/local-java-toolchain-20261122-r1/openjdk',
} = {}) {
  workspace = resolve(workspace);
  assert.match(revision ?? '', /^[a-f0-9]{40}$/);
  assert.match(version ?? '', /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/);
  assert.ok(sha(iconReceiptSha256));
  const directories = new PinnedDirectories();
  try {
    const identity = sourceIdentity(workspace, catalogId, directories);
    const hostPlan = planOwnedMarketplaceOffline({ workspace, catalogId });
    assert.ok(hostPlan.product?.productId && hostPlan.product.hostPluginId,
      'Official catalog, SQL product and host plugin identities must be linked');
    const generatorPath = join(workspace, 'scripts/package-owned-marketplace-offline.mjs');
    const probePath = join(workspace, 'scripts/fixtures/OwnedMarketplaceModelProbe.java');
    const generatorSha256 = hash(read(directories, generatorPath));
    const probeSha256 = hash(read(directories, probePath));
    assert.equal(identity.git(['rev-parse', `${revision}^{commit}`]).toString().trim(), revision);
    const iconBytes = read(directories, resolve(workspace, relativeTo(workspace, iconReceiptPath)));
    assert.equal(hash(iconBytes), iconReceiptSha256);
    const icon = JSON.parse(iconBytes);
    assert.equal(icon.contract, 'official-marketplace-icon-observation-v1');
    assert.equal(icon.catalogId, catalogId);
    assert.equal(icon.url, identity.item.avatarurl);
    assert.deepEqual(icon.catalogBinding, identity.catalogBinding);
    const image = read(directories, join(workspace, relativeTo(workspace, icon.imagePath)));
    assert.equal(hash(image), icon.sha256);
    assert.equal(image.length, icon.bytes);
    png(image);
    const tracked = identity.git(['ls-tree', '-rz', '--long', revision]).toString().split('\0').filter(Boolean)
      .map(line => {
        const match = /^(\d+) blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/.exec(line);
        assert.ok(match && match[1] === '100644' && safe(match[4]), 'Only regular, safe committed files are accepted');
        return { path: match[4], oid: match[2], bytes: Number(match[3]) };
      });
    const selected = tracked.filter(file => ['LICENSE', 'README.md', 'ibizmodel.yaml', 'pom.xml',
      'modelapi-core/pom.xml'].includes(file.path)
      || file.path.startsWith('modelapi-core/src/main/java/')
      || file.path.startsWith('modelapi-core/src/main/resources/'));
    assert.ok(selected.length > 5 && selected.length <= 9000);
    const output = outputDirectory(directories, workspace, outputPath);
    const source = directories.open(join(output.path, 'source'), { create: true, exclusive: true });
    const archive = identity.git(['archive', '--format=tar', revision, '--',
      'LICENSE', 'README.md', 'ibizmodel.yaml', 'pom.xml', 'modelapi-core/pom.xml',
      'modelapi-core/src/main/java', 'modelapi-core/src/main/resources']);
    const extracted = spawnSync('tar', ['--extract', '--file=-', '--no-same-owner',
      '--no-same-permissions', '--directory', source.path], { input: archive, timeout: 30000,
      maxBuffer: 4 * 1024 * 1024 });
    assert.equal(extracted.status, 0, 'Committed source extraction failed');
    const sourceTree = readTree(source.path, { jsonOnly: false });
    assert.equal(sourceTree.entries.length, selected.length);
    for (const file of sourceTree.contents) {
      const original = selected.find(row => row.path === file.path);
      assert.ok(original && file.bytes === original.bytes);
      assert.equal(createHash('sha1').update(`blob ${file.bytes}\0`).update(file.data).digest('hex'), original.oid);
    }
    const yamlPath = join(workspace, 'plm-web/node_modules/.pnpm/yaml@2.3.3/node_modules/yaml');
    const require = createRequire(import.meta.url);
    const yaml = require(yamlPath);
    assert.equal(require(join(yamlPath, 'package.json')).version, '2.3.3');
    const modelConfig = yaml.parse(sourceTree.contents.find(file => file.path === 'ibizmodel.yaml').data.toString());
    assert.ok(safe(modelConfig.modelfolder) && modelConfig.modelfolder.startsWith('modelapi-core/src/main/resources/model/'));
    const modelRoot = join(source.path, modelConfig.modelfolder);
    const model = readTree(modelRoot, { jsonOnly: false });
    const appModels = model.contents.filter(file =>
      /PSSYSAPPS\/[^/]+\/PSSYSAPP[^/]*\.json$/.test(file.path));
    assert.ok(appModels.length > 0 && model.contents.some(file => file.path === 'PSSYSTEM.json'));
    const references = [...new Set(appModels.flatMap(file => {
      const collected = collectPluginReferences(JSON.parse(file.data));
      assert.deepEqual(collected.invalidReferences, []);
      return collected.packages.map(pkg => pkg.repo);
    }))].sort();
    assert.deepEqual(references, [], 'This initial exact source packager accepts only genuinely zero-external-plugin catalogs; no alias or missing runtime is substituted');
    const timestamp = identity.git(['show', '-s', '--format=%cI', revision]).toString().trim();
    const tree = identity.git(['rev-parse', `${revision}^{tree}`]).toString().trim();
    const subject = identity.git(['show', '-s', '--format=%s', revision]).toString().trim();
    const payload = directories.open(join(output.path, 'bundle/payload'), { create: true, exclusive: true });
    const files = [];
    const add = (path, bytes, role) => {
      put(directories, payload, path, bytes);
      files.push({ path, bytes: bytes.length, sha256: hash(bytes), role });
    };
    for (const file of model.contents) add(`model/${file.path}`, file.data, 'model');
    for (const file of sourceTree.contents.filter(file => !file.path.startsWith(modelConfig.modelfolder + '/'))) {
      add(`source/${file.path}`, file.data, file.path === 'LICENSE' ? 'license' : 'source');
    }
    add('assets/icon.png', image, 'icon');
    add('docs/UPSTREAM-README.md', sourceTree.contents.find(file => file.path === 'README.md').data, 'readme');
    add('docs/LOCAL-DELIVERY-CHANGELOG.md', renderLocalDeliveryChangelog({
      catalogId, revision, tree, committedAt: timestamp, subject, version,
    }), 'changelog');
    add('catalog/catalog.json', json({ ...identity.item, avatarurl: '../assets/icon.png',
      upstreamAvatarUrl: identity.item.avatarurl, localDeliveryVersion: version }), 'dependency');
    const date = new Date(timestamp);
    for (const file of model.entries) fs.utimesSync(join(modelRoot, file.path), date, date);
    const zipPath = join(output.path, 'native-model.zip');
    const zipped = spawnSync('zip', ['-X', '-q', zipPath, '-@'], { cwd: modelRoot,
      env: { ...process.env, TZ: 'UTC' }, input: model.entries.map(file => file.path).join('\n') + '\n',
      timeout: 30000, encoding: 'utf8' });
    assert.equal(zipped.status, 0, 'Native model ZIP export failed');
    add('native/model.zip', read(directories, zipPath), 'model');
    const dependencyRoot = join(workspace, relativeTo(workspace, dependencyPath));
    const jars = fs.readdirSync(dependencyRoot).filter(name => name.endsWith('.jar')).sort();
    const dependencyBindings = jars.map(name => {
      const bytes = read(directories, join(dependencyRoot, name));
      return { path: join(dependencyPath, name), bytes: bytes.length, sha256: hash(bytes) };
    });
    const classes = directories.open(join(output.path, 'classes'), { create: true, exclusive: true });
    const tool = join(workspace, relativeTo(workspace, jdkPath), 'bin');
    const javaSources = sourceTree.entries.filter(file => file.path.endsWith('.java')).map(file => join(source.path, file.path));
    const probe = probePath;
    const classpath = [classes.path, ...jars.map(name => join(dependencyRoot, name))].join(':');
    const commands = [];
    const run = (phase, executable, args) => {
      const result = spawnSync(executable, args, { cwd: source.path, encoding: 'utf8', timeout: 60000,
        maxBuffer: 8 * 1024 * 1024 });
      const bytes = Buffer.from(`${result.stdout ?? ''}${result.stderr ?? ''}`);
      put(directories, output, `${phase}.private.log`, bytes);
      commands.push({ phase, executable, args, status: result.status, logSha256: hash(bytes) });
      assert.equal(result.status, 0, `Native ${phase} failed; retain the private log`);
      return result.stdout;
    };
    run('compile', join(tool, 'javac'), ['--release', '11', '-proc:none', '-encoding', 'UTF-8',
      '-cp', classpath, '-d', classes.path, ...javaSources, probe]);
    const extractedModel = join(output.path, 'native-probe-model');
    const probeText = run('native-model-probe', join(tool, 'java'),
      ['-Xmx768m', '-XX:ActiveProcessorCount=2', '-cp', classpath, 'OwnedMarketplaceModelProbe', zipPath, extractedModel]);
    const parsed = probeText.split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } })
      .find(value => value?.applications && value.systemName);
    assert.ok(parsed, 'Actual native model parser output is required');
    assert.deepEqual(readTree(extractedModel, { jsonOnly: false }).entries, model.entries);
    const coreJar = join(output.path, 'modelapi-core-local.jar');
    const packageRoots = [...new Set(javaSources.map(path =>
      relative(join(source.path, 'modelapi-core/src/main/java'), path).split('/')[0]))].sort();
    assert.ok(packageRoots.length && packageRoots.every(safe));
    run('jar', join(tool, 'jar'), ['--create', '--file', coreJar, '--date', date.toISOString(),
      ...packageRoots.flatMap(path => ['-C', classes.path, path]),
      '-C', join(source.path, 'modelapi-core/src/main/resources'), '.']);
    for (const dependency of dependencyBindings) {
      assert.equal(hash(read(directories, join(workspace, dependency.path))), dependency.sha256,
        'Host compile/parser dependency changed during package generation');
    }
    assert.equal(hash(read(directories, generatorPath)), generatorSha256,
      'Package generator changed during the source build');
    assert.equal(hash(read(directories, probePath)), probeSha256,
      'Native model probe changed during the source build');
    add('native/modelapi-core-local.jar', read(directories, coreJar), 'backend');
    const nativeSource = 'ibiz-service-hub/libs/ibiz-plugin-extension/src/main/java/net/ibizsys/central/plugin/extension/sysutil/HubSysExtensionUtilRuntimeBase.java';
    const nativeBytes = read(directories, join(workspace, nativeSource));
    assert.ok(nativeBytes.toString().includes('v2SystemSource.getOssFile()')
      && nativeBytes.toString().includes('ZipUtils.unzip(new File(ossFile.getLocalPath()), dynaModelFolder)'));
    const provenance = { contract: 'official-marketplace-source-package-v1', catalogId, revision, tree,
      localDeliveryVersion: version, localDeliveryRecordGenerated: true,
      localDeliveryRecordRule: 'local-delivery-record-v1', upstreamReleaseClaimed: false,
      generator: { path: 'scripts/package-owned-marketplace-offline.mjs',
        sha256: generatorSha256 },
      nativeProbeSource: { path: 'scripts/fixtures/OwnedMarketplaceModelProbe.java',
        sha256: probeSha256 },
      catalogBinding: identity.catalogBinding, icon: { receiptSha256: iconReceiptSha256,
        url: icon.url, sha256: icon.sha256, sourceRefImmutable: false },
      hostProduct: hostPlan.product,
      sourceFiles: sourceTree.entries, sourceFingerprint: sourceTree.fingerprint,
      modelFiles: model.entries, exactExternalRuntimeReferences: references,
      modelPluginReferenceInputs: appModels.map(file => ({ path: file.path, sha256: file.sha256 })),
      externalReferenceMeaning: 'Exact PF plugin references in every main/simple/hub application variant; built-in host assets remain separate',
      frontendHostAssetsBound: false,
      hostFrameworkDependencies: dependencyBindings, hostDependencyFingerprint: hash(json(dependencyBindings)),
      originalDependencyClosureAccepted: false, nativeParser: parsed, nativeModelZipFormatVerified: true,
      nativeConsumer: { path: nativeSource, sha256: hash(nativeBytes), contract: 'V2SystemSource.ossfile-to-ZIP-with-root-PSSYSTEM.json' },
      nativeInstallationExecuted: false, nativeMarketplaceAcceptance: false };
    add('provenance.json', json(provenance), 'dependency');
    const manifest = { contract: 'owned-marketplace-offline-bundle-v1', schemaVersion: 1, catalogId, version,
      source: { repository: identity.entry.repository, revision, licensePath: 'source/LICENSE' },
      files: files.sort((a, b) => a.path.localeCompare(b.path)) };
    const manifestBytes = json(manifest);
    put(directories, directories.open(join(output.path, 'bundle')), 'manifest.json', manifestBytes);
    const checked = verifyOfflineMarketplaceBundle({ workspace,
      bundlePath: join(output.path, 'bundle'), manifestSha256: hash(manifestBytes) });
    const result = { contract: 'official-marketplace-package-build-v1', catalogId, revision, version,
      bundlePath: relative(workspace, join(output.path, 'bundle')), manifestSha256: checked.manifestSha256,
      files: files.length, modelFiles: model.files, nativeParser: parsed, commands,
      sourceClosureAccepted: false, nativeInstallationExecuted: false, nativeMarketplaceAcceptance: false };
    put(directories, output, 'package-report.private.json', json(result));
    return result;
  } finally { directories.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, allowPositionals: false, options: {
    action: { type: 'string' }, 'catalog-id': { type: 'string' }, revision: { type: 'string' },
    version: { type: 'string' }, output: { type: 'string' }, 'icon-receipt': { type: 'string' },
    'icon-receipt-sha256': { type: 'string' },
  } });
  const common = { catalogId: values['catalog-id'], outputPath: values.output };
  const result = values.action === 'fetch-icon' ? await fetchOfficialMarketplaceIcon(common)
    : values.action === 'package' ? packageOwnedMarketplaceOffline({ ...common, revision: values.revision,
      version: values.version, iconReceiptPath: values['icon-receipt'],
      iconReceiptSha256: values['icon-receipt-sha256'] })
      : (() => { throw new Error('Explicit fetch-icon or package action required'); })();
  console.log(json(values.action === 'package' ? {
    contract: result.contract, catalogId: result.catalogId, revision: result.revision,
    version: result.version, bundlePath: result.bundlePath, manifestSha256: result.manifestSha256,
    files: result.files, modelFiles: result.modelFiles, nativeParser: result.nativeParser,
    nativeInstallationExecuted: false, nativeMarketplaceAcceptance: false,
  } : result).toString());
}
