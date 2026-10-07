#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageName = '@ibiz-template-plugin/runtime-model';
const fixedIssueIds = [
  'response-shadows-cache-key', 'pagination-delete-count', 'unescaped-search-expression',
  'empty-root-never-loaded', 'children-promise-does-not-wait',
  'config-http-status-unchecked', 'selection-not-reactive',
];
const revisions = {
  baseline: { path: 'modelingweb/local-plugins/runtime-model', version: '0.2.2-local.1' },
  fixed: { path: 'modelingweb/local-plugins/runtime-model-next', version: '0.2.2-local.2' },
};

function revisionConfiguration(revision) {
  assert.ok(Object.hasOwn(revisions, revision), `Unknown runtime-model revision: ${revision}`);
  return revisions[revision];
}
const originalObservation = {
  path: 'plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/es/node_modules/.pnpm/' +
    '@ibiz-template-plugin_runtime-model@0.2.2_@stencil_store@2.0.16/node_modules/@ibiz-template-plugin/runtime-model',
  files: 7,
  bytes: 278671,
  fingerprint: 'b8e6ea99941967181c723b693d56f64a00db3777ffd2b521fa1692a00973eae3',
};
const requiredElements = [
  'ibiz-model-runtime',
  'ibiz-model-runtime-list',
  'loading-mask',
  'loading-panel',
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const excludedParts = new Set(['node_modules', 'dist', 'loader', '.artifacts', 'coverage']);
const sourceFiles = new Set(['package.json', 'package-lock.json', 'stencil.config.ts', 'tsconfig.json']);
const dependencies = {
  '@stencil/core': '2.17.0',
  '@stencil/store': '2.0.16',
  '@webcreate/infinite-ajax-scroll': '3.0.0',
  ramda: '0.29.1',
};
const devDependencies = { '@types/ramda': '0.29.12', typescript: '4.7.4' };
const requiredSourceFiles = [
  'src/index.ts',
  ...requiredElements.flatMap(tag => [
    `src/components/${tag}/${tag}.tsx`,
    `src/components/${tag}/${tag}.css`,
  ]),
  ...['store-base', 'model-runtime-service', 'model-runtime-store',
    'model-runtime-controller', 'loading-controller', 'types'].map(name => `src/core/${name}.ts`),
];
const observedMembers = {
  'ibiz-model-runtime': {
    url: [8], headers: [8], parentKey: [1, 'parent-key'],
    configBaseUrl: [1, 'config-base-url'], breadcrumbHoverIndex: [32],
  },
  'loading-mask': { visible: [32], show: [64], hide: [64] },
  'ibiz-model-runtime-list': {
    controller: [16], items: [16], index: [2], parent: [8], list: [32],
  },
  'loading-panel': {
    defaultShow: [4, 'default-show'], visible: [32], message: [32], show: [64], hide: [64],
  },
};

function isInside(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function assertWorkspacePath(workspace, path) {
  const absolute = resolve(workspace, path);
  assert.ok(isInside(workspace, absolute), `Path escapes workspace: ${path}`);
  return absolute;
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function walk(root, current = root, entries = [], excludeGenerated = true) {
  for (const dirent of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name))) {
    const path = join(current, dirent.name);
    const rel = relative(root, path).split(sep).join('/');
    if (excludeGenerated && (excludedParts.has(dirent.name) || rel === 'src/components.d.ts')) continue;
    assert.ok(!dirent.isSymbolicLink(), `Symlink input rejected: ${rel}`);
    if (dirent.isDirectory()) walk(root, path, entries, excludeGenerated);
    else {
      assert.ok(dirent.isFile(), `Non-regular input rejected: ${rel}`);
      const data = fs.readFileSync(path);
      entries.push({ path: rel, bytes: data.length, sha256: hash(data) });
    }
  }
  return entries;
}

function inventory(root) {
  const entries = walk(root).filter(item =>
    item.path.startsWith('src/') || sourceFiles.has(item.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: entries.length,
    bytes: entries.reduce((total, item) => total + item.bytes, 0),
    fingerprint: hash(JSON.stringify(entries)),
    entries,
  };
}

function packageOutputInventory(packageRoot) {
  const entries = [];
  for (const rootName of ['dist', 'loader']) {
    const root = join(packageRoot, rootName);
    if (!fs.existsSync(root)) continue;
    for (const item of walk(root, root, [])) {
      entries.push({ ...item, path: `${rootName}/${item.path}` });
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: entries.length,
    bytes: entries.reduce((total, item) => total + item.bytes, 0),
    fingerprint: hash(JSON.stringify(entries)),
    entries,
  };
}

function commandEnvironment(packageRoot, artifactRoot) {
  return {
    ...process.env,
    NODE_OPTIONS: '',
    NODE_PATH: '',
    CI: 'true',
    npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true',
    npm_config_registry: 'http://127.0.0.1:9/',
    COREPACK_ENABLE_NETWORK: '0',
    HOME: join(artifactRoot, 'home'),
    TMPDIR: join(artifactRoot, 'tmp'),
    XDG_CACHE_HOME: join(artifactRoot, 'cache'),
    PATH: process.env.PATH,
    AIBIZ_RUNTIME_MODEL_PACKAGE: packageRoot,
  };
}

function runCommand(packageRoot, artifactRoot, id, args, timeout) {
  const logPath = join(artifactRoot, 'logs', `${id}.log`);
  fs.mkdirSync(dirname(logPath), { recursive: true });
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: packageRoot,
    env: commandEnvironment(packageRoot, artifactRoot),
    timeout,
    shell: false,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  fs.writeFileSync(logPath, output);
  return {
    id,
    executable: process.execPath,
    args,
    cwd: packageRoot,
    exitCode: result.status,
    signal: result.signal ?? null,
    error: result.error?.message ?? null,
    durationMs: Date.now() - started,
    log: relative(artifactRoot, logPath).split(sep).join('/'),
    logBytes: Buffer.byteLength(output),
    logSha256: hash(Buffer.from(output)),
  };
}

function cleanGeneratedOutputs(packageRoot) {
  for (const path of ['dist', 'loader']) {
    fs.rmSync(join(packageRoot, path), { recursive: true, force: true });
  }
  const generated = join(packageRoot, 'src/components.d.ts');
  if (fs.existsSync(generated)) fs.rmSync(generated, { force: true });
}

function loaderMetadata(ts, code, revision) {
  const ast = ts.createSourceFile('loader.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, 'Cannot parse generated loader');
  let bundles;
  function literal(node) {
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node)) {
      return Object.fromEntries(node.properties.map(property => {
        assert.ok(ts.isPropertyAssignment(property), 'Nonliteral loader property');
        return [property.name.text, literal(property.initializer)];
      }));
    }
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isStringLiteral(node)) return node.text;
    assert.fail(`Nonliteral loader metadata: ${node.getText(ast)}`);
  }
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'bootstrapLazy') {
      assert.equal(bundles, undefined, 'Multiple loader bootstrap calls');
      bundles = literal(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(Array.isArray(bundles) && bundles.length, 'Stencil bootstrap metadata missing');
  const components = bundles.flatMap(bundle => {
    assert.equal(typeof bundle[0], 'string', 'Missing entry bundle name');
    return bundle[1].map(component => ({
      tag: component[1], flags: component[0], members: component[2],
      events: component[3] ?? [], watchers: component[4] ?? {},
      bundle: bundle[0],
    }));
  }).sort((a, b) => a.tag.localeCompare(b.tag));
  assert.deepEqual(components.map(item => item.tag), [...requiredElements].sort(),
    'Unexpected loader component set');
  for (const component of components) {
    assert.equal(component.flags, 0, `Shadow/scoping metadata changed: ${component.tag}`);
    const expectedMembers = revision === 'fixed' && component.tag === 'ibiz-model-runtime-list'
      ? { ...observedMembers[component.tag], activeData: [32] }
      : observedMembers[component.tag];
    assert.deepEqual(component.members, expectedMembers,
      `Public loader members changed: ${component.tag}`);
  }
  return components;
}

function moduleExports(ts, path) {
  const ast = ts.createSourceFile(path, fs.readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, `Cannot parse generated module: ${path}`);
  const names = [];
  const reexports = [];
  for (const statement of ast.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier) {
        assert.ok(ts.isStringLiteral(statement.moduleSpecifier), 'Nonliteral module reexport');
        assert.equal(statement.exportClause, undefined, 'Expected complete loader module reexport');
        reexports.push(statement.moduleSpecifier.text);
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        names.push(...statement.exportClause.elements.map(element => element.name.text));
      }
    } else if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isFunctionDeclaration(statement)) names.push(statement.name?.text);
      else if (ts.isVariableStatement(statement)) {
        names.push(...statement.declarationList.declarations.map(declaration => declaration.name.text));
      }
    }
  }
  return { names, reexports };
}

