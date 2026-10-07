#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { optionalStat, PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import {
  RUNTIME_MODEL_PATH, selectModelDesignThirdParty, verifyNativeModelDesignBuildReport,
} from './harness-native-model-design-build.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const importMapPath = 'modelingweb/app/public/extras/json/system-import.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function read(path) {
  const directories = new PinnedDirectories();
  try {
    return readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  } finally { directories.close(); }
}

export function compareModelDesignBrowserImports(systemImports, map) {
  assert.ok(map && map.imports && typeof map.imports === 'object' && !Array.isArray(map.imports),
    'Expected a static import map imports object');
  assert.ok(systemImports.length && new Set(systemImports).size === systemImports.length,
    'Expected nonempty unique SystemJS imports');
  const imports = systemImports.map(name => {
    const exact = Object.hasOwn(map.imports, name) ? name : null;
    const prefix = Object.keys(map.imports).filter(key => key.endsWith('/') && name.startsWith(key))
      .sort((a, b) => b.length - a.length)[0] ?? null;
    const key = exact ?? prefix;
    const value = key === null ? null : map.imports[key];
    assert.ok(value === null || typeof value === 'string', 'Unsupported import map target');
    const usable = typeof value === 'string' && value.length > 0 &&
      (key === exact || value.endsWith('/'));
    return { name, key, target: usable ? `${value}${key === exact ? '' : name.slice(key.length)}` : null,
      coveredByStaticMap: usable, deliveryVerified: false };
  });
  return {
    status: 'static-global-import-map-coverage-only-not-browser-acceptance',
    imports, missing: imports.filter(item => !item.coveredByStaticMap).map(item => item.name),
    scopesEvaluated: false, dynamicRegistrationEvaluated: false,
    browserExecuted: false, browserAccepted: false,
  };
}

