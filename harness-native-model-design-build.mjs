#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  fingerprint, optionalStat, PinnedDirectories, readPinnedFile, readTree,
} from './native-candidate-files.mjs';
import { verifyNativeModelDesignBuildInputs } from './prepare-native-model-design-inputs.mjs';
import {
  installedPackage, sourceFiles, verifyAiCodeSourceDepsHarness,
} from './harness-native-ai-code-source-deps.mjs';
import { verifyNativeCliSourceBuild } from './harness-native-cli-source-build.mjs';
import { verifyRuntimeModelSourceBuild } from './harness-runtime-model-source-build.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageName = '@ibiz-template-plugin/model-design';
export const REQUESTED_MODEL_DESIGN = `${packageName}@0.0.3-alpha.90`;
export const CANDIDATE_MODEL_DESIGN = `${packageName}@0.0.3-alpha.122`;
export const RUNTIME_MODEL_PATH =
  'plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/es/node_modules/.pnpm/' +
  '@ibiz-template-plugin_runtime-model@0.2.2_@stencil_store@2.0.16/node_modules/' +
  '@ibiz-template-plugin/runtime-model';
export const RUNTIME_MODEL_INVENTORY = Object.freeze({
  files: 7, bytes: 278671,
  fingerprint: 'b8e6ea99941967181c723b693d56f64a00db3777ffd2b521fa1692a00973eae3',
});
const acquisitionPath = '.artifacts/native-runtime-model-acquisition-20261006/evidence-index.json';
const acquisitionSha256 = 'f9a6e170e2013f9dcd08ac916812c6186863eb8702b322059f593331edf38588';
const modelRoot =
  'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const modelPins = {
  Central: '11cbdd30fc1e3fc7c067b1dabc363bccd2d977c8282895bcae1f0fe36885d564',
  ModelDesign: '8b8ae26b2dbf50e6f0a793a820b29aabcf57f50cc076e8d40e3071f1d4a389f5',
};
const sourceNames = ['src', 'public', 'package.json', 'tsconfig.json', 'ibiz.config.cjs', 'CHANGELOG.md'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = path => path.split(sep).join('/');
const entriesOnly = files => files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
const successful = command => command?.exitCode === 0 && command.signal === null && command.error === null;

function childPath(workspace, path) {
  assert.ok(typeof path === 'string' && path, 'Required workspace path missing');
  const absolute = resolve(workspace, path);
  const child = relative(workspace, absolute);
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child),
    'Path must be a child of the workspace');
  return absolute;
}

function pinnedRead(path) {
  const directories = new PinnedDirectories();
  try {
    return readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  } finally { directories.close(); }
}

export function loadModelDesignRuntimeEvidence({ workspace = workspaceDefault, sourceReport } = {}) {
  workspace = resolve(workspace);
  if (sourceReport !== undefined) {
    const reportPath = childPath(workspace, sourceReport);
    assert.equal(basename(reportPath), 'report.json', 'Expected a runtime source-build report.json');
    const bytes = pinnedRead(reportPath);
    const verified = verifyRuntimeModelSourceBuild({ workspace, sourceReport: reportPath });
    const { report } = verified;
    assert.equal(verified.reportSha256, hash(bytes), 'Runtime report changed while reading');
    assert.equal(report.package, '@ibiz-template-plugin/runtime-model');
    assert.equal(report.candidateVersion, '0.2.2-local.1');
    assert.equal(report.inputs.manifest.aibiz.sourceKind, 'reconstructed-from-compiled-observation');
    for (const output of ['dist', 'loader']) {
      readTree(join(report.buildRoot, output), { jsonOnly: false });
    }
    assert.deepEqual(pinnedRead(join(report.buildRoot, 'package.json')),
      pinnedRead(join(report.packageRoot, 'package.json')), 'Built runtime manifest drift');
    assert.deepEqual(pinnedRead(reportPath), bytes, 'Runtime report changed during verification');
    return {
      requested: '@ibiz-template-plugin/runtime-model@0.2.2',
      candidate: '@ibiz-template-plugin/runtime-model@0.2.2-local.1',
      sourceKind: 'reconstructed',
      sourceRecovered: false, sourceBuildInputsComplete: true, sourceBuildExecuted: true,
      sourceBuildVerified: true, reproducibleBuildVerified: true,
      manifestRecovered: false, packageLicenseAuthenticated: false,
      nativeAccepted: false, acceptedForProduction: false,
      sourceBuildEvidence: {
        reportPath: verified.reportPath, reportSha256: verified.reportSha256,
        buildRoot: report.buildRoot, sourceFingerprint: report.inputs.files.fingerprint,
        outputFingerprint: report.outputs.fingerprint,
      },
      missingInputs: [],
    };
  }
  const bytes = pinnedRead(join(workspace, acquisitionPath));
  assert.equal(hash(bytes), acquisitionSha256, 'Runtime acquisition evidence changed');
  const index = JSON.parse(bytes);
  assert.equal(index.requestedPackage, '@ibiz-template-plugin/runtime-model@0.2.2');
  assert.equal(index.sourceAcquired, false);
  assert.equal(index.authenticPackageArchiveAcquired, false);
  for (const observation of index.observations) {
    const body = childPath(dirname(join(workspace, acquisitionPath)), observation.responseFile);
    const contents = pinnedRead(body);
    assert.equal(contents.length, observation.body.bytes, 'Acquisition body size changed');
    assert.equal(hash(contents), observation.body.sha256, 'Acquisition body changed');
    const headers = pinnedRead(join(dirname(body), 'headers.txt'));
    assert.equal(headers.length, observation.headers.bytes, 'Acquisition headers size changed');
    assert.equal(hash(headers), observation.headers.sha256, 'Acquisition headers changed');
  }
  const compiled = readTree(join(workspace, RUNTIME_MODEL_PATH), { jsonOnly: false });
  assert.deepEqual({
    files: compiled.files, bytes: compiled.bytes, fingerprint: compiled.fingerprint,
  }, RUNTIME_MODEL_INVENTORY, 'Compiled runtime observation changed');
  assert.ok(compiled.entries.every(file => file.path.endsWith('.mjs')),
    'Unexpected compiled runtime input');
  return {
    requested: index.requestedPackage,
    sourceRecovered: false, sourceBuildInputsComplete: false, sourceBuildExecuted: false,
    manifestRecovered: false, packageLicenseAuthenticated: false,
    evidence: { path: acquisitionPath, sha256: acquisitionSha256, requests: index.observations.length },
    compiledObservation: {
      path: RUNTIME_MODEL_PATH, ...fingerprint(compiled.entries), entries: compiled.entries,
      role: 'compiled-observation-only-not-build-input',
    },
    missingInputs: ['original-package.json', 'src', 'stencil.config', 'tsconfig.json',
      'dependency-lock-and-provenance', 'package-license'],
  };
}

