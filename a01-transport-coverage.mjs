import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeMatrix, validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { a01InvalidRootRequest, createA01RootPlan } from './owned-a01-root-http.mjs';

const backend = 'ibiz-service-hub/';
const modelApi = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSSERVICEAPIS/ModelAPI.json';
const security = `${backend}libs/ibiz-modeling-core/src/`;
const runtime = `${backend}libs/ibiz-runtime/src/main/java/net/ibizsys/`;
const cloud = `${backend}libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/`;
const workspaceDefault = fileURLToPath(new URL('../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');

export const A01_TRANSPORT_SOURCE_PATHS = Object.freeze({
  matrix: 'scripts/prepare-run-owned-native-nonadmin-matrix.mjs',
  modelApi,
  handler: `${cloud}service/util/MethodHandlerBase.java`,
  adapter: `${cloud}service/StandardSysServiceAPIRequestMappingAdapter.java`,
  binding: `${runtime}central/dataentity/service/DEServiceAPIRuntime.java`,
  rootAccess: `${security}main/java/net/ibizsys/modeling/core/dataentity/security/PSModelDEAccessManager.java`,
  entity: `${runtime}runtime/util/EntityBase.java`,
  appContext: `${runtime}runtime/util/AppContext.java`,
  mapperTest: `${security}test/java/net/ibizsys/modeling/core/security/SystemAccessManagerRootErrorMappingTest.java`,
  registryTest: `${security}test/java/net/ibizsys/modeling/core/security/SystemAccessManagerEditorRegistryTest.java`,
  requestCacheTest: `${security}test/java/net/ibizsys/modeling/core/security/SystemAccessManagerRequestCacheTest.java`,
});

export function readA01TransportSources(workspace = workspaceDefault) {
  return Object.fromEntries(Object.entries(A01_TRANSPORT_SOURCE_PATHS)
    .map(([name, path]) => [name, readFileSync(resolve(workspace, path), 'utf8')]));
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function sourceAnchor(source, text) {
  const offset = source.indexOf(text);
  assert.ok(offset >= 0, `A01 source association needs re-review: ${text}`);
  return { text, line: source.slice(0, offset).split('\n').length };
}

function publishedMethod(methods, name, method, action, keyed) {
  const matches = methods.filter(row => row.name === name);
  assert.equal(matches.length, 1, `${name} must have one published method`);
  const row = matches[0];
  assert.deepEqual([row.requestMethod, row.dataAccessAction, row.needResourceKey === true],
    [method, action, keyed]);
  if (name === 'FetchCurSys') {
    assert.equal(row.methodType, 'FETCH');
    assert.equal(row.codeName, name);
  } else {
    assert.equal(row.methodType, 'DEACTION');
    assert.equal(row.noServiceCodeName, true);
  }
  return { name, method, accessAction: action, keyed };
}

export function reviewA01TransportSources(sources) {
  assert.deepEqual(Object.keys(sources).sort(), Object.keys(A01_TRANSPORT_SOURCE_PATHS).sort());
  for (const source of Object.values(sources)) assert.equal(typeof source, 'string');
  const anchors = {
    matrix: ["['absent', undefined], ['null', null], ['empty', ''], ['number-zero', 0]"],
    handler: [
      'public void pfetch(@PathVariable(name = "pkey") String pkey',
      'public void ppost(@PathVariable(name = "pkey") String pkey',
      'public void fetch(@RequestBody Object requestData',
      'public void post(@RequestBody Object requestData, @PathVariable(name = "key") String key',
    ],
    adapter: [
      'if(iDEServiceAPIRuntime.getAPIMode() == DEServiceAPIModes.MINOR) {\n\t\t\treturn;',
      'strPath + "/" + iPSDEServiceAPIMethod.getCodeName().toLowerCase()',
      'invokeDEMethod(null, null, null, iDEServiceAPIRuntime.getPSDEServiceAPI().getName(), iPSDEServiceAPIMethod.getCodeName(), requestData, key, null)',
      'invokeDEMethod(null, null, null, iDEServiceAPIRuntime.getPSDEServiceAPI().getName(), iPSDEServiceAPIMethod.getPSDEActionMust().getCodeName(), requestData, key, null)',
      'MethodHandlerBase.getFetchMethod()',
      'MethodHandlerBase.getPostMethod()',
    ],
    binding: [
      'if (iDEServiceAPIRSRuntime != null) {',
      'iAppContext.set(iDEServiceAPIRSRuntime.getMajorDEServiceAPIRuntime().getName(), strParentKey)',
      '.testDataAccessAction(UserContext.getCurrent()',
    ],
    rootAccess: [
      'Object root = appContext.get(APPCONTEXT_PSDEVSLNSYS)',
      'if (!(root instanceof String)',
      'testDataAccessAction(\n            IUserContext userContext',
      'ISearchContextDTO searchContextDTO,',
    ],
    entity: ['paramMap.put(strName, objValue);'],
    appContext: ['public void set(String strName, Object objValue)', 'super.set(strName.toUpperCase(), objValue);'],
    mapperTest: [
      'void malformedModelRootsMapTo403ForRecordAndSearchReadAndUpdate()',
      'for (Object root : Arrays.asList(null, "", " ", "\\t", 0,',
      'if (root != null) app.set("PSDEVSLNSYS", root);',
      'void explicitlyNullModelRootMapsTo403ForRecordAndSearchReadAndUpdate()',
      'app.set("PSDEVSLNSYS", null);\n        assertTrue(app.contains("PSDEVSLNSYS"));\n        assertNull(app.get("PSDEVSLNSYS"));\n\n        assertModelRootDenied(app);\n\n        assertTrue(app.contains("PSDEVSLNSYS"));\n        assertNull(app.get("PSDEVSLNSYS"));',
      'for (String action : Arrays.asList("READ", "UPDATE"))',
      'manager.testDataAccessAction(user, null, null, "owned-record", input, action)',
      'manager.testDataAccessAction(user, null, null, search, action)',
      'assertMapped(recordFailure, 403, Errors.ACCESSDENY)',
      'assertMapped(searchFailure, 403, Errors.ACCESSDENY)',
      'assertEquals(inputBefore, input.any());',
      'assertEquals(searchBefore, search.any());',
      'handler.getResponseEntity(failure)',
    ],
    registryTest: [
      'void absentNullNumericAndMalformedTypedRootsFailBeforeAnyAuthorizationLookup()',
      'contexts.add(new AppContext());',
      'for (Object value : Arrays.asList(null, "", 0, -1, Boolean.TRUE, ROOT_A + " ", ROOT_A + "\\n"))',
      'contexts.add(root(value));',
      'context.set("PSDEVSLNSYS", value);',
      'manager.testDataAccessAction(\n                        UserContext.getCurrentMust(), null, null, "fixture-record", input, "READ")',
    ],
    requestCacheTest: [
      'void malformedRequestRootsAreRejectedWithoutLookup()',
      'for (Object root : new Object[] {null, "", " ", 123,',
      'ActionSessionManager.getAppContext().set("PSDEVSLNSYS", root);',
      'assertNull(manager.current(true))',
      'assertThrows(Exception.class, () -> manager.current(false))',
    ],
  };
  const files = Object.entries(A01_TRANSPORT_SOURCE_PATHS).map(([name, path]) => ({
    name, path, sha256: digest(sources[name]),
    anchors: (anchors[name] ?? []).map(text => sourceAnchor(sources[name], text)),
  }));
  const api = JSON.parse(sources.modelApi);
  const modules = api.getPSDEServiceAPIs.filter(row => row.name === 'PSMODULE');
  assert.equal(modules.length, 1);
  assert.equal(modules[0].aPIMode, 1, 'A top-level HTTP candidate requires the declared MAJOR interface');
  assert.equal(modules[0].codeName, 'PSModule');
  const relations = api.getPSDEServiceAPIRSs.filter(row => row.getMajorPSDEServiceAPI.id === 'PSDevSlnSys'
    && row.getMinorPSDEServiceAPI.id === 'PSModule');
  assert.equal(relations.length, 1);
  const methods = [
    ['FetchCurSys', 'POST', 'READ', false], ['Update', 'PUT', 'UPDATE', true],
  ];
  return freeze({
    evidenceClass: 'anchored-current-source-association-not-test-execution',
    files,
    publishedParentMethods: methods.map(args => publishedMethod(relations[0].getPSDEServiceAPIMethods, ...args)),
    publishedParentlessMethods: methods.map(args => publishedMethod(modules[0].getPSDEServiceAPIMethods, ...args)),
    explicitNullMapperSourceEvidence: true,
    explicitNullMapperMethod: 'explicitlyNullModelRootMapsTo403ForRecordAndSearchReadAndUpdate',
    explicitNullMapperBoundary: 'The explicit-null source test checks present-null before/after record/search READ and UPDATE mapping; it is not six-actor native matrix execution.',
    matrixActorReplayProven: false,
  });
}

function javaEntry(row) {
  const setup = {
    absent: { present: false, javaSetup: 'new AppContext(); do not set PSDEVSLNSYS',
      check: 'contains("PSDEVSLNSYS") == false' },
    null: { present: true, valueType: 'null',
      javaSetup: 'AppContext.set("PSDEVSLNSYS", null)',
      check: 'contains("PSDEVSLNSYS") == true && get("PSDEVSLNSYS") == null' },
    empty: { present: true, valueType: 'String',
      javaSetup: 'AppContext.set("PSDEVSLNSYS", "")',
      check: 'contains("PSDEVSLNSYS") == true && "".equals(get("PSDEVSLNSYS"))' },
    'number-zero': { present: true, valueType: 'Integer',
      javaSetup: 'AppContext.set("PSDEVSLNSYS", Integer.valueOf(0))',
      check: 'get("PSDEVSLNSYS") instanceof Integer && ((Integer)get("PSDEVSLNSYS")) == 0' },
  }[row.rootKind];
  return {
    setup,
    managerEntry: row.accessAction === 'READ'
      ? 'PSModelDEAccessManager.testDataAccessAction(user, null, null, searchContextDTO, "READ")'
      : 'PSModelDEAccessManager.testDataAccessAction(user, null, null, sentinelId, inputEntityDTO, "UPDATE")',
    nativeApiEntry: 'Actual PSModule DEServiceAPIRuntime.invokeMethod with no parent relationship; retain the typed AppContext until the manager entry.',
    mapperEntry: 'ResponseExceptionHandler.getResponseEntity(actualFailure); assert 403 / ACCESSDENY and original inputs unchanged.',
    actorReplayRequired: true,
    sourceAndRuntimeBindingRequired: true,
    fullPhysicalBeforeAfterRequired: true,
    executedByClassifier: false,
  };
}

function shapeAssociation(kind, sources) {
  const mapper = sources.files.find(file => file.name === 'mapperTest');
  const registry = sources.files.find(file => file.name === 'registryTest');
  const cache = sources.files.find(file => file.name === 'requestCacheTest');
  return {
    evidenceClass: 'source-test-shape-only-not-matrix-case-execution',
    mapper: {
      explicitShapePresent: true,
      path: mapper.path,
      method: kind === 'null' ? sources.explicitNullMapperMethod
        : 'malformedModelRootsMapTo403ForRecordAndSearchReadAndUpdate',
      actions: ['READ', 'UPDATE'],
      entryForms: ['record', 'search'],
      actorMatrixCovered: false, executedByClassifier: false,
      ...(kind === 'null' ? { boundary: sources.explicitNullMapperBoundary } : {}),
    },
    managerFactory: {
      path: registry.path,
      method: 'absentNullNumericAndMalformedTypedRootsFailBeforeAnyAuthorizationLookup',
      actions: ['READ'], entryForms: ['record', 'search'], actorMatrixCovered: false,
    },
    currentRootLookup: {
      path: cache.path, method: 'malformedRequestRootsAreRejectedWithoutLookup',
      explicitShapePresent: kind === 'null' || kind === 'empty',
      equivalentTypeClassOnly: kind === 'number-zero',
      limitation: kind === 'number-zero' ? 'This suite uses Integer 123, not the matrix exact value 0.'
        : kind === 'absent' ? 'The malformed-request loop always sets the key; it does not supply an absent-key case.' : null,
      actorMatrixCovered: false,
    },
  };
}

export function classifyA01TransportCoverage(manifest, sources, options = {}) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options),
    'A01 transport options must be an object');
  assert.ok(Object.keys(options).every(key => key === 'includeParentlessAbsent'),
    'Unknown A01 transport option');
  const { includeParentlessAbsent = false } = options;
  assert.equal(typeof includeParentlessAbsent, 'boolean');
  validateMatrixFixture(manifest);
  const sourceEvidence = reviewA01TransportSources(sources);
  const original = createNativeMatrix(manifest).invalidRootCases;
  const defaultPlan = createA01RootPlan(manifest);
  const planOptions = { includeParentlessAbsent };
  const existingPlan = createA01RootPlan(manifest, planOptions);
  const rows = original.map(canonicalCase => {
    const planned = existingPlan.invalidRootCases.find(row => row.id === canonicalCase.id);
    assert.ok(planned);
    const currentRequest = a01InvalidRootRequest(manifest, planned, planOptions);
    if (currentRequest && canonicalCase.rootKind !== 'absent') return {
      canonicalCase,
      lane: 'existing-native-parent-http',
      faithfulParentString: true,
      currentRunnerSupportsDispatch: true,
      currentRequest,
      requiredEntry: 'run-owned-a01-root-http.mjs with current source/image/model bindings, six verified actors and full physical snapshots.',
      executionClaimed: false,
    };
    const typedEntry = javaEntry(canonicalCase);
    assert.ok(typedEntry.setup, 'New matrix root kind requires a transport review');
    const ownRoot = manifest.roots.find(root => root.rootId ===
      manifest.users.find(user => user.loginname === canonicalCase.principal.loginname).rootId);
    const absenceCandidate = canonicalCase.rootKind === 'absent';
    return {
      canonicalCase,
      lane: absenceCandidate ? 'published-parentless-http-candidate' : 'native-java-typed-boundary',
      faithfulParentString: false,
      currentRunnerSupportsDispatch: currentRequest !== null,
      currentRequest,
      ...(absenceCandidate ? { httpCandidate: {
        method: canonicalCase.accessAction === 'READ' ? 'POST' : 'PUT',
        path: `/api/ibizmodeling__modeldesign/psmodules/${
          canonicalCase.accessAction === 'READ' ? 'fetchcursys' : ownRoot.sentinelId}`,
        selectedByOption: includeParentlessAbsent,
        approvedForDispatch: false,
        requiredGates: [
          'Bind the top-level PSModule MAJOR methods in the actual staged ModelAPI and standard mapping adapter.',
          'Use a fresh ordinary authenticated request; prove PSDEVSLNSYS is absent immediately before native access checking.',
          'Do not seed a root in appdata, claims, headers, body or a prior request; do not replace a null/empty/zero case with this absence path.',
          'Select --include-parentless-absent through the exact runner validator; enabling it is not runtime evidence or permission to change the 84-case denominator.',
          'Retain separate physical before/after snapshots, native rejection status and all six original actors.',
        ],
      } } : {}),
      javaEntry: typedEntry,
      javaSourceAssociation: shapeAssociation(canonicalCase.rootKind, sourceEvidence),
      forbiddenSurrogates: ['String(null)', 'String(0)', 'double-slash URL', 'JSON body root', 'unreviewed application-context header'],
      executionClaimed: false,
    };
  });
  assert.equal(rows.length, 84);
  assert.deepEqual(rows.map(row => row.canonicalCase), original, 'The original cases and expected outcomes must remain unchanged');
  const count = lane => rows.filter(row => row.lane === lane).length;
  return freeze({
    contract: 'a01-layered-transport-coverage-v1',
    runId: manifest.runId,
    status: 'classified-current-source-only-not-executed',
    canonicalInvalidRootCasesSha256: digest(JSON.stringify(original)),
    counts: {
      originalLogicalCases: original.length,
      default: {
        supportedHttp: defaultPlan.counts.representable,
        blocked: defaultPlan.counts.blocked,
        parentlessAbsentSelected: false,
      },
      selected: {
        includeParentlessAbsent,
        supportedHttp: existingPlan.counts.representable,
        blocked: existingPlan.counts.blocked,
        parentlessAbsentSelected: includeParentlessAbsent,
      },
      existingNativeParentHttp: count('existing-native-parent-http'),
      publishedParentlessHttpCandidates: count('published-parentless-http-candidate'),
      nativeJavaTypedBoundaryRequired: count('native-java-typed-boundary'),
      stillBlockedInExistingHttpRunner: rows.filter(row => !row.currentRunnerSupportsDispatch).length,
      matrixCaseExecutionsProven: 0,
    },
    sourceEvidence,
    rows,
    nativeAcceptance: false, permissionAcceptance: false, fullA01Acceptance: false,
    typedRootHTTPAcceptance: false,
    boundary: 'Source classification only; reads no credentials or private runtime receipts and dispatches no Docker, SQL, HTTP or Java.',
  });
}
