#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { captionHtmlEntries } from './prepare-plm-caption-entry.mjs';
import { rewriteGuardEntry, resolveGuardResource, staticModuleReferences } from './prepare-plm-guard-overlay.mjs';
import { sourceTree } from './run-owned-frontend-source-closeout.mjs';
import { apiDocumentationRuntimeWitness } from './prepare-existing-api-documentation-release.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const require = createRequire(path.join(workspace, 'ibiz-app-hub/package.json'));
const ts = require('typescript');
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const entry = 'http://127.0.0.1:30250/ibizplm-plmweb/';
const hash = /^[a-f0-9]{64}$/;
const runtimeWitness = () => apiDocumentationRuntimeWitness(JSON.parse(execFileSync(
  'docker', ['inspect', 'plmweb'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
))[0]);

export function lifecycleCommitBinding(sources, commit) {
  assert.match(commit ?? '', /^[a-f0-9]{40}$/);
  const repository = path.join(workspace, 'ibiz-app-hub');
  const roots = sources.map(item => {
    const relative = path.relative(repository, item.source);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    return relative;
  });
  const tree = execFileSync('git', ['-C', repository, 'ls-tree', '-rz', '--full-tree', commit, '--', ...roots],
    { timeout: 30_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
  const tracked = new Map(tree.split('\0').filter(Boolean).map(line => {
    const match = line.match(/^([0-7]+) blob ([a-f0-9]{40})\t(.+)$/);
    assert.ok(match);
    return [match[3], { mode: match[1], blob: match[2] }];
  }));
  const files = [];
  sources.forEach((item, index) => {
    assert.deepEqual(sourceTree(item.source), item.inventory, 'Producer source contents changed before commit binding');
    for (const file of item.inventory.entries) {
      const relative = `${roots[index]}/${file.path}`;
      const bytes = fs.readFileSync(path.join(repository, relative));
      assert.equal(digest(bytes), file.sha256);
      const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      assert.equal(tracked.get(relative)?.blob, blob, `The new commit blob does not match the actual built input: ${relative}`);
      files.push({ path: relative, sha256: file.sha256, blob, mode: tracked.get(relative).mode });
    }
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { contract: 'content-equivalent-source-commit-binding-v1', commit, files: files.length,
    inventorySha256: digest(json(files)), entries: files, oldProducerGitMetadataRewritten: false };
}

export function lifecycleSystemContract(text) {
  const filename = '/owned-runtime-contract.js';
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(source.parseDiagnostics.length, 0);
  const host = {
    getSourceFile: name => name === filename ? source : undefined,
    getDefaultLibFileName: () => '', writeFile() {}, getCurrentDirectory: () => '/',
    getDirectories: () => [], fileExists: name => name === filename,
    readFile: name => name === filename ? text : undefined,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  const checker = ts.createProgram([filename], { allowJs: true, noLib: true, noResolve: true }, host).getTypeChecker();
  const registrations = [];
  const visitRegistration = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'System' &&
        node.expression.name.text === 'register') registrations.push(node);
    ts.forEachChild(node, visitRegistration);
  };
  visitRegistration(source);
  assert.equal(registrations.length, 1, 'Only one literal SystemJS module is eligible');
  const unwrap = node => ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  const registration = registrations[0];
  const dependenciesNode = registration.arguments.find(ts.isArrayLiteralExpression);
  assert.ok(dependenciesNode);
  const dependencies = dependenciesNode.elements.map(node => {
    assert.ok(ts.isStringLiteral(node));
    return node.text;
  });
  assert.equal(new Set(dependencies).size, dependencies.length);
  const declare = registration.arguments.map(unwrap).find(node =>
    ts.isFunctionExpression(node) || ts.isArrowFunction(node));
  assert.ok(declare && ts.isBlock(declare.body) && ts.isIdentifier(declare.parameters[0]?.name));
  const exporter = checker.getSymbolAtLocation(declare.parameters[0].name);
  assert.ok(exporter);
  const exported = new Set();
  const visitExport = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        checker.getSymbolAtLocation(node.expression) === exporter) {
      const first = node.arguments[0];
      if (ts.isStringLiteral(first)) exported.add(first.text);
      else {
        assert.ok(ts.isObjectLiteralExpression(first), 'Computed SystemJS exports require a separate review');
        for (const property of first.properties) {
          assert.ok(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property));
          assert.ok(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name));
          exported.add(property.name.text);
        }
      }
    }
    ts.forEachChild(node, visitExport);
  };
  visitExport(declare.body);
  const returned = declare.body.statements.find(ts.isReturnStatement);
  const body = returned && unwrap(returned.expression);
  assert.ok(body && ts.isObjectLiteralExpression(body));
  const setters = body.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(source) === 'setters');
  assert.ok(setters && ts.isArrayLiteralExpression(setters.initializer));
  assert.equal(setters.initializer.elements.length, dependencies.length);
  const imports = setters.initializer.elements.map((value, index) => {
    const setter = unwrap(value);
    assert.ok(ts.isFunctionExpression(setter) || ts.isArrowFunction(setter));
    assert.ok(ts.isIdentifier(setter.parameters[0]?.name));
    const symbol = checker.getSymbolAtLocation(setter.parameters[0].name);
    const properties = new Set();
    const visit = node => {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
          checker.getSymbolAtLocation(node.expression) === symbol) properties.add(node.name.text);
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) &&
          checker.getSymbolAtLocation(node.expression) === symbol) {
        assert.ok(ts.isStringLiteral(node.argumentExpression), 'Computed dependency access requires a separate review');
        properties.add(node.argumentExpression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(setter.body);
    return { dependency: dependencies[index], properties: [...properties].sort() };
  });
  return { dependencies, exports: [...exported].sort(), imports };
}