export function inspectModelDesignSource(ts, files) {
  const registrations = [];
  const imports = [];
  const serviceCalls = [];
  const globals = new Set();
  for (const file of files.filter(item => /\.(?:ts|tsx)$/.test(item.path))) {
    const ast = ts.createSourceFile(file.path, file.data.toString('utf8'),
      ts.ScriptTarget.Latest, true, file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const registerNames = new Set();
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const module = statement.moduleSpecifier.text;
      if (module.startsWith('.')) continue;
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const names = bindings && ts.isNamedImports(bindings)
        ? bindings.elements.map(item => ({
          exported: (item.propertyName ?? item.name).text, local: item.name.text,
          typeOnly: clause.isTypeOnly || item.isTypeOnly,
        })) : [];
      imports.push({ path: file.path, module, names,
        defaultImport: clause?.name?.text ?? null, typeOnly: clause?.isTypeOnly ?? false });
      if (module === '@ibiz-template/runtime') {
        for (const name of names) {
          if (name.exported === 'registerUIActionProvider') registerNames.add(name.local);
        }
      }
    }
    function visit(node) {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && registerNames.has(node.expression.text)) {
          assert.ok(node.arguments[0] && ts.isStringLiteral(node.arguments[0]),
            'Nonliteral UIAction registration cannot be audited');
          registrations.push({ path: file.path, key: node.arguments[0].text });
        }
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'exec') {
          const action = node.arguments.find(item => ts.isStringLiteral(item));
          serviceCalls.push({ path: file.path, line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            expression: node.expression.getText(ast), action: action?.text ?? null,
            firstArgumentLiteral: !!node.arguments[0] && ts.isStringLiteral(node.arguments[0]) });
        }
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
          node.expression.text === 'ibiz') globals.add(node.name.text);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  const keys = registrations.map(item => item.key).sort();
  assert.equal(new Set(keys).size, keys.length, 'Duplicate UIAction registrations');
  return { registrations, keys, imports, serviceCalls, ibizGlobals: [...globals].sort() };
}

export function compareModelDesignRegistrations(models, keys) {
  const apps = models.map(({ app, model, ...evidence }) => {
    const refs = (model.getAllPSAppPFPluginRefs ?? []).filter(ref =>
      ref.rTObjectRepo === REQUESTED_MODEL_DESIGN);
    assert.ok(refs.length, `No alpha.90 model-design references in ${app}`);
    const references = refs.map(ref => ({
      pluginType: ref.pluginType, pluginCode: ref.pluginCode, rTObjectName: ref.rTObjectName,
      refMode: ref.refMode, key: `${ref.pluginType}_${ref.pluginCode}`,
    }));
    assert.ok(references.every(ref => ref.pluginType === 'DEUIACTION' &&
      ref.refMode === 'UIACTION' && ref.rTObjectName === ref.pluginCode),
    'Unexpected alpha.90 registration contract');
    return { app, ...evidence, references,
      missing: references.map(ref => ref.key).filter(key => !keys.includes(key)) };
  });
  const requestedKeys = [...new Set(apps.flatMap(app => app.references.map(ref => ref.key)))].sort();
  return {
    requested: REQUESTED_MODEL_DESIGN, candidate: CANDIDATE_MODEL_DESIGN,
    apps, requestedKeys, candidateKeys: keys, extra: keys.filter(key => !requestedKeys.includes(key)),
    registrationNamesCovered: apps.every(app => app.missing.length === 0),
    strictCompatibilityVerified: false, exactVersionReproductionVerified: false,
    compatibility: 'registration-names-only-not-accepted',
  };
}

