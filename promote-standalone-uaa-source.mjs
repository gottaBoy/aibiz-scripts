#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { sourceBuildInputs, verifyRecordedBuildInputs } from './source-build-identity.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const selectedBuildSha = 'e3e4b175db046a221621625b38515213a28156b613813fe1e19bd4c5d320af64';

export function validatePromotionBuild(build, hash) {
  assert.equal(hash, selectedBuildSha, 'Promotion requires the selected immutable MGQ6RI receipt');
  assert.equal(build.contract, 'standalone-uaa-recovered-source-compilation-experiment-v1');
  assert.equal(build.status, 'recovered-source-built-focused-fixture-tested-not-native-accepted');
  assert.deepEqual(build.errors, []);
  assert.equal(build.nativeAcceptance, false);
  assert.equal(build.sourceClosureVerified, false);
  for (const flag of ['javaCompilationVerified', 'compilerBuildInDockerVerified', 'focusedSourceContractVerified']) {
    assert.equal(build[flag], true);
  }
  assert.deepEqual(build.packages.map(item => item.module), ['uaa-core', 'uaa-user', 'uaa-api']);
  assert.deepEqual(build.sourceInputs.before, build.sourceInputs.after);
  assert.deepEqual(build.toolInputs.before, build.toolInputs.after);
}

export function promoteStandaloneUaaSource() {
  const selected = join(workspace, '.artifacts/standalone-uaa-editable-20261006-E1/build-MGQ6RI');
  const starter = join(workspace,
    '.artifacts/standalone-uaa-starter-build/build-a529e8bb-d198-47e9-a823-9c1f5e92d737');
  const packaging = join(workspace, '.artifacts/standalone-uaa-editable-20261006-E1');
  const maintained = join(workspace, 'standalone-uaa');
  const directories = new PinnedDirectories();
  const read = path => readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  const write = (path, bytes, mode = 0o644) => {
    const directory = directories.open(dirname(path), { create: true });
    directories.write(directory, basename(path), bytes);
    fs.chmodSync(directories.entry(directory, basename(path)), mode);
  };
  function copyInputs(source, target, inventory) {
    const destination = directories.open(target, { create: true, exclusive: true });
    for (const entry of inventory.entries) {
      assert.ok(!/\.(?:class|jar|war)$/.test(entry.path), 'Compiled artifacts cannot become editable source');
      const bytes = read(join(source, entry.path));
      assert.equal(bytes.length, entry.bytes);
      assert.equal(sha256(bytes), entry.sha256, 'Promotion source changed');
      write(join(destination.path, entry.path), bytes, entry.mode);
    }
    assert.deepEqual(sourceBuildInputs(target), inventory, 'Promoted source differs from selected inputs');
    assert.deepEqual(sourceBuildInputs(source), inventory, 'Selected source changed during promotion');
  }
  try {
    for (const name of ['source', 'starters', 'tools', 'provenance.json']) {
      assert.ok(!fs.existsSync(join(maintained, name)), `Refusing to overwrite maintained ${name}`);
    }
    const buildBytes = read(join(selected, 'report.json'));
    const build = JSON.parse(buildBytes);
    validatePromotionBuild(build, sha256(buildBytes));
    assert.ok(verifyRecordedBuildInputs(join(selected, 'source'), build).ok);
    assert.deepEqual(sourceBuildInputs(join(selected, 'tool-source')), build.toolInputs.before);
    const starterBytes = read(join(starter, 'report.json'));
    const builtStarter = JSON.parse(starterBytes);
    assert.equal(builtStarter.contract, 'standalone-uaa-starter-docker-compilation-v1');
    assert.equal(builtStarter.javaCompilationVerified, true);
    assert.equal(builtStarter.compilerBuildInDockerVerified, true);
    assert.deepEqual(builtStarter.errors, []);
    assert.ok(verifyRecordedBuildInputs(join(starter, 'source'), builtStarter).ok);
    copyInputs(join(selected, 'source'), join(maintained, 'source'), build.sourceInputs.before);
    copyInputs(join(starter, 'source'), join(maintained, 'starters'), builtStarter.sourceInputs.before);
    const tools = directories.open(join(maintained, 'tools'), { create: true, exclusive: true });
    for (const name of ['build.mjs', 'SourceContractTests.java', 'receipt.mjs', 'receipt.test.mjs']) {
      const tool = build.tools.find(item => basename(item.snapshotPath) === name);
      assert.ok(tool, `Missing selected tool ${name}`);
      const bytes = read(join(selected, tool.snapshotPath));
      assert.equal(sha256(bytes), tool.sha256);
      write(join(tools.path, name), bytes);
    }
    for (const name of ['runtime-image.mjs', 'runtime-image.test.mjs']) {
      write(join(tools.path, name), read(join(packaging, name)));
    }
    write(join(maintained, 'settings.xml'), read(join(starter, 'settings.xml')));
    const provenance = {
      schemaVersion: 1, contract: 'standalone-uaa-maintained-source-origin-v1',
      classification: 'independently-reconstructed-compatible-candidate-not-authenticated-original',
      originalSourceRecovered: false, sourceAuthenticityVerified: false,
      sourceClosureVerified: false, nativeAcceptance: false, originalLicenseProvenance: 'unknown',
      selectedBuild: { path: join(selected, 'report.json'), sha256: sha256(buildBytes) },
      selectedStarterBuild: { path: join(starter, 'report.json'), sha256: sha256(starterBytes) },
      originalSourceInputs: build.sourceInputs.before,
      originalStarterInputs: builtStarter.sourceInputs.before,
      businessPackages: build.packages.map(item => ({
        module: item.module,
        originalOwnClasses: item.classSourceMappings.map(mapping => mapping.originalClass),
        classSourceMappings: item.classSourceMappings.map(mapping => ({
          originalClass: mapping.originalClass, source: mapping.source,
        })),
      })),
      dependencies: build.dependencies,
      starterPackages: builtStarter.packages.map(({ artifact, version, javaSources }) =>
        ({ artifact, version, javaSources })),
      settingsSha256: builtStarter.settingsSha256,
      limitations: [
        'Promotion preserves selected editable bytes; it is not upstream source authentication.',
        'Third-party binaries remain pinned dependencies, not localization targets.',
        'No original own JAR is copied into maintained source.',
        'Build, image, deployed protocol, permissions and business acceptance require fresh independent evidence.',
      ],
    };
    assert.equal(sha256(read(join(maintained, 'settings.xml'))), provenance.settingsSha256);
    write(join(maintained, 'provenance.json'), Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`));
    assert.equal(sha256(read(join(selected, 'report.json'))), selectedBuildSha);
    assert.equal(sha256(read(join(starter, 'report.json'))), provenance.selectedStarterBuild.sha256);
    return { status: 'promoted-editable-inputs-only', source: join(maintained, 'source'),
      starters: join(maintained, 'starters'), tools: tools.path, nativeAcceptance: false };
  } finally {
    directories.close();
  }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    'promote-selected-source': { type: 'boolean', default: false },
  } });
  assert.equal(values['promote-selected-source'], true, 'Explicit selected-source promotion required');
  console.log(JSON.stringify(promoteStandaloneUaaSource(), null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