function verifyLoader(packageRoot, ts, revision) {
  const paths = [
    join(packageRoot, 'dist/esm/loader.js'),
    join(packageRoot, 'loader/index.js'),
    join(packageRoot, 'dist/esm/polyfills/index.js'),
  ];
  for (const path of paths) {
    assert.ok(fs.existsSync(path), `Missing loader output: ${relative(packageRoot, path)}`);
  }
  const loader = fs.readFileSync(paths[0], 'utf8');
  const components = loaderMetadata(ts, loader, revision);
  const collection = packageOutputInventory(packageRoot);
  for (const element of requiredElements) {
    assert.ok(collection.entries.some(item =>
      item.path === `dist/types/components/${element}/${element}.d.ts` && item.bytes > 0),
    `Type output missing for ${element}`);
    assert.ok(collection.entries.some(item =>
      item.path === `dist/collection/components/${element}/${element}.css` && item.bytes > 0),
    `Style output missing for ${element}`);
  }
  assert.ok(collection.entries.some(item => item.path === 'dist/types/components.d.ts'),
    'Custom element declarations missing');
  assert.deepEqual(moduleExports(ts, paths[1]).reexports.sort(),
    ['../dist/esm/loader.js', '../dist/esm/polyfills/index.js'],
    'Loader index module reexports changed');
  assert.ok(moduleExports(ts, paths[0]).names.includes('defineCustomElements'),
    'Custom element loader export missing');
  assert.ok(moduleExports(ts, paths[2]).names.includes('applyPolyfills'),
    'Polyfill loader export missing');
  const loaderPackage = readJson(join(packageRoot, 'loader/package.json'));
  assert.equal(loaderPackage.module, './index.js', 'Loader package ESM entry changed');
  assert.equal(loaderPackage.typings, './index.d.ts', 'Loader package type entry changed');
  assert.ok(collection.entries.some(item => item.path === 'loader/index.d.ts' && item.bytes > 0),
    'Loader public declarations missing');
  for (const component of components) {
    assert.ok(fs.existsSync(join(packageRoot, 'dist/esm', `${component.bundle}.entry.js`)),
    `Entry output missing for ${component.tag}`);
  }
  return {
    requiredElements,
    components,
    loaderSha256: hash(fs.readFileSync(paths[0])),
    loaderIndexSha256: hash(fs.readFileSync(paths[1])),
    polyfillsSha256: hash(fs.readFileSync(paths[2])),
    output: collection,
  };
}