export function inspectRuntimeLoaderExports(ts, bytes) {
  const ast = ts.createSourceFile('loader/index.mjs', bytes.toString(),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const exports = ast.statements.filter(statement => ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.exportClause && ts.isNamedExports(statement.exportClause))
    .flatMap(statement => statement.exportClause.elements.map(item => ({
      name: item.name.text, imported: (item.propertyName ?? item.name).text,
      module: statement.moduleSpecifier.text,
    })));
  return {
    role: 'compiled-loader-export-observation-not-authenticated-runtime-source-api',
    exports,
    requestedNamesObserved: ['applyPolyfills', 'defineCustomElements']
      .every(name => exports.some(item => item.name === name)),
    authenticSourceRecovered: false, sourceBuildVerified: false, behavioralCompatibilityVerified: false,
  };
}

export function inspectModelDesignActionArguments(ts, files) {
  const calls = [];
  const unrecognizedExecCalls = [];
  for (const file of files.filter(item => /\.(?:ts|tsx)$/.test(item.path))) {
    const ast = ts.createSourceFile(file.path, file.data.toString(),
      ts.ScriptTarget.Latest, true, file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const tables = new Map();
    for (const statement of ast.statements) {
      if (!ts.isVariableStatement(statement) ||
          !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer ||
            !ts.isObjectLiteralExpression(declaration.initializer)) continue;
        const entries = declaration.initializer.properties.filter(property =>
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
          ts.isStringLiteral(property.initializer))
          .map(property => ({ key: property.name.text, action: property.initializer.text }));
        tables.set(declaration.name.text, entries);
      }
    }
    function literals(node) {
      if (!node) return [];
      if (ts.isStringLiteral(node)) return [node.text];
      if (ts.isParenthesizedExpression(node)) return literals(node.expression);
      if (ts.isConditionalExpression(node)) return [...literals(node.whenTrue), ...literals(node.whenFalse)];
      return [];
    }
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'exec') {
        const receiver = node.expression.expression;
        const index = ts.isIdentifier(receiver) && receiver.text === 'service' ? 0 :
          ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'deService' ? 1 : null;
        const location = { path: file.path,
          line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          expression: node.expression.getText(ast) };
        if (index === null) unrecognizedExecCalls.push(location);
        else {
          const argument = node.arguments[index];
          const table = argument && ts.isElementAccessExpression(argument) &&
            ts.isIdentifier(argument.expression) ? argument.expression.text : null;
          const literalTableObservation = table && tables.has(table)
            ? { name: table, entries: tables.get(table),
              role: 'top-level-table-values-only-not-scope-or-index-resolution' } : null;
          calls.push({ ...location, actionArgumentIndex: index,
            actionExpression: argument?.getText(ast) ?? null,
            literalActions: [...new Set(literals(argument))].sort(), literalTableObservation,
            dynamicSelection: !argument || !ts.isStringLiteral(argument),
            receiverTypeVerified: false, selectedActionExecuted: false });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return {
    status: 'syntactic-service-action-arguments-only-not-api-acceptance',
    calls, unrecognizedExecCalls,
    observedActions: [...new Set(calls.flatMap(call => [
      ...call.literalActions, ...(call.literalTableObservation?.entries ?? []).map(item => item.action),
    ]))].sort(),
    typeResolutionExecuted: false, dynamicInputsVerified: false,
    completeApiSurfaceVerified: false, endpointExecuted: false, strictApiCompatibilityVerified: false,
  };
}

export function compareModelDesignActionDeclarations(actions, apps) {
  assert.ok(actions.length && actions.every(action => typeof action === 'string') &&
    new Set(actions).size === actions.length, 'Expected nonempty unique action names');
  return {
    status: 'static-declared-actions-only-not-endpoint-validation',
    actions,
    apps: apps.map(({ app, entities }) => ({
      app, entities: entities.map(({ model, ...evidence }) => {
        const names = [...(model.getAllPSAppDEMethods ?? []), ...(model.getAllPSAppDEActions ?? [])]
          .flatMap(item => [item.name, item.codeName])
          .filter(name => typeof name === 'string').map(name => name.toLowerCase());
        return { ...evidence, matchingActions: actions.filter(action => names.includes(action.toLowerCase())) };
      }),
    })).map(app => ({
      ...app, actions: actions.map(action => ({
        action, matchingEntities: app.entities.filter(entity => entity.matchingActions.includes(action))
          .map(entity => entity.name),
      })),
    })),
    entitySelectionVerified: false, requestResponseCompatibilityVerified: false,
    endpointExecuted: false, strictApiCompatibilityVerified: false,
  };
}

export function inspectNativeModelDesignCompatibility(options = {}) {
  const workspace = resolve(options.workspace ?? workspaceDefault);
  const root = join(workspace, '.artifacts/native-model-design-compatibility');
  const destination = resolve(workspace, options.output ?? join(root, `compatibility-${randomUUID()}`));
  assert.equal(dirname(destination), root, 'Output must be a direct child of the compatibility artifact root');
  assert.match(basename(destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Invalid output directory name');
  assert.ok(!optionalStat(destination), 'Existing evidence must not be overwritten');
  const build = verifyNativeModelDesignBuildReport({ workspace, sourceReport: options.sourceReport });
  const mapBytes = read(join(workspace, importMapPath));
  const map = JSON.parse(mapBytes);
  const loaderPath = `${RUNTIME_MODEL_PATH}/loader/index.mjs`;
  const loaderBytes = read(join(workspace, loaderPath));
  const recordedLoader = build.report.runtime.compiledObservation.entries
    .find(item => item.path === 'loader/index.mjs');
  assert.equal(hash(loaderBytes), recordedLoader.sha256, 'Runtime loader differs from pinned build observation');
  const tsLink = build.report.dependencies.links.find(item => item.name === 'typescript');
  const ts = createRequire(join(tsLink.target, 'package.json'))(tsLink.target);
  const sourceFiles = build.report.source.entries.filter(item =>
    item.path.startsWith('src/') && /\.(?:ts|tsx)$/.test(item.path)).map(item => {
    const data = read(join(build.report.packageRoot, item.path));
    assert.equal(hash(data), item.sha256, 'Verified plugin source changed during API analysis');
    return { path: item.path, data };
  });
  const serviceArguments = inspectModelDesignActionArguments(ts, sourceFiles);
  const declaredServiceActions = compareModelDesignActionDeclarations(serviceArguments.observedActions,
    build.report.apiActions.apps.map(app => ({
      app: app.app, entities: app.entities.map(({ matchingActions, ...entity }) => {
        const data = read(join(workspace, entity.path));
        assert.equal(hash(data), entity.sha256, 'Original action entity changed during API analysis');
        return { ...entity, model: JSON.parse(data) };
      }),
    })));
  const semverPackage = selectModelDesignThirdParty([
    join(workspace, 'modelingweb/app'), join(workspace, 'ibiz-app-hub'),
  ], 'semver', null, null);
  assert.ok(semverPackage, 'Real semver parser required');
  const semver = createRequire(join(semverPackage.realpath, 'package.json'))(semverPackage.realpath);
  const browserImports = compareModelDesignBrowserImports(build.report.artifacts.systemImports, map);
  const runtimeEndpoint = build.report.apiActions.apps.map(app => {
    const entity = app.entities.find(item => item.name === 'PSDEVSLNSYS');
    assert.ok(entity, `Missing PSDEVSLNSYS observation in ${app.app}`);
    const bytes = read(join(workspace, entity.path));
    assert.equal(hash(bytes), entity.sha256, 'Original runtime endpoint entity changed');
    const model = JSON.parse(bytes);
    const methods = [
      ...(model.getAllPSAppDEMethods ?? []), ...(model.getAllPSAppDEActions ?? []),
    ].filter(item => [item.name, item.codeName].some(name =>
      typeof name === 'string' && name.toLowerCase() === 'getruntimenodes'));
    return { app: app.app, path: entity.path, sha256: entity.sha256,
      method: 'getruntimenodes', declared: methods.length > 0, methods,
      endpointExecuted: false, requestResponseCompatibilityVerified: false };
  });
  const axiosRange = build.report.dependencies.links.find(item => item.name === 'axios').declared;
  const axiosPath = browserImports.imports.find(item => item.name === 'axios')?.target;
  const axiosPathHint = axiosPath === '../js/axios/1.6.1/axios.system.min.js' ? '1.6.1' : null;
  const report = {
    schemaVersion: 1, contract: 'native-model-design-static-compatibility-evidence',
    generatedAt: new Date().toISOString(),
    buildEvidence: { path: build.reportPath, sha256: build.reportSha256, integrityVerified: true },
    mapping: build.report.mapping,
    importMap: { path: importMapPath, bytes: mapBytes.length, sha256: hash(mapBytes) },
    browserImports,
    compiledLoader: { path: loaderPath, bytes: loaderBytes.length, sha256: hash(loaderBytes),
      ...inspectRuntimeLoaderExports(ts, loaderBytes) },
    api: {
      declaredActions: build.report.apiActions,
      declaredActionsRole: 'historical-build-first-argument-literal-subset-not-complete-api-surface',
      serviceArguments, declaredServiceActions,
      runtimeEndpoint,
      originalAlpha90ImplementationAvailableForDiff: false,
      strictApiCompatibilityVerified: false,
    },
    browserVersionHint: {
      name: 'axios', declaredRange: axiosRange, target: axiosPath, versionFromPathOnly: axiosPathHint,
      rangeSatisfiedByPathHint: axiosPathHint ? semver.satisfies(axiosPathHint, axiosRange) : null,
      packageIdentityAuthenticated: false, actualBrowserApiVerified: false,
    },
    sourceBuild: {
      fullDeclaredBuildSucceeded: build.report.fullDeclaredBuildSucceeded,
      typecheckSucceeded: build.report.typecheckSucceeded,
      diagnostics: build.report.typecheckDiagnostics,
      outputFingerprint: build.report.outputs.fingerprint,
      resourceCopies: build.report.resourceCopies,
    },
    status: 'compatibility-evidence-only-candidate-blocked',
    blockers: [
      ...build.report.blockers,
      ...browserImports.missing.map(name => `static-browser-import-map-missing:${name}`),
    ],
    exactVersionReproductionVerified: false, strictCompatibilityVerified: false,
    nativeAccepted: false, acceptedForProduction: false,
    runtimeModelSourceRecovered: false, deploymentExecuted: false, exitCode: 2,
  };
  const directories = new PinnedDirectories();
  try {
    const candidate = directories.open(destination, { create: true, exclusive: true });
    assert.deepEqual(read(join(workspace, importMapPath)), mapBytes, 'Static import map changed during analysis');
    assert.deepEqual(read(join(workspace, loaderPath)), loaderBytes, 'Compiled runtime loader changed during analysis');
    for (const file of sourceFiles) {
      assert.deepEqual(read(join(build.report.packageRoot, file.path)), file.data,
        'Plugin source changed during analysis');
    }
    for (const app of declaredServiceActions.apps) {
      for (const entity of app.entities) {
        assert.equal(hash(read(join(workspace, entity.path))), entity.sha256,
          'Original action entity changed during analysis');
      }
    }
    const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    directories.write(candidate, 'report.json', bytes);
    directories.write(candidate, 'report.sha256', Buffer.from(`${hash(bytes)}\n`));
    assert.deepEqual(readPinnedFile(directories, candidate, 'report.json').data, bytes);
    directories.verify(candidate);
    return { report, reportPath: join(destination, 'report.json'), reportSha256: hash(bytes) };
  } finally { directories.close(); }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args, options: {
      'source-report': { type: 'string' }, output: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/inspect-native-model-design-compatibility.mjs --source-report PATH [--output PATH]');
    console.log('Static model-design-only evidence; no installs, source reconstruction, deployment or browser acceptance.');
    console.log('Exit 2 preserves unresolved compatibility gates; existing evidence is never overwritten.');
    return 0;
  }
  const result = inspectNativeModelDesignCompatibility({
    sourceReport: values['source-report'], output: values.output,
  });
  console.log(JSON.stringify({
    reportPath: result.reportPath, reportSha256: result.reportSha256, status: result.report.status,
    missingStaticImports: result.report.browserImports.missing,
    observedActions: result.report.api.serviceArguments.observedActions,
    runtimeEndpoint: result.report.api.runtimeEndpoint.map(({ app, declared }) => ({ app, declared })),
    strictCompatibilityVerified: false, exactVersionReproductionVerified: false,
  }, null, 2));
  return result.report.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) {
    console.error(`Model-design compatibility evidence failed: ${error.message}`);
    process.exitCode = 1;
  }
}