function readModels(workspace) {
  return Object.entries(modelPins).map(([app, sha256]) => {
    const path = `${modelRoot}/PSSYSAPPS/${app}/PSSYSAPP.json`;
    const bytes = pinnedRead(join(workspace, path));
    assert.equal(hash(bytes), sha256, `Original ${app} model changed`);
    return { app, path, bytes: bytes.length, sha256, model: JSON.parse(bytes) };
  });
}

function modelActionEvidence(workspace, models, source) {
  const actions = [...new Set(source.serviceCalls.filter(call => call.firstArgumentLiteral)
    .map(call => call.action))].sort();
  const apps = models.map(({ app, model }) => {
    const entities = model.getAllPSAppDataEntities.map(ref => {
      const path = childPath(join(workspace, modelRoot), ref.path);
      const bytes = pinnedRead(path);
      const entity = JSON.parse(bytes);
      const declaredActions = [...new Set([
        ...(entity.getAllPSAppDEMethods ?? []), ...(entity.getAllPSAppDEActions ?? []),
      ].flatMap(item => [item.name, item.codeName]).filter(Boolean).map(name => name.toLowerCase()))];
      return { name: ref.name, path: slash(relative(workspace, path)),
        sha256: hash(bytes), matchingActions: actions.filter(action =>
          declaredActions.includes(action.toLowerCase())) };
    });
    return { app, entities, actions: actions.map(action => ({
      action, matchingEntities: entities.filter(entity => entity.matchingActions.includes(action))
        .map(entity => entity.name),
    })) };
  });
  return { status: 'static-declared-actions-only-not-endpoint-validation', actions, apps };
}

function packageIdentity(pkg) {
  return { name: pkg.name, version: pkg.version, path: pkg.realpath,
    manifestSha256: hash(pinnedRead(join(pkg.realpath, 'package.json'))) };
}

export function selectModelDesignThirdParty(owners, name, range, semver) {
  for (const owner of owners) {
    for (const location of [owner, join(owner, 'node_modules/.pnpm/node_modules/_build_lookup')]) {
      const pkg = installedPackage(location, name, { optional: true });
      if (pkg && (!range || semver.satisfies(pkg.version, range))) return pkg;
    }
  }
  return null;
}

function dependenciesFor(workspace, manifest, deps, cli, runtime) {
  const local = new Map(deps.report.sources.filter(pkg => pkg.id !== 'ai-code' && pkg.id !== 'hub-config')
    .map(pkg => [pkg.name, pkg]));
  const owners = [
    deps.report.sources.find(pkg => pkg.id === 'ai-code').original,
    join(workspace, 'modelingweb/app'), join(workspace, 'ibiz-app-hub'),
  ];
  const appFirst = [owners[1], owners[0], owners[2]];
  const semverPackage = selectModelDesignThirdParty(appFirst, 'semver', null, null);
  assert.ok(semverPackage, 'Installed semver parser required for third-party dependency selection');
  const semver = createRequire(join(semverPackage.realpath, 'package.json'))(semverPackage.realpath);
  const links = [];
  const missing = [];
  const supplementalInputs = [{
    name: '@types/qs', reason: 'source-imports-qs-but-manifest-omits-qs-types',
    declared: null,
  }];
  const names = new Set([
    ...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies),
    ...Object.keys(manifest.peerDependencies), ...supplementalInputs.map(input => input.name),
  ]);
  for (const name of names) {
    const declared = manifest.dependencies[name] ?? manifest.devDependencies[name] ??
      manifest.peerDependencies[name];
    if (name === '@ibiz-template-plugin/runtime-model') {
      if (runtime?.sourceKind === 'reconstructed' && runtime.sourceBuildVerified) {
        const evidence = runtime.sourceBuildEvidence;
        links.push({
          name, declared, version: '0.2.2-local.1', target: evidence.buildRoot,
          role: 'verified-reconstructed-local-source-build', sourceKind: 'reconstructed',
          sourceReport: evidence.reportPath, sourceReportSha256: evidence.reportSha256,
          sourceFingerprint: evidence.sourceFingerprint, outputFingerprint: evidence.outputFingerprint,
          exactDeclaredVersion: false, originalSourceRecovered: false, nativeAccepted: false,
        });
      } else {
        missing.push({ name, declared, reason: 'authentic-source-and-package-build-inputs-missing' });
      }
      continue;
    }
    if (name === '@ibiz-template/cli') {
      assert.equal(declared, cli.version);
      links.push({ name, declared, version: cli.version, target: cli.cli.path,
        role: 'verified-source-built-cli', sourceReportSha256: cli.reportSha256 });
    } else if (local.has(name)) {
      const pkg = local.get(name);
      links.push({ name, declared, version: pkg.version, target: pkg.staged,
        role: name === '@ibiz-template/theme' ? 'verified-source-scss-input' : 'verified-source-built-framework',
        sourceFingerprint: pkg.fingerprint, sourceReportSha256: deps.reportSha256,
        exactDeclaredVersion: declared === pkg.version });
    } else {
      assert.ok(!name.startsWith('@ibiz'), `Published own dependency fallback forbidden: ${name}`);
      const search = ['typescript', 'vue-tsc', 'monaco-editor', '@monaco-editor/loader'].includes(name)
        ? owners : appFirst;
      const pkg = selectModelDesignThirdParty(search, name, declared, semver);
      if (!pkg) missing.push({ name, declared, reason: 'installed-third-party-unavailable' });
      else links.push({ ...packageIdentity(pkg), declared: declared ?? null, target: pkg.realpath,
        declaredRangeSatisfied: declared ? semver.satisfies(pkg.version, declared) : null,
        role: 'installed-open-source-third-party-not-source-built' });
    }
  }
  return { links, missing, supplementalInputs, rangeParser: packageIdentity(semverPackage),
    isolatedLockfile: null, installsExecuted: false,
    runtimeSourceClosureComplete: runtime?.sourceKind === 'reconstructed' && runtime.sourceBuildVerified === true };
}