export function lifecycleRuntimeMap(original, revision) {
  assert.match(revision, /^[a-f0-9]{16}$/);
  assert.equal(typeof original?.imports?.['@ibiz-template/runtime'], 'string');
  const result = structuredClone(original);
  result.imports['@ibiz-template/runtime'] =
    `../js/@ibiz-template/runtime/lifecycle-${revision}/index.system.min.js`;
  const unchanged = structuredClone(result);
  unchanged.imports['@ibiz-template/runtime'] = original.imports['@ibiz-template/runtime'];
  assert.deepEqual(unchanged, original, 'Every other import, style and configuration must remain unchanged');
  return result;
}

function privateBytes(output, relative, value) {
  assert.ok(!path.isAbsolute(relative) && relative.split('/').every(part => part && part !== '.' && part !== '..'));
  const filename = path.join(output, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { path: relative, bytes: value.length, sha256: digest(value) };
}

async function served(relative) {
  const response = await fetch(`${entry}${relative}`, { signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, `Actual static host GET failed: ${relative}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function prepareControlLifecycleRuntime({ build, reportSha256, verificationSha256, hubCommit, output }) {
  build = path.resolve(build);
  output = path.resolve(output);
  assert.equal(fs.realpathSync(path.dirname(build)), artifacts);
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  assert.match(path.basename(build), /^d01-frontend-source-[a-z0-9-]+$/);
  assert.match(path.basename(output), /^plm-control-lifecycle-candidate-[a-z0-9-]+$/);
  assert.match(reportSha256 ?? '', hash);
  assert.match(verificationSha256 ?? '', hash);
  const reportBytes = fs.readFileSync(path.join(build, 'report.private.json'));
  assert.equal(digest(reportBytes), reportSha256);
  const producer = JSON.parse(reportBytes);
  assert.equal(producer.status, 'complete-own-source-built-twice-not-published');
  assert.equal(producer.published, false);
  for (const key of ['sourceInputsUnchanged', 'originalDistributionsUnchanged', 'toolsUnchanged',
    'cachedDependenciesUnchanged', 'privateToolchainUnchanged', 'executionSourceUnchanged', 'inputsUnchanged']) {
    assert.equal(producer[key], true, key);
  }
  assert.equal(producer.allGeneratedOutputComparison.bytewise, true);
  const verificationBytes = fs.readFileSync(path.join(build, 'final-verification.private.json'));
  assert.equal(digest(verificationBytes), verificationSha256);
  const verification = JSON.parse(verificationBytes);
  assert.equal(verification.status, 'PASS_ALL_GENERATED_BYTES_AND_DIRECT_SYSTEM_DEPENDENCY_BINDINGS');
  assert.equal(verification.producerReportSha256, reportSha256);
  assert.equal(verification.allOutputs.bytewise, true);
  const planBytes = fs.readFileSync(path.join(build, 'plan.private.json'));
  const plan = JSON.parse(planBytes);
  for (const item of plan.sources) {
    assert.deepEqual(sourceTree(item.source), item.inventory);
    assert.deepEqual(sourceTree(item.snapshot), item.inventory);
  }
  const commitBinding = lifecycleCommitBinding(plan.sources, hubCommit);
  const source = plan.sources.find(item => item.name === 'runtime');
  assert.equal(source?.source, path.join(workspace, 'ibiz-app-hub/packages/runtime'));
  assert.deepEqual(sourceTree(source.source), source.inventory, 'The built runtime source must still be current');
  const bindings = producer.systemEntryBindings.filter(item => item.name === '@ibiz-template/runtime');
  assert.equal(bindings.length, 1);
  const runtimePath = path.join(build, 'first/packages/runtime/index.system.min.js');
  assert.equal(bindings[0].path, runtimePath);
  const candidate = fs.readFileSync(runtimePath);
  assert.equal(digest(candidate), bindings[0].sha256);
  const first = producer.first.packages.find(item => item.name === 'runtime');
  const second = producer.second.packages.find(item => item.name === 'runtime');
  for (const item of [first, second]) {
    assert.equal(item.status, 'built');
    const file = item.outputs.entries.find(row => row.path === 'index.system.min.js');
    assert.equal(file.sha256, digest(candidate));
    assert.equal(file.bytes, candidate.length);
  }
  assert.deepEqual(candidate, fs.readFileSync(path.join(build, 'second/packages/runtime/index.system.min.js')));
  assert.ok(candidate.includes(Buffer.from('Controller lifecycle cancelled')));
  assert.ok(candidate.includes(Buffer.from('assertLifecycleActive')));
  const before = runtimeWitness();
  const originalIndex = fs.readFileSync(path.join(workspace, 'plm-web/dist/index.html'));
  assert.deepEqual(await served('index.html'), originalIndex);
  const originalEntries = captionHtmlEntries(originalIndex.toString('utf8'));
  const originalMap = fs.readFileSync(path.join(workspace, 'plm-web/dist', originalEntries.importMap));
  assert.deepEqual(await served(originalEntries.importMap), originalMap);
  const map = JSON.parse(originalMap);
  const currentRuntimePath = resolveGuardResource('@ibiz-template/runtime', originalEntries.appEntry, map, originalEntries.importMap);
  assert.match(currentRuntimePath, /^extras\/js\/@ibiz-template\/runtime\/language-[a-f0-9]{16}\/index\.system\.min\.js$/);
  const currentRuntime = fs.readFileSync(path.join(workspace, 'plm-web/dist', currentRuntimePath));
  assert.deepEqual(await served(currentRuntimePath), currentRuntime);
  const oldContract = lifecycleSystemContract(currentRuntime.toString('utf8'));
  const newContract = lifecycleSystemContract(candidate.toString('utf8'));
  assert.deepEqual(newContract, oldContract, 'Runtime dependencies, exports and imported symbols must stay identical');
  const references = staticModuleReferences(candidate.toString('utf8'), 'index.system.min.js');
  const originalReferences = staticModuleReferences(currentRuntime.toString('utf8'), currentRuntimePath);
  assert.deepEqual([...references.references].sort(), [...originalReferences.references].sort(),
    'Literal lazy imports must also retain the current runtime contract');
  const inherited = [];
  for (const reference of references.references) {
    const relative = resolveGuardResource(reference, currentRuntimePath, map, originalEntries.importMap);
    const bytes = fs.readFileSync(path.join(workspace, 'plm-web/dist', relative));
    assert.deepEqual(await served(relative), bytes, `Existing direct dependency differs: ${reference}`);
    inherited.push({ reference, path: relative, bytes: bytes.length, sha256: digest(bytes) });
  }
  fs.mkdirSync(output, { mode: 0o700 });
  const revision = digest(candidate).slice(0, 16);
  const runtimeFile = `extras/js/@ibiz-template/runtime/lifecycle-${revision}/index.system.min.js`;
  const mapPath = `extras/json/system-import-lifecycle-${revision}.json`;
  const newMap = json(lifecycleRuntimeMap(map, revision));
  const index = Buffer.from(rewriteGuardEntry(originalIndex.toString('utf8'), {
    appEntry: `./${originalEntries.appEntry}`, importMap: `./${mapPath}`,
  }));
  const files = [
    privateBytes(output, `overlay/${runtimeFile}`, candidate),
    privateBytes(output, `overlay/${mapPath}`, newMap),
    privateBytes(output, 'overlay/index.html', index),
  ].map(file => ({ ...file, path: file.path.slice('overlay/'.length) }));
  privateBytes(output, 'rollback/index.html', originalIndex);
  privateBytes(output, `rollback/${originalEntries.importMap}`, originalMap);
  privateBytes(output, 'producer-report.private.json', reportBytes);
  privateBytes(output, 'producer-verification.private.json', verificationBytes);
  privateBytes(output, 'producer-plan.private.json', planBytes);
  const commitBindingFile = privateBytes(output, 'commit-binding.private.json', json(commitBinding));
  const sourceFiles = [];
  for (const file of source.inventory.entries) {
    const bytes = fs.readFileSync(path.join(source.source, file.path));
    assert.equal(digest(bytes), file.sha256);
    sourceFiles.push(privateBytes(output, `snapshot/ibiz-app-hub/packages/runtime/${file.path}`, bytes));
  }
  const tools = [
    'scripts/prepare-plm-control-lifecycle-runtime.mjs', 'scripts/tests/prepare-plm-control-lifecycle-runtime.test.mjs',
    'scripts/deploy-existing-plm-control-lifecycle-runtime.mjs', 'scripts/tests/deploy-existing-plm-control-lifecycle-runtime.test.mjs',
    'scripts/deploy-existing-plm-language-runtime.mjs', 'scripts/tests/deploy-existing-plm-language-runtime.test.mjs',
    'scripts/tests/control-controller-lifecycle.test.mjs', 'scripts/prepare-plm-caption-entry.mjs',
    'scripts/prepare-plm-guard-overlay.mjs', 'scripts/run-owned-frontend-source-closeout.mjs',
    'scripts/prepare-existing-api-documentation-release.mjs',
  ].map(relative => {
    const bytes = fs.readFileSync(path.join(workspace, relative));
    return { path: relative, ...privateBytes(output, `tools/${relative}`, bytes), sourcePath: relative };
  });
  assert.deepEqual(lifecycleCommitBinding(plan.sources, hubCommit), commitBinding);
  assert.deepEqual(runtimeWitness(), before, 'The real serving runtime changed during preparation');
  for (const [relative, bytes] of [['index.html', originalIndex], [originalEntries.importMap, originalMap],
    [currentRuntimePath, currentRuntime]]) assert.deepEqual(await served(relative), bytes);
  const manifest = { contract: 'plm-control-lifecycle-runtime-candidate-v1', status: 'PREPARED-NOT-PUBLISHED',
    revision, build, producerReportSha256: reportSha256, producerPlanSha256: digest(planBytes),
    producerVerificationSha256: verificationSha256, commitBinding: {
      path: commitBindingFile.path, sha256: commitBindingFile.sha256, commit: hubCommit,
      files: commitBinding.files, inventorySha256: commitBinding.inventorySha256,
    },
    runtimeSource: source, sourceFiles, tools, files, runtimeFile, mapPath,
    originalIndexSha256: digest(originalIndex), originalMapSha256: digest(originalMap),
    activeOriginalEntries: originalEntries, currentRuntime: { path: currentRuntimePath, sha256: digest(currentRuntime) },
    systemContract: newContract, references, originalReferences, inherited, runtimeBefore: before, runtimeUnchanged: true,
    runtimeOnly: true, otherImportMapValuesUnchanged: true, componentStylesUnchanged: true,
    applicationEntryUnchanged: true, docsPluginsModelsUnchangedByCandidate: true,
    directDependenciesOnly: true, recursiveDependencyClosureClaimed: false,
    sharedWrites: 0, deployed: false, functionalAcceptance: false, preparedAt: new Date().toISOString() };
  privateBytes(output, 'control-lifecycle-candidate.private.json', json(manifest));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    build: { type: 'string' }, 'report-sha256': { type: 'string' }, 'verification-sha256': { type: 'string' },
    'hub-commit': { type: 'string' }, output: { type: 'string' },
  }, strict: true });
  try {
    const report = await prepareControlLifecycleRuntime({
      build: values.build, reportSha256: values['report-sha256'], verificationSha256: values['verification-sha256'],
      hubCommit: values['hub-commit'], output: values.output,
    });
    console.log(JSON.stringify({ status: report.status, files: report.files, exports: report.systemContract.exports.length,
      dependencies: report.inherited.length, sharedWrites: report.sharedWrites, deployed: false }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
