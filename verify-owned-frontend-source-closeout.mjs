#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export function frontendOutputsMatchReceipt(actual, recorded) {
  assert.equal(recorded?.bytewise, true, 'A successful producer must bind all generated outputs');
  assert.ok(Number.isSafeInteger(recorded.files) && recorded.files > 0);
  for (const key of ['first', 'second']) assert.match(recorded[key], /^[a-f0-9]{64}$/);
  return actual.bytewise && ['files', 'first', 'second'].every(key => actual[key] === recorded[key]);
}

export function inspectBoundSystemModule(ts, filename, bytes, expectedSha256) {
  assert.match(expectedSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(sha(bytes), expectedSha256, 'Copied SystemJS bytes differ from the producer binding');
  const source = ts.createSourceFile(filename, bytes.toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(source.parseDiagnostics.length, 0);
  const dependencies = [];
  let registrations = 0;
  const inspect = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(source) === 'System' && node.expression.name.text === 'register') {
      registrations++;
      const array = node.arguments.find(argument => ts.isArrayLiteralExpression(argument));
      assert.ok(array, 'SystemJS module must contain its dependency array');
      for (const element of array.elements) {
        assert.ok(ts.isStringLiteral(element));
        dependencies.push(element.text);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  assert.ok(registrations > 0, 'A generated SystemJS module must contain System.register');
  return { path: filename, sha256: expectedSha256, registrations, dependencies };
}

export async function verifyOwnedFrontendSourceCloseout({ directory, reportSha256, planSha256, output } = {}) {
  directory = path.resolve(directory);
  assert.equal(path.dirname(directory), path.join(workspace, '.artifacts'));
  assert.match(path.basename(directory), /^d01-frontend-source-[a-z0-9-]+$/);
  assert.match(reportSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(planSha256 ?? '', /^[a-f0-9]{64}$/);
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Receipt directory ancestry must be real directories');
    if (path.dirname(current) === current) break;
  }
  output = path.resolve(output);
  assert.equal(path.dirname(output), directory);
  assert.equal(fs.existsSync(output), false);
  const bytes = fs.readFileSync(path.join(directory, 'report.private.json'));
  assert.equal(sha(bytes), reportSha256, 'The completed source-build receipt changed');
  const producer = JSON.parse(bytes);
  assert.equal(producer.status, 'complete-own-source-built-twice-not-published');
  assert.equal(producer.sourceBuildComplete, true);
  assert.equal(producer.offlineReproducible, true);
  for (const key of ['sourceInputsUnchanged', 'originalDistributionsUnchanged', 'toolsUnchanged',
    'cachedDependenciesUnchanged', 'privateToolchainUnchanged', 'executionSourceUnchanged', 'inputsUnchanged']) {
    assert.equal(producer[key], true, key);
  }
  const planBytes = fs.readFileSync(path.join(directory, 'plan.private.json'));
  assert.equal(sha(planBytes), planSha256, 'The exact producer plan changed');
  const plan = JSON.parse(planBytes);
  assert.equal(plan.workspace, workspace);
  assert.equal(plan.output, directory);
  assert.equal(plan.importMap, path.join(workspace, 'modelingweb/app/public/extras/json/system-import.json'));
  const producerSource = path.join(directory, 'executed-runner.private.mjs');
  const binding = plan.inputFiles.find(row => row.path === path.join(workspace, 'scripts/run-owned-frontend-source-closeout.mjs'));
  assert.equal(sha(fs.readFileSync(producerSource)), binding.sha256);
  const fixtureBinding = plan.inputFiles.find(row =>
    row.path === path.join(workspace, 'scripts/fixtures/frontend-scss-order-patch.mjs'));
  assert.equal(sha(fs.readFileSync(path.join(directory, 'fixtures/frontend-scss-order-patch.mjs'))),
    fixtureBinding?.sha256, 'A dependency of the sealed producer source changed');
  const { sourceTree, compareFrontendOutputs, frontendSourcePackages } = await import(pathToFileURL(producerSource));
  for (const pass of ['first', 'second']) {
    assert.deepEqual(producer[pass].packages.map(item => [item.name, item.source]), Object.entries(frontendSourcePackages));
  }
  const generated = pass => {
    const entries = [];
    const packages = [];
    for (const item of producer[pass].packages) {
      const roots = ['dist', 'out', 'es', 'lib'].filter(name =>
        fs.existsSync(path.join(directory, pass, 'workspace/ibiz-app-hub', item.source, name)));
      for (const name of roots) {
        const actual = sourceTree(path.join(directory, pass, 'workspace/ibiz-app-hub', item.source, name),
          { ignore: new Set() });
        const expected = name === 'dist' ? item.outputs
          : item.declarations.find(row => row.directory === name)?.inventory;
        if (expected) assert.deepEqual(actual, expected, 'An independently recorded output changed');
        entries.push(...actual.entries.map(row => ({ ...row, path: `${item.name}/${name}/${row.path}` })));
        packages.push({ name: item.name, directory: name, files: actual.files, bytes: actual.bytes });
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return { entries, fingerprint: sha(json(entries)), packages };
  };
  const first = generated('first'), second = generated('second');
  const allOutputs = compareFrontendOutputs(first, second);
  const copiedDistributions = compareFrontendOutputs(
    sourceTree(path.join(directory, 'first/packages'), { ignore: new Set() }),
    sourceTree(path.join(directory, 'second/packages'), { ignore: new Set() }),
  );
  const allGeneratedOutputsMatchProducerReceipt =
    frontendOutputsMatchReceipt(allOutputs, producer.allGeneratedOutputComparison);
  const copiedOutputsMatchProducerReceipt =
    frontendOutputsMatchReceipt(copiedDistributions, producer.outputComparison);
  const outputsMatchProducerReceipt =
    allGeneratedOutputsMatchProducerReceipt && copiedOutputsMatchProducerReceipt;
  const require = createRequire(path.join(workspace, 'ibiz-app-hub/package.json'));
  const parserPath = fs.realpathSync(require.resolve('typescript'));
  const parserBinding = plan.cachedDependencyInputs.entries.find(row => row.path === parserPath && row.sha256);
  assert.ok(parserBinding, 'The actual TypeScript parser must belong to the measured build dependency inputs');
  assert.equal(sha(fs.readFileSync(parserPath)), parserBinding.sha256, 'The build-bound TypeScript parser changed');
  const ts = require('typescript');
  const mapBytes = fs.readFileSync(plan.importMap);
  assert.equal(sha(mapBytes), plan.inputFiles.find(row => row.path === plan.importMap)?.sha256,
    'The build-bound import map changed');
  const map = JSON.parse(mapBytes);
  const roots = new Map(producer.systemEntryBindings.map(row => [row.name, row.path]));
  assert.equal(roots.size, Object.keys(frontendSourcePackages).length);
  assert.equal(producer.systemEntryBindings.length, roots.size);
  const deliveredFiles = new Map(producer.first.packages.flatMap(item =>
    item.outputs.entries.map(row => [
      path.join(directory, 'first/packages', item.name, row.path), row.sha256,
    ])));
  for (const entry of producer.systemEntryBindings) {
    assert.equal(deliveredFiles.get(entry.path), entry.sha256, 'SystemJS entry must match a bound package dist file');
  }
  const visited = new Set();
  const graph = [];
  const externalFiles = new Map();
  const visit = filename => {
    assert.ok(filename.startsWith(`${directory}/first/packages/`));
    if (visited.has(filename)) return;
    visited.add(filename);
    const actual = fs.readFileSync(filename);
    const module = inspectBoundSystemModule(ts, filename, actual, deliveredFiles.get(filename));
    const { dependencies } = module;
    graph.push(module);
    for (const dependency of dependencies) {
      if (dependency.startsWith('.')) visit(path.resolve(path.dirname(filename), dependency));
      else if (roots.has(dependency)) visit(roots.get(dependency));
      else {
        const mapped = map.imports[dependency];
        assert.equal(typeof mapped, 'string', `No actual import map entry for ${dependency}`);
        assert.ok(!/^(?:https?:|\/\/|data:)/.test(mapped), 'External runtime input must be a local file');
        const target = path.resolve(path.dirname(plan.importMap), mapped.split('?')[0]);
        assert.ok(target.startsWith(`${workspace}/modelingweb/app/public/`));
        const buffer = fs.readFileSync(target);
        externalFiles.set(target, { name: dependency, path: target, bytes: buffer.length, sha256: sha(buffer),
          kind: 'existing-precompiled-import-map-distribution-not-recursive-source-build' });
      }
    }
  };
  for (const filename of roots.values()) visit(filename);
  const report = {
    contract: 'owned-framework-generated-output-and-system-entry-verification-v1',
    status: outputsMatchProducerReceipt ? 'PASS_ALL_GENERATED_BYTES_AND_DIRECT_SYSTEM_DEPENDENCY_BINDINGS'
      : 'FAILED_GENERATED_DELIVERY_BYTES_OR_PRODUCER_BINDINGS_DIFFER',
    verifiedAt: new Date().toISOString(), producerReportSha256: reportSha256,
    producerPlanSha256: planSha256, outputsMatchProducerReceipt,
    producerSourceSha256: binding.sha256, verifierSourceSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
    parserSourceSha256: parserBinding.sha256, importMapSha256: sha(mapBytes),
    allOutputs, copiedDistributions, allGeneratedOutputsMatchProducerReceipt, copiedOutputsMatchProducerReceipt,
    systemEntryBindingsVerified: true, systemModuleBindingsVerified: true,
    packages: first.packages, generatedFileCount: first.entries.length,
    systemEntries: roots.size, graph, directExternalRuntimeFiles: [...externalFiles.values()],
    directExternalOnly: true, recursiveRuntimeDependencyClosure: false,
    browserExecuted: false, deployed: false, fullD01Acceptance: false, fullD02Acceptance: false,
    fullD03Acceptance: false, fullO01Acceptance: false,
  };
  fs.writeFileSync(output, json(report), { flag: 'wx', mode: 0o600 });
  console.log(json({ status: report.status, generatedFiles: first.entries.length, runtimeModules: graph.length,
    externalRuntimeFiles: externalFiles.size, output, sha256: sha(fs.readFileSync(output)) }).trim());
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    directory: { type: 'string' }, 'report-sha256': { type: 'string' },
    'plan-sha256': { type: 'string' }, output: { type: 'string' },
  }, strict: true });
  const report = await verifyOwnedFrontendSourceCloseout({
    directory: values.directory, reportSha256: values['report-sha256'],
    planSha256: values['plan-sha256'], output: values.output,
  });
  if (!report.outputsMatchProducerReceipt) process.exitCode = 1;
}