function validateInputs(packageRoot, revision) {
  const configuration = revisionConfiguration(revision);
  assert.ok(!fs.lstatSync(packageRoot).isSymbolicLink(), 'Symlink package root rejected');
  const manifestPath = join(packageRoot, 'package.json');
  const manifest = readJson(manifestPath);
  assert.equal(manifest.name, packageName, 'Unexpected package name');
  assert.equal(manifest.version, configuration.version, 'Unexpected local candidate version');
  assert.equal(manifest.private, true, 'Reconstructed package must remain private');
  assert.equal(manifest.aibiz?.originalSourceRecovered, false,
    'Reconstructed package cannot claim original source recovery');
  assert.equal(manifest.aibiz?.originalLicenseAuthenticated, false,
    'Reconstructed package cannot claim authenticated licensing');
  assert.equal(manifest.aibiz?.nativeAccepted, false, 'Native acceptance is not a build assertion');
  assert.equal(manifest.aibiz?.acceptedForProduction, false, 'Production acceptance is not a build assertion');
  assert.equal(manifest.aibiz?.sourceKind, 'reconstructed-from-compiled-observation');
  if (revision === 'fixed') {
    assert.equal(manifest.aibiz?.baselineVersion, revisions.baseline.version,
      'Fixed revision must identify its preserved baseline');
    assert.deepEqual(manifest.aibiz?.intentionalDifferences, fixedIssueIds,
      'Fixed revision must retain its exact intentional-difference ledger');
  }
  assert.deepEqual(manifest.dependencies, dependencies, 'Declared dependencies must be pinned');
  assert.deepEqual(manifest.devDependencies, devDependencies, 'Declared tools must be pinned');
  assert.equal(manifest.scripts?.typecheck, 'tsc --noEmit', 'Unexpected typecheck command');
  assert.equal(manifest.scripts?.build, 'stencil build --ci --max-workers=2', 'Unexpected build command');
  for (const script of ['pretypecheck', 'posttypecheck', 'prebuild', 'postbuild']) {
    assert.equal(manifest.scripts[script], undefined, `Unexpected lifecycle hook: ${script}`);
  }
  const lock = readJson(join(packageRoot, 'package-lock.json'));
  assert.equal(lock.lockfileVersion, 3, 'Unsupported lockfile format');
  assert.equal(lock.name, packageName, 'Lockfile package identity changed');
  assert.equal(lock.version, manifest.version, 'Lockfile version changed');
  assert.equal(lock.packages?.['']?.version, manifest.version, 'Lockfile root version changed');
  assert.deepEqual(lock.packages?.['']?.dependencies, dependencies, 'Lockfile dependency drift');
  assert.deepEqual(lock.packages?.['']?.devDependencies, devDependencies, 'Lockfile tool drift');
  const installed = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    assert.ok(path.startsWith('node_modules/') && !path.includes('..'), 'Invalid lockfile package path');
    assert.ok(!entry.link, 'Linked lockfile dependencies rejected');
    const root = join(packageRoot, path);
    const actual = readJson(join(root, 'package.json'));
    assert.equal(actual.version, entry.version, `Installed dependency drift: ${path}`);
    installed.push({
      path, name: actual.name, version: actual.version, license: actual.license ?? null,
      packageSha256: hash(fs.readFileSync(join(root, 'package.json'))),
      lockIntegrity: entry.integrity ?? null,
      implementation: dependencyInventory(root),
    });
  }
  const files = inventory(packageRoot);
  assert.ok(files.entries.some(item => item.path.startsWith('src/')),
    'Editable source tree is empty');
  assert.ok(!files.entries.some(item => item.path.includes('plm-web/public/plugins')),
    'Observed compiled package must not be a source input');
  for (const item of files.entries) {
    assert.ok(!item.path.includes('node_modules/'), `Dependency tree leaked into inputs: ${item.path}`);
  }
  for (const name of [...sourceFiles, ...requiredSourceFiles]) {
    assert.ok(files.entries.some(item => item.path === name && item.bytes > 0),
      `Missing authored input: ${name}`);
  }
  return { manifest, files, installed };
}