function assertLinks(packageRoot, dependencies) {
  for (const link of dependencies.links) {
    const path = join(packageRoot, 'node_modules', link.name);
    assert.ok(fs.lstatSync(path).isSymbolicLink(), `Dependency is not a deliberate link: ${link.name}`);
    assert.equal(fs.realpathSync(path), fs.realpathSync(link.target), `Dependency link changed: ${link.name}`);
    const manifest = JSON.parse(pinnedRead(join(link.target, 'package.json')));
    assert.equal(manifest.name, link.name);
    assert.equal(manifest.version, link.version);
  }
  if (!dependencies.links.some(link => link.name === '@ibiz-template-plugin/runtime-model')) {
    assert.ok(!optionalStat(join(packageRoot, 'node_modules/@ibiz-template-plugin/runtime-model')),
      'Compiled runtime or fabricated package must not enter source build');
  }
}

function outputsAt(packageRoot) {
  const entries = [];
  for (const name of ['dist', 'es', 'lib']) {
    if (!optionalStat(join(packageRoot, name))) continue;
    const tree = readTree(join(packageRoot, name), { jsonOnly: false });
    entries.push(...tree.entries.map(file => ({ ...file, path: `${name}/${file.path}` })));
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, ...fingerprint(entries) };
}

function inspectBuildOutputs(ts, outputs, packageRoot, source, resourceFingerprint, runtime) {
  const resourceCopies = ['dist', 'es', 'lib'].map(output => {
    const path = `${output}/assets/json/runtime-model`;
    const files = outputs.entries.filter(entry => entry.path.startsWith(`${path}/`))
      .map(entry => ({ ...entry, path: entry.path.slice(path.length + 1) }));
    return { output, path, ...fingerprint(files),
      verified: fingerprint(files).fingerprint === resourceFingerprint };
  });
  const systemEntry = join(packageRoot, 'dist/index.system.min.js');
  let systemImports = [];
  if (optionalStat(systemEntry)) {
    const ast = ts.createSourceFile(systemEntry, pinnedRead(systemEntry).toString(),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(ast) === 'System' && node.expression.name.text === 'register') {
        const array = node.arguments.find(item => ts.isArrayLiteralExpression(item));
        systemImports = array?.elements.filter(item => ts.isStringLiteral(item)).map(item => item.text) ?? [];
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  const builtUiAction = join(packageRoot, 'es/ui-action/index.mjs');
  const builtKeys = optionalStat(builtUiAction) ? inspectModelDesignSource(ts, [{
    path: 'es/ui-action/index.ts', data: pinnedRead(builtUiAction),
  }]).keys : [];
  return {
    resourceCopies,
    artifacts: {
      systemEntryProduced: optionalStat(systemEntry)?.isFile() ?? false,
      systemImports, builtUiActionKeys: builtKeys,
      builtUiActionKeysMatchSource: JSON.stringify(builtKeys) === JSON.stringify(source.keys),
      runtimeLoaderImport: '@ibiz-template-plugin/runtime-model/loader',
      runtimeLoaderExternalized: systemImports.includes('@ibiz-template-plugin/runtime-model/loader'),
      runtimeLoaderDelivered: false,
      monacoRuntimeAssetPath: 'monaco-editor@0.52.2/min/vs',
      browserExecuted: false,
      browserPrecheck: runtime?.sourceBuildVerified
        ? 'static-source-built-runtime-loader-pending-browser-no-save-reload-claim'
        : 'static-blocked-no-source-built-runtime-loader-no-save-reload-claim',
    },
  };
}

export function summarizeModelDesignDiagnostics(log) {
  const errors = [...log.matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm)]
    .map(([, path, line, column, code, message]) =>
      ({ path, line: Number(line), column: Number(column), code, message }));
  return { errors, count: errors.length, codes: Object.fromEntries([...new Set(errors.map(error => error.code))]
    .sort().map(code => [code, errors.filter(error => error.code === code).length])) };
}

export function modelDesignBuildVerdict({ commands, mapping, runtime, resourceCopies, artifacts }) {
  const bundle = commands.find(command => command.id === 'bundle');
  const declarations = commands.find(command => command.id === 'declarations');
  const typecheck = commands.find(command => command.id === 'typecheck');
  const fullDeclaredBuildSucceeded = successful(bundle) && successful(declarations) &&
    declarations.role === 'declared-build-second-step';
  const resourcesComplete = Array.isArray(resourceCopies) &&
    resourceCopies.length === 3 &&
    JSON.stringify(resourceCopies.map(copy => copy?.output).sort()) ===
      JSON.stringify(['dist', 'es', 'lib']) &&
    resourceCopies.every(copy => copy.verified === true);
  const blockers = [
    ...(!runtime.sourceBuildInputsComplete ? ['runtime-model-0.2.2-authentic-source-inputs-missing'] : []),
    ...(runtime.sourceKind === 'reconstructed' &&
      (!runtime.sourceBuildVerified || !runtime.reproducibleBuildVerified)
      ? ['runtime-model-reconstructed-source-build-unverified'] : []),
    ...(!successful(typecheck) ? ['plugin-typecheck-failed'] : []),
    ...(!fullDeclaredBuildSucceeded ? ['full-declared-build-failed'] : []),
    ...(!mapping.registrationNamesCovered ? ['alpha90-registration-coverage-failed'] : []),
    ...(!resourcesComplete ? ['built-resource-copy-incomplete'] : []),
    ...(!artifacts.runtimeLoaderDelivered ? ['runtime-model-loader-not-delivered'] : []),
    'isolated-dependency-lock-not-reproduced',
    'alpha90-original-api-behavior-not-verified',
    'browser-editor-save-reload-not-verified',
  ];
  return {
    status: 'model-design-build-probe-not-accepted', exitCode: 2,
    fullDeclaredBuildSucceeded, typecheckSucceeded: successful(typecheck),
    runtimeModelSourceRecovered: runtime.sourceRecovered,
    strictCompatibilityVerified: false, exactVersionReproductionVerified: false,
    nativeAccepted: false, acceptedForProduction: false, fullLocalization: false, blockers,
  };
}

export function runNativeModelDesignBuild(options = {}) {
  const workspace = resolve(options.workspace ?? workspaceDefault);
  const root = join(workspace, '.artifacts/native-model-design-build');
  const destination = resolve(workspace, options.output ?? join(root, `build-${randomUUID()}`));
  assert.equal(dirname(destination), root, 'Output must be a direct child of .artifacts/native-model-design-build');
  assert.match(basename(destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Invalid output directory name');
  assert.ok(!optionalStat(destination), 'Existing destination must not be overwritten');
  const inputOptions = { workspace, receipt: options.inputReceipt, repairReceipt: options.repairReceipt };
  const inputs = verifyNativeModelDesignBuildInputs(inputOptions);
  const deps = verifyAiCodeSourceDepsHarness({ workspace, sourceReport: options.dependencyReport });
  assert.equal(deps.dependencySourceBuildsVerified, true);
  const cliRef = deps.report.cliSourceReports.find(item => item.version === '0.3.30');
  assert.ok(cliRef, 'Verified source CLI 0.3.30 report missing');
  const cli = verifyNativeCliSourceBuild({ workspace, sourceReport: cliRef.reportPath });
  assert.equal(cli.cliSourceBuildVerified, true);
  const runtimeOptions = { workspace, sourceReport: options.runtimeSourceReport };
  const runtime = loadModelDesignRuntimeEvidence(runtimeOptions);
  const files = readTree(childPath(workspace, inputs.package.path), { jsonOnly: false });
  assert.deepEqual(files.entries, inputs.package.entries);
  const manifest = JSON.parse(files.contents.find(file => file.path === 'package.json').data);
  assert.equal(manifest.scripts.typecheck, 'vue-tsc --noEmit', 'Unexpected declared typecheck');
  assert.equal(manifest.scripts.build, 'ibiz-temp build -c && vue-tsc --declaration --emitDeclarationOnly',
    'Unexpected declared build');
  const dependencies = dependenciesFor(workspace, manifest, deps, cli, runtime);
  const tsLink = dependencies.links.find(item => item.name === 'typescript');
  const vueTscLink = dependencies.links.find(item => item.name === 'vue-tsc');
  assert.ok(tsLink && vueTscLink, 'Real compiler tools unavailable');
  const ts = createRequire(join(tsLink.target, 'package.json'))(tsLink.target);
  const source = inspectModelDesignSource(ts, files.contents.filter(file => file.path.startsWith('src/')));
  const models = readModels(workspace);
  const mapping = compareModelDesignRegistrations(models, source.keys);
  const apiActions = modelActionEvidence(workspace, models, source);
  const packageRoot = join(destination, 'package');
  const report = {
    schemaVersion: 1, contract: 'native-model-design-isolated-source-build-probe',
    generatedAt: new Date().toISOString(), workspace, destination, packageRoot,
    node: { executable: process.execPath, version: process.version },
    inputReceipt: {
      path: options.inputReceipt, sha256: hash(pinnedRead(childPath(workspace, options.inputReceipt))),
      repairReceipt: options.repairReceipt,
      repairReceiptSha256: hash(pinnedRead(childPath(workspace, options.repairReceipt))),
    },
    source: inputs.source, resources: inputs.resources, inputInventory: inputs.package,
    frameworkEvidence: { reportPath: deps.reportPath, sha256: deps.reportSha256, sourceBuildsVerified: true },
    cliEvidence: { reportPath: cli.reportPath, sha256: cli.reportSha256,
      version: cli.version, sourceBuildVerified: true },
    mapping, runtime, sourceSurface: source, apiActions, dependencies,
    declaredCommands: manifest.scripts, commands: [],
    networkRequestsExecutedByHarness: false, arbitraryNpmScriptsExecuted: false,
  };
  const directories = new PinnedDirectories();
  try {
    const run = directories.open(destination, { create: true, exclusive: true });
    for (const file of files.contents) {
      const path = join(packageRoot, file.path);
      directories.write(directories.open(dirname(path), { create: true }), basename(path), file.data);
    }
    for (const link of dependencies.links) {
      const path = join(packageRoot, 'node_modules', link.name);
      const directory = directories.open(dirname(path), { create: true });
      fs.symlinkSync(link.target, directories.entry(directory, basename(path)), 'dir');
      directories.verify(directory);
    }
    const recheck = () => {
      assert.deepEqual(entriesOnly(sourceFiles(packageRoot, { names: sourceNames })), files.entries,
        'Isolated source/config/resource input drift');
      assertLinks(packageRoot, dependencies);
      directories.verify(run);
    };
    recheck();
    const vueTscManifest = JSON.parse(pinnedRead(join(vueTscLink.target, 'package.json')));
    const vueTsc = join(vueTscLink.target, typeof vueTscManifest.bin === 'string'
      ? vueTscManifest.bin : vueTscManifest.bin['vue-tsc']);
    function command(id, entry, args, role) {
      recheck();
      const entrySha256 = hash(pinnedRead(entry));
      const startedAt = new Date().toISOString();
      const result = spawnSync(process.execPath, [entry, ...args], {
        cwd: packageRoot, encoding: 'utf8', timeout: options.timeout ?? 180000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, NODE_PATH: '', CI: 'true', NO_COLOR: '1',
          npm_config_ignore_scripts: 'true', npm_config_offline: 'true' },
      });
      const log = Buffer.from(`${result.stdout ?? ''}${result.stderr ?? ''}`);
      directories.write(directories.open(join(destination, 'logs'), { create: true }), `${id}.log`, log);
      const recorded = {
        id, role, executable: process.execPath, entry, entrySha256, args, cwd: packageRoot,
        startedAt, finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal,
        error: result.error?.message ?? null,
        log: `logs/${id}.log`, logBytes: log.length, logSha256: hash(log),
      };
      report.commands.push(recorded);
      assert.equal(hash(pinnedRead(entry)), entrySha256, 'Compiler entry drift');
      recheck();
      return recorded;
    }
    command('typecheck', vueTsc, ['--noEmit'], 'declared-typecheck');
    const bundled = command('bundle', cli.cli.bin, ['build', '-c'], 'declared-build-first-step');
    command('declarations', vueTsc, ['--declaration', '--emitDeclarationOnly'],
      successful(bundled) ? 'declared-build-second-step' : 'diagnostic-only-after-failed-first-step');
    report.outputs = outputsAt(packageRoot);
    Object.assign(report, inspectBuildOutputs(ts, report.outputs, packageRoot, source,
      inputs.resources.outputFingerprint, runtime));
    report.typecheckDiagnostics = summarizeModelDesignDiagnostics(
      pinnedRead(join(destination, 'logs/typecheck.log')).toString());
    Object.assign(report, modelDesignBuildVerdict(report));
    report.sourceDrift = 'unchanged';
    verifyNativeModelDesignBuildInputs(inputOptions);
    assert.equal(verifyAiCodeSourceDepsHarness({
      workspace, sourceReport: options.dependencyReport,
    }).reportSha256, deps.reportSha256, 'Framework source evidence drift');
    assert.deepEqual(loadModelDesignRuntimeEvidence(runtimeOptions), runtime, 'Runtime evidence drift');
    recheck();
    const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    directories.write(run, 'report.json', bytes);
    directories.write(run, 'report.sha256', Buffer.from(`${hash(bytes)}\n`));
    assert.deepEqual(readPinnedFile(directories, run, 'report.json').data, bytes);
    recheck();
    return { report, reportPath: join(destination, 'report.json'), reportSha256: hash(bytes) };
  } finally { directories.close(); }
}

export function verifyNativeModelDesignBuildReport(options = {}) {
  const workspace = resolve(options.workspace ?? workspaceDefault);
  const reportPath = childPath(workspace, options.sourceReport);
  assert.equal(basename(reportPath), 'report.json', 'Expected a build report.json');
  const destination = dirname(reportPath);
  assert.equal(dirname(destination), join(workspace, '.artifacts/native-model-design-build'),
    'Report must belong to an isolated model-design build');
  const bytes = pinnedRead(reportPath);
  const reportSha256 = hash(bytes);
  assert.equal(pinnedRead(join(destination, 'report.sha256')).toString().trim(),
    reportSha256, 'Build report hash changed');
  const report = JSON.parse(bytes);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.contract, 'native-model-design-isolated-source-build-probe');
  assert.equal(report.workspace, workspace);
  assert.equal(report.destination, destination);
  const packageRoot = join(destination, 'package');
  assert.equal(report.packageRoot, packageRoot);
  assert.deepEqual(report.node, { executable: process.execPath, version: process.version });
  const inputs = verifyNativeModelDesignBuildInputs({
    workspace, receipt: report.inputReceipt.path, repairReceipt: report.inputReceipt.repairReceipt,
  });
  assert.equal(hash(pinnedRead(childPath(workspace, report.inputReceipt.path))), report.inputReceipt.sha256);
  assert.equal(hash(pinnedRead(childPath(workspace, report.inputReceipt.repairReceipt))),
    report.inputReceipt.repairReceiptSha256);
  assert.deepEqual(report.source, inputs.source);
  assert.deepEqual(report.resources, inputs.resources);
  assert.deepEqual(report.inputInventory, inputs.package);
  const deps = verifyAiCodeSourceDepsHarness({ workspace, sourceReport: report.frameworkEvidence.reportPath });
  assert.deepEqual(report.frameworkEvidence, {
    reportPath: deps.reportPath, sha256: deps.reportSha256, sourceBuildsVerified: true,
  });
  const cli = verifyNativeCliSourceBuild({ workspace, sourceReport: report.cliEvidence.reportPath });
  assert.equal(cli.version, '0.3.30');
  assert.deepEqual(report.cliEvidence, {
    reportPath: cli.reportPath, sha256: cli.reportSha256, version: cli.version, sourceBuildVerified: true,
  });
  const files = sourceFiles(packageRoot, { names: sourceNames });
  assert.deepEqual(entriesOnly(files), inputs.package.entries, 'Built candidate input drift');
  const manifest = JSON.parse(files.find(file => file.path === 'package.json').data);
  const runtime = loadModelDesignRuntimeEvidence({
    workspace, sourceReport: report.runtime.sourceBuildEvidence?.reportPath,
  });
  assert.deepEqual(report.runtime, runtime, 'Runtime source-build evidence changed');
  const dependencies = dependenciesFor(workspace, manifest, deps, cli, runtime);
  assert.deepEqual(report.dependencies, dependencies, 'Dependency resolution changed');
  assertLinks(packageRoot, dependencies);
  const tsLink = dependencies.links.find(item => item.name === 'typescript');
  const ts = createRequire(join(tsLink.target, 'package.json'))(tsLink.target);
  const source = inspectModelDesignSource(ts, files.filter(file => file.path.startsWith('src/')));
  assert.deepEqual(report.sourceSurface, source);
  const models = readModels(workspace);
  assert.deepEqual(report.mapping, compareModelDesignRegistrations(models, source.keys));
  assert.deepEqual(report.apiActions, modelActionEvidence(workspace, models, source));
  assert.deepEqual(report.declaredCommands, manifest.scripts);
  const vueTscLink = dependencies.links.find(item => item.name === 'vue-tsc');
  const vueTscManifest = JSON.parse(pinnedRead(join(vueTscLink.target, 'package.json')));
  const vueTsc = join(vueTscLink.target, typeof vueTscManifest.bin === 'string'
    ? vueTscManifest.bin : vueTscManifest.bin['vue-tsc']);
  const plans = [
    { id: 'typecheck', entry: vueTsc, args: ['--noEmit'], role: 'declared-typecheck' },
    { id: 'bundle', entry: cli.cli.bin, args: ['build', '-c'], role: 'declared-build-first-step' },
    { id: 'declarations', entry: vueTsc, args: ['--declaration', '--emitDeclarationOnly'],
      role: successful(report.commands[1]) ? 'declared-build-second-step' : 'diagnostic-only-after-failed-first-step' },
  ];
  assert.equal(report.commands.length, plans.length, 'Build command steps missing');
  for (const [index, plan] of plans.entries()) {
    const command = report.commands[index];
    for (const key of Object.keys(plan)) assert.deepEqual(command[key], plan[key], 'Build command drift');
    assert.equal(command.executable, process.execPath);
    assert.equal(command.cwd, packageRoot);
    assert.equal(command.entrySha256, hash(pinnedRead(command.entry)));
    assert.equal(command.log, `logs/${command.id}.log`);
    const log = pinnedRead(join(destination, command.log));
    assert.equal(command.logBytes, log.length, 'Build log size changed');
    assert.equal(command.logSha256, hash(log), 'Build log changed');
    assert.ok(command.exitCode === null || Number.isInteger(command.exitCode), 'Invalid command exit code');
    assert.ok(command.signal === null || typeof command.signal === 'string');
    assert.ok(command.error === null || typeof command.error === 'string');
  }
  const outputs = outputsAt(packageRoot);
  assert.deepEqual(report.outputs, outputs, 'Build output drift');
  const inspected = inspectBuildOutputs(ts, outputs, packageRoot, source, inputs.resources.outputFingerprint, runtime);
  assert.deepEqual(report.resourceCopies, inspected.resourceCopies);
  assert.deepEqual(report.artifacts, inspected.artifacts);
  assert.deepEqual(report.typecheckDiagnostics, summarizeModelDesignDiagnostics(
    pinnedRead(join(destination, 'logs/typecheck.log')).toString()));
  for (const [key, value] of Object.entries(modelDesignBuildVerdict(report))) {
    assert.deepEqual(report[key], value, `Unjustified build or compatibility claim: ${key}`);
  }
  assert.equal(report.sourceDrift, 'unchanged');
  assert.equal(report.networkRequestsExecutedByHarness, false);
  assert.equal(report.arbitraryNpmScriptsExecuted, false);
  assert.deepEqual(pinnedRead(reportPath), bytes, 'Build report changed during verification');
  assert.deepEqual(entriesOnly(sourceFiles(packageRoot, { names: sourceNames })), inputs.package.entries);
  return { report, reportPath, reportSha256, evidenceIntegrityVerified: true };
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args, options: {
      'input-receipt': { type: 'string' }, 'repair-receipt': { type: 'string' },
      'runtime-source-report': { type: 'string' },
      'dependency-report': { type: 'string' }, output: { type: 'string' },
      'verify-report': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/harness-native-model-design-build.mjs --input-receipt PATH --repair-receipt PATH --dependency-report PATH [--runtime-source-report PATH] [--output PATH]');
    console.log('Fresh isolated build only; no installs, fabricated runtime package, deployment or native acceptance.');
    console.log('Optional runtime input is verified reconstructed source-built 0.2.2-local.1, never recovered originals.');
    console.log('Partial candidates/logs are retained. Exit 2 is an unaccepted probe, not build PASS.');
    console.log('Read-only verification: --verify-report PATH (no other options).');
    return 0;
  }
  assert.ok(!values['verify-report'] || Object.keys(values).length === 1,
    '--verify-report cannot be combined with build options');
  const result = values['verify-report'] ? verifyNativeModelDesignBuildReport({
    sourceReport: values['verify-report'],
  }) : runNativeModelDesignBuild({
    inputReceipt: values['input-receipt'], repairReceipt: values['repair-receipt'],
    runtimeSourceReport: values['runtime-source-report'],
    dependencyReport: values['dependency-report'], output: values.output,
  });
  console.log(JSON.stringify({
    reportPath: result.reportPath, reportSha256: result.reportSha256,
    status: result.report.status, fullDeclaredBuildSucceeded: result.report.fullDeclaredBuildSucceeded,
    typecheckSucceeded: result.report.typecheckSucceeded, mapping: {
      requested: result.report.mapping.requested, candidate: result.report.mapping.candidate,
      registrationNamesCovered: result.report.mapping.registrationNamesCovered,
      strictCompatibilityVerified: false,
    }, evidenceIntegrityVerified: result.evidenceIntegrityVerified ?? false,
    blockers: result.report.blockers,
  }, null, 2));
  return result.report.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) {
    console.error(`Native model-design build probe failed: ${error.message}`);
    process.exitCode = 1;
  }
}