function dependencyInventory(root) {
  const entries = walk(fs.realpathSync(root), undefined, [], false)
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: entries.length,
    bytes: entries.reduce((total, item) => total + item.bytes, 0),
    fingerprint: hash(JSON.stringify(entries)),
    entries,
  };
}

function verifyUnchangedInputs(packageRoot, buildRoot, inputs, revision) {
  assert.equal(fs.realpathSync(join(buildRoot, 'node_modules')),
    fs.realpathSync(join(packageRoot, 'node_modules')), 'Isolated dependency directory drift');
  assert.deepEqual(validateInputs(packageRoot, revision), inputs, 'Source input or dependency drift during build');
  assert.deepEqual(inventory(buildRoot), inputs.files, 'Isolated input drift during build');
}

function toolchain(packageRoot) {
  const tools = [
    ['typecheck', 'node_modules/typescript/bin/tsc', ['--noEmit']],
    ['build', 'node_modules/@stencil/core/bin/stencil', ['build', '--ci', '--max-workers=2']],
  ].map(([id, path, args]) => {
    const absolute = join(packageRoot, path);
    assert.ok(fs.statSync(absolute).isFile(), `Missing pinned tool: ${path}`);
    return { id, path, sha256: hash(fs.readFileSync(absolute)), args: [absolute, ...args] };
  });
  return { tools, ts: createRequire(join(packageRoot, 'package.json'))('typescript') };
}

function copyInputs(sourceRoot, destination, inputs) {
  fs.mkdirSync(destination);
  for (const item of inputs.entries) {
    const source = join(sourceRoot, item.path);
    const bytes = fs.readFileSync(source);
    assert.equal(hash(bytes), item.sha256, `Input changed during copy: ${item.path}`);
    const target = join(destination, item.path);
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  fs.symlinkSync(fs.realpathSync(join(sourceRoot, 'node_modules')), join(destination, 'node_modules'), 'dir');
}

export function runRuntimeModelSourceBuild({
  workspace = workspaceDefault,
  output,
  timeout = 600_000,
  revision = 'baseline',
} = {}) {
  workspace = resolve(workspace);
  const configuration = revisionConfiguration(revision);
  assert.ok(Number.isSafeInteger(timeout) && timeout > 0, 'Timeout must be a positive integer');
  const packageRoot = assertWorkspacePath(workspace, configuration.path);
  const artifactRoot = resolve(workspace, output ?? join(
    '.artifacts/runtime-model-source-build', `build-${randomUUID()}`));
  assert.equal(dirname(artifactRoot), join(workspace, '.artifacts/runtime-model-source-build'),
    'Output must be a direct runtime-model source-build artifact');
  fs.mkdirSync(dirname(artifactRoot), { recursive: true });
  fs.mkdirSync(artifactRoot, { recursive: false });
  const buildRoot = join(artifactRoot, 'package');
  const report = {
    schemaVersion: 1,
    contract: 'runtime-model-reconstructed-source-build',
    startedAt: new Date().toISOString(),
    workspace,
    packageRoot,
    buildRoot,
    artifactRoot,
    package: packageName,
    candidateVersion: configuration.version,
    candidateRevision: revision,
    originalObservation,
    status: 'failed',
    exitCode: 1,
    sourceBuildVerified: false,
    reproducibleBuildVerified: false,
    originalSourceRecovered: false,
    originalLicenseAuthenticated: false,
    nativeAccepted: false,
    acceptedForProduction: false,
    networkRequestsExecutedByHarness: false,
    arbitraryNpmScriptsExecuted: false,
    networkAccessPrevented: false,
    inputs: null,
    toolchain: null,
    commands: [],
    builds: [],
    outputs: null,
    errors: [],
    limitations: [
      'This is an independently versioned reconstruction from compiled observations, not authenticated upstream source.',
      'Open-source dependencies are installed and declared, not source-localized by this package.',
      'Dependency implementation files are shared with the workspace and rechecked; this is not OS or network isolation.',
      'Build success does not establish native editor, PLM or production acceptance.',
    ],
  };
  try {
    fs.mkdirSync(join(artifactRoot, 'home'), { recursive: true });
    fs.mkdirSync(join(artifactRoot, 'tmp'), { recursive: true });
    fs.mkdirSync(join(artifactRoot, 'cache'), { recursive: true });
    report.inputs = validateInputs(packageRoot, revision);
    copyInputs(packageRoot, buildRoot, report.inputs.files);
    verifyUnchangedInputs(packageRoot, buildRoot, report.inputs, revision);
    const { tools, ts } = toolchain(buildRoot);
    report.toolchain = tools.map(({ args, ...tool }) => tool);
    for (let build = 1; build <= 2; build += 1) {
      cleanGeneratedOutputs(buildRoot);
      const buildCommands = [];
      for (const { id, args } of tools) {
        const evidence = runCommand(buildRoot, artifactRoot, `${build}-${id}`, args, timeout);
        buildCommands.push(evidence);
        report.commands.push(evidence);
        assert.equal(evidence.exitCode, 0,
          `${id} failed (build ${build}); see ${evidence.log}`);
        assert.equal(evidence.signal, null, `${id} interrupted (build ${build})`);
        assert.equal(evidence.error, null, `${id} errored (build ${build})`);
        verifyUnchangedInputs(packageRoot, buildRoot, report.inputs, revision);
      }
      const loader = verifyLoader(buildRoot, ts, revision);
      const outputs = loader.output;
      report.builds.push({
        number: build,
        commands: buildCommands,
        loader: {
          requiredElements: loader.requiredElements,
          components: loader.components,
          loaderSha256: loader.loaderSha256,
          loaderIndexSha256: loader.loaderIndexSha256,
          polyfillsSha256: loader.polyfillsSha256,
        },
        outputs,
      });
      if (build === 1) report.outputs = outputs;
      else {
        assert.deepEqual(outputs, report.outputs, 'Second source build output differs');
        assert.deepEqual(loader, {
          ...report.builds[0].loader,
          output: report.outputs,
        }, 'Second source build loader differs');
      }
    }
    report.sourceBuildVerified = true;
    report.reproducibleBuildVerified = true;
    report.status = 'source-build-complete-not-accepted';
    report.exitCode = 2;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(join(artifactRoot, 'report.json'), jsonBytes(report));
    fs.writeFileSync(join(artifactRoot, 'report.sha256'),
      `${hash(fs.readFileSync(join(artifactRoot, 'report.json')))}\n`);
  }
  return {
    report,
    reportPath: join(artifactRoot, 'report.json'),
    exitCode: report.exitCode,
  };
}

export function verifyRuntimeModelSourceBuild({
  workspace = workspaceDefault,
  sourceReport,
} = {}) {
  workspace = resolve(workspace);
  const reportPath = resolve(workspace, sourceReport);
  assert.ok(isInside(join(workspace, '.artifacts/runtime-model-source-build'), reportPath),
    'Source report must be under runtime-model source-build artifacts');
  const artifactRoot = dirname(reportPath);
  const reportBytes = fs.readFileSync(reportPath);
  assert.equal(fs.readFileSync(join(artifactRoot, 'report.sha256'), 'utf8').trim(),
    hash(reportBytes), 'Source-build report hash mismatch');
  const report = JSON.parse(reportBytes);
  const revision = Object.keys(revisions).find(name =>
    revisions[name].version === report.candidateVersion);
  const configuration = revisionConfiguration(revision);
  if (report.candidateRevision !== undefined) {
    assert.equal(report.candidateRevision, revision, 'Report revision mismatch');
  }
  assert.equal(report.contract, 'runtime-model-reconstructed-source-build');
  assert.equal(report.status, 'source-build-complete-not-accepted');
  assert.equal(report.exitCode, 2);
  assert.equal(report.sourceBuildVerified, true);
  assert.equal(report.reproducibleBuildVerified, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.nativeAccepted, false);
  assert.equal(report.acceptedForProduction, false);
  assert.equal(report.originalSourceRecovered, false);
  assert.equal(report.originalLicenseAuthenticated, false);
  assert.equal(report.networkRequestsExecutedByHarness, false);
  assert.equal(report.arbitraryNpmScriptsExecuted, false);
  assert.equal(report.networkAccessPrevented, false);
  assert.equal(report.workspace, workspace, 'Report workspace mismatch');
  assert.equal(report.package, packageName, 'Report package identity mismatch');
  const packageRoot = assertWorkspacePath(workspace, configuration.path);
  assert.equal(report.packageRoot, packageRoot, 'Report package mismatch');
  const buildRoot = join(artifactRoot, 'package');
  assert.equal(report.buildRoot, buildRoot, 'Report build directory mismatch');
  assert.equal(fs.realpathSync(join(buildRoot, 'node_modules')),
    fs.realpathSync(join(packageRoot, 'node_modules')), 'Isolated dependency directory drift');
  assert.equal(report.builds.length, 2);
  assert.deepEqual(report.builds.map(build => build.number), [1, 2], 'Unexpected build sequence');
  assert.deepEqual(report.builds[0].outputs, report.builds[1].outputs);
  assert.deepEqual(report.builds[0].outputs, report.outputs, 'Double-build output evidence mismatch');
  assert.equal(report.builds[0].loader.loaderSha256, report.builds[1].loader.loaderSha256);
  assert.equal(report.builds[0].loader.loaderIndexSha256, report.builds[1].loader.loaderIndexSha256);
  assert.equal(report.builds[0].loader.polyfillsSha256, report.builds[1].loader.polyfillsSha256);
  const current = validateInputs(packageRoot, revision);
  assert.deepEqual(current, report.inputs, 'Source input or dependency drift detected');
  assert.deepEqual(inventory(buildRoot), report.inputs.files, 'Isolated input drift detected');
  const { tools, ts } = toolchain(buildRoot);
  assert.deepEqual(tools.map(({ args, ...tool }) => tool), report.toolchain, 'Pinned tool drift detected');
  assert.equal(report.commands.length, 4, 'Missing build commands');
  for (let build = 1; build <= 2; build += 1) {
    const expected = tools.map(tool => `${build}-${tool.id}`);
    const commands = report.commands.slice((build - 1) * 2, build * 2);
    assert.deepEqual(commands.map(command => command.id), expected, 'Unexpected build command order');
    assert.deepEqual(commands, report.builds[build - 1].commands, 'Build command evidence mismatch');
    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      assert.equal(command.executable, process.execPath, 'Unexpected build executable');
      assert.deepEqual(command.args, tools[index].args, 'Unexpected build arguments');
      assert.equal(command.cwd, buildRoot, 'Unexpected build working directory');
      assert.equal(command.exitCode, 0, 'Build command failed');
      assert.equal(command.signal, null, 'Build command interrupted');
      assert.equal(command.error, null, 'Build command errored');
      assert.equal(command.log, `logs/${command.id}.log`, 'Unexpected build log path');
      const bytes = fs.readFileSync(join(artifactRoot, command.log));
      assert.equal(bytes.length, command.logBytes, 'Build log size changed');
      assert.equal(hash(bytes), command.logSha256, 'Build log changed');
    }
  }
  const loader = verifyLoader(buildRoot, ts, revision);
  assert.deepEqual(loader.output, report.outputs, 'Build output drift detected');
  const { output: ignored, ...metadata } = loader;
  for (const build of report.builds) assert.deepEqual(metadata, build.loader, 'Loader evidence drift detected');
  return { report, reportPath, reportSha256: hash(reportBytes) };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      workspace: { type: 'string' },
      output: { type: 'string' },
      'verify-report': { type: 'string' },
      timeout: { type: 'string' },
      revision: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/harness-runtime-model-source-build.mjs [--revision baseline|fixed] [--output PATH] [--timeout MS]');
    console.log('Verify: --verify-report .artifacts/runtime-model-source-build/<run>/report.json');
    console.log('Isolated pinned-tool double build; exit 2 is source evidence, not native acceptance.');
    return;
  }
  const options = {
    workspace: values.workspace,
    output: values.output,
    timeout: values.timeout ? Number(values.timeout) : undefined,
    revision: values.revision,
  };
  if (values['verify-report']) {
    const result = verifyRuntimeModelSourceBuild({
      workspace: values.workspace,
      sourceReport: values['verify-report'],
    });
    console.log(JSON.stringify({
      status: 'verified-source-build-not-accepted',
      report: result.reportPath,
      reportSha256: result.reportSha256,
      nativeAccepted: false,
    }, null, 2));
    process.exitCode = 2;
    return;
  }
  const result = runRuntimeModelSourceBuild(options);
  console.log(JSON.stringify({
    status: result.report.status,
    report: result.reportPath,
    exitCode: result.exitCode,
    errors: result.report.errors,
    nativeAccepted: false,
  }, null, 2));
  process.exitCode = result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
